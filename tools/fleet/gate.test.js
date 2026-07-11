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

// --- T022: block-причина прокидывается в prompt следующей попытки ---
test('parseReasons: читает reasons из JSON-фолбэка', () => {
  assert.deepEqual(gate.parseReasons('{"verdict":"block","reasons":["scope creep"]}'), ['scope creep']);
  assert.deepEqual(gate.parseReasons(''), []);
  assert.deepEqual(gate.parseReasons('текст без reasons'), []);
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

// --- gate() end-to-end на темп-репо с фейк-судьёй ---
const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-gate-'));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const commits = () => Number(git(['rev-list', '--count', 'HEAD']).trim());
const stub = (name, verdict) =>
  writeStub(name, `console.log('{"verdict":"${verdict}","reasons":["stub"]}');`);
function writeStub(name, body) { const p = path.join(REPO, name); fs.writeFileSync(p, body); return p; }
function writeHarness(oracle) {
  fs.mkdirSync(path.join(REPO, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.harness', 'harness.json'),
    JSON.stringify({ oracle, shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false }));
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

  const cap1 = path.join(REPO, 'capture1.json');
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stubCapture('judge-cap1.js', 'block', cap1)]);
  const r1 = await gate.gate({ tid: 'T4', taskText: 'демо4', cwd: REPO });
  delete process.env.FLEET_BIN_CLAUDE;
  assert.equal(r1.ok, false);
  assert.equal(r1.stage, 'judge');
  const prompt1 = fs.readFileSync(cap1, 'utf8');
  assert.match(prompt1, /РУБРИКА/, 'рубрика попала в реальный промпт судьи');
  assert.match(prompt1, /Критерий приёмки: T4 не трогает slice2\.txt/);
  assert.doesNotMatch(prompt1, /ПРЕДЫДУЩАЯ/, 'первая попытка — ещё нет block-причины');

  const cap2 = path.join(REPO, 'capture2.json');
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stubCapture('judge-cap2.js', 'pass', cap2)]);
  const r2 = await gate.gate({ tid: 'T4', taskText: 'демо4', cwd: REPO, prevBlockReason: r1.reasons.join('; ') });
  delete process.env.FLEET_BIN_CLAUDE;
  assert.equal(r2.ok, true, 'retry с исправлением проходит');
  const prompt2 = fs.readFileSync(cap2, 'utf8');
  assert.match(prompt2, /ПРЕДЫДУЩАЯ попытка.*ЗАБЛОКИРОВАНА.*scope creep вне files/s, 'block-причина пережила retry');
  fs.rmSync(path.join(specDir, 'spec.md'), { force: true });
});

test('gate: красный оракул → stage oracle, судья не зовётся', async () => {
  writeHarness('node -e "process.exit(1)"');
  const r = await gate.gate({ tid: 'T3', taskText: 'x', cwd: REPO });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'oracle');
  writeHarness('node --version'); // вернуть зелёный для гигиены
});
