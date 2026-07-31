'use strict';
// 011 T008 (AC8) — мутатор: выжившая мутация = строка, которую не проверяет ни один тест.
//
// Прогон тестов здесь НАСТОЯЩИЙ (`node <file>` в фикстур-репо, миллисекунды), а не мок: мок
// «упал/не упал» проверял бы сам себя — ровно тот класс теста, за который судья блокирует.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { mutate, mutationsFor, invertCondition, swapReturn, flipComparison } = require('./elt-mutate');

const dirs = [];
function repoWith(libBody, testBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-mutate-'));
  dirs.push(root);
  const g = (a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  g(['init', '-q']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(root, 'lib.js'), 'module.exports = {};\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);
  fs.writeFileSync(path.join(root, 'lib.js'), libBody);       // «слайс»: строки изменены
  fs.writeFileSync(path.join(root, 'lib.test.js'), testBody);
  return root;
}
// Настоящий прогон: ненулевой код возврата = мутация убита.
const realRunner = (root) => () => spawnSync(process.execPath, ['lib.test.js'], { cwd: root, encoding: 'utf8' }).status !== 0;
after(() => { for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* windows lock */ } });

test('мутация УБИТА: строку проверяет тест — слой молчит', () => {
  const root = repoWith(
    'function grade(score) {\n  if (score > 50) return "pass";\n  return "fail";\n}\nmodule.exports = { grade };\n',
    "const assert = require('node:assert/strict');\n" +
    "assert.equal(require('./lib').grade(80), 'pass');\n" +
    "assert.equal(require('./lib').grade(10), 'fail');\n"
  );
  const r = mutate({ cwd: root, files: ['lib.js'], runTests: realRunner(root) });
  assert.equal(r.status, 'clean', r.reason);
  assert.ok(r.tested > 0, 'мутации реально прогонялись, а не «нечего ломать»');
  assert.deepEqual(r.survived, []);
});

test('мутация ВЫЖИЛА: block с файлом и строкой — строка не покрыта', () => {
  // Тест дёргает только ветку "pass": порог и ветка "fail" не проверяются ничем.
  const root = repoWith(
    'function grade(score) {\n  if (score > 50) return "pass";\n  return "fail";\n}\nmodule.exports = { grade };\n',
    "const assert = require('node:assert/strict');\n" +
    "assert.ok(typeof require('./lib').grade === 'function');\n"
  );
  const r = mutate({ cwd: root, files: ['lib.js'], runTests: realRunner(root) });
  assert.equal(r.status, 'block');
  assert.match(r.reason, /мутация выжила/);
  assert.equal(r.survived[0].file, 'lib.js');
  assert.ok(r.survived[0].line >= 1, 'номер строки назван — иначе чинить нечего');
  assert.match(r.reason, /lib\.js:\d+/, 'файл и строка в причине, а не только в данных');
});

test('бюджет исчерпан → inconclusive с причиной, НЕ «чисто» и не тихий пропуск (R2)', () => {
  const root = repoWith(
    'function f(a) {\n  if (a > 1) return 1;\n  if (a > 2) return 2;\n  if (a > 3) return 3;\n  return 0;\n}\nmodule.exports = { f };\n',
    "require('node:assert').ok(require('./lib').f);\n"
  );
  const r = mutate({ cwd: root, files: ['lib.js'], runTests: realRunner(root), budget: { maxMutations: 1 } });
  assert.equal(r.status, 'inconclusive', 'непроверенное не выдаётся ни за чистое, ни за блок');
  assert.match(r.reason, /бюджет исчерпан/);
  assert.match(r.reason, /1 из \d+/, 'видно, сколько осталось непроверенным');
  assert.equal(r.tested, 1);
});

test('мутируются только ИЗМЕНЁННЫЕ строки — чужой код слайс не судит', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-mutate-scope-'));
  dirs.push(root);
  const g = (a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  g(['init', '-q']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  // Непокрытая строка существовала ДО слайса — она не его вина и не его блок.
  fs.writeFileSync(path.join(root, 'lib.js'), 'function old(a) {\n  if (a > 99) return "старое";\n  return "х";\n}\nmodule.exports = { old };\n');
  fs.writeFileSync(path.join(root, 'lib.test.js'), "require('node:assert').ok(require('./lib').old);\n");
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);
  // Слайс дописывает ОДНУ строку, и она покрыта.
  fs.writeFileSync(path.join(root, 'lib.js'),
    'function old(a) {\n  if (a > 99) return "старое";\n  return "х";\n}\nconst fresh = (x) => x === 5;\nmodule.exports = { old, fresh };\n');
  fs.writeFileSync(path.join(root, 'lib.test.js'),
    "const assert = require('node:assert/strict');\n" +
    "assert.ok(require('./lib').old);\n" +
    "assert.equal(require('./lib').fresh(5), true);\n" +
    "assert.equal(require('./lib').fresh(6), false);\n");

  const r = mutate({ cwd: root, files: ['lib.js'], runTests: realRunner(root) });
  assert.equal(r.status, 'clean', `старая непокрытая строка не должна вменяться слайсу: ${r.reason}`);
});

test('тест-файлы не мутируются (ломать проверку — не проверка)', () => {
  const root = repoWith('module.exports = { a: 1 };\n', "require('node:assert').ok(require('./lib').a);\n");
  const r = mutate({ cwd: root, files: ['lib.test.js'], runTests: () => true });
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /нет изменённых прод-файлов/);
});

test('нечего ломать в изменённых строках → skipped, а не ложное «чисто»', () => {
  const root = repoWith('module.exports = { name: "просто данные" };\n', "require('node:assert').ok(1);\n");
  const r = mutate({ cwd: root, files: ['lib.js'], runTests: () => true });
  assert.equal(r.status, 'skipped');
  assert.match(r.reason, /нечего ломать/);
});

test('операторы: инверсия условия, подмена возврата, снятие сравнения', () => {
  assert.equal(invertCondition('  if (a && (b || c)) {'), '  if (!(a && (b || c))) {', 'скобки внутри условия не рвут разбор');
  assert.equal(invertCondition('  const x = 1;'), null);
  assert.equal(swapReturn('  return true;'), '  return false;');
  assert.equal(swapReturn('  return compute(a, b);'), '  return null;');
  assert.equal(flipComparison('if (a === b) {'), 'if (a !== b) {');
  assert.equal(flipComparison('if (a >= b) {'), 'if (a < b) {');
  // Стрелка функции — синтаксис, а не сравнение: правка сделала бы файл невалидным, и «мутация
  // убита» означала бы лишь SyntaxError, а не работу теста.
  assert.equal(flipComparison('const f = (x) => x;'), null);
});

test('комментарии и пустые строки бюджет не тратят', () => {
  const text = '// комментарий с if (x)\n\n  * jsdoc-строка\nif (a > 1) return 2;\n';
  const m = mutationsFor(text, [1, 2, 3, 4]);
  assert.equal(m.length, 1, 'мутируется только исполняемая строка');
  assert.equal(m[0].line, 4);
});
