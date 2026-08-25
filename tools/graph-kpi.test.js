'use strict';
// 020 T022 — тесты измерителей. Проверяется главным образом НЕспособность соврать: каждый
// случай ниже — это реальный способ, которым метрика уже когда-то показывала не то.

const assert = require('node:assert/strict');
const kpi = require('./graph-kpi');

// Пустая выборка — `null`. Ноль в отчёте о латентности читается как «мгновенно» и выглядит
// достижением там, где данных нет вовсе.
function testEmptySampleIsNullNotZero() {
  assert.equal(kpi.percentile([], 0.5), null);
  const l = kpi.latencyKpi([]);
  assert.equal(l.readyToCommit.p95, null);
  assert.equal(l.readyToCommit.status, 'not-yet-measured', 'нет данных — нет ни pass, ни fail');
  assert.equal(l.certification.p50, null);
}

function testPercentilePicksRealObservations() {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(kpi.percentile(values, 0.5), 5);
  assert.equal(kpi.percentile(values, 0.9), 9);
  assert.equal(kpi.percentile(values, 0.95), 10);
  assert.equal(kpi.percentile([42], 0.95), 42, 'единственное наблюдение и есть любой перцентиль');
}

// Тяжёлая латентность сертификации публикуется ОТДЕЛЬНО и не смешивается с быстрой посадкой:
// одна усреднённая цифра спрятала бы ровно ту причину, по которой харнес обходят.
function testCertificationLatencyIsReportedSeparately() {
  const entries = [
    { batch: { readyToLocalCommitSec: 3 }, oracle: { durationSec: 160 } },
    { batch: { readyToLocalCommitSec: 4 }, oracle: { durationSec: 300 } },
  ];
  const l = kpi.latencyKpi(entries);
  assert.equal(l.readyToCommit.n, 2);
  assert.equal(l.certification.n, 2);
  assert.ok(l.certification.p90 >= 160, 'оракул не имеет права раствориться в средней цифре');
  assert.equal(l.readyToCommit.status, 'pass', 'посадка укладывается в порог');
}

function testLatencyFailsHonestlyWhenSlow() {
  const entries = Array.from({ length: 20 }, (_, i) => ({ batch: { readyToLocalCommitSec: 10 + i } }));
  const l = kpi.latencyKpi(entries);
  assert.equal(l.readyToCommit.status, 'fail', 'превышение порога обязано быть красным, а не «около того»');
}

// Порог объёма нельзя объявить взятым молча: либо число под порогом, либо в отчёте видно, кто
// именно одобрил новую базу.
function testLocRebaselineMustBeExplicit() {
  const silent = kpi.locKpi({ releaseCoreLoc: 19879, graphCoreLoc: 893 });
  assert.equal(silent.releaseCore.status, 'fail');
  assert.equal(silent.graphCore.status, 'pass', 'graph-core укладывается в свои 1 500');

  const approved = kpi.locKpi({ releaseCoreLoc: 19879, graphCoreLoc: 893, rebaselineApprovedBy: 'user@2026-08-25' });
  assert.equal(approved.releaseCore.status, 'rebaselined');
  assert.equal(approved.releaseCore.rebaselineApprovedBy, 'user@2026-08-25', 'кем одобрено — часть отчёта');

  const under = kpi.locKpi({ releaseCoreLoc: 3000, graphCoreLoc: 900 });
  assert.equal(under.releaseCore.status, 'pass');
  assert.equal(under.releaseCore.rebaselineApprovedBy, null, 'под порогом rebaseline не нужен и не показывается');
}

// Adoption без полного недельного окна — `not-yet-measured`. Иначе первый же удачный день
// объявлялся бы достижением порога.
function testAdoptionWithoutFullWindowIsNotMeasured() {
  const short = kpi.adoptionKpi({ commits: 10, viaHarness: 9, windowDays: 2 });
  assert.equal(short.share, 0.9);
  assert.equal(short.status, 'not-yet-measured');

  const full = kpi.adoptionKpi({ commits: 10, viaHarness: 9, windowDays: 7 });
  assert.equal(full.status, 'pass');

  const low = kpi.adoptionKpi({ commits: 10, viaHarness: 3, windowDays: 7 });
  assert.equal(low.status, 'fail');

  assert.equal(kpi.adoptionKpi({}).status, 'not-yet-measured', 'ноль коммитов — не ноль процентов');
}

// `unknown` не подмешивается ни в одну сторону: именно это делало прошлый замер
// неопровержимым и недоказуемым одновременно.
function testUnknownIsNeverFoldedIntoRatio() {
  const r = kpi.signalNoiseKpi({ signal: 5, noise: 2, unknown: 13, diffs: 20 });
  assert.equal(r.classified, 7, 'unknown не входит в классифицированные');
  assert.equal(r.ratio, 2.5);
  assert.ok(r.unknownShare > 0.6, 'доля неопределённых публикуется отдельно, а не прячется');
  assert.equal(r.status, 'pass');
}

// Отношение — число, а не строка `1:N`. Строка округлялась и однажды показала «шума нет».
function testRatioIsNumberNotRoundedString() {
  const r = kpi.signalNoiseKpi({ signal: 2, noise: 5, diffs: 20 });
  assert.equal(typeof r.ratio, 'number');
  assert.ok(r.ratio < 1, 'шума больше сигнала — это обязано быть видно');
  assert.equal(r.status, 'fail');
  assert.notEqual(Math.round(r.ratio), r.ratio, 'округление до целого здесь стирает сам факт');
}

function testSignalNoiseNeedsFullWindow() {
  const early = kpi.signalNoiseKpi({ signal: 5, noise: 1, diffs: 3 });
  assert.equal(early.status, 'not-yet-measured', 'три диффа не доказывают порог на двадцати');
}

// Наблюдательные пороги не блокируют честный первый тег — так записано в спеке. Блокирует
// только то, что проверяемо здесь и сейчас.
function testReleaseGateBlocksOnlyOnProvableFailures() {
  const loc = kpi.locKpi({ releaseCoreLoc: 19879, graphCoreLoc: 893, rebaselineApprovedBy: 'user' });
  const gate = kpi.releaseGate({
    latency: kpi.latencyKpi([]),
    loc,
    adoption: kpi.adoptionKpi({}),
    signalNoise: kpi.signalNoiseKpi({}),
    blockingDefects: 0,
  });
  assert.equal(gate.ok, true, 'ненаблюдённые пороги не создают фальшивый блокер');
  assert.equal(gate.observational.adoption, 'not-yet-measured');

  const withDefect = kpi.releaseGate({ loc, blockingDefects: 1 });
  assert.equal(withDefect.ok, false);
  assert.match(withDefect.blockers[0], /blocking-defects/);

  const fatLoc = kpi.locKpi({ releaseCoreLoc: 19879, graphCoreLoc: 893 });
  const noRebaseline = kpi.releaseGate({ loc: fatLoc });
  assert.equal(noRebaseline.ok, false, 'превышение объёма без явного rebaseline — блокер');
}

function main() {
  testEmptySampleIsNullNotZero();
  testPercentilePicksRealObservations();
  testCertificationLatencyIsReportedSeparately();
  testLatencyFailsHonestlyWhenSlow();
  testLocRebaselineMustBeExplicit();
  testAdoptionWithoutFullWindowIsNotMeasured();
  testUnknownIsNeverFoldedIntoRatio();
  testRatioIsNumberNotRoundedString();
  testSignalNoiseNeedsFullWindow();
  testReleaseGateBlocksOnlyOnProvableFailures();
  process.stdout.write('graph kpi tests: PASS\n');
}

main();
