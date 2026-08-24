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
// approve now runs `spec lint` first (006 T003) — needs all required sections.
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
function harness(specApproval) {
  return JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL,
    judge: { enabled: true, model: 'codex' }, specApproval,
  });
}
function fixture({ specApproval = true, withSpecMd = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-approval-gate-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), harness(specApproval));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  if (withSpecMd) fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'spec.md'), FIXTURE_SPEC_MD);
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** first\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  return root;
}
function specDir(root) {
  return path.join(root, 'specs', '001-fixture');
}
function approve(root) {
  const r = run(root, ['spec', 'approve']);
  assert.equal(r.status, 0, r.stderr.toString());
}

test('slice next: blocked (exit 4) when specApproval:true and spec unapproved', () => {
  const root = fixture();
  const r = run(root, ['slice', 'next']);
  assert.equal(r.status, 4, r.stderr.toString());
});

test('slice next: proceeds once the spec is approved', () => {
  const root = fixture();
  approve(root);
  const r = run(root, ['slice', 'next', '--json']);
  assert.equal(r.status, 0, r.stderr.toString());
  assert.equal(result(r).id, 'T001');
});

test('slice next: --skip-approval bypasses the gate without an approval', () => {
  const root = fixture();
  const r = run(root, ['slice', 'next', '--json', '--skip-approval']);
  assert.equal(r.status, 0, r.stderr.toString());
});

test('slice next: specApproval:false (absent) never gates, regardless of spec.md', () => {
  const root = fixture({ specApproval: false });
  const r = run(root, ['slice', 'next', '--json']);
  assert.equal(r.status, 0, r.stderr.toString());
});

test('slice next: micro-plan (tasks.md without spec.md) is never gated', () => {
  const root = fixture({ withSpecMd: false });
  const r = run(root, ['slice', 'next', '--json']);
  assert.equal(r.status, 0, r.stderr.toString());
});

// Regression: `slice next` never required a fully-valid harness.json before this
// gate existed (only `commit`/`oracle` do). A minimal config missing kind/judge
// (e.g. the self-heal watchdog's {oracle, shell} fixture) must keep working —
// the gate is opt-in and must not newly demand full schema validity to be a no-op.
test('slice next: a minimal harness.json (no kind/judge) still works when specApproval is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-approval-gate-minimal-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({ oracle: 'exit 1', shell: SHELL }));
  fs.mkdirSync(path.join(root, 'specs', '001-selfheal'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-selfheal', 'tasks.md'), '- [ ] **T001** self-heal fix\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  const r = run(root, ['slice', 'next', '--json']);
  assert.equal(r.status, 0, r.stderr.toString());
  assert.equal(result(r).id, 'T001');
});

function commitFixture(root) {
  fs.writeFileSync(path.join(root, 'slice.txt'), 'change\n');
  assert.equal(run(root, ['oracle']).status, 0);
  const write = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex']);
  assert.equal(write.status, 0, write.stderr.toString());
}

test('commit: blocked (exit 4) when specApproval:true and the task\'s own spec is unapproved', () => {
  const root = fixture();
  commitFixture(root);
  const r = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(r.status, 4, r.stderr.toString());
  // nothing committed
  assert.equal(git(root, ['log', '--oneline']).trim().split('\n').length, 1);
});

test('commit: proceeds once approved, and stays approved-gated (no approvalSkipped in run-log)', () => {
  const root = fixture();
  approve(root);
  commitFixture(root);
  const r = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(r.status, 0, r.stderr.toString());
  const log = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = log[log.length - 1];
  assert.equal(last.approvalSkipped, undefined);
});

test('commit: --skip-approval bypasses the gate and marks approvalSkipped:true in run-log', () => {
  const root = fixture();
  commitFixture(root);
  const r = run(root, ['commit', '--task', 'T001', '--skip-oracle', '--skip-approval']);
  assert.equal(r.status, 0, r.stderr.toString());
  const log = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = log[log.length - 1];
  assert.equal(last.approvalSkipped, true);
});

test('commit: micro-plan (no spec.md) commits without any approval at all', () => {
  const root = fixture({ withSpecMd: false });
  commitFixture(root);
  const r = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(r.status, 0, r.stderr.toString());
});

test('commit: gate follows the TASK\'s own spec dir, not an unrelated first-open plan', () => {
  const root = fixture(); // specs/001-fixture: spec.md present, unapproved
  // A second, EARLIER (alphabetically) plan with its own open box and no spec.md —
  // findTasks() would auto-select this one, but committing T001 in 001-fixture
  // must still be judged by 001-fixture's own (missing) approval, not this one's.
  fs.mkdirSync(path.join(root, 'specs', '000-earlier'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '000-earlier', 'tasks.md'), '- [ ] **T900** earlier plan, no spec.md\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'add earlier plan']);
  commitFixture(root);
  const blocked = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(blocked.status, 4, blocked.stderr.toString());
  const approveResult = run(root, ['spec', 'approve', '--spec', 'specs/001-fixture']);
  assert.equal(approveResult.status, 0, approveResult.stderr.toString());
  assert.equal(run(root, ['oracle']).status, 0); // approval.json changed the tree — re-prove
  const write = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex']);
  assert.equal(write.status, 0, write.stderr.toString());
  const passed = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(passed.status, 0, passed.stderr.toString());
});

// 006 T019 regression: an EARLIER (alphabetically) spec that's gated AND still
// unapproved must not be able to block an explicitly targeted, approved spec.
// Before the fix, `slice next` (and PowerShell-драйвер (снят 019/T007)) had no way to say which
// specs/*/tasks.md to use — the alphabetically-first one with open boxes
// always won, so a stalled older spec could permanently block an active one.
test('slice next --spec: targets one spec directly, unaffected by an earlier unapproved+gated spec', () => {
  const root = fixture(); // specs/001-fixture: spec.md present, unapproved
  fs.mkdirSync(path.join(root, 'specs', '000-blocked'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '000-blocked', 'spec.md'), FIXTURE_SPEC_MD);
  fs.writeFileSync(path.join(root, 'specs', '000-blocked', 'tasks.md'), '- [ ] **T900** stalled elsewhere\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'add earlier blocked plan']);

  // default (no --spec) выбирает новейший plan, а не воскрешает старый 000-blocked
  const auto = run(root, ['slice', 'next']);
  assert.equal(auto.status, 4, auto.stderr.toString());
  assert.match(auto.stderr.toString(), /001-fixture/);

  // explicit --spec targets 001-fixture directly — still gated on ITS OWN status
  const targeted = run(root, ['slice', 'next', '--spec', 'specs/001-fixture']);
  assert.equal(targeted.status, 4, targeted.stderr.toString());
  assert.match(targeted.stderr.toString(), /001-fixture/);

  // approving 001-fixture (NOT 000-blocked, which the bare `approve()` helper
  // would auto-select here since it's alphabetically earlier) unblocks the
  // targeted run without touching 000-blocked at all.
  const approveResult = run(root, ['spec', 'approve', '--spec', 'specs/001-fixture']);
  assert.equal(approveResult.status, 0, approveResult.stderr.toString());
  const passed = run(root, ['slice', 'next', '--json', '--spec', 'specs/001-fixture']);
  assert.equal(passed.status, 0, passed.stderr.toString());
  assert.equal(result(passed).id, 'T001');
});

// 018 T004: подпись читается ЛИШЬ из истории. Эти два теста держат решение спеки «миграционной
// льготы нет»: файл рядом с планом больше не пропуск, а отказ обязан нести КОМАНДУ, которой его
// чинят, — иначе он выгоняет в ручной git commit, то есть мимо харнеса, что и есть корень D4.
test('018 T004: одинокий approval.json больше не пускает через гейт', () => {
  const root = fixture();
  const st = JSON.parse(run(root, ['spec', 'status']).stdout.toString());
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'approval.json'), JSON.stringify({
    approvedAt: new Date().toISOString(), specHash: st.specHash, tasksHash: st.tasksHash,
  }));

  const r = run(root, ['slice', 'next']);
  assert.equal(r.status, 4, r.stderr.toString());
});

test('018 T004: отказ называет точную команду со --spec той спеки, из-за которой он пришёл', () => {
  const root = fixture();
  const r = run(root, ['slice', 'next']);
  assert.equal(r.status, 4);
  const err = r.stderr.toString();
  assert.ok(err.includes('elt spec approve --spec specs/001-fixture'), err);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
