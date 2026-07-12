'use strict';
// T002 (004-elt-selfdrive): liveness-инвариант судьи. Мёртвый судья (пустой вывод/timeout/
// spawn-fail) ДОЛЖЕН давать runOk:false (ERROR-STOP), а НЕ маскироваться под block —
// иначе тихий сбой неотличим от reject (корень бага 3e73423). Покрываем и сам инвариант
// (gate.runJudge/gate), и мост tools/judge-invoke.js, через который solo-драйвер его читает.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gate = require('./gate');

const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-invoke-'));
const BRIDGE = path.join(__dirname, '..', 'judge-invoke.js');
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const stub = (name, body) => { const p = path.join(REPO, name); fs.writeFileSync(p, body); return p; };

let PASS_STUB, EMPTY_STUB;
before(() => {
  git(['init', '-q']); git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(REPO, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'specs', 'tasks.md'), '- [ ] **T1** демо-слайс\n');
  fs.writeFileSync(path.join(REPO, 'seed.txt'), 'seed\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'seed']);
  git(['checkout', '-q', '-b', 'fleet/T1']); // как worktree — не main, без авто-ветки
  fs.mkdirSync(path.join(REPO, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.harness', 'harness.json'),
    JSON.stringify({ oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false }));
  PASS_STUB = stub('judge-pass.js', `console.log('{"verdict":"pass","reasons":["ok"]}');`);
  EMPTY_STUB = stub('judge-empty.js', 'process.exit(0);'); // пустой stdout → providers ok:false
  fs.writeFileSync(path.join(REPO, 'slice.txt'), 'work\n'); // есть что судить (непустой дифф)
});
after(() => { try { fs.rmSync(REPO, { recursive: true, force: true }); } catch { /* noop */ } });

test('runJudge: мёртвый судья (пустой вывод) → runOk:false, verdict null — НЕ block', async () => {
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', EMPTY_STUB]);
  const r = await gate.runJudge({ cwd: REPO, tid: 'T1', taskText: 'демо', model: 'sonnet' });
  delete process.env.FLEET_BIN_CLAUDE;
  assert.equal(r.runOk, false, 'пустой вывод судьи = НЕ отработал');
  assert.equal(r.verdict, null, 'liveness-сбой не даёт вердикт (иначе REJECT-default замаскирует под block)');
});

test('gate: мёртвый судья → stage judge-unavailable (парковка, НЕ judge/reject)', async () => {
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', EMPTY_STUB]);
  const r = await gate.gate({ tid: 'T1', taskText: 'демо', cwd: REPO });
  delete process.env.FLEET_BIN_CLAUDE;
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'judge-unavailable', 'dead-judge ≠ legitimate block');
});

// Мост judge-invoke.js: solo-драйвер читает этот JSON и ветвится по runOk.
function runBridge() {
  const desc = path.join(REPO, 'jdesc.json');
  fs.writeFileSync(desc, JSON.stringify({ cwd: REPO, tid: 'T1', taskText: 'демо', model: 'sonnet' }));
  const r = spawnSync('node', [BRIDGE, desc], { encoding: 'utf8' }); // наследует FLEET_BIN_CLAUDE из env
  return JSON.parse(r.stdout);
}

test('judge-invoke мост: мёртвый судья → JSON runOk:false', () => {
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', EMPTY_STUB]);
  const j = runBridge();
  delete process.env.FLEET_BIN_CLAUDE;
  assert.equal(j.runOk, false, 'мост доносит liveness-сбой до PS-драйвера как runOk:false');
});

test('judge-invoke мост: живой судья pass → JSON runOk:true, verdict pass', () => {
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', PASS_STUB]);
  const j = runBridge();
  delete process.env.FLEET_BIN_CLAUDE;
  assert.equal(j.runOk, true);
  assert.equal(j.verdict, 'pass');
});
