'use strict';
// 011 T006 (AC6) — impact-выборка тест-файлов.
//
// Слой опасен ровно одним отказом: пропустить тест, который поймал бы регресс. Поэтому тесты
// ниже давят не на «сэкономили», а на «когда НЕ уверены — гоним все», и каждая причина
// fallback'а обязана быть названа вслух (тихий fallback = слой, о котором никто не знает).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { selectTests, dependents, needlesFor } = require('./elt-oracle-select');

const dirs = [];
// Мини-репо: тест A трогает only-a.js, тест B — only-b.js, тест C зовёт CLI строкой в конфиге
// (связь, которой нет ни в одном `require` — на ней слепнет разбор импортов).
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-select-'));
  dirs.push(root);
  const w = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  w('tools/only-a.js', 'module.exports = { a: () => 1 };\n');
  w('tools/only-b.js', 'module.exports = { b: () => 2 };\n');
  w('tools/mid.js', "const { a } = require('./only-a');\nmodule.exports = { mid: () => a() };\n");
  w('tools/cli-runner.js', 'process.exit(0);\n');
  w('tools/a.test.js', "require('./mid');\n");                    // через посредника: 2 шага
  w('tools/b.test.js', "require('./only-b');\n");                 // напрямую
  w('tools/c.test.js', "const cfg = { oracle: 'node tools/cli-runner.js' };\n"); // строкой, не require
  return root;
}
const allTests = ['tools/a.test.js', 'tools/b.test.js', 'tools/c.test.js'];
const pick = (root, changed, extra = {}) =>
  selectTests({ cwd: root, changedFiles: changed, allTests, mode: 'impact', useCodegraph: false, ...extra });
after(() => { for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* windows lock */ } });

test('impact: выбирается подмножество, а не все — прямая связь', () => {
  const r = pick(fixture(), ['tools/only-b.js']);
  assert.equal(r.mode, 'impact');
  assert.deepEqual(r.files, ['tools/b.test.js'], 'соседние тесты не гоняются впустую');
  assert.equal(r.total, 3, 'в отчёте видно, из скольких выбрано');
});

test('impact: связь через посредника (тест → модуль → изменённый файл) не теряется', () => {
  const r = pick(fixture(), ['tools/only-a.js']);
  assert.deepEqual(r.files, ['tools/a.test.js'], 'два шага — это ещё покрытие, а не «далеко»');
});

test('impact: связь СТРОКОЙ (spawn CLI из конфига) видна — на ней слеп разбор импортов', () => {
  const r = pick(fixture(), ['tools/cli-runner.js']);
  assert.deepEqual(r.files, ['tools/c.test.js']);
});

test('impact: изменённый тест-файл гоняется всегда, даже если на него никто не ссылается', () => {
  const r = pick(fixture(), ['tools/b.test.js']);
  assert.deepEqual(r.files, ['tools/b.test.js']);
});

test('mode=all (дефолт): выборки нет, гоняются все — обратная совместимость', () => {
  const root = fixture();
  const r = selectTests({ cwd: root, changedFiles: ['tools/only-b.js'], allTests, mode: 'all' });
  assert.equal(r.mode, 'all');
  assert.deepEqual(r.files, allTests);
  assert.match(r.reason, /oracleSelect=all/, 'причина названа, а не подразумевается');
});

test('fallback: не-JS в диффе → все, с ЯВНОЙ причиной (конфиг влияет на что угодно)', () => {
  const r = pick(fixture(), ['tools/only-b.js', '.harness/harness.json']);
  assert.equal(r.mode, 'all', 'конфиг может изменить поведение любого теста — не угадываем');
  assert.match(r.reason, /не JS в диффе.*harness\.json/);
});

test('fallback: ничего не разобрали → все, а не «тестов не задето»', () => {
  const r = pick(fixture(), ['tools/never-referenced.js']);
  assert.equal(r.mode, 'all');
  assert.match(r.reason, /выборка пуста/, 'пустая выборка — это неуверенность, а не зелёный свет');
  assert.deepEqual(r.files, allTests);
});

test('fallback: дифф только из инертных файлов → все (правка .md ничего не ломает, но и не сужает)', () => {
  const r = pick(fixture(), ['README.md', '.planning/CHECKPOINT.md']);
  assert.equal(r.mode, 'all');
  assert.match(r.reason, /нет исполняемых файлов/);
});

// Без этого исключения слой был бы мёртв на практике: `elt spec approve` переписывает
// approval.json ПЕРЕД каждым гейтом, и он уводил бы выборку в «гнать все» на каждом слайсе.
test('бумага гейта (specs/**) выборку не рушит — approval.json не считается «не разобрать»', () => {
  const r = pick(fixture(), ['tools/only-b.js', 'specs/011-x/approval.json', 'specs/011-x/tasks.md']);
  assert.equal(r.mode, 'impact');
  assert.deepEqual(r.files, ['tools/b.test.js']);
});

test('codegraph: пустой ответ не выключает выборку и попадает в отчёт причиной', () => {
  const root = fixture();
  // Реальный `codegraph affected` в этом репо возвращает пусто (граф импортов не покрывает
  // CommonJS) — слой обязан пережить это, а не вернуть «тестов не задето».
  const r = selectTests({ cwd: root, changedFiles: ['tools/only-b.js'], allTests, mode: 'impact', useCodegraph: true });
  assert.equal(r.mode, 'impact');
  assert.ok(r.files.includes('tools/b.test.js'));
  assert.match(r.reason, /codegraph/, 'вклад второго источника (или его отсутствие) виден числом/причиной');
});

test('глубина ограничена: транзитивность не съедает выборку целиком', () => {
  const root = fixture();
  const chain = ['tools/only-a.js'];
  const affected = dependents(chain, ['tools/only-a.js', 'tools/mid.js', ...allTests], (rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; }
  });
  assert.ok(affected.has('tools/a.test.js'));
  assert.ok(!affected.has('tools/b.test.js'), 'несвязанный тест не притягивается');
});

test('иглы имени различают файл, а не любое вхождение слова', () => {
  const n = needlesFor('tools/elt.js');
  assert.ok(n.includes('tools/elt.js'));
  assert.ok(n.includes('elt.js'));
  assert.ok(!n.includes('elt'), 'голое `elt` матчило бы почти каждый файл репо и вырождало выборку');
});
