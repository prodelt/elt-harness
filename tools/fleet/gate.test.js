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
    JSON.stringify({ oracle, shell: 'bash', branchPolicy: 'feature', push: false }));
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
  assert.equal(commits(), n, 'блок → дерево не закоммичено');
});

test('gate: красный оракул → stage oracle, судья не зовётся', async () => {
  writeHarness('node -e "process.exit(1)"');
  const r = await gate.gate({ tid: 'T3', taskText: 'x', cwd: REPO });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'oracle');
  writeHarness('node --version'); // вернуть зелёный для гигиены
});
