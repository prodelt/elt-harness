#!/usr/bin/env node
'use strict';

/**
 * UserPromptSubmit hook: T006 — mechanical checkpoint writer.
 *
 * context-autocompact-guard.js only nudges near the autocompact line; the
 * user still writes the checkpoint by hand (43x /clear in the session scan).
 * This hook goes one step further: at stage2 (~200k on a 1M-window model,
 * ~120k on a 200k-window model) it writes the checkpoint FILE itself — git
 * state + last run-log entry + next open slice + a ready resume prompt —
 * sourced from `elt status` (the harness's single source of truth, T001),
 * not reimplemented tasks.md/run-log parsing.
 *
 * Standalone: stdlib only, no AMOS deps. Never blocks; always exits 0.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Same window profiles as context-autocompact-guard.js — duplicated on
// purpose, both hooks are standalone (see file header). Only stage2 matters
// here; the guard already owns stage1/stage3 nudging.
const PROFILES = {
  big: { window: 1000000, stage2: 200000, repeat: 30000 },
  small: { window: 200000, stage2: 120000, repeat: 15000 },
};
const BIG_MODEL = /opus-4-8|sonnet-4-6|sonnet-5|fable-5|^(?:opus|sonnet)$/i;

function profileFor(model) {
  return BIG_MODEL.test(model || '') ? PROFILES.big : PROFILES.small;
}

function readStdin() { try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch (_) { return {}; } }

function emit(msg) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: msg },
  }));
}

function lastContext(p) {
  let txt;
  try { txt = fs.readFileSync(p, 'utf8'); } catch (_) { return { tok: 0, model: '' }; }
  const lines = txt.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    let o; try { o = JSON.parse(lines[i]); } catch (_) { continue; }
    const u = o.message && o.message.usage;
    if (u) {
      const tok = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      return { tok, model: (o.message && o.message.model) || '' };
    }
  }
  return { tok: 0, model: '' };
}

function findTranscript(sessionId) {
  const dir = path.join(os.homedir(), '.claude', 'projects');
  let best = null, t = 0;
  try {
    for (const d of fs.readdirSync(dir)) {
      const c = path.join(dir, d, sessionId + '.jsonl');
      try { const s = fs.statSync(c); if (s.mtimeMs > t) { t = s.mtimeMs; best = c; } } catch (_) {}
    }
  } catch (_) {}
  return best;
}

// elt.js is the single source of truth for git/plan/run-log (T001) — shell
// out to `elt status` instead of re-parsing tasks.md/run-log.jsonl here.
function findEltJs() {
  const candidates = [
    path.join(__dirname, 'elt.js'),
    path.join(os.homedir(), '.claude', 'bin', 'elt.js'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function eltStatus(projectDir) {
  const eltPath = findEltJs();
  if (!eltPath) return null;
  const r = spawnSync(process.execPath, [eltPath, 'status'], { cwd: projectDir, encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return null;
  try { return JSON.parse(r.stdout); } catch (_) { return null; }
}

function renderCheckpoint(status, meta) {
  const git = status && status.git && typeof status.git === 'object' ? status.git : null;
  const lastRun = status && status.lastRun;
  const plan = status && status.plan && typeof status.plan === 'object' ? status.plan : null;

  const gitLines = git
    ? `- branch: \`${git.branch}\`\n- dirty files: ${git.dirty}`
    : '- git status unavailable';

  const lastRunLines = lastRun
    ? `- commit: \`${lastRun.commit || '(none)'}\`\n- verdict: ${lastRun.verdict || '(none)'}\n- oracle exit: ${lastRun.oracle ? lastRun.oracle.exit : '?'}\n- msg: ${lastRun.msg || ''}`
    : '- no run-log entry yet';

  const nextLines = plan
    ? `- plan file: \`${plan.file}\`\n- open: ${plan.open} / done: ${plan.done}\n- next: ${plan.next || '(план закрыт)'}`
    : '- no specs/*/tasks.md';

  const resumePrompt = plan && plan.next
    ? `/elt continue — план \`${plan.file}\`, следующий слайс: ${plan.next}`
    : '/elt — план закрыт или отсутствует, спросить юзера новую задачу';

  return `# Checkpoint (auto) — ${meta.date}

Автозаписан \`checkpoint-writer.js\` на пороге ~${meta.k}k/${meta.limitK}k токенов (stage2) — ротация сессии, не ручной /checkpoint.

## Git
${gitLines}

## Last Run
${lastRunLines}

## Next Slice
${nextLines}

## Resume Prompt
${resumePrompt}
`;
}

function shouldTrigger(tok, prof, st) {
  if (tok < prof.stage2) return false;
  if (!st.wrote) return true;
  return (tok - st.lastTok) >= prof.repeat;
}

function runCheckpointWriter({ sessionId, transcriptPath, projectDir, stateFile }) {
  if (!sessionId || !transcriptPath) return { wrote: false, reason: 'no-session-or-transcript' };
  const { tok, model } = lastContext(transcriptPath);
  const prof = profileFor(model);

  let st = { sid: null, wrote: false, lastTok: 0 };
  try { const s = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (s.sid === sessionId) st = s; } catch (_) {}

  if (!shouldTrigger(tok, prof, st)) return { wrote: false, reason: 'below-threshold', tok, stage2: prof.stage2 };

  const status = eltStatus(projectDir);
  const date = new Date().toISOString().slice(0, 10);
  const k = Math.round(tok / 1000);
  const limitK = Math.round(prof.window / 1000);
  const content = renderCheckpoint(status, { date, k, limitK });

  const outDir = path.join(projectDir, '.planning');
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `CHECKPOINT-${date}-auto.md`);
  fs.writeFileSync(filePath, content, 'utf8');

  fs.writeFileSync(stateFile, JSON.stringify({ sid: sessionId, wrote: true, lastTok: tok }));

  return { wrote: true, filePath, tok, k, limitK };
}

const DEFAULT_STATE_FILE = path.join(os.tmpdir(), 'claude-checkpoint-writer.json');

function main() {
  const inp = readStdin();
  const sessionId = inp.session_id || inp.sessionId;
  if (!sessionId) return;
  const projectDir = inp.cwd || process.cwd();
  const transcriptPath = inp.transcript_path || inp.transcriptPath || findTranscript(sessionId);
  if (!transcriptPath) return;

  const result = runCheckpointWriter({ sessionId, transcriptPath, projectDir, stateFile: DEFAULT_STATE_FILE });
  if (!result.wrote) return;

  emit(`Чекпоинт записан: \`${path.relative(projectDir, result.filePath)}\` (~${result.k}k/${result.limitK}k токенов). Прочитай Resume Prompt и предложи юзеру новый чат с ним.`);
}

// Self-check: node checkpoint-writer.js --selftest
if (require.main === module && process.argv[2] === '--selftest') {
  const assert = require('assert');
  const { execFileSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-writer-selftest-'));

  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code',
    oracle: 'exit 0', shell: 'powershell', branchPolicy: 'feature', push: false, judge: { enabled: false },
  }));
  fs.appendFileSync(path.join(dir, '.harness', 'run-log.jsonl'), JSON.stringify({
    task: 'T001', commit: 'abc123', branch: 'feature/x', verdict: 'pass', msg: 'feat: T001 thing',
    oracle: { cmd: 'exit 0', exit: 0 },
  }) + '\n');
  fs.mkdirSync(path.join(dir, 'specs', '001-test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'specs', '001-test', 'tasks.md'), '- [ ] **T002** do the thing\n');

  const transcript = path.join(dir, 'transcript.jsonl');
  const stateFile = path.join(dir, 'state.json');

  fs.writeFileSync(transcript, JSON.stringify({ message: { model: 'claude-sonnet-5', usage: { input_tokens: 50000 } } }) + '\n');
  let r = runCheckpointWriter({ sessionId: 'sid-1', transcriptPath: transcript, projectDir: dir, stateFile });
  assert.equal(r.wrote, false, 'below stage2 — тишина');
  assert.equal(fs.existsSync(path.join(dir, '.planning')), false, '.planning не создан ниже порога');

  fs.writeFileSync(transcript, JSON.stringify({ message: { model: 'claude-sonnet-5', usage: { input_tokens: 210000 } } }) + '\n');
  r = runCheckpointWriter({ sessionId: 'sid-1', transcriptPath: transcript, projectDir: dir, stateFile });
  assert.equal(r.wrote, true, 'выше stage2 (210k, big-профиль 200k) — пишет');
  assert.ok(fs.existsSync(r.filePath), 'файл чекпоинта создан');
  const content = fs.readFileSync(r.filePath, 'utf8');
  assert.match(content, /## Git/);
  assert.match(content, /## Last Run/);
  assert.match(content, /## Next Slice/);
  assert.match(content, /## Resume Prompt/);
  assert.match(content, /T002/, 'следующий открытый слайс попал в файл');
  assert.match(content, /abc123/, 'последний коммит из run-log попал в файл');

  r = runCheckpointWriter({ sessionId: 'sid-1', transcriptPath: transcript, projectDir: dir, stateFile });
  assert.equal(r.wrote, false, 'повтор без роста токенов — тишина (де-дуп)');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('selftest ok');
  process.exit(0);
}

try { main(); } catch (_) {}

module.exports = {
  profileFor, lastContext, renderCheckpoint, shouldTrigger, runCheckpointWriter, eltStatus, findEltJs,
};
