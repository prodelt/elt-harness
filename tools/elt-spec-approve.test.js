'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const roots = [];
// approve now runs `spec lint` first (006 T003) — the fixture spec.md needs all
// required sections or approve fails closed before writing approval.json.
const FIXTURE_SPEC_MD = [
  '# fixture spec', '',
  '## Проблема', 'test', '',
  '## Решения', 'test', '',
  '## User stories', 'test', '',
  '## Критерии приёмки', 'test', '',
  '## Риски', 'test', '',
  '## Вне scope', 'test', '',
].join('\n');

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-spec-approve-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'spec.md'), FIXTURE_SPEC_MD);
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** first\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  return root;
}
function specDir(root) {
  return path.join(root, 'specs', '001-fixture');
}

test('spec approve: writes approval.json bound to current spec+tasks hashes', () => {
  const root = fixture();
  const r = run(root, ['spec', 'approve']);
  assert.equal(r.status, 0, r.stderr.toString());
  const approval = JSON.parse(fs.readFileSync(path.join(specDir(root), 'approval.json'), 'utf8'));
  assert.ok(approval.approvedAt);
  assert.ok(approval.specHash);
  assert.ok(approval.tasksHash);
});

test('spec status: unapproved before approve, approved after', () => {
  const root = fixture();
  assert.equal(result(run(root, ['spec', 'status'])).status, 'unapproved');
  assert.equal(run(root, ['spec', 'approve']).status, 0);
  assert.equal(result(run(root, ['spec', 'status'])).status, 'approved');
});

test('spec approve: idempotent — repeat call keeps the same approvedAt', () => {
  const root = fixture();
  const first = result(run(root, ['spec', 'approve']));
  const second = result(run(root, ['spec', 'approve']));
  assert.equal(second.approvedAt, first.approvedAt);
});

test('spec status: editing spec.md after approve goes stale', () => {
  const root = fixture();
  assert.equal(run(root, ['spec', 'approve']).status, 0);
  fs.appendFileSync(path.join(specDir(root), 'spec.md'), 'edited\n');
  assert.equal(result(run(root, ['spec', 'status'])).status, 'stale');
});

test('spec status: editing tasks.md after approve goes stale, re-approve clears it', () => {
  const root = fixture();
  assert.equal(run(root, ['spec', 'approve']).status, 0);
  fs.appendFileSync(path.join(specDir(root), 'tasks.md'), '- [ ] **T002** second\n');
  assert.equal(result(run(root, ['spec', 'status'])).status, 'stale');
  assert.equal(run(root, ['spec', 'approve']).status, 0);
  assert.equal(result(run(root, ['spec', 'status'])).status, 'approved');
});

test('spec approve: missing spec.md fails closed', () => {
  const root = fixture();
  fs.rmSync(path.join(specDir(root), 'spec.md'));
  const r = run(root, ['spec', 'approve']);
  assert.notEqual(r.status, 0);
});

test('spec approve/status: --spec targets an explicit dir regardless of other open plans', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'specs', '000-earlier'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '000-earlier', 'tasks.md'), '- [ ] **T001** earlier plan, no spec.md\n');
  const r = run(root, ['spec', 'approve', '--spec', 'specs/001-fixture']);
  assert.equal(r.status, 0, r.stderr.toString());
  assert.equal(result(run(root, ['spec', 'status', '--spec', 'specs/001-fixture'])).status, 'approved');
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
