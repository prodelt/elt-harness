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

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function run(root, args) { return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' }); }
function commitCount(root) { return Number(git(root, ['rev-list', '--count', 'HEAD'])); }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-commit-proof-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, branchPolicy: 'feature', judge: { enabled: true, model: 'codex' },
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** fixture\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  git(root, ['checkout', '-qb', 'work']);
  fs.writeFileSync(path.join(root, 'slice.txt'), 'change\n');
  return root;
}
function writeProof(root, verdict = 'pass') {
  assert.equal(run(root, ['oracle']).status, 0);
  const proof = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', verdict, '--model', 'codex']);
  assert.equal(proof.status, 0, proof.stderr.toString());
}
function assertRejected(root, args = []) {
  const before = commitCount(root);
  const result = run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'test commit', ...args]);
  assert.notEqual(result.status, 0, result.stderr.toString());
  assert.equal(commitCount(root), before, result.stderr.toString());
  assert.equal(git(root, ['diff', '--cached', '--name-only']), '', 'rejected commit must not stage files');
}

test('commit proof: missing, stale, block, and dead fail closed', () => {
  let root = fixture();
  assert.equal(run(root, ['oracle']).status, 0);
  assertRejected(root);

  root = fixture();
  writeProof(root);
  fs.appendFileSync(path.join(root, 'slice.txt'), 'after proof\n');
  assertRejected(root);

  root = fixture();
  writeProof(root, 'block');
  assertRejected(root);

  root = fixture();
  writeProof(root, 'dead');
  assertRejected(root);
});

test('commit proof: valid pass creates exactly one commit and rejects free verdict', () => {
  const root = fixture();
  writeProof(root);
  const before = commitCount(root);
  const result = run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'test commit']);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(commitCount(root), before + 1);
  assert.match(fs.readFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), 'utf8'), /\[X\] \*\*T001\*\*/);

  const fresh = fixture();
  writeProof(fresh);
  assertRejected(fresh, ['--verdict', 'pass']);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
