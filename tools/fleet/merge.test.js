'use strict';
// Тесты merge.js на реальном темп-репо с искусственным конфликтом.
const { test, before, after, describe } = require('node:test');
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
    JSON.stringify({ kind: 'code', oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' } }));
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

test('mergeSlice: чистый merge (disjoint) → [X]-марк + зелёный smoke-оракул', async () => {
  const r = await merge.mergeSlice('T3', { cwd: REPO, integration: 'main', tasksPath: tasksPath() });
  assert.equal(r.ok, true);
  assert.equal(r.marked, true);
  assert.equal(r.oracleOk, true, 'smoke-оракул зелёный после merge');
  assert.match(readTasks(), /- \[X\] \*\*T3\*\*/, 'T3 помечен [X]');
  assert.ok(fs.existsSync(path.join(REPO, 'newc.txt')), 'файл T3 влит');
});

test('mergeSlice: второй чистый merge (правит shared) проходит', async () => {
  const r = await merge.mergeSlice('T1', { cwd: REPO, integration: 'main', tasksPath: tasksPath() });
  assert.equal(r.ok, true);
  assert.equal(readShared(), 'from-T1');
  assert.match(readTasks(), /- \[X\] \*\*T1\*\*/);
});

test('mergeSlice: конфликт → abort, requeue-serial, интеграционная чистая', async () => {
  const r = await merge.mergeSlice('T2', { cwd: REPO, integration: 'main', tasksPath: tasksPath() });
  assert.equal(r.ok, false);
  assert.equal(r.conflict, true);
  assert.equal(r.requeue, 'serial');
  assert.equal(readShared(), 'from-T1', 'merge откатан — shared остался от T1');
  assert.match(readTasks(), /- \[ \] \*\*T2\*\*/, 'T2 НЕ помечен (не влит)');
  // дерево чистое (нет зависшего merge-state)
  assert.equal(git(['status', '--porcelain']).trim(), '');
});

test('mergeSlice: повторный merge уже влитого слайса идемпотентен (merged:false, чисто)', async () => {
  const r = await merge.mergeSlice('T3', { cwd: REPO, integration: 'main', tasksPath: tasksPath(), oracle: false });
  assert.equal(r.ok, true);
  assert.equal(r.merged, false, 'already up to date — реального merge не было');
  assert.equal(git(['status', '--porcelain']).trim(), '', 'дерево чистое, нет пустого коммита');
});

test('mergeAll: серийная очередь собирает конфликты в requeue', async () => {
  const summary = await merge.mergeAll(['T2'], { cwd: REPO, integration: 'main', tasksPath: tasksPath() });
  assert.deepEqual(summary.conflicts, ['T2']);
  assert.deepEqual(summary.merged, []);
});

test('markDoneInFile: [ ] → [X] только для нужного слайса', async () => {
  const p = path.join(REPO, 'mark-probe.md');
  fs.writeFileSync(p, '- [ ] **T10** a\n- [ ] **T11** b\n');
  assert.equal(merge.markDoneInFile(p, 'T10'), true);
  const t = fs.readFileSync(p, 'utf8');
  assert.match(t, /- \[X\] \*\*T10\*\*/);
  assert.match(t, /- \[ \] \*\*T11\*\*/, 'соседний слайс не тронут');
  assert.equal(merge.markDoneInFile(p, 'T99'), false, 'нет слайса → false');
});

describe('mergeSlice: scoped staging (T023) — [files:] вместо git add -A', () => {
  const REPO2 = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-merge-scoped-'));
  const git2 = (args) => execFileSync('git', args, { cwd: REPO2, encoding: 'utf8' });
  const tasksPath2 = path.join(REPO2, 'tasks.md');

  before(() => {
    git2(['init', '-q', '-b', 'main']);
    git2(['config', 'user.email', 't@t']); git2(['config', 'user.name', 't']);
    fs.writeFileSync(path.join(REPO2, 'a.txt'), 'base\n');
    fs.writeFileSync(tasksPath2, '- [ ] **T1** правит a [files:a.txt]\n');
    fs.mkdirSync(path.join(REPO2, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(REPO2, '.harness', 'harness.json'), JSON.stringify({
      kind: 'code',
      oracle: 'node --version',
      shell: process.platform === 'win32' ? 'powershell' : 'bash',
      branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' },
    }));
    git2(['add', '-A']); git2(['commit', '-q', '-m', 'base']);
    git2(['checkout', '-q', '-b', 'fleet/T1', 'main']);
    fs.writeFileSync(path.join(REPO2, 'a.txt'), 'from-T1\n');
    git2(['add', '-A']); git2(['commit', '-q', '-m', 'fleet/T1']);
    git2(['checkout', '-q', 'main']);
  });
  after(() => { try { fs.rmSync(REPO2, { recursive: true, force: true }); } catch { /* noop */ } });

  test('посторонний dirty-файл вне [files:] остаётся нетронутым после merge', async () => {
    fs.writeFileSync(path.join(REPO2, 'foreign.txt'), 'untracked-foreign\n');
    const r = await merge.mergeSlice('T1', { cwd: REPO2, integration: 'main', tasksPath: tasksPath2, oracle: false });
    assert.equal(r.ok, true);
    assert.equal(fs.readFileSync(path.join(REPO2, 'a.txt'), 'utf8').trim(), 'from-T1', 'слайс влит');
    assert.equal(git2(['status', '--porcelain', '--', 'foreign.txt']).trim(), '?? foreign.txt',
      'foreign.txt остался untracked, git add -A его бы закоммитил');
  });

  test('sliceFiles: читает [files:] глобы конкретного слайса из tasks.md', async () => {
    assert.deepEqual(merge.sliceFiles(tasksPath2, 'T1'), ['a.txt']);
    assert.deepEqual(merge.sliceFiles(tasksPath2, 'T99'), [], 'нет слайса → []');
  });
});

describe('mergeSlice: error-path без git reset --hard (T023)', () => {
  const REPO3 = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-merge-errpath-'));
  const git3 = (args) => execFileSync('git', args, { cwd: REPO3, encoding: 'utf8' });
  const tasksPath3 = path.join(REPO3, 'tasks.md');

  before(() => {
    git3(['init', '-q', '-b', 'main']);
    git3(['config', 'user.email', 't@t']); git3(['config', 'user.name', 't']);
    fs.writeFileSync(path.join(REPO3, 'a.txt'), 'base\n');
    fs.writeFileSync(tasksPath3, '- [ ] **T1** правит a [files:a.txt]\n');
    git3(['add', '-A']); git3(['commit', '-q', '-m', 'base']);
    git3(['checkout', '-q', '-b', 'fleet/T1', 'main']);
    fs.writeFileSync(path.join(REPO3, 'a.txt'), 'from-T1\n');
    git3(['add', '-A']); git3(['commit', '-q', '-m', 'fleet/T1']);
    git3(['checkout', '-q', 'main']);
    // pre-commit хук всегда фейлит → форсирует stage:'commit' error-path
    const hookDir = path.join(REPO3, '.git', 'hooks');
    const hookPath = path.join(hookDir, 'pre-commit');
    fs.writeFileSync(hookPath, '#!/bin/sh\nexit 1\n');
    if (process.platform !== 'win32') fs.chmodSync(hookPath, 0o755);
  });
  after(() => { try { fs.rmSync(REPO3, { recursive: true, force: true }); } catch { /* noop */ } });

  test('commit-фейл → merge --abort БЕЗ reset --hard, чужой dirty-файл выживает', async () => {
    fs.writeFileSync(path.join(REPO3, 'foreign.txt'), 'survive-me\n');
    const r = await merge.mergeSlice('T1', { cwd: REPO3, integration: 'main', tasksPath: tasksPath3, oracle: false });
    assert.equal(r.ok, false);
    assert.equal(r.stage, 'commit');
    assert.equal(fs.readFileSync(path.join(REPO3, 'foreign.txt'), 'utf8'), 'survive-me\n',
      'reset --hard убрали — посторонний файл не стёрт');
  });
});
