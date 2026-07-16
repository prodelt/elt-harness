#!/usr/bin/env node

/**
 * UserPromptSubmit hook: Context Budget Gate
 *
 * Monitors transcript size. At 130k tokens → first reminder.
 * Every 30k tokens after → repeats with escalation.
 * Forces memory + docs update before autocompact hits.
 *
 * Token estimate: transcript JSONL file size / 6
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const cfg = require('./lib/config');
const metrics = require('./lib/metrics');

metrics.inc('context-budget-gate', 'fired');
const { thresholdTokens: THRESHOLD_TOKENS, repeatIntervalTokens: REPEAT_INTERVAL, singlePromptWarnTokens: TOKENS_PER_PROMPT_WARN, charsPerToken: CHARS_PER_TOKEN } = cfg.contextBudget;

const stateDir = path.join(os.tmpdir(), 'claude-context-gate');
const stateFile = path.join(stateDir, 'state.json');

let input = '';
const timeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input);
    let transcriptPath = data.transcript_path;
    const sessionId = data.session_id;

    if (!sessionId) { process.exit(0); }

    // v2: fallback transcript discovery if transcript_path not in payload
    if (!transcriptPath) {
      try {
        const projectsDir = path.join(os.homedir(), '.claude', 'projects');
        if (fs.existsSync(projectsDir)) {
          const dirs = fs.readdirSync(projectsDir);
          let bestMatch = null;
          let bestTime = 0;
          for (const dir of dirs) {
            const candidate = path.join(projectsDir, dir, sessionId + '.jsonl');
            try {
              const st = fs.statSync(candidate);
              if (st.mtimeMs > bestTime) {
                bestTime = st.mtimeMs;
                bestMatch = candidate;
              }
            } catch (_) {}
          }
          if (bestMatch) transcriptPath = bestMatch;
        }
      } catch (_) {}
    }

    if (!transcriptPath) { process.exit(0); }

    // Load state
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    let state = { sessionId: null, reminderCount: 0, lastReminderTokens: 0 };
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (saved.sessionId === sessionId) state = saved;
    } catch (_) {}

    // Estimate tokens from transcript file size
    let estimatedTokens = 0;
    try {
      const stat = fs.statSync(transcriptPath);
      estimatedTokens = Math.floor(stat.size / CHARS_PER_TOKEN);
    } catch (_) { process.exit(0); }

    // Below threshold → silent
    if (estimatedTokens < THRESHOLD_TOKENS) { process.exit(0); }

    // Check if should remind (first time or every REPEAT_INTERVAL tokens)
    const tokensSinceLastReminder = estimatedTokens - (state.lastReminderTokens || 0);
    const isFirstReminder = state.reminderCount === 0;
    const shouldRemind = isFirstReminder || tokensSinceLastReminder >= REPEAT_INTERVAL;

    if (!shouldRemind) { process.exit(0); }

    // Update state
    state.sessionId = sessionId;
    state.reminderCount++;
    state.lastReminderTokens = estimatedTokens;
    fs.writeFileSync(stateFile, JSON.stringify(state));

    // Escalating message (terse — save tokens in the warning itself)
    const kTok = Math.round(estimatedTokens / 1000);
    let msg;
    if (state.reminderCount === 1) {
      msg = `Ctx ~${kTok}k. Save MEMORY.md soon.`;
    } else if (state.reminderCount === 2) {
      msg = `Ctx ~${kTok}k (${state.reminderCount}x). Save MEMORY now.`;
    } else {
      msg = `Ctx ~${kTok}k CRITICAL (${state.reminderCount}x). /learn + save MEMORY.`;
    }

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: msg
      }
    }));

  } catch (_) {}
  process.exit(0);
});
