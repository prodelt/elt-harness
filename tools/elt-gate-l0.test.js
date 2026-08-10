'use strict';
// 011 T001 — контракт снятия verify-судьи с этого репо.
//
// Замер 2026-07-31: два независимых REJECT-default судьи перемножаются, block-rate 77%,
// из 48 блоков 36 — verify при `pass` первичного, и verify никогда не калибровался.
// Контур остаётся на red-proof (см. `circuitEnabled()` в elt.js), но конъюнкции судей нет.
// Код-пути verify не тронуты — ими пользуется fleet и чужие проекты.

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { verifySettings, readHarnessConfig } = require('./elt-config');
const { evaluate, externalImports, DEFAULT_DIFF_SIZE } = require('./elt-gate-l0');
const providers = require('./fleet/providers');
const { runJudge } = require('./fleet/gate');

const ROOT = path.join(__dirname, '..');
const BENCH = path.join(ROOT, '.planning', 'JUDGE-BENCH-011-T001.json');

function testVerifyOffForThisRepo() {
  assert.equal(verifySettings(ROOT), null, 'у этого репо второго судьи нет — конъюнкция снята');
  const { ok, config, errors } = readHarnessConfig(ROOT);
  assert.equal(ok, true, `конфиг обязан остаться схема-валидным: ${(errors || []).join('; ')}`);
  assert.equal(config.judge.enabled, true, 'первичный судья остаётся обязательным');
  // Контур не выключен целиком — он держится на red-proof, ровно как считает circuitEnabled().
  assert.notEqual(config.redProof, 'off', 'снятие verify не должно оставлять слайс без контура');
}

// Число ДО того, как на одиночном судье поедут слайсы: без него «стало лучше» нечем доказать.
function testBenchBaselineParses() {
  const report = JSON.parse(fs.readFileSync(BENCH, 'utf8'));
  assert.equal(report.provider, 'agy', 'baseline снят первичным судьёй репо');
  assert.ok(Array.isArray(report.results) && report.results.length >= 14, 'бенч гоняется на полном золотом наборе');
  for (const r of report.results) {
    assert.ok(r.id, 'у кейса есть id');
    assert.ok(r.expect === 'pass' || r.expect === 'block', `кейс ${r.id}: ожидание — pass или block`);
  }
  const s = report.score;
  assert.equal(s.total, report.results.length);
  assert.equal(s.blockCases + s.passCases, s.total, 'кейсы разложены по двум ожиданиям без остатка');
  for (const key of ['recall', 'falsePositiveRate', 'accuracy']) {
    assert.ok(typeof s[key] === 'number' && s[key] >= 0 && s[key] <= 1, `${key} — доля в [0,1]`);
  }
}

// --- 011 T002: риск-триггеры L0 (AC2) ------------------------------------------------
// Дифф собирается вручную, а не из git: L0 обязан быть чистой функцией, и тест это
// фиксирует — если в неё заедет fs/spawn, тест начнёт требовать репозиторий и упадёт.

function diffFor(file, { isNew = false, added = 1, removed = 0, removedLines, addedLines } = {}) {
  const rem = removedLines || Array.from({ length: removed }, (_, i) => `old ${i}`);
  const add = addedLines || Array.from({ length: added }, (_, i) => `new ${i}`);
  return [
    `diff --git a/${file} b/${file}`,
    ...(isNew ? [`new file mode 100644`, '--- /dev/null'] : ['--- a/' + file]),
    `+++ b/${file}`,
    '@@ -1,1 +1,1 @@',
    ...rem.map((l) => `-${l}`),
    ...add.map((l) => `+${l}`),
  ].join('\n');
}

const names = (result) => result.triggers.map((t) => t.name);

// Пустой набор: слайс правит прод-код и вместе с ним тест — ровно то, ради чего судью
// будить не надо. Именно этот случай был 100% вызовов судьи до 011.
function testNoTriggersOnCleanSlice() {
  const result = evaluate({
    diff: [
      diffFor('tools/some-feature.js', { isNew: true, added: 20 }),
      diffFor('tools/some-feature.test.js', { isNew: true, added: 15 }),
    ].join('\n'),
    config: {},
  });
  assert.deepEqual(names(result), [], 'чистый слайс не даёт ни одного триггера');
  assert.equal(result.judgeNeeded, false, 'судья на чистом слайсе не нужен');
}

// --- 014 T002: weakened-assertion заменяет existing-test-modified (AC2) --------------
// Старый триггер сработал на 30 из 39 слайсов (замер 011) — любая правка теста, включая
// чистое добавление кейса, будила судью. Новый смотрит в СОДЕРЖИМОЕ удалённых строк.

function testWeakenedAssertionRemovedAssertLine() {
  const result = evaluate({
    diff: diffFor('tools/some-feature.test.js', {
      removedLines: ["assert(require('./f').ok());"],
      addedLines: ['// проверка убрана'],
    }),
    config: {},
  });
  assert.deepEqual(names(result), ['weakened-assertion']);
  assert.deepEqual(result.triggers[0].files, ['tools/some-feature.test.js']);
  assert.equal(result.judgeNeeded, true);
}

function testWeakenedAssertionStrictToWeakSwap() {
  // strictEqual → ok: строгая проверка удалена, слабая добавлена — реалистичный стиль
  // репо (`require('node:assert').equal(...)`), не только голый `assert.strictEqual(`.
  const result = evaluate({
    diff: diffFor('tools/some-feature.test.js', {
      removedLines: ["require('node:assert').strictEqual(f(), 42);"],
      addedLines: ["require('node:assert').ok(f());"],
    }),
    config: {},
  });
  assert.deepEqual(names(result), ['weakened-assertion']);
}

function testWeakenedAssertionRemovedTestBlock() {
  const result = evaluate({
    diff: diffFor('tools/some-feature.test.js', {
      removedLines: ["test('кейс сломан', () => { assert.ok(false); });"],
      addedLines: [],
    }),
    config: {},
  });
  assert.deepEqual(names(result), ['weakened-assertion']);
}

function testWeakenedAssertionFullRewrite() {
  // Переписка > 50% строк: сами удалённые строки нейтральны (не матчат assert/block), но
  // originalLineCount говорит, что снесена бОльшая часть файла.
  const result = evaluate({
    diff: diffFor('tools/some-feature.test.js', {
      removedLines: ['line a', 'line b', 'line c', 'line d', 'line e', 'line f'],
      addedLines: ['new a', 'new b'],
    }),
    config: { originalLineCount: () => 10 }, // 6 удалено из 10 → 60% > REWRITE_RATIO
  });
  assert.deepEqual(names(result), ['weakened-assertion']);
  // Та же правка, но originalLineCount недоступен (git недоступен/новый файл) — сигнала нет.
  assert.deepEqual(names(evaluate({
    diff: diffFor('tools/some-feature.test.js', { removedLines: ['line a', 'line b', 'line c', 'line d', 'line e', 'line f'], addedLines: ['new a'] }),
    config: {},
  })), []);
}

function testWeakenedAssertionCleanAdditionIsNotATrigger() {
  // Чистое добавление кейса — removed=0 — не триггер, даже если добавленные строки несут assert.
  const result = evaluate({
    diff: diffFor('tools/some-feature.test.js', { added: 5 }),
    config: {},
  });
  assert.deepEqual(names(result), [], 'добавление нового теста не обязано будить судью');
  // Граница: НОВЫЙ тест-файл целиком — не этот триггер (ослаблять там нечего).
  assert.deepEqual(names(evaluate({ diff: diffFor('tools/some-feature.test.js', { isNew: true, added: 9 }), config: {} })), []);
}

function testWeakenedAssertionNeutralEditIsNotATrigger() {
  // Убрана строка без ассерта/блока, и переписка ниже порога — правка теста, а не ослабление
  // (например, переименование переменной без изменения проверок).
  const result = evaluate({
    diff: diffFor('tools/some-feature.test.js', { removedLines: ['const x = 1;'], addedLines: ['const y = 1;'] }),
    config: { originalLineCount: () => 100 },
  });
  assert.deepEqual(names(result), []);
}

function testNewCodeWithoutCheck() {
  const result = evaluate({ diff: diffFor('tools/some-feature.js', { isNew: true, added: 30 }), config: {} });
  assert.deepEqual(names(result), ['new-code-no-check']);
  assert.deepEqual(result.triggers[0].files, ['tools/some-feature.js']);
  // Untracked файл в дифф не попадает — он виден только через git status, и без этого
  // триггер был бы слеп ровно на своём случае.
  const untracked = evaluate({ diff: '', status: '?? tools/brand-new.js', config: {} });
  assert.deepEqual(names(untracked), ['new-code-no-check']);
  assert.deepEqual(untracked.triggers[0].files, ['tools/brand-new.js']);
}

// 015 T001 — `@/…`, `~/…`, `#…` это path-алиасы (tsconfig paths, imports-поле package.json),
// а не пакеты. Без этого каждый TS/Next-проект давал ложный триггер new-dependency на своём же
// коде: у npm-скоупа имя непустое (`@scope/name`), а `@/lib/x` даёт скоуп `@`.
function testPathAliasesAreNotDependencies() {
  // Спецификаторы собираются из кусков, а НЕ пишутся литералом: иначе L0 читает диff этого
  // самого теста и репортит фикстуры как реальные новые зависимости (проверено — блокирует).
  const KW = 'from';
  const line = (spec) => `+import x ${KW} ${JSON.stringify(spec)};`;
  const diff = ['@/lib/db', '~/utils/x', '#internal/y', 'lodash/fp', '@scope/pkg/sub']
    .map(line).join('\n');
  assert.deepEqual(
    externalImports(diff).sort(),
    ['@scope/pkg', 'lodash'],
    'алиасы игнорируются, реальные пакеты сворачиваются до имени пакета',
  );
}

function testHotPath() {
  // Дефолтный список: гейт/авторизация/секреты.
  assert.deepEqual(names(evaluate({ diff: diffFor('tools/fleet/gate.js', { removed: 1, added: 1 }), config: {} })), ['hot-path']);
  // Свой список из harness.json вытесняет дефолт целиком.
  const custom = evaluate({
    diff: diffFor('src/billing/charge.js', { removed: 1, added: 1 }),
    config: { hotPaths: ['src/billing/**'] },
  });
  assert.deepEqual(names(custom), ['hot-path']);
  assert.deepEqual(custom.triggers[0].files, ['src/billing/charge.js']);
  // ...и то, что было горячим по дефолту, при своём списке горячим быть перестаёт.
  assert.deepEqual(names(evaluate({ diff: diffFor('tools/fleet/gate.js', { removed: 1, added: 1 }), config: { hotPaths: ['src/billing/**'] } })), []);
  // Абсолютный путь вне cwd (009 T014) обязан срезаться до репо-относительного.
  const external = evaluate({
    diff: diffFor('C:/repo/tools/fleet/gate.js', { removed: 1, added: 1 }),
    cwd: 'C:\\repo',
    config: {},
  });
  assert.deepEqual(external.triggers[0].files, ['tools/fleet/gate.js']);
}

function testDiffSize() {
  const big = diffFor('docs/notes.md', { added: DEFAULT_DIFF_SIZE + 1 });
  assert.deepEqual(names(evaluate({ diff: big, config: {} })), ['diff-size']);
  // Порог из конфига действует вместо дефолта — в обе стороны.
  assert.deepEqual(names(evaluate({ diff: big, config: { diffSizeThreshold: 10000 } })), []);
  assert.deepEqual(names(evaluate({ diff: diffFor('docs/notes.md', { added: 11 }), config: { diffSizeThreshold: 10 } })), ['diff-size']);
}

// --- 011 T024: scope-триггер (артефакт: «выход ловится механически, не судьёй») ------

function testOutOfScopeNotTriggeredInsideZone() {
  const result = evaluate({
    diff: diffFor('tools/widget.js', { removed: 1, added: 1 }),
    config: {},
    taskText: 'починить виджет [files: tools/widget.js]',
  });
  assert.deepEqual(names(result), [], 'дифф строго в зоне [files:] — триггера нет');
}

function testOutOfScopeFiresOnFileOutsideZone() {
  const result = evaluate({
    diff: [
      diffFor('tools/widget.js', { removed: 1, added: 1 }),
      diffFor('tools/fleet/router.js', { removed: 1, added: 1 }),
    ].join('\n'),
    config: {},
    taskText: 'починить виджет [files: tools/widget.js]',
  });
  assert.deepEqual(names(result), ['out-of-scope']);
  assert.deepEqual(result.triggers[0].files, ['tools/fleet/router.js']);
  assert.equal(result.judgeNeeded, true);
}

function testOutOfScopeSilentWithoutFilesTagAtAll() {
  // Задача без [files:] не объявила зону — нарушить нечего, слой не включается вовсе
  // (тот же принцип, что у ctx7 при нуле импортов).
  const result = evaluate({
    diff: diffFor('tools/anything.js', { removed: 1, added: 1 }),
    config: {},
    taskText: 'сделать что-нибудь полезное, без тега зоны',
  });
  assert.deepEqual(names(result), []);
}

function testOutOfScopeIgnoresHarnessOwnedFiles() {
  // .harness/** и tasks.md — владения оркестратора, не работы слайса; барьерный триггер
  // не должен ругаться на то, что оркестратор правит сам (см. gate.js:isHarnessOwned).
  const result = evaluate({
    diff: [
      diffFor('tools/widget.js', { removed: 1, added: 1 }),
      diffFor('.harness/harness.json', { removed: 1, added: 1 }),
      diffFor('specs/011-elt-v3-gate/tasks.md', { removed: 1, added: 1 }),
    ].join('\n'),
    config: {},
    taskText: 'починить виджет [files: tools/widget.js]',
  });
  assert.deepEqual(names(result), [], 'харнесс-владения не считаются выходом за зону');
}

function testOutOfScopeGlobPrefixMatchesSubpath() {
  // [files: tools/widgets*] — префикс-глоб, как и остальная зона в этом харнессе; поддиректория
  // внутри префикса — В зоне, соседняя директория с похожим именем — уже нет.
  const inside = evaluate({
    diff: diffFor('tools/widgets/core.js', { removed: 1, added: 1 }),
    config: {},
    taskText: 'слайс [files: tools/widgets*]',
  });
  assert.deepEqual(names(inside), []);
  const outside = evaluate({
    diff: diffFor('tools/widgetsview/x.js', { removed: 1, added: 1 }),
    config: {},
    taskText: 'слайс [files: tools/widgets/*]',
  });
  assert.deepEqual(names(outside), ['out-of-scope']);
}

// --- 011 T025: риск из связности вместо глобов hotPaths ------------------------------
// evaluate() принимает config.fanIn как ЧИСТУЮ инъекцию (данные/геттер, не fs) — те же
// unit-тесты, что у hot-path/diff-size выше, чистая функция без git/fs.

function testHighFaninTriggersOnCentralModule() {
  const fanIn = (f) => (f === 'tools/central.js' ? 15 : 2);
  const result = evaluate({ diff: diffFor('tools/central.js', { removed: 1, added: 1 }), config: { fanIn } });
  assert.deepEqual(names(result), ['high-fanin']);
  assert.deepEqual(result.triggers[0].files, ['tools/central.js']);
  assert.equal(result.judgeNeeded, true);
}

function testHighFaninSilentOnLeafFile() {
  const fanIn = () => 2; // ниже дефолтного порога 10
  const result = evaluate({ diff: diffFor('tools/leaf.js', { removed: 1, added: 1 }), config: { fanIn } });
  assert.deepEqual(names(result), []);
}

function testHighFaninThresholdFromConfig() {
  const fanIn = () => 5;
  // Дефолтный порог 10 — не триггерит; свой порог 3 из harness.json — триггерит то же число.
  assert.deepEqual(names(evaluate({ diff: diffFor('tools/mid.js', { removed: 1, added: 1 }), config: { fanIn } })), []);
  assert.deepEqual(
    names(evaluate({ diff: diffFor('tools/mid.js', { removed: 1, added: 1 }), config: { fanIn, fanInThreshold: 3 } })),
    ['high-fanin'],
  );
}

// При недоступном скане — триггера нет, НЕ ложный block: та же дисциплина, что у codegraph
// в impact-выборке (T006) и у ctx7 при мёртвом сервисе (R5).
function testHighFaninSilentWhenFanInUnavailable() {
  assert.deepEqual(names(evaluate({ diff: diffFor('tools/central.js', { removed: 1, added: 1 }), config: {} })), []);
  const nullFanIn = () => null; // файл вне скан-пула — computeFanIn отдаёт null, не 0
  assert.deepEqual(
    names(evaluate({ diff: diffFor('tools/outside-pool.js', { removed: 1, added: 1 }), config: { fanIn: nullFanIn } })),
    [],
  );
}

// Интеграционный: РЕАЛЬНЫЙ computeFanIn поверх настоящего дерева файлов — доказывает, что
// walkJs+dependents (elt-oracle-select.js) реально считают входящую степень, а не то, что мок
// инъекции сам себя подтверждает.
function testComputeFanInRealFileTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-fanin-'));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  const w = (rel, body) => fs.writeFileSync(path.join(root, 'tools', rel), body);
  // central.js требуется четырьмя разными модулями — leaf.js не требуется никем.
  w('central.js', 'module.exports = { c: () => 1 };\n');
  w('leaf.js', 'module.exports = { l: () => 2 };\n');
  w('a.js', "require('./central');\n");
  w('b.js', "require('./central');\n");
  w('c.js', "require('./central');\n");
  w('d.js', "require('./central');\n");

  const { computeFanIn } = require('./elt-gate-l0');
  const fanIn = computeFanIn(root);
  assert.equal(typeof fanIn, 'function', 'сосед elt-oracle-select.js доступен — геттер построен');
  assert.equal(fanIn('tools/central.js'), 4, 'четыре реальных require() — фан-ин 4');
  assert.equal(fanIn('tools/leaf.js'), 0, 'листовой файл — фан-ина нет');

  const result = evaluate({
    diff: diffFor('tools/central.js', { removed: 1, added: 1 }),
    config: { fanIn, fanInThreshold: 3 },
  });
  assert.deepEqual(names(result), ['high-fanin'], 'реальный скан доводит триггер до evaluate()');
}

// --- 011 T003: проводка L0 в гейт (AC3) ----------------------------------------------
// Здесь тест уже не чистый: `runJudge` читает настоящий `git diff` — значит нужен настоящий
// репозиторий. Зато он меряет ровно то, что заявлено критерием: сколько РАЗ позван судья.
// Подменяется единственный шов, за которым живёт LLM (`providers.run`), — не сам runJudge:
// мок на runJudge доказывал бы работу мока, а не то, что судья не запустился.

const tmpDirs = [];
function makeRepo(baseFiles) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-l0-gate-'));
  tmpDirs.push(repo);
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  for (const [file, body] of Object.entries(baseFiles)) fs.writeFileSync(path.join(repo, file), body);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  return repo;
}
function cleanupRepos() {
  for (const dir of tmpDirs) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ } }
}

// filesReviewed в ответе НЕ отдаём: `null` = провайдер не знает про поле, и граундинг-чек по
// файлам не срабатывает. Стабу нечего «разбирать» — он меряется числом вызовов, не вердиктом.
async function withJudgeStub(fn) {
  const calls = [];
  const original = providers.run;
  providers.run = async (opts) => {
    calls.push(opts);
    return { ok: true, stdout: JSON.stringify([{ type: 'result', structured_output: { verdict: 'pass', reasons: ['стаб'] } }]), logPath: null };
  };
  try { return { result: await fn(), calls }; } finally { providers.run = original; }
}

async function testJudgeNotCalledOnCleanSlice() {
  const repo = makeRepo({ 'seed.txt': 'seed\n' });
  // Слайс: новый прод-модуль вместе со своим тестом — ни одного риск-триггера.
  fs.writeFileSync(path.join(repo, 'widget.js'), 'module.exports = { size: () => 42 };\n');
  fs.writeFileSync(path.join(repo, 'widget.test.js'), "require('node:assert').equal(require('./widget').size(), 42);\n");

  const { result, calls } = await withJudgeStub(() => runJudge({ cwd: repo, tid: 'T003', taskText: 'новый виджет' }));
  assert.equal(calls.length, 0, 'на чистом слайсе судья не зовётся ВОВСЕ — ни разу');
  assert.equal(result.runOk, true);
  assert.equal(result.verdict, 'pass', 'вердикт выносит механика, слайс закрывается');
  assert.match(result.reasons.join(' '), /l0-clean/, 'причина названа явно, а не пустая');
  assert.deepEqual(result.l0, { triggers: [], judgeNeeded: false }, 'список проверенных триггеров пуст — это и есть пруф');
  // proof-контракт (elt.js validateJudgeProof) требует judges[]; писать туда имя LLM-судьи,
  // который не запускался, было бы ложью в пруфе — там стоит тот, кто реально решил.
  assert.equal(result.judges.length, 1);
  assert.equal(result.judges[0].provider, 'l0');
  assert.equal(result.judges[0].verdict, 'pass');
}

async function testJudgeCalledOnceOnRiskySlice() {
  const repo = makeRepo({
    'widget.js': 'module.exports = { size: () => 42 };\n',
    'widget.test.js': "require('node:assert').equal(require('./widget').size(), 42);\n",
  });
  // Слайс правит СУЩЕСТВОВАВШИЙ тест — ровно тот случай, ради которого судья и нужен.
  fs.writeFileSync(path.join(repo, 'widget.test.js'), "require('node:assert').ok(require('./widget').size());\n");

  const { result, calls } = await withJudgeStub(() => runJudge({ cwd: repo, tid: 'T003', taskText: 'ослабить проверку' }));
  assert.equal(calls.length, 1, 'на рисковом слайсе судья зовётся РОВНО один раз (verify снят)');
  assert.deepEqual(result.l0.triggers.map((t) => t.name), ['weakened-assertion']);
  assert.equal(result.l0.judgeNeeded, true);
  // Триггеры доезжают до судьи как контекст «почему тебя позвали», а не теряются по дороге.
  const prompt = calls[0].prompt;
  assert.match(prompt, /ПОЧЕМУ ТЕБЯ ПОЗВАЛИ/);
  assert.match(prompt, /weakened-assertion/);
  assert.match(prompt, /widget\.test\.js/);
}

// 011 T024: scope-триггер проведён в runJudge (taskText несёт [files:]) — файл вне
// объявленной зоны обязан позвать судью с причиной out-of-scope, а не пройти как l0-clean.
async function testOutOfScopeReachesJudge() {
  const repo = makeRepo({ 'seed.txt': 'seed\n' });
  // widget.js несёт свой тест — new-code-no-check не срабатывает, изолируем именно out-of-scope.
  fs.writeFileSync(path.join(repo, 'widget.js'), 'module.exports = { size: () => 42 };\n');
  fs.writeFileSync(path.join(repo, 'widget.test.js'), "require('node:assert').equal(require('./widget').size(), 42);\n");
  fs.writeFileSync(path.join(repo, 'router.js'), 'module.exports = { route: () => 1 };\n'); // вне [files:]

  const { result, calls } = await withJudgeStub(() =>
    runJudge({ cwd: repo, tid: 'T024', taskText: 'починить виджет [files: widget.js, widget.test.js]' }));
  assert.equal(calls.length, 1, 'файл вне зоны — судья зовётся');
  assert.deepEqual(result.l0.triggers.map((t) => t.name), ['out-of-scope']);
  assert.match(calls[0].prompt, /out-of-scope/);
  assert.match(calls[0].prompt, /router\.js/);
}

// Дыра, которую L0 открыл бы сам по себе: в пустом диффе триггеров нет ПО ОПРЕДЕЛЕНИЮ, и
// «чистый слайс» стал бы способом закрыть задачу, не сделав ничего. Пустое отдаём судье.
async function testEmptyDiffStillReachesJudge() {
  const repo = makeRepo({ 'seed.txt': 'seed\n' });
  const { calls } = await withJudgeStub(() => runJudge({ cwd: repo, tid: 'T003', taskText: 'ничего не сделано' }));
  assert.equal(calls.length, 1, 'пустой дифф — не l0-clean, его судит судья (REJECT-default)');
}

// --- 011 T017 (а)(б): судья, которого можно позвать, и перевыдача мёртвого ------------------

// (а) Конфиг репо обязан называть ЖИВОГО судью. `agy` падает spawn ENAMETOOLONG на любом
// реальном диффе (промпт идёт через argv) — все 11 слайсов 011 прошли ручным `--provider
// claude`, т.е. дефолтный путь был сломан, а тесты этого не видели.
function testRepoJudgeProviderIsAlive() {
  const { config: cfg } = readHarnessConfig(ROOT);
  assert.notEqual(cfg.judge.provider, 'agy',
    'agy как первичный судья этого репо: spawn ENAMETOOLONG на диффе больше пары килобайт');
  assert.ok(providers.available(cfg.judge.provider), `судья ${cfg.judge.provider} из harness.json не установлен`);
}

// Стаб с разным поведением по провайдерам: мёртвый первичный, живая замена.
async function withJudgeStubByProvider(behaviour, fn) {
  const calls = [];
  const original = providers.run;
  providers.run = async (opts) => {
    calls.push(opts);
    if (behaviour[opts.provider] === 'dead') return { ok: false, stdout: '', logPath: '/tmp/dead.log', reason: 'stub-dead' };
    return { ok: true, stdout: JSON.stringify([{ type: 'result', structured_output: { verdict: 'pass', reasons: ['стаб'] } }]), logPath: null };
  };
  try { return { result: await fn(), calls }; } finally { providers.run = original; }
}

function riskyRepo() {
  const repo = makeRepo({
    'widget.js': 'module.exports = { size: () => 42 };\n',
    'widget.test.js': "require('node:assert').equal(require('./widget').size(), 42);\n",
  });
  fs.writeFileSync(path.join(repo, 'widget.test.js'), "require('node:assert').ok(require('./widget').size());\n");
  return repo;
}

// (б) Регресс, введённый T001: перевыдача мёртвого судьи была написана ТОЛЬКО для verify.
// Пока судей было двое, смерть первичного покрывалась вторым слоем; после снятия verify
// первичный остался единственным, и его смерть валила весь гейт при живом CLI на машине.
async function testDeadPrimaryIsReissued() {
  const repo = riskyRepo();
  process.env.FLEET_BIN_CODEX = JSON.stringify(['node', '--version']); // codex «установлен»
  try {
    const { result, calls } = await withJudgeStubByProvider({ claude: 'dead' },
      () => runJudge({ cwd: repo, tid: 'T017', taskText: 'ослабить проверку', verify: null }));
    assert.deepEqual(calls.map((c) => c.provider), ['claude', 'codex'], 'мёртвый первичный перевыдан следующему живому CLI');
    assert.equal(result.runOk, true, 'вердикт есть — гейт не умер вместе с первичным судьёй');
    assert.equal(result.verdict, 'pass');
    // Пруф не имеет права соврать, КТО судил: мёртвая попытка остаётся, живая названа своим именем.
    assert.equal(result.judges.length, 2);
    assert.equal(result.judges[0].provider, 'claude');
    assert.equal(result.judges[0].runOk, false);
    assert.equal(result.judges[1].provider, 'codex');
    assert.equal(result.judges[1].verdict, 'pass');
  } finally { delete process.env.FLEET_BIN_CODEX; }
}

// Обратная сторона: живого судьи никто не перевыдаёт — иначе один block стоил бы второго
// мнения молча, и REJECT-default превратился бы в «спроси, пока не разрешат».
async function testLivePrimaryIsNotReissued() {
  const repo = riskyRepo();
  process.env.FLEET_BIN_CODEX = JSON.stringify(['node', '--version']);
  try {
    const { calls } = await withJudgeStubByProvider({}, () => runJudge({ cwd: repo, tid: 'T017', taskText: 'ослабить проверку', verify: null }));
    assert.deepEqual(calls.map((c) => c.provider), ['claude'], 'живой первичный судит один раз и один');
  } finally { delete process.env.FLEET_BIN_CODEX; }
}

// Заменить некем — по-прежнему парковка (judge-dead), а не тихий pass.
async function testDeadPrimaryWithoutAltStaysDead() {
  const repo = riskyRepo();
  const { result } = await withJudgeStubByProvider({ claude: 'dead', codex: 'dead', agy: 'dead' },
    () => runJudge({ cwd: repo, tid: 'T017', taskText: 'ослабить проверку', verify: null }));
  assert.equal(result.runOk, false, 'нет живого судьи → нет вердикта; слайс паркуется, а не проходит');
  assert.notEqual(result.verdict, 'pass');
}

async function main() {
  testVerifyOffForThisRepo();
  testRepoJudgeProviderIsAlive();
  testBenchBaselineParses();
  testNoTriggersOnCleanSlice();
  testWeakenedAssertionRemovedAssertLine();
  testWeakenedAssertionStrictToWeakSwap();
  testWeakenedAssertionRemovedTestBlock();
  testWeakenedAssertionFullRewrite();
  testWeakenedAssertionCleanAdditionIsNotATrigger();
  testWeakenedAssertionNeutralEditIsNotATrigger();
  testNewCodeWithoutCheck();
  testPathAliasesAreNotDependencies();
  testHotPath();
  testDiffSize();
  testOutOfScopeNotTriggeredInsideZone();
  testOutOfScopeFiresOnFileOutsideZone();
  testOutOfScopeSilentWithoutFilesTagAtAll();
  testOutOfScopeIgnoresHarnessOwnedFiles();
  testOutOfScopeGlobPrefixMatchesSubpath();
  testHighFaninTriggersOnCentralModule();
  testHighFaninSilentOnLeafFile();
  testHighFaninThresholdFromConfig();
  testHighFaninSilentWhenFanInUnavailable();
  try {
    testComputeFanInRealFileTree();
    await testJudgeNotCalledOnCleanSlice();
    await testJudgeCalledOnceOnRiskySlice();
    await testOutOfScopeReachesJudge();
    await testEmptyDiffStillReachesJudge();
    await testDeadPrimaryIsReissued();
    await testLivePrimaryIsNotReissued();
    await testDeadPrimaryWithoutAltStaysDead();
  } finally { cleanupRepos(); }
  process.stdout.write('elt gate L0 tests: PASS\n');
}

main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exit(1); });
