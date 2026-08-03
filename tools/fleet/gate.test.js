'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gate = require('./gate');

// --- parseVerdict: чистая функция, REJECT-default ---
test('parseVerdict: JSON/проза → verdict, иначе block', () => {
  assert.equal(gate.parseVerdict('{"verdict":"pass","reasons":["ok"]}'), 'pass');
  assert.equal(gate.parseVerdict('шум {"verdict":"block"}'), 'block');
  assert.equal(gate.parseVerdict('Вердикт: pass — в границах'), 'pass');
  assert.equal(gate.parseVerdict('verdict block'), 'block');
  assert.equal(gate.parseVerdict(''), 'block', 'пусто → block');
  assert.equal(gate.parseVerdict('текст без вердикта'), 'block');
  assert.equal(gate.parseVerdict('код вернул { status: "ok" }'), 'block', 'чужой JSON не ловим');
});

// --- Эхо промпта (баг 2026-07-22, judge-bench): `codex exec` печатает весь промпт в свой
// stdout, а промпт несёт и строку-инструкцию {"verdict":"pass"…}, и дифф (где встречается
// `return 'pass'`). Читать надо ПОСЛЕДНЕЕ совпадение — ответ модели идёт в конце. Пока
// парсер брал первое, codex-судья давал recall 0/7: настоящий block читался как pass. ---
test('parseVerdict: эхо промпта не подменяет ответ модели', () => {
  const echo = [
    'ОТВЕТ: последней строкой выведи РОВНО один JSON без обрамления:',
    '{"verdict":"pass","reasons":["…"]}  или  {"verdict":"block","reasons":["…"]}',
    '--- git diff HEAD ---',
    "-  return 'block';",
    "+  return 'pass';",
    'codex',
    'Изменение выходит за рамки рефакторинга: fail-closed заменено на fail-open.',
    '{"verdict":"block","reasons":["Ослаблена REJECT-default семантика"]}',
  ].join('\n');
  assert.equal(gate.parseVerdict(echo), 'block', 'вердикт берётся из ХВОСТА, а не из эха инструкции');
  assert.deepEqual(gate.parseReasons(echo), ['Ослаблена REJECT-default семантика'], 'reasons тоже из ответа, а не из эха');
});

test('parseVerdict: эхо не превращает block-инструкцию в ложный block при честном pass', () => {
  const echo = '{"verdict":"pass"} или {"verdict":"block"}\n…рассуждения…\n{"verdict":"pass","reasons":["в границах задачи"]}';
  assert.equal(gate.parseVerdict(echo), 'pass');
  assert.deepEqual(gate.parseReasons(echo), ['в границах задачи']);
});

// --- T022: block-причина прокидывается в prompt следующей попытки ---
test('parseReasons: читает reasons из JSON-фолбэка', () => {
  assert.deepEqual(gate.parseReasons('{"verdict":"block","reasons":["scope creep"]}'), ['scope creep']);
  assert.deepEqual(gate.parseReasons(''), []);
  assert.deepEqual(gate.parseReasons('текст без reasons'), []);
});

test('parseReasons/parseFilesReviewed: квадратные скобки ВНУТРИ reason не обрезают ответ', () => {
  // Живой ложный block 2026-07-27 (009 T006, дважды подряд): regex `\[[^\]]*\]` рвался на
  // первой `]` внутри строки → reasons:[] → безусловный grounding:no-reasons на честном pass.
  const out = 'проза судьи\n{"verdict":"pass","reasons":["эффорт по тегу [L]->max, [S]/[M]->high","в границах"],"filesReviewed":["gate.js","gate.test.js"]}';
  assert.deepEqual(gate.parseReasons(out), ['эффорт по тегу [L]->max, [S]/[M]->high', 'в границах']);
  assert.deepEqual(gate.parseFilesReviewed(out), ['gate.js', 'gate.test.js']);
  assert.equal(gate.checkGrounding('', gate.parseFilesReviewed(out), gate.parseReasons(out), __dirname), null,
    'честный ответ со скобками обязан проходить grounding-чек');
});

test('judgePrompt: prevBlockReason добавляет секцию «предыдущая попытка заблокирована»', () => {
  const p0 = gate.judgePrompt('T1', 'задача', 'diff', 'status');
  assert.doesNotMatch(p0, /ПРЕДЫДУЩАЯ/);
  const p1 = gate.judgePrompt('T1', 'задача', 'diff', 'status', 'scope creep вне [files:]');
  assert.match(p1, /ПРЕДЫДУЩАЯ попытка.*ЗАБЛОКИРОВАНА.*scope creep вне \[files:\]/s);
});

// --- T025: рубрика (spec.md/constitution.md) в промпте судьи ---
test('judgePrompt: rubric добавляет секцию РУБРИКА с путём и текстом spec/constitution', () => {
  const p0 = gate.judgePrompt('T1', 'задача', 'diff', 'status', '', null);
  assert.doesNotMatch(p0, /РУБРИКА/);
  const rubric = { spec: { path: 'specs/x/spec.md', text: 'критерий приёмки XYZ' }, constitution: null };
  const p1 = gate.judgePrompt('T1', 'задача', 'diff', 'status', '', rubric);
  assert.match(p1, /РУБРИКА/);
  assert.match(p1, /specs\/x\/spec\.md/);
  assert.match(p1, /критерий приёмки XYZ/);
});

test('findSpecDir/loadRubric: находит spec-папку по tasks.md, содержащему **tid**', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-rubric-'));
  try {
    const specDir = path.join(dir, 'specs', '007-demo');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'tasks.md'), '- [ ] **T9** demo\n');
    fs.writeFileSync(path.join(specDir, 'spec.md'), 'приёмка: демо готово');
    const found = gate.findSpecDir(dir, 'T9');
    assert.equal(found, specDir);
    const rubric = gate.loadRubric(dir, 'T9');
    assert.match(rubric.spec.text, /приёмка: демо готово/);
    assert.equal(rubric.constitution, null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Live-баг 2026-07-12: **T008** существовал одновременно в specs/002-elt-fleet и
// specs/004-elt-selfdrive — без явного specFile судья получал РУБРИКУ первой найденной
// папки (не той, что реально закрывалась) и блокировал корректный слайс.
test('findSpecDir/loadRubric: ID-коллизия между spec-папками → specFile снимает неоднозначность', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-collision-'));
  try {
    const dirA = path.join(dir, 'specs', '002-a');
    const dirB = path.join(dir, 'specs', '004-b');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    fs.writeFileSync(path.join(dirA, 'tasks.md'), '- [X] **T008** задача A\n');
    fs.writeFileSync(path.join(dirA, 'spec.md'), 'приёмка A');
    fs.writeFileSync(path.join(dirB, 'tasks.md'), '- [ ] **T008** задача B\n');
    fs.writeFileSync(path.join(dirB, 'spec.md'), 'приёмка B');

    // Без specFile — неоднозначность (найдёт A или B, тест не про это, а про то что specFile её снимает).
    const withHint = gate.findSpecDir(dir, 'T008', path.join(dirB, 'tasks.md'));
    assert.equal(withHint, dirB);
    const rubric = gate.loadRubric(dir, 'T008', path.join(dirB, 'tasks.md'));
    assert.match(rubric.spec.text, /приёмка B/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// --- gate() end-to-end на темп-репо с фейк-судьёй ---
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-gate-'));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const commits = () => Number(git(['rev-list', '--count', 'HEAD']).trim());
const stub = (name, verdict) =>
  writeStub(name, `console.log('{"verdict":"${verdict}","reasons":["stub"]}');`);
function writeStub(name, body) { const p = path.join(REPO, name); fs.writeFileSync(p, body); return p; }
// 011 T003: `l0.hotPaths: ['**']` — здесь меряется путь ЧЕРЕЗ судью (вердикт, промпт,
// нормализация), а не решение L0 звать ли его. Без этого фикстуры вроде `slice2.txt` не дают
// ни одного риск-триггера, судья не зовётся вовсе, и тесты меряли бы уже не то, что заявляют.
// Само решение L0 покрыто отдельно — tools/elt-gate-l0.test.js (счётчик вызовов стаба).
function writeHarness(oracle) {
  fs.mkdirSync(path.join(REPO, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.harness', 'harness.json'),
    JSON.stringify({ kind: 'code', oracle, shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' }, l0: { hotPaths: ['**'] } }));
}

let PASS_STUB, BLOCK_STUB;
before(() => {
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(REPO, 'seed.txt'), 'seed\n');
  fs.mkdirSync(path.join(REPO, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'specs', 'tasks.md'), '- [ ] **T1** демо-слайс\n- [ ] **T2** демо2\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'seed']);
  git(['checkout', '-q', '-b', 'fleet/T1']); // как реальный worktree — не main, без авто-ветки
  writeHarness('node --version');            // зелёный оракул
  PASS_STUB = stub('judge-pass.js', 'pass');
  BLOCK_STUB = stub('judge-block.js', 'block');
});
after(() => { try { fs.rmSync(REPO, { recursive: true, force: true }); } catch { /* noop */ } });

test('gate: зелёный оракул + судья pass → коммит (без --task = без [X]-марка)', async () => {
  fs.writeFileSync(path.join(REPO, 'slice.txt'), 'work\n');
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', PASS_STUB]);
  const n = commits();
  const r = await gate.gate({ tid: 'T1', taskText: 'демо-слайс', cwd: REPO });
  delete process.env.FLEET_BIN_CLAUDE;
  assert.equal(r.ok, true);
  assert.equal(commits(), n + 1, 'ровно один новый коммит');
  const msg = git(['log', '-1', '--pretty=%s']).trim();
  assert.match(msg, /T1/, 'сообщение несёт Tid');
  // ГЛАВНЫЙ инвариант T007: gate НЕ ставит [X] — метку ставит оркестратор после merge (T008)
  const tasks = fs.readFileSync(path.join(REPO, 'specs', 'tasks.md'), 'utf8');
  assert.match(tasks, /- \[ \] \*\*T1\*\*/, 'T1 остался [ ] — gate не трогает tasks.md');
});

test('gate: нет elt CLI → stage env, без спавна оракула', async () => {
  const r = await gate.gate({ tid: 'T9', taskText: 'x', cwd: REPO, elt: path.join(REPO, 'нет-elt.js') });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'env');
});

test('gate: судья block → НЕ коммитит, stage judge', async () => {
  fs.writeFileSync(path.join(REPO, 'slice2.txt'), 'work2\n');
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', BLOCK_STUB]);
  const n = commits();
  const r = await gate.gate({ tid: 'T2', taskText: 'демо2', cwd: REPO });
  delete process.env.FLEET_BIN_CLAUDE;
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'judge');
  assert.equal(r.verdict, 'block');
  assert.deepEqual(r.reasons, ['stub'], 'T022: причина block доступна caller-у для проброса дальше');
  assert.equal(commits(), n, 'блок → дерево не закоммичено');
});

// T025 end-to-end: судья реально получает рубрику + переживающую retry block-причину.
// Стаб-судья пишет прочитанный stdin (реальный промпт) в capture-файл — проверяем содержимое,
// не полагаемся на unit-тест judgePrompt в изоляции.
function stubCapture(name, verdict, capturePath) {
  const body = `const fs=require('fs');let d='';process.stdin.on('data',c=>d+=c);` +
    `process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(capturePath)},d);` +
    `console.log(JSON.stringify({verdict:${JSON.stringify(verdict)},reasons:['scope creep вне files']}));});`;
  return writeStub(name, body);
}

test('gate: судья получает рубрику spec.md + переживающую retry block-причину в промпте', async () => {
  const specDir = path.join(REPO, 'specs');
  fs.writeFileSync(path.join(specDir, 'spec.md'), 'Критерий приёмки: T4 не трогает slice2.txt');
  fs.writeFileSync(path.join(REPO, 'specs', 'tasks.md'), '- [ ] **T4** демо4\n');
  fs.writeFileSync(path.join(REPO, 'slice4.txt'), 'work4\n');

  const cap1 = path.join(os.tmpdir(), `fleet-gate-cap1-${Date.now()}.json`);
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stubCapture('judge-cap1.js', 'block', cap1)]);
  const r1 = await gate.gate({ tid: 'T4', taskText: 'демо4', cwd: REPO });
  delete process.env.FLEET_BIN_CLAUDE;
  assert.equal(r1.ok, false);
  assert.equal(r1.stage, 'judge');
  const prompt1 = fs.readFileSync(cap1, 'utf8');
  assert.match(prompt1, /РУБРИКА/, 'рубрика попала в реальный промпт судьи');
  assert.match(prompt1, /Критерий приёмки: T4 не трогает slice2\.txt/);
  assert.doesNotMatch(prompt1, /ПРЕДЫДУЩАЯ/, 'первая попытка — ещё нет block-причины');

  const cap2 = path.join(os.tmpdir(), `fleet-gate-cap2-${Date.now()}.json`);
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stubCapture('judge-cap2.js', 'pass', cap2)]);
  const r2 = await gate.gate({ tid: 'T4', taskText: 'демо4', cwd: REPO, prevBlockReason: r1.reasons.join('; ') });
  delete process.env.FLEET_BIN_CLAUDE;
  assert.equal(r2.ok, true, 'retry с исправлением проходит');
  const prompt2 = fs.readFileSync(cap2, 'utf8');
  assert.match(prompt2, /ПРЕДЫДУЩАЯ попытка.*ЗАБЛОКИРОВАНА.*scope creep вне files/s, 'block-причина пережила retry');
  fs.rmSync(path.join(specDir, 'spec.md'), { force: true });
  fs.rmSync(cap1, { force: true });
  fs.rmSync(cap2, { force: true });
});

test('gate: красный оракул → stage oracle, судья не зовётся', async () => {
  writeHarness('node -e "process.exit(1)"');
  const r = await gate.gate({ tid: 'T3', taskText: 'x', cwd: REPO });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'oracle');
  writeHarness('node --version'); // вернуть зелёный для гигиены
});

// --- Живой прогон 007 (2026-07-22): оракул гонялся через spawnSync и вешал ВЕСЬ event loop
// оркестратора на свои ~96с. Следствия были видны живьём: таймауты воркеров не срабатывали,
// поллинг .harness/STOP не тикал, close-события соседних слайсов копились, а гейты внутри
// Promise.all шли последовательно — параллельность fleet съедалась на самом дорогом шаге.
// Тест меряет НЕ время гейта, а живость петли во время него: тикает ли таймер. ---
// Меряем МАКСИМАЛЬНЫЙ ЗАЗОР между тиками, а не их количество: количество набегает во время
// судьи (он и так асинхронный) и регресс маскирует — проверено, первая версия теста прошла
// и с spawnSync. Блокировка event loop видна только как дыра длиной в сам оракул.
test('gate: оракул не блокирует event loop оркестратора', async () => {
  const ORACLE_MS = 2000;
  writeHarness(`node -e "setTimeout(()=>{},${ORACLE_MS})"`); // «долгий» оракул, зелёный
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', PASS_STUB]);
  fs.writeFileSync(path.join(REPO, 'heartbeat.txt'), 'work\n');
  let last = Date.now();
  let maxGap = 0;
  const beat = setInterval(() => { const now = Date.now(); maxGap = Math.max(maxGap, now - last); last = now; }, 50);
  try {
    await gate.gate({ tid: 'T3', taskText: 'x', cwd: REPO });
  } finally {
    clearInterval(beat);
    delete process.env.FLEET_BIN_CLAUDE;
    writeHarness('node --version');
  }
  // async: зазоры ~интервал таймера. spawnSync: одна дыра длиной в оракул (≈ORACLE_MS).
  assert.ok(maxGap < ORACLE_MS / 2, `event loop стоял ${maxGap}мс при оракуле ${ORACLE_MS}мс — гейт снова синхронный`);
});

// --- 006 T007: межрепо-слепота судьи — [files:] может указывать на путь ВНЕ репо worktree'а ---
test('judgePrompt: externalDiffs добавляет секцию «ВНЕШНИЙ РЕПО» с root/status/diff', () => {
  const p0 = gate.judgePrompt('T1', 'задача', 'diff', 'status');
  assert.doesNotMatch(p0, /ВНЕШНИЙ РЕПО/);
  const p1 = gate.judgePrompt('T1', 'задача', 'diff', 'status', '', null, [{ root: 'C:\\fake\\repo', diff: 'внешний дифф ABC', status: 'M x.md' }]);
  assert.match(p1, /ВНЕШНИЙ РЕПО C:\\fake\\repo/);
  assert.match(p1, /внешний дифф ABC/);
});

test('externalRepoRoots: файл зоны в другом git-репо → его корень; файл внутри cwd-репо → пусто', () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-outer-'));
  const cwdRepo = path.join(outer, 'cwd-repo');
  const otherRepo = path.join(outer, 'other-repo');
  try {
    for (const r of [cwdRepo, otherRepo]) {
      fs.mkdirSync(r, { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: r });
      execFileSync('git', ['config', 'user.email', 't@t'], { cwd: r });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: r });
      fs.writeFileSync(path.join(r, 'seed.txt'), 'seed\n');
      execFileSync('git', ['add', '-A'], { cwd: r });
      execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: r });
    }
    fs.writeFileSync(path.join(otherRepo, 'skill.md'), 'изменено\n');
    const roots = gate.externalRepoRoots(cwdRepo, [path.join(otherRepo, 'skill.md'), 'tools/local.js']);
    assert.deepEqual(roots.map((r) => fs.realpathSync(r)), [fs.realpathSync(otherRepo)]);
    const diffs = gate.slurpExternalDiffs(cwdRepo, [path.join(otherRepo, 'skill.md')]);
    assert.equal(diffs.length, 1);
    assert.match(diffs[0].status, /skill\.md/);
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});

// 009 T014: внешний репо показывается судье ТОЛЬКО по зоне [files:]. Живой ложный block
// T003 (2026-07-24): слайс правил ~/.claude/skills/elt/SKILL.md, а судья увидел заодно
// пользовательские settings.json/plans/** того же репо и вменил их слайсу как scope creep.
test('slurpExternalDiffs: внешний репо режется по зоне — чужие правки того же репо не видны', () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-extscope-'));
  const cwdRepo = path.join(outer, 'cwd-repo');
  const shared = path.join(outer, 'shared-repo');   // ~/.claude: общий репо пользователя
  try {
    for (const r of [cwdRepo, shared]) {
      fs.mkdirSync(r, { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: r });
      execFileSync('git', ['config', 'user.email', 't@t'], { cwd: r });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: r });
      fs.writeFileSync(path.join(r, 'seed.txt'), 'seed\n');
      execFileSync('git', ['add', '-A'], { cwd: r });
      execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: r });
    }
    fs.mkdirSync(path.join(shared, 'skills'));
    fs.writeFileSync(path.join(shared, 'skills', 'SKILL.md'), 'работа слайса\n');       // зона
    fs.writeFileSync(path.join(shared, 'settings.json'), '{"effortLevel":"medium"}\n');  // чужое
    fs.writeFileSync(path.join(shared, 'seed.txt'), 'правка пользователя\n');            // чужое

    const [ext] = gate.slurpExternalDiffs(cwdRepo, [path.join(shared, 'skills', 'SKILL.md')]);
    assert.match(ext.status, /SKILL\.md/, 'файл зоны показан');
    assert.doesNotMatch(ext.status, /settings\.json/, 'чужая правка того же репо не вменяется слайсу');
    assert.doesNotMatch(ext.diff, /правка пользователя/);
    assert.match(ext.diff, /работа слайса/);
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});

// Реальный кейс 006 T007: скилл-слайс правит SKILL.md в отдельном репо (~/.claude) +
// контракт-тест в этом репо (tools/). cwd-дифф НЕ пуст (тест реален), но главная работа
// (сам SKILL.md) видна судье только через внешний дифф — раньше судья её не видел вообще.
test('gate: задача с [files: тест-в-cwd, SKILL.md во внешнем репо] → судья видит ОБА диффа', async () => {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-crossrepo-'));
  const otherRepo = path.join(outer, 'other-repo');
  try {
    fs.mkdirSync(otherRepo, { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: otherRepo });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: otherRepo });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: otherRepo });
    fs.writeFileSync(path.join(otherRepo, 'SKILL.md'), 'v1\n');
    execFileSync('git', ['add', '-A'], { cwd: otherRepo });
    execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: otherRepo });
    fs.writeFileSync(path.join(otherRepo, 'SKILL.md'), 'v2 — реальная правка слайса\n');
    fs.writeFileSync(path.join(REPO, 'contract-check.js'), 'ok\n'); // cwd-репо тоже трогается (реальный паттерн 006)
    fs.appendFileSync(path.join(REPO, 'specs', 'tasks.md'), '- [ ] **T5** демо\n');

    const cap = path.join(os.tmpdir(), `fleet-gate-crossrepo-${Date.now()}.txt`);
    process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stubCapture('judge-crossrepo.js', 'pass', cap)]);
    const taskText = `демо [files:contract-check.js,${otherRepo.replace(/\\/g, '/')}/SKILL.md]`;
    const r = await gate.gate({ tid: 'T5', taskText, cwd: REPO });
    delete process.env.FLEET_BIN_CLAUDE;
    assert.equal(r.ok, true);
    const promptSeen = fs.readFileSync(cap, 'utf8');
    assert.match(promptSeen, /ВНЕШНИЙ РЕПО/);
    assert.match(promptSeen, /v2 — реальная правка слайса/, 'внешняя правка реально видна судье');
    fs.rmSync(cap, { force: true });
  } finally { fs.rmSync(outer, { recursive: true, force: true }); }
});

// --- inScope: чистая функция зоны [files:] ---
test('inScope: точный путь и вне-зонные файлы', () => {
  assert.equal(gate.inScope('out/alpha.txt', ['out/alpha.txt']), true);
  assert.equal(gate.inScope('out/alpha.txt', ['out/*.txt']), true, 'глоб-зона по префиксу');
  assert.equal(gate.inScope('.harness/harness.json', ['out/alpha.txt']), false, 'harness.json вне зоны');
  assert.equal(gate.inScope('tasks.md', ['out/alpha.txt']), false, 'tasks.md вне зоны');
  assert.equal(gate.inScope('.harness/run-log.jsonl', ['out/alpha.txt']), false, 'run-log вне зоны');
});

// --- T028 регрессия (живой блокер): воркер сам git commit'ит + правит вне [files:] ---
// agy живьём: пишет scoped-файл → git add+commit (→ `git diff HEAD` ПУСТ) → на heal правит
// harness.json/tasks.md вне зоны. Судья видел пустой/шумный дифф и REJECT-default бил чистую
// работу. gate.normalizeWorktree обязан привести дерево к «base + только [files:], некоммичено».
// Симулируем поведение обычным git (без реального agy) — детерминированно.
test('gate: self-commit воркера + правка вне [files:] → нормализуются, судья видит чистый scoped-дифф → pass', async () => {
  const R = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-norm-'));
  const g2 = (args) => execFileSync('git', args, { cwd: R, encoding: 'utf8' });
  try {
    g2(['init', '-q']); g2(['config', 'user.email', 't@t']); g2(['config', 'user.name', 't']);
    fs.mkdirSync(path.join(R, 'out'), { recursive: true });
    fs.writeFileSync(path.join(R, 'out', '.gitkeep'), '');
    fs.writeFileSync(path.join(R, 'tasks.md'), '- [ ] **T1** демо [files:out/alpha.txt]\n');
    fs.mkdirSync(path.join(R, '.harness'), { recursive: true });
    const baseShell = process.platform === 'win32' ? 'powershell' : 'bash';
    fs.writeFileSync(path.join(R, '.harness', 'harness.json'),
      JSON.stringify({ kind: 'code', oracle: 'node --version', shell: baseShell, branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' }, l0: { hotPaths: ['**'] } }));
    // capture-стаб судьи кладём в base (не часть слайса, чужой дифф не создаёт)
    const cap = path.join(os.tmpdir(), `fleet-gate-cap-${Date.now()}.txt`);
    fs.writeFileSync(path.join(R, 'judge.js'),
      `const fs=require('fs');let d='';process.stdin.on('data',c=>d+=c);` +
      `process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(cap)},d);` +
      `console.log(JSON.stringify({verdict:'pass',reasons:['ok']}));});`);
    g2(['add', '-A']); g2(['commit', '-q', '-m', 'seed']);
    const base = g2(['rev-parse', 'HEAD']).trim();
    g2(['checkout', '-q', '-b', 'fleet/T1']);

    // СИМУЛЯЦИЯ agy: scoped-файл + правки tasks.md И harness.json вне зоны + САМ коммитит всё.
    // (harness.json безопасно тут: gate нормализует ПЕРЕД своим оракулом — битый shell откатится
    // до прогона оракула, в отличие от heal-фазы fleet.run, где оракул идёт раньше нормализации.)
    fs.writeFileSync(path.join(R, 'out', 'alpha.txt'), 'ALPHA\n');
    fs.writeFileSync(path.join(R, 'tasks.md'), '- [X] **T1** демо [files:out/alpha.txt]\n');
    fs.writeFileSync(path.join(R, '.harness', 'harness.json'),
      JSON.stringify({ kind: 'code', oracle: 'node --version', shell: 'zsh', branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' }, l0: { hotPaths: ['**'] } }));
    g2(['add', '-A']); g2(['commit', '-q', '-m', 'feat: add alpha output']);
    assert.equal(g2(['diff', 'HEAD']).trim(), '', 'до нормализации git diff HEAD ПУСТ (self-commit спрятал работу)');

    process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', path.join(R, 'judge.js')]);
    const r = await gate.gate({ tid: 'T1', taskText: 'демо [files:out/alpha.txt]', cwd: R, integration: base });
    delete process.env.FLEET_BIN_CLAUDE;

    assert.equal(r.ok, true, 'нормализованный scoped-дифф → судья pass → commit (оракул зелёный: harness.json откачен ДО оракула)');
    const promptSeen = fs.readFileSync(cap, 'utf8');
    assert.match(promptSeen, /out\/alpha\.txt/, 'судья ВИДИТ scoped-файл в диффе (self-commit снят)');
    assert.doesNotMatch(promptSeen, /\[X\] \*\*T1\*\*/, 'вне-зонная правка tasks.md НЕ в диффе судьи (возвращена к base)');
    assert.match(fs.readFileSync(path.join(R, 'tasks.md'), 'utf8'), /- \[ \] \*\*T1\*\*/, 'tasks.md на диске восстановлен к base [ ]');
    assert.equal(JSON.parse(fs.readFileSync(path.join(R, '.harness', 'harness.json'), 'utf8')).shell, baseShell, 'harness.json shell восстановлен к base');
  } finally {
    delete process.env.FLEET_BIN_CLAUDE;
    try { fs.rmSync(cap, { force: true }); } catch { /* noop */ }
    try { fs.rmSync(R, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

// --- 011 T019(б): grounding:no-reasons — транспорт, а не качество ---
// Провайдер без structured output (codex/agy отвечают JSON-хвостом) регулярно теряет reasons;
// по замеру артефакта это 10% ВСЕХ блоков — блокировался формат ответа, а не работа.
// Стаб считает СВОИ запуски: «ровно одна перевыдача» проверяется счётчиком, а не последствиями.
function stubCounting(name, body, counterPath) {
  return writeStub(name, `require('fs').appendFileSync(${JSON.stringify(counterPath)},'x');\n${body}`);
}
test('T019: no-reasons → ровно одна перевыдача, повтор даёт inconclusive и коммит проходит', async () => {
  const counter = path.join(os.tmpdir(), `fleet-noreasons-${Date.now()}.txt`);
  fs.writeFileSync(path.join(REPO, 'slice-nr.txt'), 'work-nr\n');
  fs.writeFileSync(path.join(REPO, 'specs', 'tasks.md'), '- [ ] **T5** демо5\n');
  const stubJs = stubCounting('judge-noreasons.js',
    `console.log(JSON.stringify({verdict:'pass',reasons:[],filesReviewed:['slice-nr.txt']}));`, counter);
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stubJs]);
  const n = commits();
  const r = await gate.gate({ tid: 'T5', taskText: 'демо5', cwd: REPO });
  delete process.env.FLEET_BIN_CLAUDE;

  assert.equal(fs.readFileSync(counter, 'utf8').length, 2, 'ровно два прогона: исходный + ОДНА перевыдача');
  assert.equal(r.ok, true, 'повторный no-reasons больше не блокирует — слайс идёт дальше с меткой');
  assert.equal(r.verdict, 'inconclusive');
  assert.equal(commits(), n + 1, 'коммит состоялся');
  fs.rmSync(counter, { force: true });
});

test('T019: перевыдача помогла (reasons появились) → обычный pass, без метки', async () => {
  const counter = path.join(os.tmpdir(), `fleet-nr-heal-${Date.now()}.txt`);
  const flag = path.join(os.tmpdir(), `fleet-nr-flag-${Date.now()}.txt`);
  fs.writeFileSync(path.join(REPO, 'slice-nr2.txt'), 'work-nr2\n');
  fs.writeFileSync(path.join(REPO, 'specs', 'tasks.md'), '- [ ] **T6** демо6\n');
  // Первый прогон отдаёт пустой reasons, второй — нормальный: ровно транспортный сбой.
  const stubJs = stubCounting('judge-nr-heal.js',
    `const fs=require('fs');const f=${JSON.stringify(flag)};` +
    `const first=!fs.existsSync(f);if(first)fs.writeFileSync(f,'1');` +
    // filesReviewed не шлём: файловые проверки здесь не предмет теста (тест-фикстура двигает
    // ещё и tasks.md, полный список судье пришлось бы поддерживать вручную), а no-reasons
    // срабатывает безусловно — независимо от того, знает провайдер про поле или нет.
    `console.log(JSON.stringify({verdict:'pass',reasons:first?[]:['в границах']}));`, counter);
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stubJs]);
  const r = await gate.gate({ tid: 'T6', taskText: 'демо6', cwd: REPO });
  delete process.env.FLEET_BIN_CLAUDE;

  assert.equal(fs.readFileSync(counter, 'utf8').length, 2, 'перевыдача была ровно одна');
  assert.equal(r.ok, true);
  assert.equal(r.verdict, 'pass', 'ответ со второго раза разобран — сомнение не записывается человеку зря');
  fs.rmSync(counter, { force: true });
  fs.rmSync(flag, { force: true });
});

test('T019: phantom-file НЕ ретраится и остаётся block — это враньё судьи, а не транспорт', async () => {
  const counter = path.join(os.tmpdir(), `fleet-phantom-${Date.now()}.txt`);
  fs.writeFileSync(path.join(REPO, 'slice-ph.txt'), 'work-ph\n');
  fs.writeFileSync(path.join(REPO, 'specs', 'tasks.md'), '- [ ] **T7** демо7\n');
  const stubJs = stubCounting('judge-phantom.js',
    `console.log(JSON.stringify({verdict:'pass',reasons:['всё разобрал'],filesReviewed:['нет-такого-файла.js']}));`, counter);
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stubJs]);
  const n = commits();
  const r = await gate.gate({ tid: 'T7', taskText: 'демо7', cwd: REPO });
  delete process.env.FLEET_BIN_CLAUDE;

  assert.equal(fs.readFileSync(counter, 'utf8').length, 1, 'ретрая нет: враньё о прочитанном не лечится повтором');
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'judge');
  assert.equal(r.verdict, 'block');
  assert.ok((r.reasons || []).includes('grounding:phantom-file'));
  assert.equal(commits(), n, 'дерево не закоммичено');
  fs.rmSync(counter, { force: true });
});

// 011 T019: двухсудейский путь — свёртка вердиктов знает про ТРИ исхода.
// Поймано судьёй на самом слайсе T019: `secondary.verdict === 'pass' ? 'pass' : 'block'`
// возвращало `inconclusive` verify-судьи обратно в block — то есть ровно в сценарии, который
// спека 011 называет главным источником 77% block-rate («verify заблокировал при pass
// первичного 36 из 48»), заявленное «grounding больше не блокирует» не выполнялось.
// Тесты выше этот путь не задевали: их фикстура без `judge.verify`, второй слой не включался.
const providers = require('./providers');
async function withVerdicts(byProvider, fn) {
  const calls = [];
  const original = providers.run;
  providers.run = async (opts) => {
    calls.push(opts.provider);
    const v = byProvider[opts.provider] || { verdict: 'pass', reasons: ['стаб'] };
    return { ok: true, stdout: JSON.stringify([{ type: 'result', structured_output: { ...v } }]), logPath: null };
  };
  try { return { result: await fn(), calls }; } finally { providers.run = original; }
}
function verifyRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-verify-'));
  const g = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(repo, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash',
    branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' }, l0: { hotPaths: ['**'] },
  }));
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'seed']);
  fs.writeFileSync(path.join(repo, 'work.js'), 'module.exports = 1;\n');
  return repo;
}
const VERIFY = { provider: 'codex', model: 'gpt-5.6' };

test('T019: verify дал inconclusive → итог inconclusive, а не block', async () => {
  const repo = verifyRepo();
  const { result, calls } = await withVerdicts(
    { codex: { verdict: 'inconclusive', reasons: ['не могу ручаться за внешний вызов'] } },
    () => gate.runJudge({ cwd: repo, tid: 'T1', taskText: 'слайс', provider: 'claude', model: 'sonnet', verify: VERIFY }));
  assert.deepEqual(calls, ['claude', 'codex'], 'оба слоя отработали');
  assert.equal(result.verdict, 'inconclusive', 'сомнение второго слоя — сомнение, а не отказ');
  assert.ok(result.reasons.some((r) => /не могу ручаться/.test(r)), 'причина verify доезжает до человека');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('T019: verify дал block → итог block (второй слой не ослаблен третьим исходом)', async () => {
  const repo = verifyRepo();
  const { result } = await withVerdicts({ codex: { verdict: 'block', reasons: ['scope creep'] } },
    () => gate.runJudge({ cwd: repo, tid: 'T1', taskText: 'слайс', provider: 'claude', model: 'sonnet', verify: VERIFY }));
  assert.equal(result.verdict, 'block');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('T019: verify потерял reasons дважды → inconclusive, а не block (транспорт не блокирует)', async () => {
  const repo = verifyRepo();
  const { result, calls } = await withVerdicts({ codex: { verdict: 'pass', reasons: [] } },
    () => gate.runJudge({ cwd: repo, tid: 'T1', taskText: 'слайс', provider: 'claude', model: 'sonnet', verify: VERIFY }));
  assert.deepEqual(calls, ['claude', 'codex', 'codex'], 'ровно одна перевыдача verify-судье');
  assert.equal(result.verdict, 'inconclusive');
  fs.rmSync(repo, { recursive: true, force: true });
});
