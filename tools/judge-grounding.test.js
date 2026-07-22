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
