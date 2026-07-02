#!/usr/bin/env node
// Stop hook: block "done" declarations on MEDIUM+ code tasks until a fresh
// judge_verdict:pass is logged in session-ledger.jsonl (elt-code Step 4).
// Anti-AMOS: per-project (copy like git-guardrails), self-contained (no
// require of repo files), real block (decision:block) not advisory text.
// Stop hooks use {decision,reason} on stdout, NOT exit-code/hookSpecificOutput
// (verified in this repo's AMOS history: audit/S4_hook_bugfixes/after-stop-verification.js).

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const GATED_COMPLEXITIES = new Set(['MEDIUM', 'BUG', 'ARCH', 'COMPLEX']);
const CLOSED_PHASES = new Set(['closed', 'shipped']);
const MAX_RETRIES = 3;
const TAIL_BYTES = 200000;
const STALE_MS = 24 * 60 * 60 * 1000;

// ponytail: closeout-intent heuristic, not exact intent-route match. Plain
// substring (no \b) for Cyrillic — JS \b is ASCII-\w-based and misfires on it.
const DONE_RE = /\bdone\b|\bcompleted\b|✅|готов|виконан|завершен|заверш[іи]н|можно закрывать|задач\w* закрыт|закрива[юєе]мо задач/i;

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/');
}

// Mirrors tools/pipeline-state.js projectKey() — must produce the same hash.
function projectKey(root) {
  const normalized = normalizePath(root).toLowerCase();
  const base = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  return `${base || 'project'}-${hash}`;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

// A task classified > STALE_MS ago is treated as abandoned, not current work.
// Without this, a months-old non-closed pipeline-state.json (e.g. a non-code
// course project) arms the gate on every future "done". Unparseable ts => not
// stale (keep the gate, don't silently disarm on bad data).
function isStale(tsIso) {
  const ts = Date.parse(tsIso);
  if (Number.isNaN(ts)) return false;
  return (Date.now() - ts) > STALE_MS;
}

function readTail(transcriptPath) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
  } catch {
    return '';
  }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    fs.closeSync(fd);
  }
}

function lastAssistantText(transcriptPath) {
  const lines = readTail(transcriptPath).split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let ev;
    try { ev = JSON.parse(lines[i]); } catch { continue; }
    if (ev && ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      return ev.message.content
        .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('\n');
    }
  }
  return '';
}

function hasFreshPassVerdict(ledgerPath, sinceIso) {
  let text;
  try {
    text = fs.readFileSync(ledgerPath, 'utf8');
  } catch {
    return false;
  }
  const since = Date.parse(sinceIso);
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let ev;
    try { ev = JSON.parse(s); } catch { continue; }
    if (!ev || ev.type !== 'judge_verdict' || ev.verdict !== 'pass') continue;
    const ts = Date.parse(ev.ts);
    if (!Number.isNaN(ts) && (Number.isNaN(since) || ts >= since)) return true;
  }
  return false;
}

// Proof the verdict came from an ISOLATED subagent, not an inline self-judge:
// the transcript must show a subagent turn (isSidechain:true, child-side) OR a
// Task tool_use that launched it (parent-side) timestamped at/after task
// classification. The model cannot forge sidechain events — only the harness
// writes them — so this is the trustworthy anchor the ledger line can't fake.
// ponytail: ANY sidechain since classification counts as judge evidence; if
// other subagents (Explore/Plan) start firing near closeout, tighten by
// matching the Task prompt for "судья/judge".
function hasIsolatedJudgeSince(transcriptPath, sinceIso) {
  const since = Date.parse(sinceIso);
  for (const line of readTail(transcriptPath).split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let ev;
    try { ev = JSON.parse(s); } catch { continue; }
    if (!ev) continue;
    const ts = Date.parse(ev.timestamp);
    if (!Number.isNaN(since) && !Number.isNaN(ts) && ts < since) continue;
    if (ev.isSidechain === true) return true;
    const content = ev.message && ev.message.content;
    if (Array.isArray(content) &&
        content.some((c) => c && c.type === 'tool_use' && c.name === 'Task')) {
      return true;
    }
  }
  return false;
}

function retryGatePath(cwd, sessionId) {
  const key = crypto.createHash('sha1').update(`${cwd}|${sessionId}`).digest('hex');
  return path.join(os.tmpdir(), 'claude-judge-gate', `${key}.json`);
}

function bumpRetry(file) {
  let state = { count: 0 };
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  state.count = (state.count || 0) + 1;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {}
  return state.count;
}

function allow() {
  process.exit(0);
}

function block(reason) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return allow();
  }

  const cwd = input && input.cwd ? input.cwd : process.cwd();
  const sessionId = (input && input.session_id) || 'unknown-session';
  const transcriptPath = input && input.transcript_path;

  const stateFile = path.join(os.homedir(), '.claude', 'projects', projectKey(cwd), 'pipeline-state.json');
  const state = readJson(stateFile);
  if (!state) return allow();
  if (!GATED_COMPLEXITIES.has(state.complexity)) return allow();
  if (CLOSED_PHASES.has(state.phase)) return allow();
  // ponytail: stale-task guard — a non-closed task older than 24h is a
  // forgotten mine, not the task you're finishing now. Ceiling: a single task
  // worked >24h in one sitting bypasses the gate; the per-slice /pipeline
  // re-stamp keeps state.ts fresh in the normal loop.
  if (isStale(state.ts)) return allow();

  if (!transcriptPath) return allow();
  const lastText = lastAssistantText(transcriptPath);
  if (!DONE_RE.test(lastText)) return allow();

  const ledgerPath = state.ledgerPath || path.join(os.homedir(), '.claude', 'projects', projectKey(cwd), 'session-ledger.jsonl');
  const hasVerdict = hasFreshPassVerdict(ledgerPath, state.ts);
  const isolated = hasIsolatedJudgeSince(transcriptPath, state.ts);
  if (hasVerdict && isolated) return allow();

  // ponytail: retry cap is the only safety valve against an infinite block
  // loop if detection itself is wrong; raise if judge subagent legitimately
  // needs >3 turns to land a verdict.
  const count = bumpRetry(retryGatePath(cwd, sessionId));
  if (count > MAX_RETRIES) {
    process.stderr.write(`judge-closeout-gate: ${MAX_RETRIES} blocks reached for this session, allowing stop without a verdict.\n`);
    return allow();
  }

  const logHint =
    `then log it via the central Pipeline Setupper CLI: ` +
    `node <pipeline-setupper>/tools/pipeline-state.js log-verdict --root "${cwd}" --json '<verdict JSON>' — do not hand-write the ledger line.`;

  if (hasVerdict && !isolated) {
    return block(
      `elt-code Step 4: a judge_verdict:pass is logged, but NO isolated subagent (Task/sidechain) ran since task ` +
      `classification (${state.ts}) — that verdict is an inline self-judge and does not count. Spawn the judge as a ` +
      `real Task subagent (sonnet/opus, fresh context: diff + spec only), re-run the H1/H2/H3 rubric, ${logHint}`
    );
  }

  return block(
    `elt-code Step 4: this is a ${state.complexity} code task and no fresh judge_verdict:pass is logged ` +
    `(session-ledger.jsonl, since ${state.ts}). Run the judge per the SKILL.md rubric (H1/H2/H3) as an ISOLATED ` +
    `subagent (sonnet/opus — never inline self-judge), ${logHint}`
  );
}

// Runnable check for the detection logic: `node judge-closeout-gate.js --self-check`.
function selfCheck() {
  const assert = require('assert');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-gate-sc-'));
  const tx = path.join(dir, 't.jsonl');
  const led = path.join(dir, 'l.jsonl');
  const since = '2026-06-25T12:00:00.000Z';
  const before = '2026-06-25T11:00:00.000Z';
  const after = '2026-06-25T12:05:00.000Z';
  const line = (o) => JSON.stringify(o);

  fs.writeFileSync(tx, line({ type: 'assistant', isSidechain: false, timestamp: after, message: { content: [{ type: 'text', text: 'inline self-judge pass' }] } }));
  assert.strictEqual(hasIsolatedJudgeSince(tx, since), false, 'inline-only must NOT count as isolated');

  fs.writeFileSync(tx, line({ type: 'assistant', isSidechain: true, timestamp: after, message: { content: [] } }));
  assert.strictEqual(hasIsolatedJudgeSince(tx, since), true, 'sidechain after classification must count');

  fs.writeFileSync(tx, line({ type: 'assistant', isSidechain: true, timestamp: before, message: { content: [] } }));
  assert.strictEqual(hasIsolatedJudgeSince(tx, since), false, 'sidechain BEFORE classification must not count');

  fs.writeFileSync(tx, line({ type: 'assistant', isSidechain: false, timestamp: after, message: { content: [{ type: 'tool_use', name: 'Task', input: {} }] } }));
  assert.strictEqual(hasIsolatedJudgeSince(tx, since), true, 'Task tool_use after classification must count');

  fs.writeFileSync(led, line({ type: 'judge_verdict', verdict: 'pass', ts: after }));
  assert.strictEqual(hasFreshPassVerdict(led, since), true, 'pass after since is fresh');
  fs.writeFileSync(led, line({ type: 'judge_verdict', verdict: 'pass', ts: before }));
  assert.strictEqual(hasFreshPassVerdict(led, since), false, 'pass before since is stale');
  fs.writeFileSync(led, line({ type: 'judge_verdict', verdict: 'block', ts: after }));
  assert.strictEqual(hasFreshPassVerdict(led, since), false, 'block is not a pass');

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  assert.strictEqual(isStale(hourAgo), false, 'task classified 1h ago is current');
  assert.strictEqual(isStale(weekAgo), true, 'task classified a week ago is a stale mine');
  assert.strictEqual(isStale('not-a-date'), false, 'unparseable ts keeps the gate');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('judge-closeout-gate self-check: ok');
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  main();
}
