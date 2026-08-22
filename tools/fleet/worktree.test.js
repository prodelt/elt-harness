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

// 017 T006 — регресс на D1/D2. Фоновый судья по коммиту 76c40bb прав: пять тестов выше
// проходят БАЙТ-В-БАЙТ, даже если удалить linkNodeModules/unlinkNodeModules целиком — в
// фикстуре нет node_modules, и обе функции уходят в ранний выход. Здесь node_modules есть.
// Уточнение к реестру дефектов: сквозь junction идёт НЕ `fs.rmSync` (Node 24 его только
// отвязывает), а сам `git worktree remove --force` — воспроизведено 2026-08-22 на чистой
// фикстуре: без снятия линка маркер в КОРНЕВОМ node_modules исчезает.
test('node_modules: create линкует (D1), remove снимает линк и не выедает корневой (D2)', () => {
  const src = path.join(REPO, 'node_modules');
  const marker = path.join(src, '.bin', 'marker.txt');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, 'корневая зависимость\n');

  const r = wt.create('T103', { cwd: REPO });
  const link = path.join(r.path, 'node_modules');
  assert.ok(fs.existsSync(link), 'D1: worktree получил node_modules — иначе оракул там красный без вины слайса');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'это линк, а не копия зависимостей');
  assert.strictEqual(fs.readFileSync(path.join(link, '.bin', 'marker.txt'), 'utf8'), 'корневая зависимость\n',
    'через линк видно содержимое корневого node_modules');

  wt.remove('T103', { cwd: REPO, deleteBranch: true });
  assert.ok(!fs.existsSync(link), 'линк снят вместе с worktree');
  assert.ok(fs.existsSync(marker), 'D2: корневой node_modules цел — удаление не ушло сквозь junction');
});
