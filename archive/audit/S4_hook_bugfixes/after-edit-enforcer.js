#!/usr/bin/env node

/**
 * PreToolUse hook: Edit Enforcer (v4)
 * Matcher: Write|Edit
 *
 * CENTRAL enforcement gate. Reads state files from PostToolUse trackers.
 * Uses OFFICIAL API format: hookSpecificOutput with additionalContext/permissionDecision.
 *
 * Checks:
 * 1. Inline review: warn at 7, DENY at 15+ edits without review
 * 2. Context7: warn at 10+, DENY at 30+ edits without usage
 * 3. Loop detection: warn if same file edited 3+ times (reads loop-guardian state)
 *
 * Output format (official):
 *   Warn:  { hookSpecificOutput: { hookEventName, permissionDecision:"allow", additionalContext } }
 *   Block: { hookSpecificOutput: { hookEventName, permissionDecision:"deny", permissionDecisionReason } }
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const cfg = require('./lib/config');
const metrics = require('./lib/metrics');
const logger = require('./lib/logger');

metrics.inc('edit-enforcer', 'fired');
let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { metrics.inc('edit-enforcer', 'parse_error'); process.exit(0); }

const filePath = (input.tool_input && (input.tool_input.file_path || '')) || '';
const lower = filePath.toLowerCase().replace(/\\/g, '/');

// Skip non-code files
const skipExt = cfg.editEnforcer.skipExtensions;
const skipPaths = cfg.editEnforcer.skipPaths;
if (skipExt.some(ext => lower.endsWith(ext))) { metrics.inc('edit-enforcer', 'skip_ext'); process.exit(0); }
if (skipPaths.some(p => lower.includes(p))) { metrics.inc('edit-enforcer', 'skip_path'); process.exit(0); }

// === FREEZE MODE: block ALL file edits ===
try {
  const freezeFile = path.join(os.tmpdir(), 'claude-freeze-mode', 'state.json');
  const s = JSON.parse(fs.readFileSync(freezeFile, 'utf8'));
  if (s.active && Date.now() - (s.ts || 0) < 8 * 60 * 60 * 1000) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'FREEZE MODE ACTIVE: All file edits are blocked. Run /freeze off to deactivate.'
      }
    }));
    process.exit(0);
  }
} catch (_) {}

const denyReasons = [];
const warnings = [];

// === CHECK 1: Inline review ===
try {
  const stateFile = path.join(os.tmpdir(), 'claude-inline-review', 'state.json');
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (Date.now() - (state.ts || 0) < cfg.session.ttlHours * 60 * 60 * 1000) {
      const edits = state.editsSinceLastReview || 0;
      const { warnAt, blockAt } = cfg.inlineReview;
      if (edits >= blockAt) {
        denyReasons.push(
          'INLINE REVIEW REQUIRED: ' + edits + ' code edits without review. ' +
          'Run /inline-review NOW — spawn code-reviewer (haiku), 5 questions, ~2 min. ' +
          'This edit is BLOCKED until review completes.'
        );
      } else if (edits >= warnAt) {
        warnings.push(
          'Inline review: ' + edits + '/' + blockAt + ' code edits without review. ' +
          'At ' + blockAt + ' edits your next edit will be DENIED. Run /inline-review proactively.'
        );
      }
    }
  }
} catch (_) {}

// === CHECK 2: Context7 ===
try {
  const stateFile = path.join(os.tmpdir(), 'claude-context7-tracker', 'state.json');
  if (fs.existsSync(stateFile)) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (Date.now() - (state.ts || 0) < cfg.session.ttlHours * 60 * 60 * 1000) {
      const hasGracePeriod = state.lastContext7Use && (Date.now() - state.lastContext7Use < cfg.context7.gracePeriodMs);
      if (!hasGracePeriod) {
        const reminders = state.reminderCount || 0;
        const partialEdits = state.editsSinceLastReminder || 0;
        const totalEdits = reminders * 3 + partialEdits;
        const { warnAtReminders, blockAtReminders } = cfg.context7;
        if (reminders >= blockAtReminders) {
          denyReasons.push(
            'CONTEXT7 REQUIRED: ' + totalEdits + ' code edits without fetching docs. ' +
            'Use mcp__context7__resolve-library-id → mcp__context7__query-docs for ANY library. ' +
            'This edit is BLOCKED until Context7 is used.'
          );
        } else if (reminders >= warnAtReminders) {
          warnings.push(
            'Context7: ' + totalEdits + ' edits without docs. ' +
            'At ' + (blockAtReminders * 3) + ' edits your edits will be DENIED. Use Context7 NOW.'
          );
        }
      }
    }
  }
} catch (_) {}

// === CHECK 3: Loop detection ===
try {
  const stateFile = path.join(os.tmpdir(), 'claude-loop-guardian', 'history.json');
  if (fs.existsSync(stateFile)) {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (Date.now() - (saved.ts || 0) < 4 * 60 * 60 * 1000) {
      const history = saved.history || [];
      const currentKey = 'file:' + filePath;
      let count = 0;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i] === currentKey) count++;
        else break;
      }
      if (count >= 3) {
        warnings.push(
          'LOOP: This file edited ' + count + 'x consecutively. Stop and re-read the error — try a DIFFERENT approach.'
        );
      }
    }
  }
} catch (_) {}

// === CHECK 4: Pipeline not invoked for substantial work ===
try {
  const stateFile = path.join(os.tmpdir(), 'claude-pipeline-tracker', 'state.json');
  const reviewFile = path.join(os.tmpdir(), 'claude-inline-review', 'state.json');
  let editCount = 0;
  let pipelineUsed = false;

  if (fs.existsSync(reviewFile)) {
    const rs = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
    if (Date.now() - (rs.ts || 0) < 4 * 60 * 60 * 1000) {
      editCount = (rs.editsSinceLastReview || 0) + (rs.totalEdits || 0);
    }
  }
  if (fs.existsSync(stateFile)) {
    const ps = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (Date.now() - (ps.ts || 0) < 4 * 60 * 60 * 1000) {
      pipelineUsed = ps.pipelineUsed || false;
    }
  }
  // Warn at 5+ edits without pipeline (MEDIUM/COMPLEX threshold)
  if (!pipelineUsed && editCount >= cfg.pipeline.warnAtEdits) {
    warnings.push(
      'PIPELINE: ' + editCount + ' code edits without /pipeline. ' +
      'Use /pipeline to classify complexity and route correctly (TRIVIAL/MEDIUM/COMPLEX). ' +
      'Skip only if task is TRIVIAL (<50 lines, 1 file).'
    );
  }
} catch (_) {}

// === OUTPUT ===
if (denyReasons.length > 0) {
  metrics.inc('edit-enforcer', 'blocked');
  try { logger.warn('edit-enforcer', 'BLOCK ' + path.basename(filePath), { reasons: denyReasons.length }); } catch (_) {}
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: denyReasons.join('\n\n')
    }
  }));
} else if (warnings.length > 0) {
  metrics.inc('edit-enforcer', 'warned');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      additionalContext: warnings.join(' | ')
    }
  }));
} else {
  metrics.inc('edit-enforcer', 'allowed');
}
// else: silent allow
