'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { guard } = require('./approval-guard');
const ELT = path.join(__dirname, 'elt.js');
const GUARD_CLI = path.join(__dirname, 'approval-guard.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}
function elt(root, args) {
  return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' });
}
const COMPLETE_SPEC_MD = [
  '# fixture spec', '',
  '## Проблема', 'test', '',
  '## Решения', 'test', '',
  '## User stories', 'test', '',
  '## Критерии приёмки', 'test', '',
  '## Риски', 'test', '',
  '## Вне scope', 'test', '',
].join('\n');
function fixture({ specApproval = true, withSpecMd = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-guard-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL,
    judge: { enabled: true, model: 'codex' }, specApproval,
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  if (withSpecMd) fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'spec.md'), COMPLETE_SPEC_MD);
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** first\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  return root;
}
function specDir(root) {
  return path.join(root, 'specs', '001-fixture');
}

test('guard(): no harness.json at all → ok (no-config)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-guard-noconfig-'));
  roots.push(root);
  const r = guard(root);
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'no-config');
});

test('guard(): specApproval absent/false → ok (disabled), even with an unapproved spec.md present', () => {
  const root = fixture({ specApproval: false });
  const r = guard(root, specDir(root));
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'disabled');
});

test('guard(): specApproval:true + unapproved spec.md (explicit specDir) → blocked', () => {
  const root = fixture();
  const r = guard(root, specDir(root));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unapproved');
});

test('guard(): specApproval:true + approved spec.md (explicit specDir) → ok', () => {
  const root = fixture();
  assert.equal(elt(root, ['spec', 'approve']).status, 0);
  const r = guard(root, specDir(root));
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'approved');
});

test('guard(): micro-plan (no spec.md) → ok regardless of specApproval', () => {
  const root = fixture({ withSpecMd: false });
  const r = guard(root, specDir(root));
  assert.equal(r.ok, true);
  assert.equal(r.reason, 'micro-plan');
});

test('guard(): auto-detect specDir via `elt status` when specDir is omitted', () => {
  const root = fixture();
  const r = guard(root); // no explicit specDir — must resolve it itself
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unapproved');
  assert.equal(path.resolve(r.specDir), path.resolve(specDir(root)));
});

test('CLI: exits 1 and prints a loud message when blocked, 0 when clear', () => {
  const root = fixture();
  const blocked = spawnSync(process.execPath, [GUARD_CLI, root, 'specs/001-fixture'], { encoding: 'utf8' });
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /спека не утверждена/);

  assert.equal(elt(root, ['spec', 'approve']).status, 0);
  const clear = spawnSync(process.execPath, [GUARD_CLI, root, 'specs/001-fixture'], { encoding: 'utf8' });
  assert.equal(clear.status, 0);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
