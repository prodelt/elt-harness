'use strict';
// 023 T001 — замок на класс, которого не было.
//
// Спека 022 увела рабочие каталоги (`.planning/`, `archive/`, ...) в `.gitignore`. У автора они
// остались на диске, поэтому пять файлов сьюта, читавших оттуда, оставались зелёными локально и
// краснели у всех остальных: в чистом клоне, в фоновом worktree и на CI. Класс дефекта — не
// «пять забытых путей», а отсутствие границы между сьютом и рабочим столом автора.
//
// Здесь эта граница и проводится: ни один файл сьюта не смеет ЧИТАТЬ С ДИСКА путь, адресованный
// от корня этого репозитория, если git его игнорирует.
//
// Граница выбрана узко и намеренно. Первая версия замка ловила ещё и голые литералы вида
// 'archive/x.md' и дала 33 ложных срабатывания подряд: почти все такие литералы в сьюте —
// имена файлов ВНУТРИ синтетических диффов (`judge-deletion-budget`, `harness-files`,
// `judge-grounding-rename`) и пути внутри временных фикстур. Их никто не открывает, и красный
// на них приучил бы смотреть мимо замка. По той же причине корнем считается только выражение,
// доказуемо указывающее на этот репозиторий — `path.join(__dirname, '..')` и переменные,
// объявленные через него в том же файле. Переменная с именем ROOT в чужом тесте сплошь и рядом
// оказывается временным каталогом, и доверять имени нельзя.
//
// Пути, собранные динамически (из переменных, шаблонов), замок не видит. Это записано в
// «Риски» спеки 023 как осознанная цена: он ловит ту форму записи, которой написаны все пять
// живых случаев, и стоит один вызов git.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Те же три корня, что сканирует сам оракул (см. CLAUDE.md → Testing).
const ROOTS = ['tools', 'bin', 'benchmarks'];

// Временные каталоги — не дерево репозитория: тест, пишущий в os.tmpdir(), герметичен по
// построению, и спрашивать про его пути `git check-ignore` бессмысленно.
const TMP_MARKERS = ['tmpdir', 'mkdtemp'];

// Читающие вызовы. Путь, который никто не открывает, к герметичности отношения не имеет.
const READERS = /(?:readFileSync|readFile|existsSync|createReadStream|readdirSync|statSync|accessSync|openSync)/;

function listTestFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.test.js')) out.push(full);
    }
  };
  for (const r of ROOTS) walk(path.join(ROOT, r));
  return out;
}

// Имена переменных, объявленных в файле как корень репозитория:
// `const ROOT = path.join(__dirname, '..');`
function repoRootVars(src) {
  const names = new Set();
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*path\.(?:join|resolve)\(\s*__dirname\s*,\s*(['"])\.\.\2\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) names.add(m[1]);
  return names;
}

// Из `path.join(__dirname, '..', '.planning', 'X.json')` собирает `.planning/X.json`.
function candidatePaths(src) {
  const found = new Set();
  const rootVars = repoRootVars(src);
  const joinRe = /path\.join\(\s*([^()]{0,400}?)\)/g;
  let m;
  while ((m = joinRe.exec(src)) !== null) {
    const args = m[1];
    if (TMP_MARKERS.some((t) => args.includes(t))) continue;

    const firstArg = args.split(',')[0].trim();
    const startsAtRepoRoot = /__dirname\s*,\s*(['"])\.\.\1/.test(args) || rootVars.has(firstArg);
    if (!startsAtRepoRoot) continue;

    const literals = [...args.matchAll(/'([^']*)'|"([^"]*)"/g)]
      .map((x) => (x[1] !== undefined ? x[1] : x[2]))
      .filter((x) => x && x !== '..');
    if (!literals.length) continue;

    // Считаем только то, что действительно открывают: либо вызов обёрнут читающим методом,
    // либо результат присвоен переменной, которую читают ниже.
    const tail = src.slice(Math.max(0, m.index - 60), m.index);
    const assigned = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(tail);
    const readInline = READERS.test(tail);
    const readLater = assigned
      ? new RegExp(READERS.source + `\\(\\s*${assigned[1]}\\b`).test(src)
      : false;
    if (!readInline && !readLater) continue;

    found.add(literals.join('/'));
  }
  return [...found];
}

function gitAvailable() {
  return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
}

// `git check-ignore --stdin` за один вызов: по пути на строку, ответ — только игнорируемые.
function ignoredAmong(paths) {
  if (!paths.length) return new Set();
  const r = spawnSync('git', ['-C', ROOT, 'check-ignore', '--stdin'], {
    input: paths.join('\n'),
    encoding: 'utf8',
  });
  // exit 0 — что-то игнорируется, 1 — ничего; всё прочее — настоящая ошибка git.
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`git check-ignore упал (${r.status}): ${r.stderr}`);
  }
  const norm = (p) => p.split(path.sep).join('/').trim();
  return new Set((r.stdout || '').split(/\r?\n/).filter(Boolean).map(norm));
}

const SKIP = gitAvailable() ? false : 'git недоступен — проверка невозможна';

test('ни один файл сьюта не читает git-игнорируемый путь', { skip: SKIP }, () => {
  const offenders = [];
  for (const file of listTestFiles()) {
    const src = fs.readFileSync(file, 'utf8');
    const paths = candidatePaths(src);
    const ignored = ignoredAmong(paths);
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    for (const p of paths) {
      if (ignored.has(p)) offenders.push(`${rel} → ${p}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'сьют читает пути, которых нет в поставке (зелено только на машине автора):\n  ' + offenders.join('\n  '),
  );
});

// Замок обязан ловить. Без этой проверки «offenders пуст» неотличимо от «скан ничего не умеет»:
// образец — дословно та строка, с которой краснел d0-smoke-feasibility.test.js.
test('замок ловит образец: тест, читающий .planning/, назван виновным', { skip: SKIP }, () => {
  // Сегмент собирается из кусков намеренно: будь он в этом файле цельным литералом, замок
  // поймал бы собственный образец и потребовал исключить себя из скана — то есть проделал бы
  // в себе ровно ту дыру, которую стережёт. candidatePaths получает уже собранную строку.
  const seg = '.plan' + 'ning';
  const sample = [
    `const REPORT = path.join(__dirname, '..', '${seg}', 'D0-smoke-feasibility.md');`,
    'const md = fs.readFileSync(REPORT, "utf8");',
  ].join('\n');
  const paths = candidatePaths(sample);
  assert.ok(
    paths.includes('.planning/D0-smoke-feasibility.md'),
    `скан не увидел путь образца, увидел: ${JSON.stringify(paths)}`,
  );
  assert.ok(ignoredAmong(paths).has('.planning/D0-smoke-feasibility.md'), 'git не признал путь образца игнорируемым');
});

test('замок не трогает пути под os.tmpdir(): фикстуры герметичны по построению', { skip: SKIP }, () => {
  const sample = [
    "const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-'));",
    `const j = fs.readFileSync(path.join(dir, '${'.plan' + 'ning'}', 'x.json'), 'utf8');`,
  ].join('\n');
  assert.deepEqual(candidatePaths(sample), [], 'фикстура во временном каталоге принята за нарушение');
});

test('имя файла внутри синтетического диффа нарушением не считается', { skip: SKIP }, () => {
  const sample = "const diff = 'diff --git a/archive/x.md b/archive/x.md';";
  assert.deepEqual(candidatePaths(sample), [], 'литерал в теле диффа принят за чтение с диска');
});

test('поставляемый путь нарушением не считается', { skip: SKIP }, () => {
  const sample = [
    "const BENCH = path.join(__dirname, 'judge-bench', 'baselines', '011-T001.json');",
    'const report = JSON.parse(fs.readFileSync(BENCH, "utf8"));',
  ].join('\n');
  assert.equal(ignoredAmong(candidatePaths(sample)).size, 0, 'baseline из поставки объявлен игнорируемым');
});
