'use strict';
// 008 T001: grounding-чек судьи. Судья обязан вернуть filesReviewed — код механически
// сверяет его со списком файлов диффа (из git status --porcelain, не из самого диффа —
// диф режется по cap, status нет). Три отказа форсируют block независимо от того, что
// сказала модель: судья не мог реально смотреть файл, которого нет в диффе (галлюцинация),
// или не смотреть файл, который есть (судил не весь слайс), или дать вердикт без причины.
//
// Гоняем ЧЕРЕЗ ту же функцию, что и прод/бенч (gate.judgeDiff), стаб подменяет CLI-бинарь
// (FLEET_BIN_CLAUDE), а не саму функцию — иначе тест доказывает не то, что работает в проде.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gate = require('./fleet/gate');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-grounding-'));

// Стаб claude: печатает тот же конверт, что `claude -p --output-format json --json-schema`
// (массив, последний элемент — result со structured_output). filesReviewed кладётся ТОЛЬКО
// если явно задан в JUDGE_RESP — так тестируем и «поле отсутствует» (обратная совместимость
// со старым провайдером/стабом без схемы), и «поле пустое/неверное» (реальный grounding-отказ).
const STUB = path.join(TMP, 'stub.js');
fs.writeFileSync(STUB, `
let inp = '';
process.stdin.on('data', (b) => { inp += b; });
process.stdin.on('end', () => {
  const resp = JSON.parse(process.env.JUDGE_RESP);
  const so = { verdict: resp.verdict, reasons: resp.reasons };
  if (Object.prototype.hasOwnProperty.call(resp, 'filesReviewed')) so.filesReviewed = resp.filesReviewed;
  process.stdout.write(JSON.stringify([{ type: 'result', structured_output: so }]));
});
`);

function withStub(resp, fn) {
  const prevBin = process.env.FLEET_BIN_CLAUDE;
  const prevResp = process.env.JUDGE_RESP;
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', STUB]);
  process.env.JUDGE_RESP = JSON.stringify(resp);
  return Promise.resolve(fn()).finally(() => {
    if (prevBin === undefined) delete process.env.FLEET_BIN_CLAUDE; else process.env.FLEET_BIN_CLAUDE = prevBin;
    if (prevResp === undefined) delete process.env.JUDGE_RESP; else process.env.JUDGE_RESP = prevResp;
  });
}

const STATUS_ONE_FILE = ' M a.js\n';
const STATUS_TWO_FILES = ' M a.js\n?? b.js\n';

test('judgeDiff: честный вердикт — filesReviewed совпадает со списком файлов диффа → pass проходит', async () => {
  const r = await withStub(
    { verdict: 'pass', reasons: ['в границах задачи'], filesReviewed: ['a.js'] },
    () => gate.judgeDiff({ cwd: TMP, tid: 'T1', taskText: 'demo', diff: 'diff a.js', status: STATUS_ONE_FILE, provider: 'claude', model: 'sonnet', timeoutMs: 30000 }),
  );
  assert.equal(r.runOk, true);
  assert.equal(r.verdict, 'pass');
  assert.deepEqual(r.reasons, ['в границах задачи']);
  assert.deepEqual(r.filesReviewed, ['a.js']);
});

test('judgeDiff: filesReviewed называет файл не из диффа → block grounding:phantom-file', async () => {
  const r = await withStub(
    { verdict: 'pass', reasons: ['выглядит нормально'], filesReviewed: ['b.js'] }, // b.js не в диффе
    () => gate.judgeDiff({ cwd: TMP, tid: 'T1', taskText: 'demo', diff: 'diff a.js', status: STATUS_ONE_FILE, provider: 'claude', model: 'sonnet', timeoutMs: 30000 }),
  );
  assert.equal(r.verdict, 'block', 'галлюцинированный файл форсирует block вопреки pass модели');
  assert.ok(r.reasons.includes('grounding:phantom-file'));
});

test('judgeDiff: filesReviewed пропускает файл диффа → block grounding:unreviewed-file', async () => {
  const r = await withStub(
    { verdict: 'pass', reasons: ['выглядит нормально'], filesReviewed: ['a.js'] }, // b.js из диффа не разобран
    () => gate.judgeDiff({ cwd: TMP, tid: 'T1', taskText: 'demo', diff: 'diff a.js + b.js', status: STATUS_TWO_FILES, provider: 'claude', model: 'sonnet', timeoutMs: 30000 }),
  );
  assert.equal(r.verdict, 'block', 'непокрытый файл диффа форсирует block вопреки pass модели');
  assert.ok(r.reasons.includes('grounding:unreviewed-file'));
});

test('judgeDiff: пустой reasons при любом вердикте → block grounding:no-reasons', async () => {
  const r = await withStub(
    { verdict: 'pass', reasons: [], filesReviewed: ['a.js'] },
    () => gate.judgeDiff({ cwd: TMP, tid: 'T1', taskText: 'demo', diff: 'diff a.js', status: STATUS_ONE_FILE, provider: 'claude', model: 'sonnet', timeoutMs: 30000 }),
  );
  assert.equal(r.verdict, 'block');
  assert.ok(r.reasons.includes('grounding:no-reasons'));
});

test('judgeDiff: block без grounding-отказов остаётся block по причине модели (не граунд)', async () => {
  const r = await withStub(
    { verdict: 'block', reasons: ['scope creep'], filesReviewed: ['a.js'] },
    () => gate.judgeDiff({ cwd: TMP, tid: 'T1', taskText: 'demo', diff: 'diff a.js', status: STATUS_ONE_FILE, provider: 'claude', model: 'sonnet', timeoutMs: 30000 }),
  );
  assert.equal(r.verdict, 'block');
  assert.deepEqual(r.reasons, ['scope creep'], 'граундинг молчит — reasons не тронуты');
});

// Обратная совместимость: провайдер/стаб без поддержки поля (filesReviewed вообще
// отсутствует в ответе, а не пустой массив) — граундинг-чек по файлам не имеет сигнала и
// молчит, чтобы не рубить существующие проводки (gate.test.js/judge-bench.test.js), которые
// ещё не знают про filesReviewed. Непустой reasons здесь обязателен: no-reasons безусловен
// и сработал бы даже без filesReviewed (см. тест checkGrounding ниже).
test('judgeDiff: filesReviewed отсутствует в ответе вовсе → граундинг по файлам не срабатывает (обратная совместимость)', async () => {
  const r = await withStub(
    { verdict: 'pass', reasons: ['ok'] }, // filesReviewed вообще не в ключах
    () => gate.judgeDiff({ cwd: TMP, tid: 'T1', taskText: 'demo', diff: 'diff a.js', status: STATUS_ONE_FILE, provider: 'claude', model: 'sonnet', timeoutMs: 30000 }),
  );
  assert.equal(r.verdict, 'pass', 'нет сигнала о filesReviewed — старое поведение сохранено');
  assert.deepEqual(r.filesReviewed, []);
});

// --- Чистые функции напрямую ---
test('diffFileList: парсит porcelain-строки, переименование берёт новый путь', () => {
  assert.deepEqual(gate.diffFileList(' M a.js\n?? b.js\n'), ['a.js', 'b.js']);
  assert.deepEqual(gate.diffFileList('R  old.js -> new.js\n'), ['new.js']);
  assert.deepEqual(gate.diffFileList(''), []);
});

test('checkGrounding: чистая функция трёх отказов + честный случай', () => {
  assert.equal(gate.checkGrounding(STATUS_ONE_FILE, ['a.js'], ['ok']), null, 'совпало — граунд молчит');
  assert.equal(gate.checkGrounding(STATUS_ONE_FILE, ['b.js'], ['ok']), 'grounding:phantom-file');
  assert.equal(gate.checkGrounding(STATUS_TWO_FILES, ['a.js'], ['ok']), 'grounding:unreviewed-file');
  assert.equal(gate.checkGrounding(STATUS_ONE_FILE, ['a.js'], []), 'grounding:no-reasons');
  // filesReviewed===null — провайдер не знает про поле (легаси-стаб/старая схема): молчат
  // только ФАЙЛОВЫЕ проверки, сверять действительно нечего.
  assert.equal(gate.checkGrounding(STATUS_ONE_FILE, null, ['ok']), null, 'filesReviewed отсутствует — по файлам не проверяем');
  // …но no-reasons безусловен. Иначе провайдер без structured output (codex/agy отвечают
  // JSON-хвостом, инструкции держат не всегда) просто не вернул бы filesReviewed — и
  // мотивирующий баг спеки (7f8183b: pass с reasons:[] прошёл гейт) остался бы живым.
  assert.equal(gate.checkGrounding(STATUS_ONE_FILE, null, []), 'grounding:no-reasons', 'вердикт без причины не проводится никогда');
});

test('judgePrompt: секция «ФАЙЛЫ ДИФФА» из status + требование filesReviewed в тексте', () => {
  const p = gate.judgePrompt('T1', 'задача', 'diff', STATUS_TWO_FILES);
  assert.match(p, /ФАЙЛЫ ДИФФА/);
  assert.match(p, /a\.js/);
  assert.match(p, /b\.js/);
  assert.match(p, /filesReviewed/);
});

// --- 009 T001: пофайловый бюджет вместо слепой обрезки -----------------------------
// Мотив (аудит 24.07): cap 12K против живых диффов 67K/66K/44K — судья не видел хвост,
// но grounding требовал перечислить КАЖДЫЙ файл: честный вердикт получал unreviewed-file.
const { execFileSync } = require('node:child_process');

// Реальный git-репо с 8 файлами по ~7.5K = дифф ~60K. Тест гоняет прод-функцию slurpDiff,
// а не имитацию строки, — иначе доказывал бы не то, что работает в гейте.
function repo60K() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-bigdiff-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git('add', '-A'); git('commit', '-qm', 'base');
  fs.mkdirSync(path.join(root, 'src')); fs.mkdirSync(path.join(root, 'tests'));
  const files = [];
  for (let i = 0; i < 7; i++) {
    const rel = `src/mod${i}.js`;
    fs.writeFileSync(path.join(root, rel), `// mod${i}\n` + `const x${i} = 1;\n`.repeat(500));
    files.push(rel);
  }
  fs.writeFileSync(path.join(root, 'tests/big.test.js'), '// тест слайса\n' + 'assert(true);\n'.repeat(500));
  files.push('tests/big.test.js');
  git('add', '-N', '.'); // как в fleet: intent-to-add, иначе porcelain даёт каталог, а не файлы
  return { root, files };
}

test('slurpDiff: 60K-дифф на 8 файлов — каждый файл представлен, обрезка помечена явно, бюджет соблюдён', () => {
  const { root, files } = repo60K();
  const raw = execFileSync('git', ['diff', 'HEAD'], { cwd: root, encoding: 'utf8' })
    + execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  assert.ok(raw.length > 40000, `подготовленный дифф должен быть большим, а он ${raw.length}`);

  const { diff, status, omitted } = gate.slurpDiff(root, 12000, ['src/mod0.js']);
  assert.ok(diff.length <= 12000 * 1.2, `бюджет соблюдён (получено ${diff.length})`);
  assert.match(diff, /…\(файл обрезан: показано \d+ из \d+ символов\)…/, 'обрезка видна судье, а не молчит');
  const shown = files.filter((f) => diff.includes(f));
  assert.equal(shown.length + omitted.length, files.length, 'каждый файл диффа либо показан, либо в «НЕ ПОКАЗАНЫ»');
  assert.ok(diff.includes('tests/big.test.js'), 'тестовый файл приоритетен — показан всегда');
  assert.deepEqual(gate.diffFileList(status).sort(), [...files].sort());

  // Тесный бюджет: часть файлов физически не вмещается — они обязаны попасть в omitted,
  // а не исчезнуть молча (это и есть вход для «НЕ ПОКАЗАНЫ» + послабления грандинга).
  const tight = gate.slurpDiff(root, 2000, []);
  assert.ok(tight.omitted.length > 0, 'невместившиеся файлы объявлены, а не потеряны');
  assert.equal(files.filter((f) => tight.diff.includes(f)).length + tight.omitted.length, files.length);
  assert.ok(tight.diff.includes('tests/big.test.js'), 'тест не выпадает даже при тесном бюджете');
});

test('checkGrounding: невместившийся файл не даёт unreviewed-file, но фантом остаётся фантомом', () => {
  const status = ' M a.js\n M b.js\n';
  assert.equal(gate.checkGrounding(status, ['a.js'], ['ok'], process.cwd(), ['b.js']), null,
    'b.js судье не показывали — спрашивать за него нельзя');
  assert.equal(gate.checkGrounding(status, ['a.js'], ['ok'], process.cwd(), []), 'grounding:unreviewed-file',
    'показанный файл пропускать по-прежнему нельзя');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-omitted-'));
  assert.equal(gate.checkGrounding(status, ['a.js', 'b.js', 'выдумка.js'], ['ok'], empty, ['b.js']),
    'grounding:phantom-file', 'обрезка не открывает дверь галлюцинациям');
});

test('judgeDiff: честный вердикт на большом диффе больше не блокируется обрезкой', async () => {
  const r = await withStub(
    { verdict: 'pass', reasons: ['в границах задачи'], filesReviewed: ['a.js'] },
    () => gate.judgeDiff({ cwd: TMP, tid: 'T1', taskText: 'demo', diff: 'diff a.js …(файл обрезан: показано 400 из 40000 символов)…',
      status: STATUS_TWO_FILES, omitted: ['b.js'], provider: 'claude', model: 'sonnet', timeoutMs: 30000 }),
  );
  assert.equal(r.verdict, 'pass', 'b.js не показали — честный pass проходит');
  assert.deepEqual(r.reasons, ['в границах задачи']);
});

test('judgePrompt: секция «НЕ ПОКАЗАНЫ» перечисляет невместившиеся файлы', () => {
  const p = gate.judgePrompt('T1', 'задача', 'diff', STATUS_TWO_FILES, '', null, [], ['b.js']);
  assert.match(p, /НЕ ПОКАЗАНЫ/);
  assert.match(p, /b\.js/);
  assert.match(p, /ПОКАЗАННЫХ/, 'требование filesReviewed сужено до показанных файлов');
  assert.doesNotMatch(gate.judgePrompt('T1', 'задача', 'diff', STATUS_TWO_FILES), /НЕ ПОКАЗАНЫ/,
    'без обрезки промпт не меняется');
});

// Регрессия на ЖИВОЙ ложный block (T001, 2026-07-22): судья дал pass с семью обоснованиями
// и перечислил 3 файла диффа + spec.md/tasks.md, которые ему показывают как рубрику. Правило
// «не в диффе = фантом» объявило это галлюцинацией и срубило честный вердикт. Фантом — это
// НЕСУЩЕСТВУЮЩИЙ путь; существующий файл вне диффа судья реально мог прочитать.
test('checkGrounding: существующий файл вне диффа (рубрика) — не фантом, выдуманный — фантом', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-rubric-'));
  fs.writeFileSync(path.join(root, 'a.js'), '// в диффе\n');
  fs.mkdirSync(path.join(root, 'specs', 'NNN'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'NNN', 'spec.md'), '# рубрика\n');
  assert.equal(
    gate.checkGrounding(STATUS_ONE_FILE, ['a.js', 'specs/NNN/spec.md'], ['ok'], root),
    null,
    'рубрика существует на диске — упоминание честное, не галлюцинация',
  );
  assert.equal(
    gate.checkGrounding(STATUS_ONE_FILE, ['a.js', 'src/выдумка.js'], ['ok'], root),
    'grounding:phantom-file',
    'несуществующий путь остаётся галлюцинацией',
  );
});

// 009 T014 — часть 2: пути ВНЕШНЕГО репо. Судья видит их отдельной секцией промпта
// («ВНЕШНИЙ РЕПО ~/.claude»), а diffSet собран только по текущему репо; живой block
// 2026-07-29 — судья назвал `~/.claude/bin/elt.js (external repo)` и получил phantom-file.
test('checkGrounding: путь внешнего репо (~ и пояснение в скобках) — не фантом, выдуманный внешний — фантом', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grounding-external-'));
  fs.writeFileSync(path.join(root, 'a.js'), '// в диффе\n');
  const probe = `.judge-grounding-probe-${process.pid}.js`;
  fs.writeFileSync(path.join(os.homedir(), probe), '// внешний репо\n');
  try {
    assert.equal(
      gate.checkGrounding(STATUS_ONE_FILE, ['a.js', 'a.js (external repo)'], ['ok'], root),
      null,
      'пояснительный суффикс в скобках не делает путь фантомом',
    );
    assert.equal(
      gate.checkGrounding(STATUS_ONE_FILE, ['a.js', `~/${probe} (external repo)`], ['ok'], root),
      null,
      '~ разворачивается — реально существующий внешний файл принят',
    );
    assert.equal(
      gate.checkGrounding(STATUS_ONE_FILE, ['a.js', '~/.claude/выдумка-которой-нет.js'], ['ok'], root),
      'grounding:phantom-file',
      'несуществующий внешний путь остаётся галлюцинацией',
    );
  } finally {
    try { fs.rmSync(path.join(os.homedir(), probe), { force: true }); } catch { /* noop */ }
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

// 009 T014 — часть 1: бюджет. При cap 12000 на 15 файлов судья получал по 800 символов
// на файл и блокировал слайс формулировкой «диффы обрезаны, проверить нечего» (живой
// verify-вердикт codex 2026-07-29). Дефолт 60000 — тот же дифф доезжает целиком.
test('slurpDiff: дефолтный DIFF_CAP показывает 60K-дифф без обрезки, JUDGE_DIFF_CAP переопределяет', () => {
  const { root, files } = repo60K();
  const wide = gate.slurpDiff(root);
  const narrow = gate.slurpDiff(root, 12000);
  assert.equal(wide.omitted.length, 0, 'при дефолтном бюджете ни один файл не выпадает');
  for (const f of files) assert.ok(wide.diff.includes(f), `${f} представлен в диффе`);
  // Суть задачи — не «ноль обрезки» (бюджет делится на файлы поровну, самый крупный может
  // не добрать сотню символов), а объём на файл: было 800 — стало тысячи.
  const shownShare = (r) => {
    const m = r.diff.match(/показано (\d+) из (\d+)/);
    return m ? Number(m[1]) / Number(m[2]) : 1;
  };
  assert.ok(shownShare(narrow) < 0.3, `старый cap показывал лишь ${(shownShare(narrow) * 100).toFixed(0)}% файла — голову, не содержание`);
  assert.ok(shownShare(wide) > 0.9, `дефолтный cap показывает ${(shownShare(wide) * 100).toFixed(0)}% крупнейшего файла`);
  assert.ok(wide.diff.length > narrow.diff.length * 4, `дефолтный бюджет кратно шире старого (${wide.diff.length} против ${narrow.diff.length})`);

  // Override читается из env при загрузке модуля — проверяем в отдельном процессе.
  const out = execFileSync(process.execPath, ['-e',
    `const g=require(${JSON.stringify(path.resolve('tools/fleet/gate.js'))});` +
    `const r=g.slurpDiff(${JSON.stringify(root)});` +
    `console.log(JSON.stringify({len:r.diff.length,cut:/файл обрезан/.test(r.diff)}));`],
  { encoding: 'utf8', env: { ...process.env, JUDGE_DIFF_CAP: '3000' } });
  const tight = JSON.parse(out.trim().split(/\r?\n/).pop());
  assert.ok(tight.cut, 'JUDGE_DIFF_CAP=3000 действительно ужимает дифф (override живой, не декоративный)');
  assert.ok(tight.len < wide.diff.length, `узкий бюджет короче дефолтного (${tight.len} < ${wide.diff.length})`);
});

// 009 T014: бюджет раздаётся по остатку, а не поровну. Мелкие файлы, влезающие целиком,
// больше не резервируют свою долю впустую — крупный production-дифф получает остаток.
test('budgetDiff: неиспользованный остаток достаётся крупным файлам, а не пропадает', () => {
  const big = 'diff --git a/src/big.js b/src/big.js\n' + '+строка кода\n'.repeat(3000); // заведомо больше cap
  const smalls = Array.from({ length: 6 }, (_, i) =>
    `diff --git a/src/tiny${i}.js b/src/tiny${i}.js\n+одна строка\n`);
  const sections = gate.splitDiffSections([...smalls, big].join(''));
  assert.equal(sections.length, 7, 'секции распознаны');

  const cap = 12000;
  const { diff, omitted } = gate.budgetDiff(sections, cap);
  assert.equal(omitted.length, 0, 'при этом бюджете ничего не выпадает');
  const m = diff.match(/показано (\d+) из (\d+)/);
  assert.ok(m, 'файл больше бюджета обрезан и помечен');
  const evenShare = Math.floor(cap / sections.length); // как делил старый алгоритм
  assert.ok(Number(m[1]) > evenShare * 5,
    `крупному файлу досталось ${m[1]} символов вместо равной доли ${evenShare} — остаток мелких не пропал`);
  for (let i = 0; i < 6; i += 1) assert.ok(diff.includes(`tiny${i}.js`), `tiny${i}.js на месте`);
});
