'use strict';
// 011 T001 — контракт снятия verify-судьи с этого репо.
//
// Замер 2026-07-31: два независимых REJECT-default судьи перемножаются, block-rate 77%,
// из 48 блоков 36 — verify при `pass` первичного, и verify никогда не калибровался.
// Контур остаётся на red-proof (см. `circuitEnabled()` в elt.js), но конъюнкции судей нет.
// Код-пути verify не тронуты — ими пользуется fleet и чужие проекты.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { verifySettings, readHarnessConfig } = require('./elt-config');
const { evaluate, DEFAULT_DIFF_SIZE } = require('./elt-gate-l0');

const ROOT = path.join(__dirname, '..');
const BENCH = path.join(ROOT, '.planning', 'JUDGE-BENCH-011-T001.json');

function testVerifyOffForThisRepo() {
  assert.equal(verifySettings(ROOT), null, 'у этого репо второго судьи нет — конъюнкция снята');
  const { ok, config, errors } = readHarnessConfig(ROOT);
  assert.equal(ok, true, `конфиг обязан остаться схема-валидным: ${(errors || []).join('; ')}`);
  assert.equal(config.judge.enabled, true, 'первичный судья остаётся обязательным');
  // Контур не выключен целиком — он держится на red-proof, ровно как считает circuitEnabled().
  assert.notEqual(config.redProof, 'off', 'снятие verify не должно оставлять слайс без контура');
}

// Число ДО того, как на одиночном судье поедут слайсы: без него «стало лучше» нечем доказать.
function testBenchBaselineParses() {
  const report = JSON.parse(fs.readFileSync(BENCH, 'utf8'));
  assert.equal(report.provider, 'agy', 'baseline снят первичным судьёй репо');
  assert.ok(Array.isArray(report.results) && report.results.length >= 14, 'бенч гоняется на полном золотом наборе');
  for (const r of report.results) {
    assert.ok(r.id, 'у кейса есть id');
    assert.ok(r.expect === 'pass' || r.expect === 'block', `кейс ${r.id}: ожидание — pass или block`);
  }
  const s = report.score;
  assert.equal(s.total, report.results.length);
  assert.equal(s.blockCases + s.passCases, s.total, 'кейсы разложены по двум ожиданиям без остатка');
  for (const key of ['recall', 'falsePositiveRate', 'accuracy']) {
    assert.ok(typeof s[key] === 'number' && s[key] >= 0 && s[key] <= 1, `${key} — доля в [0,1]`);
  }
}

// --- 011 T002: риск-триггеры L0 (AC2) ------------------------------------------------
// Дифф собирается вручную, а не из git: L0 обязан быть чистой функцией, и тест это
// фиксирует — если в неё заедет fs/spawn, тест начнёт требовать репозиторий и упадёт.

function diffFor(file, { isNew = false, added = 1, removed = 0 } = {}) {
  return [
    `diff --git a/${file} b/${file}`,
    ...(isNew ? [`new file mode 100644`, '--- /dev/null'] : ['--- a/' + file]),
    `+++ b/${file}`,
    '@@ -1,1 +1,1 @@',
    ...Array.from({ length: removed }, (_, i) => `-old ${i}`),
    ...Array.from({ length: added }, (_, i) => `+new ${i}`),
  ].join('\n');
}

const names = (result) => result.triggers.map((t) => t.name);

// Пустой набор: слайс правит прод-код и вместе с ним тест — ровно то, ради чего судью
// будить не надо. Именно этот случай был 100% вызовов судьи до 011.
function testNoTriggersOnCleanSlice() {
  const result = evaluate({
    diff: [
      diffFor('tools/some-feature.js', { isNew: true, added: 20 }),
      diffFor('tools/some-feature.test.js', { isNew: true, added: 15 }),
    ].join('\n'),
    config: {},
  });
  assert.deepEqual(names(result), [], 'чистый слайс не даёт ни одного триггера');
  assert.equal(result.judgeNeeded, false, 'судья на чистом слайсе не нужен');
}

function testExistingTestModified() {
  const result = evaluate({ diff: diffFor('tools/some-feature.test.js', { removed: 3, added: 1 }), config: {} });
  assert.deepEqual(names(result), ['existing-test-modified']);
  assert.deepEqual(result.triggers[0].files, ['tools/some-feature.test.js']);
  assert.equal(result.judgeNeeded, true);
  // Граница: НОВЫЙ тест-файл — не этот триггер (ослаблять там нечего).
  assert.deepEqual(names(evaluate({ diff: diffFor('tools/some-feature.test.js', { isNew: true, added: 9 }), config: {} })), []);
}

function testNewCodeWithoutCheck() {
  const result = evaluate({ diff: diffFor('tools/some-feature.js', { isNew: true, added: 30 }), config: {} });
  assert.deepEqual(names(result), ['new-code-no-check']);
  assert.deepEqual(result.triggers[0].files, ['tools/some-feature.js']);
  // Untracked файл в дифф не попадает — он виден только через git status, и без этого
  // триггер был бы слеп ровно на своём случае.
  const untracked = evaluate({ diff: '', status: '?? tools/brand-new.js', config: {} });
  assert.deepEqual(names(untracked), ['new-code-no-check']);
  assert.deepEqual(untracked.triggers[0].files, ['tools/brand-new.js']);
}

function testHotPath() {
  // Дефолтный список: гейт/авторизация/секреты.
  assert.deepEqual(names(evaluate({ diff: diffFor('tools/fleet/gate.js', { removed: 1, added: 1 }), config: {} })), ['hot-path']);
  // Свой список из harness.json вытесняет дефолт целиком.
  const custom = evaluate({
    diff: diffFor('src/billing/charge.js', { removed: 1, added: 1 }),
    config: { hotPaths: ['src/billing/**'] },
  });
  assert.deepEqual(names(custom), ['hot-path']);
  assert.deepEqual(custom.triggers[0].files, ['src/billing/charge.js']);
  // ...и то, что было горячим по дефолту, при своём списке горячим быть перестаёт.
  assert.deepEqual(names(evaluate({ diff: diffFor('tools/fleet/gate.js', { removed: 1, added: 1 }), config: { hotPaths: ['src/billing/**'] } })), []);
  // Абсолютный путь вне cwd (009 T014) обязан срезаться до репо-относительного.
  const external = evaluate({
    diff: diffFor('C:/repo/tools/fleet/gate.js', { removed: 1, added: 1 }),
    cwd: 'C:\\repo',
    config: {},
  });
  assert.deepEqual(external.triggers[0].files, ['tools/fleet/gate.js']);
}

function testDiffSize() {
  const big = diffFor('docs/notes.md', { added: DEFAULT_DIFF_SIZE + 1 });
  assert.deepEqual(names(evaluate({ diff: big, config: {} })), ['diff-size']);
  // Порог из конфига действует вместо дефолта — в обе стороны.
  assert.deepEqual(names(evaluate({ diff: big, config: { diffSizeThreshold: 10000 } })), []);
  assert.deepEqual(names(evaluate({ diff: diffFor('docs/notes.md', { added: 11 }), config: { diffSizeThreshold: 10 } })), ['diff-size']);
}

function main() {
  testVerifyOffForThisRepo();
  testBenchBaselineParses();
  testNoTriggersOnCleanSlice();
  testExistingTestModified();
  testNewCodeWithoutCheck();
  testHotPath();
  testDiffSize();
  process.stdout.write('elt gate L0 tests: PASS\n');
}

main();
