#!/usr/bin/env node

/**
 * PostToolUse hook: Loop Guardian
 * Matcher: Edit|Write|Bash
 *
 * Detects when Claude is repeating the same action without progress.
 *
 * Two-layer detection:
 *   A) Exact repeat (same command / same old_string):
 *        → warn at repeatWarn (3), BLOCK at blockAt (6)
 *   B) Same file edited many times (different old_strings — still suspicious past threshold):
 *        → advisory at sameFileWarn (5), warn only (never blocks — could be legit refactor)
 *
 * Fires only on repetition — silent by default.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const cfg = require('./lib/config');
const metrics = require('./lib/metrics');
const logger = require('./lib/logger');

metrics.inc('loop-guardian', 'fired');
const WINDOW = cfg.loopGuardian.historyWindow;
const REPEAT_WARN = cfg.loopGuardian.repeatWarn;
const BLOCK_AT = cfg.loopGuardian.blockAt || 6;
const SAME_FILE_WARN = cfg.loopGuardian.sameFileWarn || 5;

const stateDir = path.join(os.tmpdir(), 'claude-loop-guardian');
const stateFile = path.join(stateDir, 'history.json');

let input = '';
const timeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';

    // Extract action key + file key (for layer B same-file tracking)
    let actionKey = null;
    let fileKey = null;
    if (toolName === 'Bash') {
      const cmd = (data.tool_input && data.tool_input.command) || '';
      actionKey = 'bash:' + cmd.replace(/\d{10,}/g, 'N').substring(0, 120);
    } else if (toolName === 'Edit' || toolName === 'Write') {
      const filePath = (data.tool_input && data.tool_input.file_path) || '';
      if (toolName === 'Edit') {
        const oldStr = (data.tool_input && data.tool_input.old_string) || '';
        const fingerprint = oldStr.replace(/\s+/g, ' ').slice(0, 60);
        actionKey = 'edit:' + filePath + ':' + fingerprint;
      } else {
        actionKey = 'file:' + filePath;
      }
      fileKey = 'file-touch:' + filePath;
    }

    if (!actionKey) { process.exit(0); }

    // Load history
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    let history = [];
    let fileTouches = [];
    try {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (Date.now() - (saved.ts || 0) > cfg.session.ttlHours * 60 * 60 * 1000) {
        history = [];
        fileTouches = [];
      } else {
        history = saved.history || [];
        fileTouches = saved.fileTouches || [];
      }
    } catch (_) {}

    history.push(actionKey);
    if (history.length > WINDOW) history = history.slice(-WINDOW);
    if (fileKey) {
      fileTouches.push(fileKey);
      // Keep a larger window for same-file detection (16 edits happened in real sessions)
      if (fileTouches.length > 20) fileTouches = fileTouches.slice(-20);
    }
    fs.writeFileSync(stateFile, JSON.stringify({ ts: Date.now(), history, fileTouches }));

    // Layer A: exact repeat count at the tail
    const last = actionKey;
    let exactCount = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i] === last) exactCount++;
      else break;
    }

    // Layer B: same-file touch count anywhere in recent window
    let sameFileCount = 0;
    if (fileKey) {
      sameFileCount = fileTouches.filter(k => k === fileKey).length;
    }

    // BLOCK takes priority (exact repeats only — layer B never blocks)
    if (exactCount >= BLOCK_AT) {
      metrics.inc('loop-guardian', 'blocked');
      logger.warn('loop-guardian', 'BLOCK ' + exactCount + 'x repeat', { actionKey: actionKey.slice(0, 80) });
      const label = toolName === 'Bash'
        ? 'command: ' + (data.tool_input && data.tool_input.command || '').substring(0, 60)
        : 'file: ' + path.basename((data.tool_input && data.tool_input.file_path) || '');
      process.stderr.write(
        'LOOP BLOCK: Same ' + label + ' repeated ' + exactCount + 'x (threshold=' + BLOCK_AT + '). ' +
        'STOP. Re-read the error. Try a different approach — not this same edit again.'
      );
      process.exit(2);
    }

    if (exactCount >= REPEAT_WARN) {
      metrics.inc('loop-guardian', 'warned');
      const label = toolName === 'Bash'
        ? 'command: ' + (data.tool_input && data.tool_input.command || '').substring(0, 60)
        : 'file: ' + path.basename((data.tool_input && data.tool_input.file_path) || '');
      process.stderr.write(
        'LOOP DETECTED: Same ' + label + ' repeated ' + exactCount + 'x. Stop and re-read the error — try a DIFFERENT approach. ' +
        '(Block at ' + BLOCK_AT + 'x.)'
      );
      process.exit(2);
    }

    // Layer B: same file touched too many times (distinct old_strings)
    if (sameFileCount >= SAME_FILE_WARN) {
      metrics.inc('loop-guardian', 'same_file_warn');
      const fname = path.basename((data.tool_input && data.tool_input.file_path) || '');
      process.stderr.write(
        'FILE LOOP: ' + fname + ' edited ' + sameFileCount + 'x in this session. ' +
        'If refactor = OK, otherwise batch changes with Write or MultiEdit.'
      );
      process.exit(2);
    }
  } catch (err) {
    try { logger.error('loop-guardian', 'unhandled', err); } catch (_) {}
  }
  process.exit(0);
});
