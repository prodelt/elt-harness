// 018 T003: `elt spec approve` пишет подпись СВОИМ коммитом с трейлерами и больше не
// создаёт approval.json. Коммит узкий (pathspec по директории спеки), поэтому грязное
// дерево вокруг в него не заметается — иначе подпись плана таскала бы за собой чужой код.
'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const roots = [];
// approve runs `spec lint` first (006 T003) — the fixture spec.md needs all required
// sections or approve fails closed before signing anything.
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
function commitCount(root) {
  return Number(git(root, ['rev-list', '--count', 'HEAD']).trim());
}
// `seed: false` оставляет спеку неотслеживаемой — так проверяется ловушка pathspec:
// `git commit -- <path>` знает только known-to-git пути.
function fixture({ seed = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-spec-approve-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(root, 'README.md'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'spec.md'), FIXTURE_SPEC_MD);
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** first\n');
  if (seed) {
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'spec']);
  }
  return root;
}
function specDir(root) {
  return path.join(root, 'specs', '001-fixture');
}

test('spec approve: подписывает трейлером и НЕ создаёт approval.json', () => {
  const root = fixture();
  const r = run(root, ['spec', 'approve']);
  assert.equal(r.status, 0, r.stderr.toString());
  assert.equal(fs.existsSync(path.join(specDir(root), 'approval.json')), false);
  const out = result(r);
  assert.ok(out.approvedIn, 'подпись названа коммитом');
  assert.ok(out.specHash && out.tasksHash);
});

test('spec approve: сообщение коммита несёт три трейлера', () => {
  const root = fixture();
  assert.equal(run(root, ['spec', 'approve']).status, 0);
  const body = git(root, ['log', '-1', '--format=%B']);
  const st = result(run(root, ['spec', 'status']));
  assert.match(body, /^Spec-Approved: specs\/001-fixture$/m);
  assert.match(body, new RegExp(`^Spec-Hash: ${st.specHash}$`, 'm'));
  assert.match(body, new RegExp(`^Tasks-Hash: ${st.tasksHash}$`, 'm'));
});

test('spec approve: грязный файл вне спеки в коммит НЕ попал', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, 'README.md'), 'грязь вне спеки\n');
  assert.equal(run(root, ['spec', 'approve']).status, 0, 'approve не спотыкается о грязное дерево');

  const touched = git(root, ['show', '--name-only', '--format=', 'HEAD']).trim();
  assert.ok(!touched.includes('README.md'), `в коммит попало лишнее: ${touched}`);
  // Файл обязан остаться нетронутым в рабочем дереве — подпись плана ничего не «сохраняет».
  assert.match(git(root, ['status', '--porcelain']), /README\.md/);
});

test('spec approve: повторный вызов без изменений не создаёт второй коммит', () => {
  const root = fixture();
  assert.equal(run(root, ['spec', 'approve']).status, 0);
  const afterFirst = commitCount(root);
  const second = run(root, ['spec', 'approve']);
  assert.equal(second.status, 0, second.stderr.toString());
  assert.equal(commitCount(root), afterFirst, 'подпись идемпотентна');
  assert.match(second.stderr.toString(), /уже подписана/);
});

test('spec approve: неотслеживаемая спека всё равно попадает в коммит', () => {
  const root = fixture({ seed: false });
  const r = run(root, ['spec', 'approve']);
  assert.equal(r.status, 0, r.stderr.toString());
  const touched = git(root, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n');
  assert.deepEqual(touched.sort(), ['specs/001-fixture/spec.md', 'specs/001-fixture/tasks.md']);
});

test('spec status: unapproved до approve, approved после', () => {
  const root = fixture();
  assert.equal(result(run(root, ['spec', 'status'])).status, 'unapproved');
  assert.equal(run(root, ['spec', 'approve']).status, 0);
  const st = result(run(root, ['spec', 'status']));
  assert.equal(st.status, 'approved');
  assert.equal(st.source, 'trailer');
});

test('spec status: правка spec.md после approve роняет подпись в stale', () => {
  const root = fixture();
  assert.equal(run(root, ['spec', 'approve']).status, 0);
  fs.appendFileSync(path.join(specDir(root), 'spec.md'), 'edited\n');
  assert.equal(result(run(root, ['spec', 'status'])).status, 'stale');
});

test('spec status: новая задача роняет подпись, повторный approve её чинит', () => {
  const root = fixture();
  assert.equal(run(root, ['spec', 'approve']).status, 0);
  fs.appendFileSync(path.join(specDir(root), 'tasks.md'), '- [ ] **T002** second\n');
  assert.equal(result(run(root, ['spec', 'status'])).status, 'stale');
  assert.equal(run(root, ['spec', 'approve']).status, 0);
  assert.equal(result(run(root, ['spec', 'status'])).status, 'approved');
});

test('spec approve: пропавший spec.md — отказ, подписи не появляется', () => {
  const root = fixture();
  const before = commitCount(root);
  fs.rmSync(path.join(specDir(root), 'spec.md'));
  assert.notEqual(run(root, ['spec', 'approve']).status, 0);
  assert.equal(commitCount(root), before, 'отказ не оставляет коммита');
});

test('spec approve/status: --spec целится в явную директорию мимо других планов', () => {
  const root = fixture();
  fs.mkdirSync(path.join(root, 'specs', '000-earlier'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '000-earlier', 'tasks.md'), '- [ ] **T001** earlier\n');
  const r = run(root, ['spec', 'approve', '--spec', 'specs/001-fixture']);
  assert.equal(r.status, 0, r.stderr.toString());
  assert.equal(result(run(root, ['spec', 'status', '--spec', 'specs/001-fixture'])).status, 'approved');
  const touched = git(root, ['show', '--name-only', '--format=', 'HEAD']).trim();
  assert.ok(!touched.includes('000-earlier'), touched);
});

test('spec approve: пишет строку spec-approve в run-log', () => {
  const root = fixture();
  assert.equal(run(root, ['spec', 'approve']).status, 0);
  const log = path.join(root, '.git', 'elt', 'run-log.jsonl');
  assert.ok(fs.existsSync(log), 'run-log создан');
  const entries = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const entry = entries.find((e) => e.status === 'spec-approve');
  assert.ok(entry, 'запись spec-approve есть');
  assert.equal(entry.spec, 'specs/001-fixture');
  assert.ok(entry.commit);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
