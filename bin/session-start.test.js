'use strict';
// 020 T012 — контракт SessionStart-хука плагина.
//
// Хук раньше жил только в `~/.claude/hooks/elt-session-brief.js` — без источника в репозитории
// и без единого теста. Здесь проверяются три свойства, каждое из которых при поломке
// испортило бы КАЖДУЮ сессию: молчание вне ELT-проекта, отсутствие абсолютных путей в
// подсказках и то, что напоминание о фоне появляется ровно при `verify:"background"`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { brief, planSummary, runtimeRoute } = require('./session-start');

// git не спавним: факты ветки/грязи инъектируются, иначе тест зависел бы от состояния репо,
// в котором его запустили.
const fakeGit = ({ branch = 'feature/x', dirty = '' } = {}) => (args) => {
  if (args[0] === 'branch') return { stdout: branch + '\n', status: 0 };
  if (args[0] === 'status') return { stdout: dirty, status: 0 };
  return { stdout: '', status: 0 };
};

let seq = 0;
function project({ config = null, tasks = null, queue = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `session-start-${seq++}-`));
  if (config !== null) {
    fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify(config));
  }
  if (tasks !== null) {
    const dir = path.join(root, 'specs', '020-fixture');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tasks.md'), tasks);
  }
  if (queue !== null) {
    fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness', 'review-queue.jsonl'),
      queue.map((q) => JSON.stringify(q)).join('\n') + '\n');
  }
  return root;
}

test('не ELT-проект → пустой вывод: хук молчит там, где сказать нечего', () => {
  assert.equal(brief({ cwd: project(), git: fakeGit() }), '');
});

test('ELT-проект → ветка, состояние дерева и режим verify одной строкой', () => {
  const cwd = project({ config: { kind: 'code', oracle: 'node -e "0"' } });
  const text = brief({ cwd, git: fakeGit({ branch: 'feature/y', dirty: ' M a.js\n M b.js\n' }) });
  assert.match(text, /ветка feature\/y/);
  assert.match(text, /дерево грязное \(2 файлов\)/);
  assert.match(text, /verify: sync/, 'режим по умолчанию назван явно, а не подразумевается');

  const clean = brief({ cwd, git: fakeGit({ dirty: '' }) });
  assert.match(clean, /дерево чистое/);
});

test('план: открыто/закрыто и ПЕРВАЯ открытая задача', () => {
  const cwd = project({
    config: { kind: 'code' },
    tasks: '- [X] **T001** сделано\n- [X] **T002** тоже\n- [ ] **T003** первая открытая\n- [ ] **T004** вторая\n',
  });
  const text = brief({ cwd, git: fakeGit() });
  assert.match(text, /открыто 2, закрыто 2/);
  assert.match(text, /следующая: T003 первая открытая/);
  assert.doesNotMatch(text, /T004/, 'предлагается ОДИН следующий шаг, а не список');
});

test('план: путь пишется через прямые слэши — иначе на Windows строка нечитаема', () => {
  const cwd = project({ config: { kind: 'code' }, tasks: '- [ ] **T001** x\n' });
  assert.match(planSummary(cwd).file, /^specs\/020-fixture\/tasks\.md$/);
});

test('очередь ревью: количество, последние две записи и команда разбора', () => {
  const cwd = project({
    config: { kind: 'code' },
    queue: [
      { task: 'T001', kind: 'bg-red', commit: 'aaa', reason: 'первая' },
      { task: 'T002', kind: 'bg-red', commit: 'bbb', reason: 'вторая' },
      { task: 'T003', kind: 'bg-red', commit: 'ccc', reason: 'третья' },
      { task: 'T000', kind: 'bg-red', commit: 'ddd', reason: 'закрытая', closedAt: '2026-08-25T00:00:00Z' },
    ],
  });
  const text = brief({ cwd, git: fakeGit() });
  assert.match(text, /elt review: 3 фоновых красных/, 'закрытая запись не считается');
  assert.match(text, /review close --task Txxx/);
  assert.match(text, /вторая/);
  assert.match(text, /третья/);
  assert.doesNotMatch(text, /первая/, 'показываются две последние, а не вся очередь');
});

test('пустая очередь — ни строки о ревью (хук не шумит без повода)', () => {
  const cwd = project({ config: { kind: 'code' }, queue: [] });
  assert.doesNotMatch(brief({ cwd, git: fakeGit() }), /elt review/);
});

test('напоминание о фоне — ровно при verify:"background"', () => {
  const bg = project({ config: { kind: 'code', verify: 'background' } });
  assert.match(brief({ cwd: bg, git: fakeGit() }), /фон мог не закончить/);
  const sync = project({ config: { kind: 'code', verify: 'sync' } });
  assert.doesNotMatch(brief({ cwd: sync, git: fakeGit() }), /фон мог не закончить/);
});

test('битый harness.json не роняет старт сессии — хук только читает', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-start-broken-'));
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), '{не json');
  assert.match(brief({ cwd: root, git: fakeGit() }), /ELT: ветка/);
});

// Абсолютный путь в подсказке — это чужая машина. Ровно этим и был плох снятый хук:
// он советовал `~/.claude/bin/elt.js`, которого у перешедших на плагин уже нет.
test('маршрут в подсказке идёт от корня плагина и не содержит абсолютных путей', () => {
  assert.equal(runtimeRoute({ CLAUDE_PLUGIN_ROOT: '/anywhere' }), '${CLAUDE_PLUGIN_ROOT}/tools/elt.js');
  assert.equal(runtimeRoute({}), 'tools/elt.js', 'вне плагина — путь относительно проекта');

  const cwd = project({ config: { kind: 'code' }, queue: [{ task: 'T001', kind: 'bg-red', reason: 'x' }] });
  const text = brief({ cwd, env: { CLAUDE_PLUGIN_ROOT: '/anywhere' }, git: fakeGit() });
  assert.doesNotMatch(text, /[A-Za-z]:\\|\/home\/|\/Users\//, 'абсолютных путей в выводе нет');
  assert.doesNotMatch(text, /\.claude[/\\]bin/, 'снятая развёртка не может быть маршрутом');
  assert.match(text, /\$\{CLAUDE_PLUGIN_ROOT\}/);
});

test('сам файл хука не содержит абсолютных путей — требование задачи, а не только вывода', () => {
  const src = fs.readFileSync(path.join(__dirname, 'session-start.js'), 'utf8');
  const code = src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.doesNotMatch(code, /[A-Za-z]:\\\\|['"]\/(?:home|Users)\//);
});
