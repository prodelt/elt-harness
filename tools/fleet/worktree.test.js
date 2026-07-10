'use strict';
// Тесты worktree.js на реальном темп-репо (git worktree требует настоящий git).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const wt = require('./worktree');

const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-wt-'));
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });

before(() => {
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(REPO, 'a.txt'), 'seed\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'seed']);
});

after(() => {
  try { fs.rmSync(REPO, { recursive: true, force: true }); } catch { /* Windows-хендлы */ }
});

test('create заводит worktree + ветку fleet/<Tid> от HEAD', () => {
  const r = wt.create('T101', { cwd: REPO });
  assert.equal(r.branch, 'fleet/T101');
  assert.ok(fs.existsSync(r.path), 'директория worktree создана');
  assert.ok(fs.existsSync(path.join(r.path, 'a.txt')), 'seed-файл виден в worktree');
  const branches = execFileSync('git', ['branch', '--list', 'fleet/T101'], { cwd: REPO, encoding: 'utf8' });
  assert.match(branches, /fleet\/T101/);
});

test('list возвращает только fleet-worktree, с tid и веткой', () => {
  wt.create('T102', { cwd: REPO });
  const items = wt.list({ cwd: REPO });
  const tids = items.map((i) => i.tid).sort();
  assert.deepEqual(tids, ['T101', 'T102']);
  const t101 = items.find((i) => i.tid === 'T101');
  assert.equal(t101.branch, 'fleet/T101');
  // главный рабочий каталог репо НЕ должен попасть в список
  assert.ok(!items.some((i) => i.tid === ''), 'основной worktree отфильтрован');
});

test('remove убирает worktree, ветка остаётся (requeue)', () => {
  wt.remove('T102', { cwd: REPO });
  assert.ok(!fs.existsSync(wt.wtPath(REPO, 'T102')), 'директория удалена');
  const items = wt.list({ cwd: REPO });
  assert.ok(!items.some((i) => i.tid === 'T102'), 'T102 ушёл из list');
  const branches = execFileSync('git', ['branch', '--list', 'fleet/T102'], { cwd: REPO, encoding: 'utf8' });
  assert.match(branches, /fleet\/T102/, 'ветка сохранена для resume');
});

test('create переиспользует существующую ветку (resume после remove)', () => {
  // ветка fleet/T102 осталась от прошлого теста → create без -b, без ошибки
  const r = wt.create('T102', { cwd: REPO });
  assert.equal(r.branch, 'fleet/T102');
  assert.ok(fs.existsSync(r.path));
});

test('remove с deleteBranch дропает и ветку', () => {
  wt.remove('T101', { cwd: REPO, deleteBranch: true });
  const branches = execFileSync('git', ['branch', '--list', 'fleet/T101'], { cwd: REPO, encoding: 'utf8' });
  assert.equal(branches.trim(), '', 'ветка удалена');
});
