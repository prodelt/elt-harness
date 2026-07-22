'use strict';
// Батч-гейт (2026-07-22): один оракул + один судья + один коммит на N задач.
// Проверяем ровно то, что делает батч дешевле, НЕ ослабляя инвариант:
//   1. slice next --count N отдаёт N задач (и не ломает форму при N=1);
//   2. commit --task T001,T002 закрывает обе и делает РОВНО один коммит;
//   3. proof на батч не годится для другого батча/подмножества (task-mismatch);
//   4. батч с уже закрытой задачей отвергается целиком (fail closed).

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
function tasksMd(root) { return fs.readFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), 'utf8'); }

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-batch-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, branchPolicy: 'feature', judge: { enabled: true, model: 'sonnet' },
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'),
    '- [ ] **T001** первая\n- [ ] **T002** вторая\n- [ ] **T003** третья\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  git(root, ['checkout', '-qb', 'work']);
  fs.writeFileSync(path.join(root, 'slice.txt'), 'batch work\n');
  return root;
}
function writeProof(root, task, verdict = 'pass') {
  assert.equal(run(root, ['oracle']).status, 0);
  const p = run(root, ['judge-proof', 'write', '--task', task, '--verdict', verdict, '--model', 'sonnet']);
  assert.equal(p.status, 0, p.stderr);
  return p;
}

test('slice next --count: N задач, форма при N=1 не изменилась', () => {
  const root = fixture();
  const one = run(root, ['slice', 'next', '--json']);
  assert.equal(one.status, 0, one.stderr);
  const single = JSON.parse(one.stdout);
  assert.equal(Array.isArray(single), false, '--count 1 (дефолт) обязан остаться объектом');
  assert.equal(single.id, 'T001');

  const many = run(root, ['slice', 'next', '--json', '--count', '3']);
  assert.equal(many.status, 0, many.stderr);
  const list = JSON.parse(many.stdout);
  assert.deepEqual(list.map((x) => x.id), ['T001', 'T002', 'T003']);

  // --count больше, чем открытых задач → отдаёт сколько есть, а не падает
  run(root, ['slice', 'next', '--json', '--count', '99']);
  assert.equal(JSON.parse(run(root, ['slice', 'next', '--json', '--count', '99']).stdout).length, 3);
});

test('батч: один судья + один коммит закрывают все задачи батча', () => {
  const root = fixture();
  writeProof(root, 'T001,T002');
  const before = commitCount(root);
  const c = run(root, ['commit', '--task', 'T001,T002', '--skip-oracle', '-m', 'batch commit']);
  assert.equal(c.status, 0, c.stderr);
  assert.equal(commitCount(root), before + 1, 'батч = РОВНО один коммит');
  const md = tasksMd(root);
  assert.match(md, /\[X\] \*\*T001\*\*/);
  assert.match(md, /\[X\] \*\*T002\*\*/);
  assert.match(md, /\[ \] \*\*T003\*\*/, 'задача вне батча не должна закрываться');

  const log = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n').pop();
  assert.equal(JSON.parse(log).task, 'T001,T002');
});

test('батч: пробелы в списке нормализуются (proof и commit сходятся)', () => {
  const root = fixture();
  writeProof(root, 'T001, T002');
  const c = run(root, ['commit', '--task', ' T001 ,T002', '--skip-oracle', '-m', 'batch commit']);
  assert.equal(c.status, 0, c.stderr);
  assert.match(tasksMd(root), /\[X\] \*\*T002\*\*/);
});

test('батч fail closed: proof другого состава и закрытая задача отвергаются', () => {
  // proof на T001,T002 не годится для коммита T001,T002,T003
  let root = fixture();
  writeProof(root, 'T001,T002');
  let before = commitCount(root);
  let c = run(root, ['commit', '--task', 'T001,T002,T003', '--skip-oracle', '-m', 'wider batch']);
  assert.notEqual(c.status, 0);
  assert.equal(commitCount(root), before, 'состав батча шире proof — коммита быть не должно');
  assert.match(tasksMd(root), /\[ \] \*\*T001\*\*/, 'отказ не должен закрывать задачи');

  // ...и для подмножества тоже (proof связан ВСЕМ составом)
  before = commitCount(root);
  c = run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'narrower batch']);
  assert.notEqual(c.status, 0);
  assert.equal(commitCount(root), before);

  // задача уже закрыта → binding нет → proof на такой батч не пишется вовсе
  root = fixture();
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'),
    '- [X] **T001** первая\n- [ ] **T002** вторая\n');
  assert.equal(run(root, ['oracle']).status, 0);
  const p = run(root, ['judge-proof', 'write', '--task', 'T001,T002', '--verdict', 'pass', '--model', 'sonnet']);
  assert.notEqual(p.status, 0, 'батч с закрытой задачей не должен получать proof');
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
