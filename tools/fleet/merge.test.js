'use strict';
// Тесты merge.js на реальном темп-репо с искусственным конфликтом.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const merge = require('./merge');

const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-merge-'));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const readShared = () => fs.readFileSync(path.join(REPO, 'shared.txt'), 'utf8').trim();
const tasksPath = () => path.join(REPO, 'specs', 'tasks.md');
const readTasks = () => fs.readFileSync(tasksPath(), 'utf8');

before(() => {
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(REPO, 'shared.txt'), 'base\n');
  fs.mkdirSync(path.join(REPO, 'specs'), { recursive: true });
  fs.writeFileSync(tasksPath(), '- [ ] **T1** правит shared\n- [ ] **T2** правит shared иначе\n- [ ] **T3** правит новый файл\n');
  fs.mkdirSync(path.join(REPO, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.harness', 'harness.json'),
    JSON.stringify({ oracle: 'node --version', shell: 'bash', branchPolicy: 'feature', push: false }));
  git(['add', '-A']); git(['commit', '-q', '-m', 'base']);

  // три fleet-ветки от base
  const branch = (name, mut) => {
    git(['checkout', '-q', '-b', name, 'main']);
    mut();
    git(['add', '-A']); git(['commit', '-q', '-m', name]);
    git(['checkout', '-q', 'main']);
  };
  branch('fleet/T3', () => fs.writeFileSync(path.join(REPO, 'newc.txt'), 'T3\n'));       // disjoint
  branch('fleet/T1', () => fs.writeFileSync(path.join(REPO, 'shared.txt'), 'from-T1\n')); // правит shared
  branch('fleet/T2', () => fs.writeFileSync(path.join(REPO, 'shared.txt'), 'from-T2\n')); // конфликт с T1
});
after(() => { try { fs.rmSync(REPO, { recursive: true, force: true }); } catch { /* noop */ } });

test('mergeSlice: чистый merge (disjoint) → [X]-марк + зелёный smoke-оракул', () => {
  const r = merge.mergeSlice('T3', { cwd: REPO, integration: 'main', tasksPath: tasksPath() });
  assert.equal(r.ok, true);
  assert.equal(r.marked, true);
  assert.equal(r.oracleOk, true, 'smoke-оракул зелёный после merge');
  assert.match(readTasks(), /- \[X\] \*\*T3\*\*/, 'T3 помечен [X]');
  assert.ok(fs.existsSync(path.join(REPO, 'newc.txt')), 'файл T3 влит');
});

test('mergeSlice: второй чистый merge (правит shared) проходит', () => {
  const r = merge.mergeSlice('T1', { cwd: REPO, integration: 'main', tasksPath: tasksPath() });
  assert.equal(r.ok, true);
  assert.equal(readShared(), 'from-T1');
  assert.match(readTasks(), /- \[X\] \*\*T1\*\*/);
});

test('mergeSlice: конфликт → abort, requeue-serial, интеграционная чистая', () => {
  const r = merge.mergeSlice('T2', { cwd: REPO, integration: 'main', tasksPath: tasksPath() });
  assert.equal(r.ok, false);
  assert.equal(r.conflict, true);
  assert.equal(r.requeue, 'serial');
  assert.equal(readShared(), 'from-T1', 'merge откатан — shared остался от T1');
  assert.match(readTasks(), /- \[ \] \*\*T2\*\*/, 'T2 НЕ помечен (не влит)');
  // дерево чистое (нет зависшего merge-state)
  assert.equal(git(['status', '--porcelain']).trim(), '');
});

test('mergeSlice: повторный merge уже влитого слайса идемпотентен (merged:false, чисто)', () => {
  const r = merge.mergeSlice('T3', { cwd: REPO, integration: 'main', tasksPath: tasksPath(), oracle: false });
  assert.equal(r.ok, true);
  assert.equal(r.merged, false, 'already up to date — реального merge не было');
  assert.equal(git(['status', '--porcelain']).trim(), '', 'дерево чистое, нет пустого коммита');
});

test('mergeAll: серийная очередь собирает конфликты в requeue', () => {
  const summary = merge.mergeAll(['T2'], { cwd: REPO, integration: 'main', tasksPath: tasksPath() });
  assert.deepEqual(summary.conflicts, ['T2']);
  assert.deepEqual(summary.merged, []);
});

test('markDoneInFile: [ ] → [X] только для нужного слайса', () => {
  const p = path.join(REPO, 'mark-probe.md');
  fs.writeFileSync(p, '- [ ] **T10** a\n- [ ] **T11** b\n');
  assert.equal(merge.markDoneInFile(p, 'T10'), true);
  const t = fs.readFileSync(p, 'utf8');
  assert.match(t, /- \[X\] \*\*T10\*\*/);
  assert.match(t, /- \[ \] \*\*T11\*\*/, 'соседний слайс не тронут');
  assert.equal(merge.markDoneInFile(p, 'T99'), false, 'нет слайса → false');
});
