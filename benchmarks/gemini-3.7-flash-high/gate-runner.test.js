'use strict';
// Discriminating regressions for the gate experiment (spec 021 T003). No test here calls
// a live judge — `judge` is always injected — so the suite is safe inside the mechanical
// oracle. The one thing that DOES call a live model is the T003 run itself.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gate = require('./gate-runner.js');
const gateSummarize = require('./gate-summarize.js');
const datasetLib = require('./build-gate-dataset.js');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const TWO_HUNK_PATCH = [
  'diff --git a/pkg/mod.py b/pkg/mod.py',
  '--- a/pkg/mod.py',
  '+++ b/pkg/mod.py',
  '@@ -1,3 +1,4 @@',
  ' def a():',
  '+    return 1',
  '@@ -10,3 +11,4 @@',
  ' def b():',
  '+    return 2',
  '',
].join('\n');

function fixtureRow(overrides = {}) {
  return {
    id: 'demo__repo-1',
    repo: 'demo/repo',
    problemStatement: 'a() and b() must return 1 and 2',
    goldPatch: TWO_HUNK_PATCH,
    brokenPatch: datasetLib.stripLastHunk(TWO_HUNK_PATCH),
    ...overrides,
  };
}

// --- patchStatusPorcelain ---

test('patchStatusPorcelain: derives the diff file list from the patch alone', () => {
  const status = gate.patchStatusPorcelain(TWO_HUNK_PATCH);
  assert.equal(status, ' M pkg/mod.py');
});

test('patchStatusPorcelain: multiple files, deduplicated, in patch order', () => {
  const patch = [
    'diff --git a/x.py b/x.py', '@@ -1 +1 @@', '-a', '+b',
    'diff --git a/y.py b/y.py', '@@ -1 +1 @@', '-c', '+d',
    'diff --git a/x.py b/x.py', '@@ -5 +5 @@', '-e', '+f',
  ].join('\n');
  assert.equal(gate.patchStatusPorcelain(patch), ' M x.py\n M y.py');
});

test('patchStatusPorcelain: status is parseable by judge-core diffFileList (the real consumer)', () => {
  const { diffFileList } = require('../../tools/judge-core.js');
  const status = gate.patchStatusPorcelain(TWO_HUNK_PATCH);
  assert.deepEqual(diffFileList(status), ['pkg/mod.py']);
});

test('patchStatusPorcelain: empty patch -> empty status, not a crash', () => {
  assert.equal(gate.patchStatusPorcelain(''), '');
  assert.equal(gate.patchStatusPorcelain(null), '');
});

// --- decisionFromVerdict: the ELT semantics, not a stricter benchmark-only reading ---

test('decisionFromVerdict: only block stops a patch; pass AND inconclusive ship it', () => {
  assert.equal(gate.decisionFromVerdict('block'), 'reject');
  assert.equal(gate.decisionFromVerdict('pass'), 'accept');
  // The discriminating one: ELT commits an inconclusive slice with a review-queue row.
  // Scoring it as a rejection would credit the gate for a catch it does not make.
  assert.equal(gate.decisionFromVerdict('inconclusive'), 'accept');
});

// --- bare arm is analytic, and says so ---

test('bare-broken: analytic accept -> fail, and never calls a judge', async () => {
  let called = 0;
  const row = fixtureRow();
  const r = await gate.runGateItem({
    row, hand: 'bare-broken', workRoot: tmpDir('gate-bare-'),
    judge: async () => { called += 1; return { runOk: true, verdict: 'block', reasons: ['x'] }; },
  });
  assert.equal(called, 0, 'bare arm must not spend a model call');
  assert.equal(r.analytic, true);
  assert.equal(r.decision, 'accept');
  assert.equal(r.outcome, 'fail', 'a broken patch shipped by a gateless pipeline is a miss');
});

test('bare-gold: analytic accept -> pass', async () => {
  const r = await gate.runGateItem({ row: fixtureRow(), hand: 'bare-gold', workRoot: tmpDir('gate-bare-') });
  assert.equal(r.outcome, 'pass');
  assert.equal(r.analytic, true);
});

// --- judgeDiff arm scoring ---

test('judgeDiff-gold: judge pass -> outcome pass; judge block -> outcome fail', async () => {
  const row = fixtureRow();
  const work = tmpDir('gate-jd-');
  const passing = await gate.runGateItem({ row, hand: 'judgeDiff-gold', workRoot: work, judge: async () => ({ runOk: true, verdict: 'pass', reasons: ['ok'], durationSec: 1 }) });
  assert.equal(passing.outcome, 'pass');
  const blocking = await gate.runGateItem({ row, hand: 'judgeDiff-gold', workRoot: work, judge: async () => ({ runOk: true, verdict: 'block', reasons: ['no'], durationSec: 1 }) });
  assert.equal(blocking.outcome, 'fail', 'blocking a correct patch is a false positive, not a win');
});

test('judgeDiff: the judge is given the problem statement as task text and the patch as diff', async () => {
  const row = fixtureRow();
  let seen = null;
  await gate.runGateItem({ row, hand: 'judgeDiff-broken', workRoot: tmpDir('gate-jd-'), judge: async (args) => { seen = args; return { runOk: true, verdict: 'block', reasons: ['r'] }; } });
  assert.equal(seen.taskText, row.problemStatement, 'without the task text the judge would be measuring REJECT-default, not the gate');
  assert.equal(seen.diff, row.brokenPatch);
  assert.equal(seen.status, ' M pkg/mod.py');
  assert.equal(seen.tid, row.id);
});

test('judgeDiff: guard-tamper — a judge that rewrites the patch it judges is invalid, not graded', async () => {
  const row = fixtureRow();
  const r = await gate.runGateItem({
    row, hand: 'judgeDiff-gold', workRoot: tmpDir('gate-jd-'),
    judge: async ({ cwd }) => {
      fs.writeFileSync(path.join(cwd, 'candidate.patch'), 'tampered', 'utf8');
      return { runOk: true, verdict: 'pass', reasons: ['ok'] };
    },
  });
  assert.equal(r.outcome, 'invalid');
  assert.equal(r.reason, 'guard-tampered');
});

test('judgeDiff: transport failure is retried, content failure is not', async () => {
  const row = fixtureRow();
  let calls = 0;
  const transport = await gate.runGateItem({
    row, hand: 'judgeDiff-gold', workRoot: tmpDir('gate-jd-'), retryMax: 1,
    judge: async () => { calls += 1; return { runOk: false, reason: 'timeout after 480s' }; },
  });
  assert.equal(calls, 2, 'transport failure gets exactly retryMax extra attempts');
  assert.equal(transport.outcome, 'transport-failure');

  calls = 0;
  const content = await gate.runGateItem({
    row, hand: 'judgeDiff-gold', workRoot: tmpDir('gate-jd-'), retryMax: 1,
    judge: async () => { calls += 1; return { runOk: false, reason: 'nonzero exit: judge refused' }; },
  });
  assert.equal(calls, 1, 'a content failure must not be retried — unequal attempt budgets contaminate the comparison');
  assert.equal(content.outcome, 'agent-error');
});

test('runGateItem: unknown hand throws instead of silently grading the wrong patch', async () => {
  await assert.rejects(
    () => gate.runGateItem({ row: fixtureRow(), hand: 'judgeDiff', workRoot: tmpDir('gate-jd-') }),
    /unknown hand/
  );
});

// --- resume safety ---

test('pendingRows: terminal rows are skipped, transport-failure rows are retried', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const rows = [
    { id: 'a', hand: 'judgeDiff-gold', outcome: 'pass' },
    { id: 'b', hand: 'judgeDiff-gold', outcome: 'transport-failure' },
    { id: 'c', hand: 'judgeDiff-broken', outcome: 'pass' },
  ];
  assert.deepEqual(gate.pendingRows(items, 'judgeDiff-gold', rows).map((i) => i.id), ['b', 'c']);
});

// --- hash lock ---

test('verifyGateRunnerHash: mismatch is reported, not ignored', () => {
  const dir = tmpDir('gate-prereg-');
  const p = path.join(dir, 'prereg.json');
  fs.writeFileSync(p, JSON.stringify({ runner: { sha256: 'deadbeef' } }), 'utf8');
  const r = gate.verifyGateRunnerHash(p);
  assert.equal(r.ok, false);
  assert.equal(r.expected, 'deadbeef');
  assert.match(r.actual, /^[0-9a-f]{64}$/);
});

test('verifyGateRunnerHash: the committed preregistration-gate.json matches gate-runner.js on disk', () => {
  const r = gate.verifyGateRunnerHash();
  assert.equal(r.ok, true, `hash-lock разошёлся: ожидался ${r.expected}, реально ${r.actual}`);
});

// --- dataset eligibility: the reason 9/30 negatives used to be free wins ---

test('selectSweBenchInstances: single-hunk instances are excluded — an empty negative is a free reject', () => {
  const oneHunk = ['diff --git a/z.py b/z.py', '@@ -1 +1 @@', '-a', '+b', ''].join('\n');
  const instances = [
    { instance_id: 'r__one-1', repo: 'r/one', base_commit: 'c1', patch: oneHunk, problem_statement: 'p' },
    { instance_id: 'r__two-1', repo: 'r/two', base_commit: 'c2', patch: TWO_HUNK_PATCH, problem_statement: 'p' },
  ];
  assert.equal(datasetLib.stripLastHunk(oneHunk).trim(), '', 'fixture precondition: this patch degenerates to empty');
  const picked = datasetLib.selectSweBenchInstances({ instances, count: 1, seed: 's' });
  assert.deepEqual(picked.map((p) => p.id), ['r__two-1']);
  assert.ok(picked[0].brokenPatch.trim(), 'every selected negative must still look like a candidate fix');
});

test('selectSweBenchInstances: instances without a problem statement are excluded', () => {
  const instances = [
    { instance_id: 'r__a-1', repo: 'r/a', base_commit: 'c', patch: TWO_HUNK_PATCH },
    { instance_id: 'r__b-1', repo: 'r/b', base_commit: 'c', patch: TWO_HUNK_PATCH, problem_statement: 'p' },
  ];
  const picked = datasetLib.selectSweBenchInstances({ instances, count: 1, seed: 's' });
  assert.deepEqual(picked.map((p) => p.id), ['r__b-1']);
});

test('selectSweBenchInstances: carries the problem statement and its hash into the dataset', () => {
  const instances = [{ instance_id: 'r__b-1', repo: 'r/b', base_commit: 'c', patch: TWO_HUNK_PATCH, problem_statement: 'the statement' }];
  const [picked] = datasetLib.selectSweBenchInstances({ instances, count: 1, seed: 's' });
  assert.equal(picked.problemStatement, 'the statement');
  assert.equal(picked.problemStatementSha256, require('./runner.js').sha256('the statement'));
});

// --- summary math ---

function gateRows({ jdGoldCorrect, jdBrokenCorrect, n }) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const id = `i${i}`;
    rows.push({ id, hand: 'bare-gold', analytic: true, outcome: 'pass' });
    rows.push({ id, hand: 'bare-broken', analytic: true, outcome: 'fail' });
    rows.push({ id, hand: 'judgeDiff-gold', analytic: false, verdict: i < jdGoldCorrect ? 'pass' : 'block', outcome: i < jdGoldCorrect ? 'pass' : 'fail' });
    rows.push({ id, hand: 'judgeDiff-broken', analytic: false, verdict: i < jdBrokenCorrect ? 'block' : 'pass', outcome: i < jdBrokenCorrect ? 'pass' : 'fail' });
  }
  return rows;
}

test('summarizeGate: bare accuracy is exactly 50% by construction, and marked analytic', () => {
  const dataset = { kind: 'swebench-gate', datasetSha256: 'd', items: Array.from({ length: 10 }, (_, i) => ({ id: `i${i}` })) };
  const s = gateSummarize.summarizeGate({ dataset, rows: gateRows({ jdGoldCorrect: 10, jdBrokenCorrect: 10, n: 10 }) });
  assert.equal(s.arms.bare.accuracy, 0.5);
  assert.equal(s.arms.bare.analytic, true);
  assert.equal(s.arms.judgeDiff.accuracy, 1);
  assert.equal(s.delta, 0.5);
});

test('summarizeGate: a judge that blocks EVERYTHING does not score above bare', () => {
  const dataset = { kind: 'swebench-gate', datasetSha256: 'd', items: Array.from({ length: 10 }, (_, i) => ({ id: `i${i}` })) };
  // blocks everything => 0/10 on gold, 10/10 on broken => 10/20 combined = 50%, same as bare.
  const s = gateSummarize.summarizeGate({ dataset, rows: gateRows({ jdGoldCorrect: 0, jdBrokenCorrect: 10, n: 10 }) });
  assert.equal(s.arms.judgeDiff.accuracy, 0.5);
  assert.equal(s.delta, 0, 'the combined endpoint is what makes a reject-everything gate worthless on paper too');
});

test('summarizeGate: claimEligible only when every judgeDiff cell is terminal', () => {
  const dataset = { kind: 'swebench-gate', datasetSha256: 'd', items: Array.from({ length: 3 }, (_, i) => ({ id: `i${i}` })) };
  const full = gateRows({ jdGoldCorrect: 3, jdBrokenCorrect: 3, n: 3 });
  assert.equal(gateSummarize.summarizeGate({ dataset, rows: full }).claimEligible, true);
  const missing = full.filter((r) => !(r.hand === 'judgeDiff-broken' && r.id === 'i2'));
  const s = gateSummarize.summarizeGate({ dataset, rows: missing });
  assert.equal(s.claimEligible, false, 'the analytic arm must not be able to vote completeness true on its own');
  assert.match(s.claimEligibleReason, /неполна/);
});

test('summarizeGate: invalid rows are terminal but never counted as correct', () => {
  const dataset = { kind: 'swebench-gate', datasetSha256: 'd', items: [{ id: 'i0' }] };
  const rows = [
    { id: 'i0', hand: 'bare-gold', analytic: true, outcome: 'pass' },
    { id: 'i0', hand: 'bare-broken', analytic: true, outcome: 'fail' },
    { id: 'i0', hand: 'judgeDiff-gold', analytic: false, outcome: 'invalid' },
    { id: 'i0', hand: 'judgeDiff-broken', analytic: false, verdict: 'block', outcome: 'pass' },
  ];
  const s = gateSummarize.summarizeGate({ dataset, rows });
  assert.equal(s.arms.judgeDiff.invalid, 1);
  assert.equal(s.arms.judgeDiff.graded, 1);
  assert.equal(s.arms.judgeDiff.correct, 1);
  assert.equal(s.claimEligible, false, 'an invalid cell is terminal but leaves the arm ungraded on that cell');
});

test('failureModes: fail-open and false-block are counted apart, not merged', () => {
  const rows = [
    // broken accepted twice -> two fail-opens; broken blocked once -> a catch
    { id: 'a', hand: 'judgeDiff-broken', verdict: 'pass', outcome: 'fail', attempt: 1, durationSec: 10 },
    { id: 'b', hand: 'judgeDiff-broken', verdict: 'inconclusive', outcome: 'fail', attempt: 1, durationSec: 20 },
    { id: 'c', hand: 'judgeDiff-broken', verdict: 'block', outcome: 'pass', attempt: 1, durationSec: 30 },
    // gold blocked once -> one false-block
    { id: 'a', hand: 'judgeDiff-gold', verdict: 'block', outcome: 'fail', attempt: 2, durationSec: 40 },
    { id: 'b', hand: 'judgeDiff-gold', verdict: 'pass', outcome: 'pass', attempt: 1, durationSec: 50 },
  ];
  const f = gateSummarize.failureModes(rows);
  assert.equal(f.failOpen, 2);
  assert.equal(f.failOpenOf, 3);
  assert.equal(f.falseBlock, 1);
  assert.equal(f.falseBlockOf, 2);
  assert.equal(f.modelCalls, 6, 'attempts, not rows — a retried cell cost two calls');
  assert.equal(f.latencySec.p50, 30);
  assert.equal(f.verdictMix.pass, 2);
  assert.equal(f.verdictMix.inconclusive, 1);
});

test('percentile: empty input is null, not 0 — a missing latency is not a fast one', () => {
  assert.equal(gateSummarize.percentile([], 50), null);
  assert.equal(gateSummarize.percentile([5], 90), 5);
  assert.equal(gateSummarize.percentile([1, 2, 3, 4], 50), 2);
});

async function main() {
  console.log('gemini-3.7-flash-high/gate-runner.test.js');
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed += 1;
    } catch (err) {
      console.log(`  FAIL: ${name}\n    ${err.message}`);
      failed += 1;
    }
  }
  console.log(`\ngate-runner.test.js: ${tests.length} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
