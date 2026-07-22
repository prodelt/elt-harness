'use strict';

// T002 (007): полный гейт-цикл `elt oracle → judge-proof write → elt commit
// --task` в scratch git-репо, проверка фактических следов на диске — не
// стаб-утверждений о статус-кодах, как в elt-gate.test.js.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }); }
function run(root, args) { return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' }); }
function commitCount(root) { return Number(git(root, ['rev-list', '--count', 'HEAD']).trim()); }
function runLogLines(root) {
  const file = path.join(root, '.git', 'elt', 'run-log.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// oracle command is a real script that checks a marker file — a genuine pass/fail
// condition, not a hardcoded `process.exit(0)` stub.
function fixture(oracleExit) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-gate-e2e-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code',
    oracle: `node -e "process.exit(require('fs').existsSync('answer.js') ? 0 : 1)"`,
    shell: SHELL,
    branchPolicy: 'feature',
    judge: { enabled: true, model: 'codex' },
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** fixture slice\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  if (oracleExit === 0) fs.writeFileSync(path.join(root, 'answer.js'), 'module.exports = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  git(root, ['checkout', '-qb', 'work']);
  return root;
}

test('e2e green: oracle -> judge-proof write -> elt commit leaves a commit, [X] task, and a run-log entry', () => {
  const root = fixture(0);
  fs.writeFileSync(path.join(root, 'slice.js'), 'module.exports = 2;\n');
  git(root, ['add', '-A']);

  const oracle = run(root, ['oracle']);
  assert.equal(oracle.status, 0, oracle.stderr.toString());

  const proof = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'stub-judge']);
  assert.equal(proof.status, 0, proof.stderr.toString());

  const before = commitCount(root);
  const commit = run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'feat: T001 e2e slice']);
  assert.equal(commit.status, 0, commit.stderr.toString());

  assert.equal(commitCount(root), before + 1);

  const tasks = fs.readFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), 'utf8');
  assert.match(tasks, /\[X\] \*\*T001\*\*/);

  const entries = runLogLines(root);
  assert.ok(entries.length >= 1, 'run-log.jsonl must have at least one entry');
  const last = entries[entries.length - 1];
  assert.equal(last.task, 'T001');
  assert.equal(last.verdict, 'pass');
  assert.ok(last.commit, 'run-log entry must record the commit sha');
});

test('e2e red: a failing oracle leaves no commit, no [X], and no green run-log entry', () => {
  const root = fixture(1); // no answer.js -> oracle command exits 1
  fs.writeFileSync(path.join(root, 'slice.js'), 'module.exports = 2;\n');
  git(root, ['add', '-A']);

  const oracle = run(root, ['oracle']);
  assert.notEqual(oracle.status, 0);

  // judge-proof write refuses without a green oracle proof for this tree.
  const proof = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'stub-judge']);
  assert.notEqual(proof.status, 0);

  const before = commitCount(root);
  const commit = run(root, ['commit', '--task', 'T001', '-m', 'feat: T001 e2e slice']);
  assert.notEqual(commit.status, 0);

  assert.equal(commitCount(root), before, 'no commit must be created on a red oracle');

  const tasks = fs.readFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), 'utf8');
  assert.match(tasks, /\[ \] \*\*T001\*\*/, 'task must remain open');

  const entries = runLogLines(root);
  assert.ok(entries.some((e) => e.status === 'red-stop'), 'run-log must record the red-stop');
  assert.ok(!entries.some((e) => e.commit), 'run-log must not contain a commit sha');
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
