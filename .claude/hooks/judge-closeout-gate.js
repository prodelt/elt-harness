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

function lastAssistantText(transcriptPath) {
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
  } catch {
    return '';
  }
  let text = '';
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    text = buf.toString('utf8');
  } catch {
    text = '';
  } finally {
    fs.closeSync(fd);
  }

  const lines = text.split('\n').filter(Boolean);
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

  if (!transcriptPath) return allow();
  const lastText = lastAssistantText(transcriptPath);
  if (!DONE_RE.test(lastText)) return allow();

  const ledgerPath = state.ledgerPath || path.join(os.homedir(), '.claude', 'projects', projectKey(cwd), 'session-ledger.jsonl');
  if (hasFreshPassVerdict(ledgerPath, state.ts)) return allow();

  // ponytail: retry cap is the only safety valve against an infinite block
  // loop if detection itself is wrong; raise if judge subagent legitimately
  // needs >3 turns to land a verdict.
  const count = bumpRetry(retryGatePath(cwd, sessionId));
  if (count > MAX_RETRIES) {
    process.stderr.write(`judge-closeout-gate: ${MAX_RETRIES} blocks reached for this session, allowing stop without a verdict.\n`);
    return allow();
  }

  return block(
    `elt-code Step 4: this is a ${state.complexity} code task and no fresh judge_verdict:pass is logged ` +
    `(session-ledger.jsonl, since ${state.ts}). Run the judge per the SKILL.md rubric (H1/H2/H3), then log it with: ` +
    `node tools/pipeline-state.js log-verdict --root "${cwd}" --json '<verdict JSON>' — do not hand-write the ledger line.`
  );
}

main();
