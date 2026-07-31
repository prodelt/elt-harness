'use strict';
// 008 T003: red-proof доказывает, что тест слайса ловит поломку — гоняет тестовые файлы
// диффа против кода ДО слайса (worktree на baseHead). Тесты ниже реальные: они гоняют
// настоящий `node --test` в настоящем git worktree, не мокают redProof изнутри.
// Каждый тест — свой repo (не общий): top-level тесты node:test не гарантированно
// последовательны, общий мутируемый repo между тестами гонится.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { redProof } = require('./red-proof');

const dirs = [];
function makeRepo(harnessJson = { testCmd: 'node --test' }) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'red-proof-repo-'));
  dirs.push(repo);
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);
  if (harnessJson) {
    fs.mkdirSync(path.join(repo, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.harness', 'harness.json'), JSON.stringify(harnessJson));
  }
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'seed']);
  return repo;
}
after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ } } });

test('красный тест (ловит поломку): падает на baseHead, слайс доказан', () => {
  const repo = makeRepo();
  // "слайс": новый модуль lib.js + тест, который реально требует его поведения.
  fs.writeFileSync(path.join(repo, 'lib.js'), 'module.exports = { add: (a, b) => a + b };\n');
  fs.writeFileSync(
    path.join(repo, 'lib.test.js'),
    "const { test } = require('node:test');\n" +
    "const assert = require('node:assert/strict');\n" +
    "const { add } = require('./lib.js');\n" +
    "test('add', () => { assert.equal(add(2, 3), 5); });\n"
  );
  const r = redProof({ cwd: repo, baseHead: 'HEAD' });
  assert.equal(r.status, 'red');
  assert.equal(r.reason, 'fails-on-base');
  assert.deepEqual(r.files, ['lib.test.js']);
  assert.ok(r.tail.length > 0);
});

test('зелёный тест (ничего не ловит): проходит и на baseHead, слайс НЕ доказан', () => {
  const repo = makeRepo();
  fs.writeFileSync(
    path.join(repo, 'trivial.test.js'),
    "const { test } = require('node:test');\n" +
    "const assert = require('node:assert/strict');\n" +
    "test('всегда true', () => { assert.equal(1, 1); });\n"
  );
  const r = redProof({ cwd: repo, baseHead: 'HEAD' });
  assert.equal(r.status, 'green');
  assert.equal(r.reason, 'passes-on-base');
  assert.deepEqual(r.files, ['trivial.test.js']);
});

test('отсутствие тестовых файлов в диффе → skipped:no-new-tests', () => {
  const repo = makeRepo();
  fs.writeFileSync(path.join(repo, 'notes.txt'), 'просто правка, без теста\n');
  const r = redProof({ cwd: repo, baseHead: 'HEAD' });
  assert.equal(r.status, 'skipped');
  assert.equal(r.reason, 'no-new-tests');
  assert.deepEqual(r.files, []);
});

test('тестовый файл без прогонной команды (не-node, нет harness.testCmd) → skipped:no-test-cmd', () => {
  const repo = makeRepo(null);
  fs.writeFileSync(path.join(repo, 'test_feature.py'), '# python-тест без раннера в конфиге\n');
  const r = redProof({ cwd: repo, baseHead: 'HEAD' });
  assert.equal(r.status, 'skipped');
  assert.equal(r.reason, 'no-test-cmd');
});

// 011 T016 ↓ — дефолт `node --test` для этого репо ложен (тесты тут самозапускающиеся
// `main()`-скрипты), а зависший раннер вешал гейт молча на 25 минут.
test('testCmd из harness.json подхватывается вместо дефолта `node --test`', () => {
  const repo = makeRepo({ testCmd: 'node' });
  // Различимый маркер: `node --test` выставляет детям NODE_TEST_CONTEXT, плоский `node` — нет.
  // Под дефолтом этот файл дал бы green (тестов нет, ребёнок вышел 0), под `node` — red.
  fs.writeFileSync(path.join(repo, 'marker.test.js'), 'process.exit(process.env.NODE_TEST_CONTEXT ? 0 : 1);\n');
  const r = redProof({ cwd: repo, baseHead: 'HEAD' });
  assert.equal(r.status, 'red', 'сработал плоский `node` из конфига, а не дефолтный `node --test`');
});

test('зависший раннер упирается в потолок → skipped:test-cmd-timeout, а не молчаливое зависание', () => {
  const repo = makeRepo({ testCmd: 'node', redProofTimeoutMs: 1200 });
  fs.writeFileSync(path.join(repo, 'hang.test.js'), 'while (true) {}\n');
  const started = Date.now();
  const r = redProof({ cwd: repo, baseHead: 'HEAD' });
  assert.equal(r.status, 'skipped');
  assert.ok(r.reason.startsWith('test-cmd-timeout:'), `ожидалась явная причина таймаута, получено: ${r.reason}`);
  assert.ok(Date.now() - started < 30000, 'потолок обязан сработать, а не висеть бесконечно');
});

test('несколько тестовых файлов в диффе: гоняются все, а не только первый', () => {
  const repo = makeRepo({ testCmd: 'node' });
  fs.writeFileSync(path.join(repo, 'a.test.js'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(repo, 'b.test.js'), "console.log('SECOND-FILE-RAN'); process.exit(1);\n");
  const r = redProof({ cwd: repo, baseHead: 'HEAD' });
  assert.equal(r.status, 'red', 'падение второго файла обязано быть замечено');
  assert.match(r.tail, /SECOND-FILE-RAN/);
});

test('worktree удаляется всегда — не остаётся в git worktree list после прогона', () => {
  const repo = makeRepo();
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  fs.writeFileSync(path.join(repo, 'lib2.js'), 'module.exports = { sub: (a, b) => a - b };\n');
  fs.writeFileSync(
    path.join(repo, 'lib2.test.js'),
    "const { test } = require('node:test');\n" +
    "const assert = require('node:assert/strict');\n" +
    "const { sub } = require('./lib2.js');\n" +
    "test('sub', () => { assert.equal(sub(5, 2), 3); });\n"
  );
  redProof({ cwd: repo, baseHead: 'HEAD' });
  const worktrees = git(['worktree', 'list', '--porcelain']).match(/^worktree .+$/gm) || [];
  assert.equal(worktrees.length, 1, 'после прогона должен остаться только основной worktree репо');
});
