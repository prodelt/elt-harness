'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const HOOK = path.join(__dirname, '..', '.githooks', 'pre-commit');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }); }
function run(root, args) { return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' }); }
function commitCount(root) { return Number(git(root, ['rev-list', '--count', 'HEAD']).trim()); }

// The shipped hook resolves `tools/elt.js` relative to `git rev-parse
// --show-toplevel` — correct when installed in THIS repo (tools/elt.js is
// tracked here), not in a bare temp fixture. Copy the real, unmodified files
// in so the byte-identical hook script runs exactly as it does in production.
function installHook(root) {
  const hooksDir = path.join(root, '.git', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });
  const target = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(target, fs.readFileSync(HOOK, 'utf8').replace(/\r\n/g, '\n'));
  fs.chmodSync(target, 0o755);
  const toolsDir = path.join(root, 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  // 020 T016: `batch-planner.js` — часть ЗАМЫКАНИЯ elt.js (планировщик зовётся на каждом
  // коммите, не лениво). Забыть его здесь = `Cannot find module` в чужом чекауте, а не
  // «тест не про это»: список ниже и есть проверка того, что модуль доезжает.
  // 020 T015: `elt run|advance|cutover` втянули в замыкание модули графа — они требуются на
  // ВЕРХНЕМ уровне elt.js, поэтому их отсутствие в чужом чекауте убивает не команду графа, а
  // весь CLI ещё до разбора argv. Список ниже и есть та проверка, которая это ловит.
  for (const name of ['elt.js', 'elt-config.js', 'run-log.js', 'elt-stats.js', 'batch-planner.js',
    'graph-compiler.js', 'graph-core.js', 'graph-journal.js', 'graph-state.js', 'task-identity.js']) {
    fs.copyFileSync(path.join(__dirname, name), path.join(toolsDir, name));
  }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-gate-'));
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
  installHook(root); // copies tools/*.js — must land in the seed commit, not show up as untracked noise
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  git(root, ['checkout', '-qb', 'work']);
  return root;
}
function writeProof(root, verdict = 'pass') {
  assert.equal(run(root, ['oracle']).status, 0);
  const proof = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', verdict, '--model', 'codex']);
  assert.equal(proof.status, 0, proof.stderr.toString());
}

test('gate: direct git commit on code change without proof is blocked, no leftover staged files', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'slice.js'), 'change\n');
  git(root, ['add', '-A']);
  const before = commitCount(root);
  const result = spawnSync('git', ['commit', '-qm', 'direct code commit'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(commitCount(root), before);
});

test('gate: planning-only direct commit passes without any judge proof', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'notes.md'), 'notes\n');
  git(root, ['add', '-A']);
  const before = commitCount(root);
  const result = spawnSync('git', ['commit', '-qm', 'planning notes'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(commitCount(root), before + 1);
});

test('gate: direct git commit with a valid pass proof is allowed', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'slice.js'), 'change\n');
  git(root, ['add', '-A']);
  writeProof(root);
  const before = commitCount(root);
  const result = spawnSync('git', ['commit', '-qm', 'direct code commit with proof'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(commitCount(root), before + 1);
});

test('gate: full elt commit flow with hook installed still produces exactly one commit', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'slice.js'), 'change\n');
  git(root, ['add', '-A']);
  writeProof(root);
  const before = commitCount(root);
  const result = run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'via elt commit']);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(commitCount(root), before + 1);
  assert.equal(git(root, ['status', '--porcelain']), '');
});

test('gate --ci re-runs the mechanical oracle: red oracle blocks, green passes', () => {
  const root = fixture();
  assert.equal(run(root, ['gate', '--ci']).status, 0);

  const cfg = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8'));
  cfg.oracle = 'node -e "process.exit(1)"';
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify(cfg));
  const result = run(root, ['gate', '--ci']);
  assert.notEqual(result.status, 0);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
