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

function main() {
  testVerifyOffForThisRepo();
  testBenchBaselineParses();
  process.stdout.write('elt gate L0 (T001 verify-off) tests: PASS\n');
}

main();
