#!/usr/bin/env node

/**
 * SessionStart hook: Memory Discipline Gate
 *
 * Monitors MEMORY.md line count to prevent context bloat.
 *   >80 lines  → warn (additionalContext advisory)
 *   >100 lines → block (exit 2 — must run /learn first)
 *
 * Memory must stay ≤100 lines per CLAUDE.md Memory Management rules.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const metrics = require('./lib/metrics');
const logger = require('./lib/logger');

metrics.inc('memory-discipline', 'fired');

const MEMORY_PATH    = path.join(os.homedir(), '.claude', 'projects', 'C--', 'memory', 'MEMORY.md');
const WARN_THRESHOLD  = 80;
const BLOCK_THRESHOLD = 100;

let lineCount = 0;
try {
  const content = fs.readFileSync(MEMORY_PATH, 'utf8');
  // Count non-empty trailing newline as line only if file has content
  lineCount = content ? content.split('\n').length : 0;
} catch {
  // File not found — nothing to check
  process.exit(0);
}

if (lineCount > BLOCK_THRESHOLD) {
  metrics.inc('memory-discipline', 'blocked');
  logger.warn('memory-discipline', 'BLOCK ' + lineCount + ' lines (> ' + BLOCK_THRESHOLD + ')');
  process.stderr.write([
    '╔══════════════════════════════════════════════════════════════╗',
    '║  MEMORY.md TOO LARGE — session start blocked                 ║',
    '╚══════════════════════════════════════════════════════════════╝',
    '',
    `  Current: ${lineCount} lines  |  Limit: ${BLOCK_THRESHOLD} lines`,
    '',
    'Run BEFORE starting work:',
    '  /learn          ← extract patterns from session, compress entries',
    '  Then archive old project entries to memory/archive/',
    '',
    'MEMORY.md must be under 100 lines to proceed.',
  ].join('\n') + '\n');
  process.exit(2);
}

if (lineCount > WARN_THRESHOLD) {
  metrics.inc('memory-discipline', 'warned');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `⚠ MEMORY.md is ${lineCount} lines (warn at ${WARN_THRESHOLD}, block at ${BLOCK_THRESHOLD}). Run /learn to compress before adding more entries.`
    }
  }));
  process.exit(0);
}

process.exit(0);
