#!/usr/bin/env node

/**
 * Stop hook: Final verification checklist before session ends.
 * v2: ADVISORY only (not blocking). ship-gate.js is the sole blocker.
 *
 * Checks:
 * 1. No console.log in modified files
 * 2. Reminds about documentation and CLAUDE.md
 * 3. /learn prompt at 20+ edits
 *
 * Stop hooks use { decision, reason } format. Valid decision: "approve" | "block".
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const metrics = require('./lib/metrics');
const logger = require('./lib/logger');
const { normCwd } = require('./lib/pathnorm');

metrics.inc('stop-verification', 'fired');

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
const cwd = normCwd((input && input.cwd) || process.cwd());
const warnings = [];

// Check for modified files with console.log
// Try HEAD diff first, fall back to unstaged diff
let gitDiff = '';
try {
  gitDiff = execSync('git diff --name-only HEAD -- .', {
    cwd, encoding: 'utf8', timeout: 5000, stdio: 'pipe'
  }).trim();
} catch {
  try {
    gitDiff = execSync('git diff --name-only -- .', {
      cwd, encoding: 'utf8', timeout: 5000, stdio: 'pipe'
    }).trim();
  } catch {
    // Not a git repo or git not available — skip
    process.exit(0);
  }
}

if (gitDiff) {
  const files = gitDiff.split('\n').filter(f => /\.(js|jsx|ts|tsx|mjs|mts)$/.test(f));
  const consoleLogFiles = [];

  for (const file of files) {
    try {
      const absPath = path.resolve(cwd, file);
      if (fs.existsSync(absPath)) {
        const content = fs.readFileSync(absPath, 'utf8');
        if (/console\.(log|debug)\s*\(/.test(content)) {
          consoleLogFiles.push(file);
        }
      }
    } catch {
      // skip
    }
  }

  if (consoleLogFiles.length > 0) {
    warnings.push('CONSOLE.LOG AUDIT: Found in ' + consoleLogFiles.length + ' modified file(s): ' + consoleLogFiles.join(', '));
  }
}

// Remind about docs only if there are console.log issues
if (warnings.length > 0) {
  warnings.push('DOCUMENTATION CHECK: Did you update CLAUDE.md if architecture changed?');
}

// Check edit count from verification-tracker — enforce /learn for substantial sessions
try {
  const os = require('os');
  const crypto = require('crypto');
  const cwdHash = crypto.createHash('md5').update(cwd).digest('hex').slice(0, 8);
  const trackerFile = path.join(os.tmpdir(), 'claude-verification-gate', 'state-' + cwdHash + '.json');
  const learnGateFile = path.join(os.tmpdir(), 'claude-learn-gate', 'prompted-' + cwdHash + '.json');

  if (fs.existsSync(trackerFile)) {
    const state = JSON.parse(fs.readFileSync(trackerFile, 'utf8'));
    if ((state.editCount || 0) > 20) {
      // Check if already prompted once — don't block again (prevents infinite loop)
      const learnGateDir = path.join(os.tmpdir(), 'claude-learn-gate');
      let alreadyPrompted = false;
      try {
        if (fs.existsSync(learnGateFile)) {
          const gate = JSON.parse(fs.readFileSync(learnGateFile, 'utf8'));
          if (Date.now() - (gate.ts || 0) < 8 * 60 * 60 * 1000) {
            alreadyPrompted = true;
          }
        }
      } catch {}

      if (!alreadyPrompted) {
        // First time — block and prompt
        if (!fs.existsSync(learnGateDir)) fs.mkdirSync(learnGateDir, { recursive: true });
        fs.writeFileSync(learnGateFile, JSON.stringify({ ts: Date.now() }));
        warnings.push(
          'LEARN RECOMMENDED: ' + state.editCount + ' edits this session. ' +
          'Run /learn to extract reusable patterns. Say "skip learn" to proceed.'
        );
      }
      // If already prompted — silent pass (user chose to skip)
    }
  }
} catch (err) {
  try { logger.error('stop-verification', 'edit-count check', err); } catch (_) {}
}

if (warnings.length > 0) {
  metrics.inc('stop-verification', 'warned');
  // Stop hooks use decision/reason format, NOT hookSpecificOutput
  process.stdout.write(JSON.stringify({
    decision: 'approve',
    reason: 'SESSION END CHECK: ' + warnings.join(' | ')
  }));
}
// No warnings — silent exit 0
