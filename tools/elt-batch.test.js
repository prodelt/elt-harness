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
function writeProof(root, task, verdict = 'pass', extra = []) {
  assert.equal(run(root, ['oracle']).status, 0);
  const p = run(root, ['judge-proof', 'write', '--task', task, '--verdict', verdict, '--model', 'sonnet', ...extra]);
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

// ── 020 T016: repair-поколение квартинованного батча ────────────────────────────────────
// Живой отказ, ради которого написано: фоновой вердикт по `b6cd3b4` пришёл красным ПОСЛЕ
// простановки `[X]`, и починить батч было нечем — `elt commit --task T001,T007` отвечал
// «задача не найдена среди открытых [ ]». Снять галочку = подделать состояние, закоммитить
// мимо elt = выйти из харнеса. Значит нужен третий, легальный путь.

const batchState = (root) => JSON.parse(fs.readFileSync(path.join(root, '.git', 'elt', 'batch-state.json'), 'utf8'));
const lastLog = (root) => JSON.parse(fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n').pop());
function enqueue(root, row) {
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.appendFileSync(path.join(root, '.harness', 'review-queue.jsonl'), JSON.stringify(row) + '\n');
}

test('T016: посаженный батч регистрируется — identity, поколение, batchHead', () => {
  const root = fixture();
  writeProof(root, 'T001,T002');
  assert.equal(run(root, ['commit', '--task', 'T001,T002', '--skip-oracle', '-m', 'batch']).status, 0);
  const rec = Object.values(batchState(root).batches)[0];
  assert.deepEqual(rec.taskIds, ['T001', 'T002']);
  assert.equal(rec.generation, 1);
  assert.equal(rec.batchHead, git(root, ['rev-parse', '--short', 'HEAD']));
  assert.deepEqual(rec.taskIdentities.map((t) => t.id), ['T001', 'T002']);
  // Число для p95 `ready → local commit` обязано писаться КАЖДЫМ слайсом, иначе его потом
  // неоткуда взять (T022 считает по run-log, а не по секундомеру человека).
  assert.equal(typeof lastLog(root).batch.readyToLocalCommitSec, 'number');
});

test('T016: repair чинит посаженный батч, не переоткрывая план', () => {
  const root = fixture();
  writeProof(root, 'T001');
  assert.equal(run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'landing']).status, 0);
  const gen1 = git(root, ['rev-parse', '--short', 'HEAD']);
  // Красное из фона: батч в карантине.
  enqueue(root, { kind: 'bg-red', task: 'T001', specPath: 'specs/001-fixture/tasks.md', commit: gen1, layer: 'judge', reason: 'судья: block', ts: new Date().toISOString() });
  assert.equal(run(root, ['batch']).status, 1, 'карантин виден невооружённым глазом');

  fs.writeFileSync(path.join(root, 'fix.txt'), 'починка\n');
  writeProof(root, 'T001', 'pass', ['--repair']);
  const r = run(root, ['commit', '--task', 'T001', '--repair', '--skip-oracle', '-m', 'fix: T001 по вердикту']);
  assert.equal(r.status, 0, r.stderr);
  const rec = Object.values(batchState(root).batches)[0];
  assert.equal(rec.generation, 2, 'починка — второе ПОКОЛЕНИЕ того же батча, а не новый батч');
  assert.equal(Object.keys(batchState(root).batches).length, 1, 'batchId остался ТОТ ЖЕ');
  assert.equal(rec.batchHead, git(root, ['rev-parse', '--short', 'HEAD']), 'batchHead переехал на починку');
  assert.deepEqual(rec.history.map((h) => h.generation), [1, 2], 'история поколений не стирается');
  assert.match(git(root, ['log', '-1', '--pretty=%s']), /\[repair gen 2\]/, 'поколение видно в истории git');
  assert.match(tasksMd(root), /\[X\] \*\*T001\*\*/, 'план не трогается: задача как была закрыта, так и осталась');
});

test('T016: repair legacy-батча (записи нет) поднимает поколение из самой находки', () => {
  const root = fixture();
  writeProof(root, 'T001');
  assert.equal(run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'landing']).status, 0);
  const gen1 = git(root, ['rev-parse', '--short', 'HEAD']);
  fs.rmSync(path.join(root, '.git', 'elt', 'batch-state.json')); // эпоха legacy-v1: записи нет
  enqueue(root, { kind: 'bg-red', task: 'T001', specPath: 'specs/001-fixture/tasks.md', commit: gen1, layer: 'suite', reason: 'сьют: exit 1', ts: new Date().toISOString() });

  fs.writeFileSync(path.join(root, 'fix.txt'), 'починка\n');
  writeProof(root, 'T001', 'pass', ['--repair']);
  const r = run(root, ['commit', '--task', 'T001', '--repair', '--skip-oracle', '-m', 'fix: T001']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(Object.values(batchState(root).batches)[0].generation, 2);
});

test('T016: repair без открытой находки — отказ, а не тихий коммит', () => {
  const root = fixture();
  writeProof(root, 'T001');
  assert.equal(run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'landing']).status, 0);
  fs.rmSync(path.join(root, '.git', 'elt', 'batch-state.json'));
  fs.writeFileSync(path.join(root, 'fix.txt'), 'починка\n');
  writeProof(root, 'T001', 'pass', ['--repair']);
  const before = commitCount(root);
  const r = run(root, ['commit', '--task', 'T001', '--repair', '--skip-oracle', '-m', 'fix: T001']);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /чинить нечего/);
  assert.equal(commitCount(root), before);
});

test('T016: красный Mirror НЕ открывает второй батч — только починку своего', () => {
  const root = fixture();
  writeProof(root, 'T001');
  assert.equal(run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'landing']).status, 0);
  enqueue(root, {
    kind: 'bg-red', task: 'T001', specPath: 'specs/001-fixture/tasks.md',
    commit: git(root, ['rev-parse', '--short', 'HEAD']), layer: 'judge', reason: 'судья: block', ts: new Date().toISOString(),
  });

  fs.writeFileSync(path.join(root, 'next.txt'), 'следующий слайс\n');
  writeProof(root, 'T002');
  const before = commitCount(root);
  const r = run(root, ['commit', '--task', 'T002', '--skip-oracle', '-m', 'feat: T002']);
  assert.equal(r.status, 4, 'посадка поверх несертифицированного батча — ровно тот дефект, который тут закрывается');
  assert.match(r.stderr, /карантине/);
  assert.match(r.stderr, /--repair/, 'в отказе названа команда выхода, а не только запрет');
  assert.equal(commitCount(root), before);
  assert.match(tasksMd(root), /\[ \] \*\*T002\*\*/, 'отказ не смеет закрывать задачу');
});

test('T016: строка inconclusive от СИНХРОННОГО судьи в карантин не уводит', () => {
  // Решение R4 спеки 011: `inconclusive` неблокирующий. Приравнять его к красному Mirror
  // значило бы остановить работу на самом мягком исходе — поймано живьём: judge-core.test.js
  // после inconclusive-коммита переставал коммитить следующий слайс.
  const root = fixture();
  writeProof(root, 'T001');
  assert.equal(run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'landing']).status, 0);
  enqueue(root, { task: 'T001', commit: git(root, ['rev-parse', '--short', 'HEAD']), reason: 'судья не ручается', ts: new Date().toISOString() });
  assert.equal(run(root, ['batch']).status, 0, 'карантина нет: строка без kind — не вердикт фона');

  fs.writeFileSync(path.join(root, 'next.txt'), 'следующий слайс\n');
  writeProof(root, 'T002');
  const r = run(root, ['commit', '--task', 'T002', '--skip-oracle', '-m', 'feat: T002']);
  assert.equal(r.status, 0, r.stderr);
});

test('T016: батч из разных спек и пересечение зон отвергаются ДО любой записи', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'specs', '002-other'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '002-other', 'tasks.md'), '- [ ] **T009** чужая\n');
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'),
    '- [ ] **T001** первая [files: tools/a.js]\n- [ ] **T002** вторая [files: tools/a.js]\n- [ ] **T003** третья\n');
  const collision = run(root, ['batch', 'plan', '--task', 'T001,T002', '--spec', 'specs/001-fixture']);
  assert.equal(collision.status, 4);
  assert.match(collision.stdout, /zone-collision/);

  const before = commitCount(root);
  writeProof(root, 'T001,T002', 'pass', ['--spec', 'specs/001-fixture']);
  const c = run(root, ['commit', '--task', 'T001,T002', '--spec', 'specs/001-fixture', '--skip-oracle', '-m', 'collision']);
  assert.equal(c.status, 4, 'коллизия зон обязана валить сам коммит, а не только предпросмотр');
  assert.equal(commitCount(root), before);
  assert.match(tasksMd(root), /\[ \] \*\*T001\*\*/);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
