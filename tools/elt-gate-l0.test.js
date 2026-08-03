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
const { evaluate, DEFAULT_DIFF_SIZE } = require('./elt-gate-l0');
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

function diffFor(file, { isNew = false, added = 1, removed = 0 } = {}) {
  return [
    `diff --git a/${file} b/${file}`,
    ...(isNew ? [`new file mode 100644`, '--- /dev/null'] : ['--- a/' + file]),
    `+++ b/${file}`,
    '@@ -1,1 +1,1 @@',
    ...Array.from({ length: removed }, (_, i) => `-old ${i}`),
    ...Array.from({ length: added }, (_, i) => `+new ${i}`),
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

function testExistingTestModified() {
  const result = evaluate({ diff: diffFor('tools/some-feature.test.js', { removed: 3, added: 1 }), config: {} });
  assert.deepEqual(names(result), ['existing-test-modified']);
  assert.deepEqual(result.triggers[0].files, ['tools/some-feature.test.js']);
  assert.equal(result.judgeNeeded, true);
  // Граница: НОВЫЙ тест-файл — не этот триггер (ослаблять там нечего).
  assert.deepEqual(names(evaluate({ diff: diffFor('tools/some-feature.test.js', { isNew: true, added: 9 }), config: {} })), []);
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
  assert.deepEqual(result.l0.triggers.map((t) => t.name), ['existing-test-modified']);
  assert.equal(result.l0.judgeNeeded, true);
  // Триггеры доезжают до судьи как контекст «почему тебя позвали», а не теряются по дороге.
  const prompt = calls[0].prompt;
  assert.match(prompt, /ПОЧЕМУ ТЕБЯ ПОЗВАЛИ/);
  assert.match(prompt, /existing-test-modified/);
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
  testExistingTestModified();
  testNewCodeWithoutCheck();
  testHotPath();
  testDiffSize();
  testOutOfScopeNotTriggeredInsideZone();
  testOutOfScopeFiresOnFileOutsideZone();
  testOutOfScopeSilentWithoutFilesTagAtAll();
  testOutOfScopeIgnoresHarnessOwnedFiles();
  testOutOfScopeGlobPrefixMatchesSubpath();
  try {
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
