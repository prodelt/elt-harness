#!/usr/bin/env node
'use strict';

/**
 * S11 Task 12 — SessionStart advisory for oversized MEMORY.md.
 *
 * Behavior:
 * - 0..80 lines: silent
 * - 81..100 lines: advisory with explicit `/learn`
 * - 101+ lines: block session start
 *
 * `CLAUDE_MEMORY_PATH` is optional and exists only to make threshold tests
 * deterministic without monkey-patching fs. `CLAUDE_MEMORY_DISCIPLINE_EXPORTS_ONLY=1`
 * suppresses auto-run for direct module tests.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE_HOME = process.env.CLAUDE_HOME_DIR || path.join(os.homedir(), '.claude');
const HOOKS_DIR = process.env.CLAUDE_HOOKS_DIR || path.join(CLAUDE_HOME, 'hooks');
const metrics = require(path.join(HOOKS_DIR, 'lib', 'metrics'));
const logger = require(path.join(HOOKS_DIR, 'lib', 'logger'));

const MEMORY_PATH = process.env.CLAUDE_MEMORY_PATH || path.join(CLAUDE_HOME, 'projects', 'C--', 'memory', 'MEMORY.md');
const WARN_THRESHOLD = 80;
const BLOCK_THRESHOLD = 100;

function countLines(content) {
  if (!content) return 0;
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  return normalized ? normalized.split('\n').length : 0;
}

function readLineCount(filePath) {
  try {
    return countLines(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function buildWarnResponse(lineCount) {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `⚠ MEMORY.md is ${lineCount} lines (warn at ${WARN_THRESHOLD}, block at ${BLOCK_THRESHOLD}). Run /learn now to prune old entries before adding more context.`
    }
  };
}

function buildBlockMessage(lineCount) {
  return [
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
  ].join('\n') + '\n';
}

function evaluateLineCount(lineCount) {
  if (lineCount === null || lineCount <= WARN_THRESHOLD) {
    return { kind: 'silent', exitCode: 0 };
  }

  if (lineCount > BLOCK_THRESHOLD) {
    return {
      kind: 'block',
      exitCode: 2,
      stderr: buildBlockMessage(lineCount)
    };
  }

  return {
    kind: 'warn',
    exitCode: 0,
    stdout: JSON.stringify(buildWarnResponse(lineCount))
  };
}

function main() {
  metrics.inc('memory-discipline', 'fired');
  const lineCount = readLineCount(MEMORY_PATH);
  const result = evaluateLineCount(lineCount);

  if (result.kind === 'block') {
    metrics.inc('memory-discipline', 'blocked');
    logger.warn('memory-discipline', `BLOCK ${lineCount} lines (> ${BLOCK_THRESHOLD})`);
    process.stderr.write(result.stderr);
    process.exit(result.exitCode);
  }

  if (result.kind === 'warn') {
    metrics.inc('memory-discipline', 'warned');
    process.stdout.write(result.stdout);
    process.exit(result.exitCode);
  }

  process.exit(result.exitCode);
}

module.exports = {
  BLOCK_THRESHOLD,
  WARN_THRESHOLD,
  buildBlockMessage,
  buildWarnResponse,
  countLines,
  evaluateLineCount,
  readLineCount
};

if (process.env.CLAUDE_MEMORY_DISCIPLINE_EXPORTS_ONLY !== '1') main();
