'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const REPO_ROOT = path.join(__dirname, '..');
const roots = [];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}
function run(root, args) {
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
function fixture(specMd) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-spec-lint-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'spec.md'), specMd);
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** first\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  return root;
}

test('spec lint: passes when all required sections are present', () => {
  const root = fixture(COMPLETE_SPEC_MD);
  const r = run(root, ['spec', 'lint']);
  assert.equal(r.status, 0, r.stderr.toString());
});

test('spec lint: fails closed and lists every missing section', () => {
  const root = fixture('# fixture spec\n\n## Проблема\ntest\n');
  const r = run(root, ['spec', 'lint']);
  assert.notEqual(r.status, 0);
  const stderr = r.stderr.toString();
  for (const section of ['Решения', 'User stories', 'Критерии приёмки', 'Риски', 'Вне scope']) {
    assert.ok(stderr.includes(section), `expected stderr to mention missing section "${section}": ${stderr}`);
  }
  assert.ok(!stderr.includes('Проблема'), 'present section must not be listed as missing');
});

test('spec lint: matches sections by prefix (heading may carry extra context)', () => {
  const withExtras = COMPLETE_SPEC_MD.replace('## Решения', '## Решения (зафиксированы с пользователем 2026-07-20)')
    .replace('## Вне scope', '## Вне scope (кандидаты в 007)');
  const root = fixture(withExtras);
  const r = run(root, ['spec', 'lint']);
  assert.equal(r.status, 0, r.stderr.toString());
});

test('spec approve: refuses to write approval.json when lint fails', () => {
  const root = fixture('# fixture spec\n\n## Проблема\ntest\n');
  const r = run(root, ['spec', 'approve']);
  assert.notEqual(r.status, 0);
  assert.ok(!fs.existsSync(path.join(root, 'specs', '001-fixture', 'approval.json')), 'approve must not write approval.json when lint fails');
});

test('spec approve: proceeds once lint passes', () => {
  const root = fixture(COMPLETE_SPEC_MD);
  const r = run(root, ['spec', 'approve']);
  assert.equal(r.status, 0, r.stderr.toString());
  assert.ok(fs.existsSync(path.join(root, 'specs', '001-fixture', 'approval.json')));
});

test('spec lint: missing spec.md fails closed with the full section list', () => {
  const root = fixture(COMPLETE_SPEC_MD);
  fs.rmSync(path.join(root, 'specs', '001-fixture', 'spec.md'));
  const r = run(root, ['spec', 'lint']);
  assert.notEqual(r.status, 0);
});

test('self-check: specs/006-elt-front-gate/spec.md passes its own lint', () => {
  const r = spawnSync(process.execPath, [ELT, 'spec', 'lint', '--spec', 'specs/006-elt-front-gate'], { cwd: REPO_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr.toString());
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
