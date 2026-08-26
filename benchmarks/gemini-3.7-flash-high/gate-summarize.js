#!/usr/bin/env node
'use strict';
// Machine-generated summary of the gate experiment (spec 021 T003). Nothing here is
// hand-entered: every number in the README's gate table comes out of this file, so a
// number cannot drift from the raw log by being retyped.
//
// Endpoint: gate DISCRIMINATION — over the 2N (instance, patchKind) cells, how often the
// hand's ship/stop decision matches the patch's known construction (gold -> accept,
// broken -> reject). Not resolve rate: no test is executed anywhere in this experiment.
//
// `bare` is analytic (no gate ships everything, by definition) and is reported as such,
// with `analytic: true` on the hand, so no reader can take it for a measurement.

const fs = require('fs');
const path = require('path');
const { wilsonInterval, readResultRows } = require('./runner.js');
const { GATE_HANDS } = require('./gate-runner.js');

const TERMINAL = new Set(['pass', 'fail', 'invalid']);

function handStats(rows, hand, n) {
  const mine = rows.filter((r) => r.hand === hand);
  const byId = new Map();
  for (const r of mine) if (TERMINAL.has(r.outcome)) byId.set(r.id, r); // last terminal row wins
  const terminal = [...byId.values()];
  const correct = terminal.filter((r) => r.outcome === 'pass').length;
  const wrong = terminal.filter((r) => r.outcome === 'fail').length;
  const invalid = terminal.filter((r) => r.outcome === 'invalid').length;
  const graded = correct + wrong;
  return {
    hand,
    analytic: mine.length > 0 ? Boolean(mine[0].analytic) : GATE_HANDS[hand].judge === 'none',
    expect: GATE_HANDS[hand].expect,
    n,
    terminal: terminal.length,
    incomplete: n - terminal.length,
    correct,
    wrong,
    invalid,
    graded,
    accuracy: graded ? correct / graded : null,
    verdicts: terminal.reduce((acc, r) => {
      const key = r.verdict || (r.analytic ? 'analytic-accept' : 'unknown');
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
}

// Combines the gold and broken cells of ONE judge dimension into a single decision-level
// accuracy over 2N cells — this is the headline number, because a gate that says "reject"
// to everything scores 100% on the broken half and 0% on the gold half, and only the
// combined figure exposes that.
function combine(goldStats, brokenStats) {
  const correct = goldStats.correct + brokenStats.correct;
  const graded = goldStats.graded + brokenStats.graded;
  return {
    correct,
    graded,
    incomplete: goldStats.incomplete + brokenStats.incomplete,
    invalid: goldStats.invalid + brokenStats.invalid,
    accuracy: graded ? correct / graded : null,
    ci95: wilsonInterval(correct, graded),
  };
}

function summarizeGate({ dataset, rows }) {
  const n = dataset.items.length;
  const hands = Object.keys(GATE_HANDS).map((h) => handStats(rows, h, n));
  const byHand = Object.fromEntries(hands.map((h) => [h.hand, h]));
  const arms = {
    bare: combine(byHand['bare-gold'], byHand['bare-broken']),
    judgeDiff: combine(byHand['judgeDiff-gold'], byHand['judgeDiff-broken']),
  };
  arms.bare.analytic = true;
  arms.judgeDiff.analytic = false;
  // claimEligible is about the MEASURED arm only: the analytic arm cannot be incomplete,
  // so letting it vote would make completeness trivially true.
  const claimEligible = arms.judgeDiff.incomplete === 0 && arms.judgeDiff.graded === 2 * n;
  return {
    schema: 'elt-gate-summary/v1',
    generatedAt: new Date().toISOString(),
    kind: dataset.kind,
    datasetSha256: dataset.datasetSha256,
    n,
    cells: 2 * n,
    hands,
    arms,
    failureModes: failureModes(rows),
    delta: arms.judgeDiff.accuracy !== null ? arms.judgeDiff.accuracy - arms.bare.accuracy : null,
    claimEligible,
    claimEligibleReason: claimEligible
      ? 'обе клетки измеряемой руки judgeDiff терминальны на каждом инстансе датасета'
      : `рука judgeDiff неполна: ${arms.judgeDiff.incomplete} клеток без терминального результата`,
    endpointNote: 'gate discrimination (вердикт против известной по построению природы патча); НЕ resolve rate — тесты SWE-bench не запускались ни в одной руке',
  };
}

function percentile(values, p) {
  if (!values.length) return null; // empty -> null, never 0: a missing latency is not a fast one
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// The two failure modes the spec names by name, kept apart because they cost different
// things: fail-open ships a broken patch (the gate did not do its job), false-block stops
// a correct one (the gate taxed correct work). One number for both would hide the trade.
function failureModes(rows) {
  const terminalOf = (hand) => {
    const byId = new Map();
    for (const r of rows) if (r.hand === hand && TERMINAL.has(r.outcome)) byId.set(r.id, r);
    return [...byId.values()];
  };
  const broken = terminalOf('judgeDiff-broken');
  const gold = terminalOf('judgeDiff-gold');
  const judged = [...broken, ...gold];
  const durations = judged.map((r) => r.durationSec).filter((d) => typeof d === 'number');
  return {
    failOpen: broken.filter((r) => r.outcome === 'fail').length,
    failOpenOf: broken.length,
    falseBlock: gold.filter((r) => r.outcome === 'fail').length,
    falseBlockOf: gold.length,
    modelCalls: judged.reduce((sum, r) => sum + (r.attempt || 0), 0),
    latencySec: { p50: percentile(durations, 50), p90: percentile(durations, 90), n: durations.length },
    verdictMix: judged.reduce((acc, r) => {
      const k = r.verdict || 'none';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {}),
  };
}

function pct(x) {
  return x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`;
}

function markdownTable(summary) {
  const lines = [
    '| arm | correct/cells | accuracy [95% CI] | природа |',
    '| --- | --- | --- | --- |',
  ];
  for (const [name, a] of Object.entries(summary.arms)) {
    const ci = a.analytic ? '—' : `[${pct(a.ci95.lo)}, ${pct(a.ci95.hi)}]`;
    lines.push(`| ${name} | ${a.correct}/${a.graded} | ${pct(a.accuracy)} ${ci} | ${a.analytic ? 'аналитическая (гейта нет — пропускает всё)' : 'измерено'} |`);
  }
  const f = summary.failureModes;
  lines.push('');
  lines.push('| режим отказа судьи | сколько | цена |');
  lines.push('| --- | --- | --- |');
  lines.push(`| fail-open (broken пропущен) | ${f.failOpen}/${f.failOpenOf} | битый патч уехал в main |`);
  lines.push(`| false-block (gold отклонён) | ${f.falseBlock}/${f.falseBlockOf} | верная работа остановлена |`);
  lines.push(`| вызовов модели | ${f.modelCalls} | латентность p50 ${f.latencySec.p50 === null ? 'n/a' : `${f.latencySec.p50.toFixed(1)} с`} / p90 ${f.latencySec.p90 === null ? 'n/a' : `${f.latencySec.p90.toFixed(1)} с`} |`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dataset') out.dataset = argv[++i];
    else if (a === '--log') out.log = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else return { error: `unknown flag: ${a}` };
  }
  if (!out.dataset || !out.log || !out.out) return { error: '--dataset, --log и --out обязательны' };
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`gate-summarize: ${args.error}`);
    process.exitCode = 2;
    return;
  }
  const dataset = JSON.parse(fs.readFileSync(args.dataset, 'utf8'));
  const rows = readResultRows(args.log);
  const summary = summarizeGate({ dataset, rows });
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(summary, null, 2), 'utf8');
  console.log(markdownTable(summary));
  console.log(`\nclaimEligible=${summary.claimEligible} (${summary.claimEligibleReason})`);
}

module.exports = { summarizeGate, handStats, combine, markdownTable, parseArgs, failureModes, percentile };

if (require.main === module) main(process.argv.slice(2));
