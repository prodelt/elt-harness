#!/usr/bin/env node
'use strict';
// Gate experiment runner — bare vs judgeDiff (spec 021 T003).
//
// Why a SECOND runner file instead of finishing gradeSweBenchGate() inside runner.js:
// runner.js is hash-locked by preregistration.json and that lock is the entire integrity
// story of the writer results already in writer-results.jsonl. Editing it to add a grader
// would break its own hash-lock and retroactively unlock a finished experiment. This file
// carries its OWN lock against preregistration-gate.json, registered before its first
// result row, and reuses runner.js's primitives by require() rather than copy.
//
// What each hand actually does:
//   judgeDiff-gold / judgeDiff-broken — a REAL call to tools/judge-core.js judgeDiff(),
//     the same function ELT's own gate runs, on the SWE-bench patch as the diff and the
//     instance's problem_statement as the task text. No adaptation of judge-core was
//     needed: judgePrompt() reads nothing from disk and `status` is a parameter, so the
//     only cwd dependency left is the provider's working directory and checkGrounding's
//     existence fallback for paths NOT in the diff. The README's earlier claim that
//     judge-core "reads real git status" was wrong about the code.
//   bare-gold / bare-broken — ANALYTIC, not measured, and deliberately so. "bare" means
//     "no gate", and a pipeline with no gate ships whatever the writer produced: its
//     decision is `accept` on every patch by definition, not by observation. Calling a
//     model to confirm that would be theatre. This is recorded per row as
//     `analytic: true` so no reader can mistake it for a measurement.
//
// What is therefore NOT measured (and must not be claimed): whether each patch actually
// passes the instance's FAIL_TO_PASS tests. That needs a per-instance SWE-bench docker
// environment which does not exist here. The endpoint below is gate DISCRIMINATION
// (does the judge's verdict match the patch's known construction), not end-to-end resolve
// rate. See preregistration-gate.json.deviationsFromFrozenRegistration.

const fs = require('fs');
const path = require('path');
const os = require('os');

const { sha256, classifyFailure, appendResultRow, readResultRows } = require('./runner.js');

const GATE_HANDS = {
  'bare-gold': { judge: 'none', patch: 'goldPatch', expect: 'accept' },
  'bare-broken': { judge: 'none', patch: 'brokenPatch', expect: 'reject' },
  'judgeDiff-gold': { judge: 'judge-core', patch: 'goldPatch', expect: 'accept' },
  'judgeDiff-broken': { judge: 'judge-core', patch: 'brokenPatch', expect: 'reject' },
};

// git status --porcelain, synthesized from the patch itself. judge-core derives the file
// list, the harness-owned list and the grounding check from this string, so it has to be
// the real file set of the diff — deriving it from the diff (rather than from a git repo
// we do not have) is what makes an external patch judgeable at all.
function patchStatusPorcelain(patch) {
  const files = [];
  for (const line of String(patch || '').split(/\r?\n/)) {
    const m = line.match(/^diff --git a\/(.*?) b\/(.*)$/);
    if (m) files.push(m[2].trim());
  }
  const seen = new Set();
  return files
    .filter((rel) => rel && !seen.has(rel) && seen.add(rel))
    .map((rel) => ` M ${rel}`)
    .join('\n');
}

// ELT's own semantics, not a stricter benchmark-only reading: `block` stops the commit,
// while BOTH `pass` and `inconclusive` let the slice land (inconclusive commits with a
// review-queue row — see skills/elt/SKILL.md "Вердикты"). Scoring inconclusive as a
// rejection here would credit the gate for catching something it in fact lets through.
function decisionFromVerdict(verdict) {
  return verdict === 'block' ? 'reject' : 'accept';
}

async function defaultJudge({ cwd, tid, taskText, diff, status, model, timeoutMs }) {
  const { judgeDiffRetryNoReasons } = require('../../tools/judge-core.js');
  return judgeDiffRetryNoReasons({ cwd, tid, taskText, diff, status, provider: 'agy', model, timeoutMs });
}

// One (instance, hand) cell. Returns an immutable row; never writes to the log itself.
async function runGateItem({ row, hand, model, workRoot, judge = defaultJudge, retryMax = 1, timeoutMs }) {
  const spec = GATE_HANDS[hand];
  if (!spec) throw new Error(`gate-runner: unknown hand '${hand}', expected one of ${Object.keys(GATE_HANDS).join(', ')}`);
  const patch = row[spec.patch];
  const base = { id: row.id, hand, repo: row.repo, patchKind: spec.patch, expect: spec.expect, patchSha256: sha256(patch) };

  if (spec.judge === 'none') {
    // No call, no randomness, no cost — and no pretence that this was observed.
    return { ...base, attempt: 0, analytic: true, decision: 'accept', verdict: null, outcome: spec.expect === 'accept' ? 'pass' : 'fail' };
  }

  const workDir = path.join(workRoot, `${hand}-${row.id}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  // The patch on disk is the guard artifact: the judge runs readOnly and must not be able
  // to alter the very diff it is judging. Same anti-tamper contract as the writer arm.
  const guardPath = path.join(workDir, 'candidate.patch');
  fs.writeFileSync(guardPath, patch, 'utf8');
  const guardBefore = sha256(fs.readFileSync(guardPath, 'utf8'));

  const status = patchStatusPorcelain(patch);
  let attempt = 0;
  let verdictResult;
  for (;;) {
    attempt += 1;
    verdictResult = await judge({ cwd: workDir, tid: row.id, taskText: row.problemStatement, diff: patch, status, model, timeoutMs });
    if (verdictResult.runOk) break;
    if (attempt > retryMax) break;
    if (classifyFailure(verdictResult.reason) !== 'transport') break;
  }

  const guardAfter = fs.existsSync(guardPath) ? sha256(fs.readFileSync(guardPath, 'utf8')) : null;
  if (guardBefore !== guardAfter) return { ...base, attempt, outcome: 'invalid', reason: 'guard-tampered' };

  if (!verdictResult.runOk) {
    const cls = classifyFailure(verdictResult.reason);
    return { ...base, attempt, outcome: cls === 'transport' ? 'transport-failure' : 'agent-error', reason: verdictResult.reason };
  }

  const decision = decisionFromVerdict(verdictResult.verdict);
  return {
    ...base,
    attempt,
    analytic: false,
    verdict: verdictResult.verdict,
    decision,
    reasons: (verdictResult.reasons || []).slice(0, 6),
    durationSec: verdictResult.durationSec,
    outcome: decision === spec.expect ? 'pass' : 'fail',
  };
}

const TERMINAL_OUTCOMES = new Set(['pass', 'fail', 'invalid']);

function pendingRows(items, hand, rows) {
  const done = new Set(rows.filter((r) => r.hand === hand && TERMINAL_OUTCOMES.has(r.outcome)).map((r) => r.id));
  return items.filter((row) => !done.has(row.id));
}

function verifyGateRunnerHash(preregPath = path.join(__dirname, 'preregistration-gate.json')) {
  const prereg = JSON.parse(fs.readFileSync(preregPath, 'utf8'));
  const actual = sha256(fs.readFileSync(__filename, 'utf8'));
  return { ok: actual === prereg.runner.sha256, expected: prereg.runner.sha256, actual };
}

function parseArgs(argv) {
  const out = { retryMax: 1, workRoot: path.join(os.tmpdir(), 'elt-bench-gate') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dataset') out.dataset = argv[++i];
    else if (a === '--hand') out.hand = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--retry-max') out.retryMax = Number(argv[++i]);
    else if (a === '--work-root') out.workRoot = argv[++i];
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i]);
    else return { error: `unknown flag: ${a}` };
  }
  if (!out.dataset || !out.hand || !out.out) return { error: '--dataset, --hand и --out обязательны' };
  if (!GATE_HANDS[out.hand]) return { error: `--hand должен быть одним из ${Object.keys(GATE_HANDS).join(', ')}` };
  return out;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`elt-gate-runner: ${args.error}`);
    process.exitCode = 2;
    return;
  }
  const hashCheck = verifyGateRunnerHash();
  if (!hashCheck.ok) {
    console.error(`elt-gate-runner: HASH-LOCK MISMATCH — gate-runner.js изменился после preregistration (ожидался ${hashCheck.expected}, реально ${hashCheck.actual}).`);
    process.exitCode = 3;
    return;
  }
  const dataset = JSON.parse(fs.readFileSync(args.dataset, 'utf8'));
  if (dataset.kind !== 'swebench-gate') {
    console.error(`elt-gate-runner: датасет kind='${dataset.kind}', ожидался 'swebench-gate'`);
    process.exitCode = 2;
    return;
  }
  const rows = readResultRows(args.out);
  const pending = pendingRows(dataset.items, args.hand, rows);
  console.log(`elt-gate-runner: hand=${args.hand} — ${pending.length}/${dataset.items.length} pending`);
  for (const row of pending) {
    const result = await runGateItem({ row, hand: args.hand, model: args.model, workRoot: args.workRoot, retryMax: args.retryMax, timeoutMs: args.timeoutMs });
    appendResultRow(args.out, { ts: new Date().toISOString(), datasetSha256: dataset.datasetSha256, ...result });
    console.log(`  ${row.id}: ${result.outcome} (verdict=${result.verdict || 'n/a'})`);
  }
}

module.exports = {
  GATE_HANDS, patchStatusPorcelain, decisionFromVerdict, runGateItem, pendingRows,
  verifyGateRunnerHash, parseArgs, defaultJudge,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('elt-gate-runner FATAL:', err.message);
    process.exitCode = 1;
  });
}
