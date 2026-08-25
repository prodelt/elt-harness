#!/usr/bin/env node
'use strict';
// Machine-generated summary (spec 021 T002). Reads the append-only raw log + the
// dataset it was run against, and reports per-hand pass rate with a Wilson 95% CI.
// `claimEligible` is false unless BOTH hands have a terminal row (pass/fail/invalid,
// see runner.js TERMINAL_OUTCOMES) for every dataset item — an incomplete hand must
// not silently shrink the denominator into eligibility.

const fs = require('fs');
const path = require('path');
const { readResultRows, wilsonInterval } = require('./runner.js');

function summarizeHand(items, rows, hand) {
  const byId = new Map(rows.filter((r) => r.hand === hand).map((r) => [r.id, r]));
  let pass = 0;
  let fail = 0;
  let invalid = 0;
  let incomplete = 0;
  for (const item of items) {
    const row = byId.get(item.id);
    if (!row) { incomplete += 1; continue; }
    if (row.outcome === 'pass') pass += 1;
    else if (row.outcome === 'fail') fail += 1;
    else if (row.outcome === 'invalid') invalid += 1;
    else incomplete += 1; // transport-failure / agent-error still open
  }
  const graded = pass + fail; // invalid and incomplete are excluded from the rate, reported separately
  const ci = wilsonInterval(pass, graded);
  return { hand, n: items.length, pass, fail, invalid, incomplete, graded, passRate: graded ? pass / graded : null, ci95: ci };
}

function summarize({ dataset, rows, hands }) {
  const perHand = hands.map((hand) => summarizeHand(dataset.items, rows, hand));
  const claimEligible = perHand.every((h) => h.incomplete === 0 && h.graded > 0);
  return {
    schema: 'elt-benchmark-summary/v1',
    generatedAt: new Date().toISOString(),
    kind: dataset.kind,
    datasetSha256: dataset.datasetSha256,
    n: dataset.items.length,
    hands: perHand,
    claimEligible,
    claimEligibleReason: claimEligible
      ? 'обе руки имеют терминальный результат по каждому элементу датасета'
      : 'минимум одна рука неполна (incomplete>0) или не имеет ни одного graded результата — claim запрещён',
  };
}

function toMarkdown(summary) {
  const rows = summary.hands
    .map((h) => {
      const rate = h.passRate === null ? 'n/a' : `${(h.passRate * 100).toFixed(1)}%`;
      const ci = h.passRate === null ? '' : ` [${(h.ci95.lo * 100).toFixed(1)}, ${(h.ci95.hi * 100).toFixed(1)}]`;
      return `| ${h.hand} | ${h.pass}/${h.graded} | ${rate}${ci} | ${h.invalid} | ${h.incomplete} |`;
    })
    .join('\n');
  return [
    `# Summary — ${summary.kind}`,
    '',
    `n=${summary.n}, claimEligible=${summary.claimEligible} (${summary.claimEligibleReason})`,
    '',
    '| hand | pass/graded | pass rate [95% CI] | invalid | incomplete |',
    '| --- | --- | --- | --- | --- |',
    rows,
    '',
  ].join('\n');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dataset') out.dataset = argv[++i];
    else if (a === '--log') out.log = argv[++i];
    else if (a === '--hands') out.hands = argv[++i].split(',');
    else if (a === '--out') out.out = argv[++i];
    else return { error: `unknown flag: ${a}` };
  }
  if (!out.dataset || !out.log || !out.hands || !out.out) return { error: '--dataset, --log, --hands и --out обязательны' };
  return out;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`summarize: ${args.error}`);
    process.exitCode = 2;
    return;
  }
  const dataset = JSON.parse(fs.readFileSync(args.dataset, 'utf8'));
  const rows = readResultRows(args.log);
  const summary = summarize({ dataset, rows, hands: args.hands });
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(summary, null, 2), 'utf8');
  process.stdout.write(toMarkdown(summary));
}

module.exports = { summarizeHand, summarize, toMarkdown, parseArgs };

if (require.main === module) main(process.argv.slice(2));
