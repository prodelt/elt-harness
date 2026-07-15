'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}
function run(root, args) {
  return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' });
}
function result(run_) {
  return JSON.parse(run_.stdout.toString());
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-judge-proof-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# fixture\n');
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, judge: { enabled: true, model: 'codex' },
  }));
  fs.mkdirSync(path.join(root, 'specs', '000-closed'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '000-closed', 'tasks.md'), '- [X] **T001** historic duplicate\n');
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** first\n- [ ] **T002** second\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  fs.writeFileSync(path.join(root, 'slice.txt'), 'change\n');
  assert.equal(run(root, ['oracle']).status, 0);
  const write = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex']);
  assert.equal(write.status, 0, write.stderr.toString());
  assert.equal(result(write).specPath, 'specs/001-fixture/tasks.md');
  return root;
}
function proofPath(root) {
  return path.join(root, '.git', 'elt', 'judge-proof.json');
}
function expectReason(root, taskId, reason) {
  const run_ = run(root, ['judge-proof', 'validate', '--task', taskId]);
  assert.notEqual(run_.status, 0);
  assert.equal(result(run_).reason, reason);
}

test('judge proof: valid binding passes', () => {
  const root = fixture();
  const run_ = run(root, ['judge-proof', 'validate', '--task', 'T001']);
  assert.equal(run_.status, 0, run_.stderr.toString());
  assert.equal(result(run_).ok, true);
});

test('judge proof: malformed proof fails closed', () => {
  const root = fixture();
  fs.writeFileSync(proofPath(root), '{not json');
  expectReason(root, 'T001', 'malformed');
});

test('judge proof: changed tree is stale', () => {
  const root = fixture();
  fs.appendFileSync(path.join(root, 'slice.txt'), 'after proof\n');
  expectReason(root, 'T001', 'stale-tree');
});

test('judge proof: wrong task is rejected', () => {
  const root = fixture();
  expectReason(root, 'T002', 'task-mismatch');
  expectReason(root, 'T999', 'task-not-found');
  const noTask = run(root, ['judge-proof', 'validate']);
  assert.notEqual(noTask.status, 0);
  assert.equal(result(noTask).reason, 'task-required');
});

test('judge proof: block and dead are distinct rejection reasons', () => {
  const root = fixture();
  const proof = JSON.parse(fs.readFileSync(proofPath(root), 'utf8'));
  proof.verdict = 'block';
  proof.reasons = ['scope issue'];
  fs.writeFileSync(proofPath(root), JSON.stringify(proof));
  expectReason(root, 'T001', 'judge-block');
  proof.verdict = 'dead';
  proof.reasons = ['timeout'];
  fs.writeFileSync(proofPath(root), JSON.stringify(proof));
  expectReason(root, 'T001', 'judge-dead');
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
