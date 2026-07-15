'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const roots = [];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
function run(root) {
  return spawnSync(process.execPath, [ELT, 'checkpoint', '-m', 'docs: checkpoint fixture'], { cwd: root, encoding: 'utf8' });
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-checkpoint-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.planning'));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'STATE.md'), 'seed\n');
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** fixture\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  return root;
}
function commitCount(root) {
  return Number(git(root, ['rev-list', '--count', 'HEAD']));
}
function assertRejected(root) {
  const before = commitCount(root);
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.equal(commitCount(root), before, result.stderr.toString());
  assert.equal(git(root, ['diff', '--cached', '--name-only']), '', 'rejected checkpoint must not stage files');
}

test('checkpoint commits planning-only changes without judge', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, '.planning', 'STATE.md'), 'checkpoint\n');
  const before = commitCount(root);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(commitCount(root), before + 1);
  assert.equal(git(root, ['status', '--porcelain']), '');
});

test('checkpoint rejects code, harness config, and mixed changes before staging', () => {
  let root = fixture();
  fs.mkdirSync(path.join(root, 'tools'));
  fs.writeFileSync(path.join(root, 'tools', 'x.js'), 'module.exports = 1;\n');
  assertRejected(root);

  root = fixture();
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), '{}\n');
  assertRejected(root);

  root = fixture();
  fs.writeFileSync(path.join(root, '.planning', 'STATE.md'), 'allowed\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'blocked\n');
  assertRejected(root);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
