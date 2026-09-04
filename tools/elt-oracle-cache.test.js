'use strict';
// 014 T001 (AC1) — кэш оракула по хешу транзитивного замыкания. Риск R3 спеки: кэш не имеет
// права замаскировать красный тест — поэтому тесты ниже давят на «неуверенность → прогон»,
// а не на экономию.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { closureFor, loadCache, saveCache, computeEntry } = require('./elt-oracle-cache');
const { partitionByCache } = require('./elt-oracle-runner');

const dirs = [];
// Мини-репо: тест → mid → only-a (два шага, как в elt-oracle-select.test.js).
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-cache-'));
  dirs.push(root);
  const w = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  w('tools/only-a.js', 'module.exports = { a: () => 1 };\n');
  w('tools/mid.js', "const { a } = require('./only-a');\nmodule.exports = { mid: () => a() };\n");
  w('tools/a.test.js', "require('./mid');\nconsole.log('ok');\n");
  return root;
}
after(() => { for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* windows lock */ } });

const readFileRel = (root) => (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; } };
const entryFor = (root, opts = {}) => computeEntry({
  root, testFile: 'tools/a.test.js', runnerVersion: 'v1', cmd: 'node', readFile: readFileRel(root), ...opts,
});

test('closureFor: замыкание находится транзитивно через посредника (тест → mid → only-a)', () => {
  const root = fixture();
  const closure = closureFor('tools/a.test.js', ['tools/only-a.js', 'tools/mid.js'], readFileRel(root));
  assert.deepEqual(closure, ['tools/mid.js', 'tools/only-a.js']);
});

test('computeEntry: попадание — без правок ключ второго прогона тот же (тест не обязан перезапускаться)', () => {
  const root = fixture();
  assert.equal(entryFor(root).key, entryFor(root).key);
});

test('computeEntry: промах — правка файла ИЗ замыкания меняет ключ', () => {
  const root = fixture();
  const before = entryFor(root);
  fs.writeFileSync(path.join(root, 'tools/only-a.js'), 'module.exports = { a: () => 2 };\n');
  const after1 = entryFor(root);
  assert.notEqual(before.key, after1.key, 'правка файла замыкания обязана инвалидировать кэш');
});

test('computeEntry: правка файла ВНЕ замыкания не двигает ключ', () => {
  const root = fixture();
  const w = (body) => fs.writeFileSync(path.join(root, 'tools/unrelated.js'), body);
  w('module.exports = {};\n');
  const before = entryFor(root);
  w('module.exports = { changed: true };\n');
  const after1 = entryFor(root);
  assert.equal(before.key, after1.key, 'файл, которого нет в замыкании, не обязан двигать ключ');
});

test('computeEntry: инвалидация по версии раннера', () => {
  const root = fixture();
  const v1 = entryFor(root, { runnerVersion: 'v1' });
  const v2 = entryFor(root, { runnerVersion: 'v2' });
  assert.notEqual(v1.key, v2.key, 'смена версии раннера обязана инвалидировать весь кэш');
});

test('computeEntry: смена команды тоже инвалидирует ключ', () => {
  const root = fixture();
  const a = entryFor(root, { cmd: 'node' });
  const b = entryFor(root, { cmd: 'node --experimental-x' });
  assert.notEqual(a.key, b.key);
});

test('loadCache/saveCache: круглый путь на диске', () => {
  const root = fixture();
  saveCache(root, { 'tools/a.test.js': { key: 'abc' } });
  assert.equal(loadCache(root)['tools/a.test.js'].key, 'abc');
});

test('loadCache: нет файла кэша → пустой объект, не бросает', () => {
  const root = fixture();
  assert.deepEqual(loadCache(root), {});
});

test('partitionByCache: попадание — второй прогон без правок не запускает тест', () => {
  const root = fixture();
  const run = ['tools/a.test.js'];
  const first = partitionByCache(run, root, false);
  assert.deepEqual(first.toRun, run, 'первый прогон — кэш пуст, гоняем');

  const cache = {};
  for (const f of first.toRun) cache[f] = { key: first.entries[f] };
  saveCache(root, cache);

  const second = partitionByCache(run, root, false);
  assert.deepEqual(second.toRun, [], 'второй прогон без правок не запускает тест');
  assert.deepEqual(second.hits, run);
});

test('partitionByCache: промах — правка файла замыкания снова требует прогона', () => {
  const root = fixture();
  const run = ['tools/a.test.js'];
  const first = partitionByCache(run, root, false);
  saveCache(root, { [run[0]]: { key: first.entries[run[0]] } });

  fs.writeFileSync(path.join(root, 'tools/only-a.js'), 'module.exports = { a: () => 99 };\n');
  const second = partitionByCache(run, root, false);
  assert.deepEqual(second.toRun, run, 'правка файла замыкания обязана дать промах');
});

test('partitionByCache: красный прогон не кэшируется — следующий прогон снова гоняет (R3)', () => {
  const root = fixture();
  const run = ['tools/a.test.js'];
  const first = partitionByCache(run, root, false);
  // симулируем то, что делает main(): красный результат НЕ пишется в кэш.
  saveCache(root, {});
  const second = partitionByCache(run, root, false);
  assert.deepEqual(second.toRun, run, 'без записи в кэше — всегда промах, красное не маскируется');
  assert.equal(first.entries[run[0]], second.entries[run[0]], 'ключ детерминирован при неизменном коде');
});

test('partitionByCache: --full игнорирует кэш целиком', () => {
  const root = fixture();
  const run = ['tools/a.test.js'];
  const first = partitionByCache(run, root, false);
  saveCache(root, { [run[0]]: { key: first.entries[run[0]] } });

  const full = partitionByCache(run, root, true);
  assert.deepEqual(full.toRun, run, '--full обязан гонять всё, даже при валидном кэше');
  assert.deepEqual(full.hits, []);
});

// ── 024 T004 ─────────────────────────────────────────────────────────────────
// Дефект: `computeEntry` звался БЕЗ `scanDirs`, дефолт был `['tools']`, а корней оракула
// три. Замыкание теста из `bin/` или `benchmarks/` не содержало ни одного исходника оттуда,
// поэтому правка `bin/l0.js` не двигала ключ `bin/l0.test.js`: кэш отдавал попадание, тест не
// исполнялся, и оракул печатал зелёное на сломанной точке входа плагина. Воспроизведено на
// живом репозитории до фикса.
function multiRootFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oracle-cache-roots-'));
  dirs.push(root);
  const w = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  w('bin/entry.js', 'module.exports = { go: () => 1 };\n');
  w('bin/entry.test.js', "require('./entry');\nconsole.log('ok');\n");
  w('benchmarks/runner.js', 'module.exports = { grade: () => 1 };\n');
  w('benchmarks/runner.test.js', "require('./runner');\nconsole.log('ok');\n");
  w('tools/noise.js', 'module.exports = {};\n');
  return root;
}

test('024 T004: правка исходника в bin/ двигает ключ его собственного теста', () => {
  const root = multiRootFixture();
  const key = () => computeEntry({
    root, testFile: 'bin/entry.test.js', runnerVersion: 'v1', cmd: 'node', readFile: readFileRel(root),
  }).key;
  const before = key();
  fs.appendFileSync(path.join(root, 'bin', 'entry.js'), '\nmodule.exports.broken = true;\n');
  assert.notEqual(key(), before, 'кэш обязан промахнуться: тест зависит от правленого файла');
});

test('024 T004: правка исходника в benchmarks/ двигает ключ его собственного теста', () => {
  const root = multiRootFixture();
  const key = () => computeEntry({
    root, testFile: 'benchmarks/runner.test.js', runnerVersion: 'v1', cmd: 'node', readFile: readFileRel(root),
  }).key;
  const before = key();
  fs.appendFileSync(path.join(root, 'benchmarks', 'runner.js'), '\nmodule.exports.broken = true;\n');
  assert.notEqual(key(), before, 'кэш обязан промахнуться и во втором корне');
});

test('024 T004: замыкание теста из bin/ содержит его собственный исходник', () => {
  const root = multiRootFixture();
  const { closureFiles } = computeEntry({
    root, testFile: 'bin/entry.test.js', runnerVersion: 'v1', cmd: 'node', readFile: readFileRel(root),
  });
  assert.ok(closureFiles.includes('bin/entry.js'), `замыкание пустое по своему корню: ${JSON.stringify(closureFiles)}`);
});

test('024 T004: дефолт scanDirs совпадает с корнями, которые обходит раннер', () => {
  const { SCAN_DIRS } = require('./elt-oracle-cache');
  const { TEST_ROOTS } = require('./elt-oracle-runner');
  // Две копии одного списка и разошлись — обход знал три корня, замыкание один. Список
  // обязан быть ОДИН, и этот тест краснеет на любой попытке снова его раздвоить.
  assert.deepEqual([...TEST_ROOTS].sort(), [...SCAN_DIRS].sort());
});

test('024 T004: версия раннера инвалидируется правкой правил выборки', () => {
  const crypto = require('node:crypto');
  const { RUNNER_VERSION } = require('./elt-oracle-runner');
  // `needlesFor`, `walkJs` и `INERT` живут в elt-oracle-select.js и ЦЕЛИКОМ определяют
  // замыкание. Пока их исходник не входил в версию раннера, правка правил оставляла весь
  // старый кэш валидным — то есть посчитанным по правилам, которых больше нет.
  const expected = crypto.createHash('sha256')
    .update(fs.readFileSync(require.resolve('./elt-oracle-runner')))
    .update(fs.readFileSync(require.resolve('./elt-oracle-cache')))
    .update(fs.readFileSync(require.resolve('./elt-oracle-select')))
    .digest('hex');
  assert.equal(RUNNER_VERSION, expected, 'версия раннера обязана хешировать и правила выборки');
});

test('024 T004: кэш живёт в .git, а не в рабочем дереве', () => {
  const { cachePath } = require('./elt-oracle-cache');
  const root = multiRootFixture();
  const p = cachePath(root);
  assert.ok(!p.startsWith(path.join(root, '.harness')), 'кэш в .harness/ невидим для treeHash — там его и подделывали');
  assert.ok(p.endsWith(path.join('elt', 'oracle-cache.json')), p);
});
