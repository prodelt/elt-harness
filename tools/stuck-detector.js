#!/usr/bin/env node
'use strict';

/**
 * UserPromptSubmit hook: nudge when N oracle failures pile up in a row.
 *
 * Signal is the project's own `.harness/run-log.jsonl` — elt.js appends a
 * `red-stop` entry whenever `elt oracle` OR `elt commit` hits a red oracle
 * (before this, red runs left no trace, so a stuck loop was invisible).
 * A trailing run of `red-stop` entries, uninterrupted by a real commit, is
 * the streak.
 *
 * Dropped: a transcript-text fallback that scanned for "elt oracle: exit N"
 * lines. Caught live during T005/T014 dogfood — this project's own oracle
 * test suite intentionally spawns a failing oracle as a fixture, which
 * printed matching text into the transcript and produced a false "stuck"
 * nudge with zero real red-stops in run-log. Same lesson as T002: prefer
 * the structured signal over parsing free text.
 *
 * Standalone: stdlib only, no AMOS deps. Never blocks; always exits 0.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const THRESHOLD = 3;

function readStdin() { try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return {}; } }

function emit(msg) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: msg }
  }));
}

// Trailing run of red-stop entries at the tail of run-log.jsonl. Any entry
// carrying a real `commit` (a green `elt commit`) breaks the streak.
function runLogStreak(runLogPath) {
  let lines;
  try { lines = fs.readFileSync(runLogPath, 'utf8').trim().split('\n').filter(Boolean); }
  catch (_) { return 0; }
  let n = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let e; try { e = JSON.parse(lines[i]); } catch (_) { continue; }
    if (e.status === 'red-stop') { n++; continue; }
    break;
  }
  return n;
}

function buildNudge(streak) {
  if (streak < THRESHOLD) return null;
  return `Застрял ${streak} попыток подряд (красный оракул) — попробуй /effort max + /diagnose вместо ещё одной попытки на том же уровне.`;
}

const stateFile = path.join(os.tmpdir(), 'claude-stuck-detector.json');

function main() {
  const inp = readStdin();
  const sid = inp.session_id || inp.sessionId;
  if (!sid) return;
  const projectDir = inp.cwd || process.cwd();

  const runLogPath = path.join(projectDir, '.harness', 'run-log.jsonl');
  const streak = runLogStreak(runLogPath);
  const msg = buildNudge(streak);
  if (!msg) return;

  let st = { sid: null, lastStreak: 0 };
  try { const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (s.sid === sid) st = s; } catch (_) {}
  if (streak <= st.lastStreak) return; // already nudged at this level
  try { fs.writeFileSync(stateFile, JSON.stringify({ sid, lastStreak: streak })); } catch (_) {}

  emit(msg);
}

// Self-check: node stuck-detector.js --selftest
if (require.main === module && process.argv[2] === '--selftest') {
  const assert = require('assert');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-detector-selftest-'));
  const rl = path.join(dir, 'run-log.jsonl');

  fs.writeFileSync(rl, [{ status: 'red-stop' }, { status: 'red-stop' }].map((o) => JSON.stringify(o)).join('\n') + '\n');
  assert.equal(runLogStreak(rl), 2, '2 подряд red-stop посчитаны');
  assert.equal(buildNudge(runLogStreak(rl)), null, '2 < порога 3 — тишина');

  fs.appendFileSync(rl, JSON.stringify({ status: 'red-stop' }) + '\n');
  assert.equal(runLogStreak(rl), 3);
  assert.match(buildNudge(runLogStreak(rl)), /Застрял 3/, '3 = порог — nudge');

  fs.appendFileSync(rl, JSON.stringify({ commit: 'abc123' }) + '\n');
  assert.equal(runLogStreak(rl), 0, 'зелёный commit сбрасывает счётчик');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('selftest ok');
  process.exit(0);
}

try { main(); } catch (_) {}

module.exports = { runLogStreak, buildNudge, THRESHOLD };
