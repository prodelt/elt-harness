#!/usr/bin/env node
'use strict';
// Gemini-only benchmark runner (spec 021 T002). Executes one dataset item under one
// "hand" (plain/elt for the writer experiment, bare/judgeDiff for the gate experiment),
// appends exactly one immutable row per (item, hand) to a JSONL raw log, and never
// mutates a row once written — resume-safety comes from skipping ids already present
// in the log, not from rewriting it. Pure helpers here are shared (require()'d, not
// copy-pasted) by build-gate-dataset.js and summarize.js.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

// Deterministic PRNG (mulberry32) seeded from an arbitrary string. Same seed -> same
// sequence, so dataset selection is reproducible from the locked preregistration seed
// without ever calling Math.random().
function seededRandom(seedStr) {
  let seed = crypto.createHash('sha256').update(String(seedStr), 'utf8').digest().readUInt32LE(0);
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(items, seedStr) {
  const rand = seededRandom(seedStr);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Wilson score interval: stable at the small n a benchmark pilot actually has, unlike
// the naive p +/- z*sqrt(p(1-p)/n) approximation which can leave [0,1] near p=0 or p=1.
function wilsonInterval(successes, n, z = 1.96) {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (center - margin) / denom), hi: Math.min(1, (center + margin) / denom) };
}

// Retry policy (locked in preregistration.protocol.retryPolicy): only a transport
// failure — the agent never started, or the network/CLI died before answering — may be
// retried. A content failure (agent answered, grader disagreed) is retried in NEITHER
// hand, or the comparison would be contaminated by unequal attempt budgets.
const TRANSPORT_REASON_PATTERNS = [
  /timeout/i, /ECONNRESET/i, /ENOTFOUND/i, /EAI_AGAIN/i, /socket hang up/i,
  /unknown-provider/i, /spawn.*ENOENT/i, /ENAMETOOLONG/i,
];

function classifyFailure(reason) {
  const text = String(reason || '');
  return TRANSPORT_REASON_PATTERNS.some((re) => re.test(text)) ? 'transport' : 'content';
}

function appendResultRow(logPath, row) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(row) + '\n', 'utf8');
}

function readResultRows(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// resume-safe: (id, hand) pairs already terminal (pass/fail/invalid) in the log are
// skipped on the next invocation. transport-failure rows are NOT terminal — a resumed
// run retries them, which is the whole point of "transport-only retry" surviving a
// killed process, not just a killed single call.
const TERMINAL_OUTCOMES = new Set(['pass', 'fail', 'invalid']);

function pendingItems(items, hand, rows) {
  const done = new Set(
    rows.filter((r) => r.hand === hand && TERMINAL_OUTCOMES.has(r.outcome)).map((r) => r.id)
  );
  return items.filter((item) => !done.has(item.id));
}

// Real agent call — injectable so tests never spawn a live process. providers.js
// already carries the hard-won agy invocation contract (argv prompt, --add-dir,
// --print-timeout, no shell) — reused here rather than re-derived.
async function defaultExecAgent({ prompt, cwd, model }) {
  const { run } = require('../../tools/providers.js');
  return run({ provider: 'agy', prompt, cwd, model, readOnly: false });
}

// runOneTask: materializes an isolated workdir for `item`, calls the agent, restores
// nothing by itself (item.materialize is responsible for laying out exactly what the
// agent should see), then verifies the held-out guard artifact (grader test file for
// the writer experiment, gold patch for the gate experiment) is byte-identical to
// before the call — anti-leak / anti-tamper. Grading is delegated to `grade`, which
// differs by experiment (pytest exit code vs judge verdict + SWE-bench test run).
async function runOneTask({ item, hand, model, workRoot, execAgent = defaultExecAgent, grade, retryMax = 1 }) {
  const workDir = path.join(workRoot, `${hand}-${item.id}`);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  item.materialize(workDir, hand);

  const guardPath = item.guardPath ? path.join(workDir, item.guardPath) : null;
  const guardBefore = guardPath && fs.existsSync(guardPath) ? sha256(fs.readFileSync(guardPath, 'utf8')) : null;

  let attempt = 0;
  let agentResult;
  for (;;) {
    attempt += 1;
    agentResult = await execAgent({ prompt: item.prompt(hand), cwd: workDir, model });
    if (agentResult.ok) break;
    if (attempt > retryMax) break;
    if (classifyFailure(agentResult.reason) !== 'transport') break;
  }

  const guardAfter = guardPath && fs.existsSync(guardPath) ? sha256(fs.readFileSync(guardPath, 'utf8')) : null;
  if (guardPath && guardBefore !== null && guardBefore !== guardAfter) {
    return { id: item.id, hand, attempt, outcome: 'invalid', reason: 'guard-tampered' };
  }
  if (!agentResult.ok) {
    const cls = classifyFailure(agentResult.reason);
    return { id: item.id, hand, attempt, outcome: cls === 'transport' ? 'transport-failure' : 'agent-error', reason: agentResult.reason };
  }

  const graded = await grade({ workDir, item, hand });
  return { id: item.id, hand, attempt, outcome: graded.pass ? 'pass' : 'fail', graderDetail: graded.detail };
}

function parseArgs(argv) {
  const out = { retryMax: 1, workRoot: path.join(require('os').tmpdir(), 'elt-bench-run') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dataset') out.dataset = argv[++i];
    else if (a === '--hand') out.hand = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--model') out.model = argv[++i];
    else if (a === '--retry-max') out.retryMax = Number(argv[++i]);
    else if (a === '--work-root') out.workRoot = argv[++i];
    else return { error: `unknown flag: ${a}` };
  }
  if (!out.dataset || !out.hand || !out.out) return { error: '--dataset, --hand и --out обязательны' };
  return out;
}

// Builds the item interface (materialize/prompt/guardPath) for one dataset row,
// dispatched by dataset.kind — kept here (not in build-gate-dataset.js) so runner.js
// is the single place that knows how an item turns into a real agent call.
function itemFromDatasetRow(row, kind) {
  if (kind === 'polyglot-writer') {
    return {
      id: row.id,
      guardPath: row.testFile,
      materialize(workDir) {
        fs.mkdirSync(workDir, { recursive: true });
        fs.writeFileSync(path.join(workDir, row.file), row.stub, 'utf8');
        fs.writeFileSync(path.join(workDir, row.testFile), row.test, 'utf8');
      },
      prompt(hand) {
        const base = `Реализуй ${row.file} так, чтобы прошли тесты в ${row.testFile}. Не трогай ${row.testFile}. Верни только итоговое содержимое ${row.file}.`;
        return hand === 'elt' ? `${base}\n\n(рука elt: гейт запускается ПОСЛЕ этого ответа, поверх того же кода — промпт идентичен руке plain)` : base;
      },
    };
  }
  if (kind === 'swebench-gate') {
    return {
      id: row.id,
      guardPath: null,
      materialize(workDir, hand) {
        fs.mkdirSync(workDir, { recursive: true });
        const patch = hand === 'judgeDiff-bad' || hand === 'bad' ? row.brokenPatch : row.goldPatch;
        fs.writeFileSync(path.join(workDir, 'candidate.patch'), patch, 'utf8');
        fs.writeFileSync(path.join(workDir, 'meta.json'), JSON.stringify({ repo: row.repo, baseCommit: row.baseCommit }), 'utf8');
      },
      prompt() {
        return `judge review only — no generation for the gate experiment`;
      },
    };
  }
  throw new Error(`unknown dataset kind: ${kind}`);
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.error) {
    console.error(`elt-bench-runner: ${args.error}`);
    process.exitCode = 2;
    return;
  }
  const dataset = JSON.parse(fs.readFileSync(args.dataset, 'utf8'));
  const rows = readResultRows(args.out);
  const items = dataset.items.map((row) => itemFromDatasetRow(row, dataset.kind));
  const pending = pendingItems(items, args.hand, rows);
  console.log(`elt-bench-runner: ${dataset.kind} hand=${args.hand} — ${pending.length}/${items.length} pending`);
  for (const item of pending) {
    const result = await runOneTask({ item, hand: args.hand, model: args.model, workRoot: args.workRoot, retryMax: args.retryMax });
    appendResultRow(args.out, { ts: new Date().toISOString(), ...result });
    console.log(`  ${item.id}: ${result.outcome}`);
  }
}

module.exports = {
  sha256, seededRandom, seededShuffle, wilsonInterval, classifyFailure,
  appendResultRow, readResultRows, pendingItems, runOneTask, defaultExecAgent,
  itemFromDatasetRow, parseArgs,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error('elt-bench-runner FATAL:', err.message);
    process.exitCode = 1;
  });
}
