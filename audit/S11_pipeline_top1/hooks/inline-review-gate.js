#!/usr/bin/env node
'use strict';

/**
 * PostToolUse hook: Inline Review State Tracker + business assertion advisory.
 * Matcher: Edit|Write
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let cfg;
try {
  cfg = require('./lib/config');
} catch (_) {
  cfg = { session: { ttlHours: 4 } };
}

let metrics;
try {
  metrics = require('./lib/metrics');
} catch (_) {
  metrics = { inc: () => {} };
}

const SKIP_EXT = ['.md', '.txt', '.json', '.yml', '.yaml', '.toml', '.cfg', '.ini', '.env', '.lock', '.log', '.csv', '.svg', '.png', '.jpg'];
const TEST_FILE_PATTERN = /(^|\/)([^/]+\.)?(test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\//i;
const ASSERTION_PATTERN = /expect\s*\([\s\S]*?\)\s*\.\s*(to[A-Za-z0-9_]+)\s*\(/g;
const SHALLOW_ASSERTIONS = new Set(['toBeTruthy', 'toBeDefined']);

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (_) {
    return null;
  }
}

function normalizePath(filePath) {
  return String(filePath || '').toLowerCase().replace(/\\/g, '/');
}

function shouldSkipFile(lowerPath) {
  return (
    SKIP_EXT.some((ext) => lowerPath.endsWith(ext)) ||
    lowerPath.includes('/.claude/') ||
    lowerPath.includes('/.gsd/') ||
    lowerPath.includes('node_modules')
  );
}

function isTestFile(lowerPath) {
  return TEST_FILE_PATTERN.test(lowerPath);
}

function readEditedContent(input) {
  const toolInput = (input && input.tool_input) || {};
  if (typeof toolInput.content === 'string') {
    return toolInput.content;
  }
  if (typeof toolInput.new_string === 'string') {
    return toolInput.new_string;
  }

  const filePath = toolInput.file_path || '';
  const cwd = input.cwd || process.cwd();
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > 200 * 1024) {
      return '';
    }
    return fs.readFileSync(resolved, 'utf8');
  } catch (_) {
    return '';
  }
}

function analyzeAssertions(content) {
  const assertions = Array.from(content.matchAll(ASSERTION_PATTERN)).map((match) => match[1]);
  const shallowCount = assertions.filter((assertion) => SHALLOW_ASSERTIONS.has(assertion)).length;
  return {
    assertionCount: assertions.length,
    shallowCount,
    onlyShallow: assertions.length > 0 && assertions.length === shallowCount,
  };
}

function readState(stateFile) {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (Date.now() - (saved.ts || 0) < cfg.session.ttlHours * 60 * 60 * 1000) {
      return saved;
    }
  } catch (_) {}

  return { codeEditCount: 0, editsSinceLastReview: 0, ts: Date.now() };
}

function writeState(stateRoot) {
  const stateDir = path.join(stateRoot, 'claude-inline-review');
  const stateFile = path.join(stateDir, 'state.json');
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const state = readState(stateFile);
  const nextState = {
    ...state,
    codeEditCount: state.codeEditCount + 1,
    editsSinceLastReview: state.editsSinceLastReview + 1,
    ts: Date.now(),
  };

  try {
    fs.writeFileSync(stateFile, JSON.stringify(nextState));
  } catch (_) {}
}

function businessAssertionWarning(filePath, analysis) {
  const reason = [
    `Inline review warning: ${filePath} has ${analysis.assertionCount} assertion(s), all return-type-only.`,
    'Add at least one concrete business assertion, for example `.toBe(<concrete>)` or `.toEqual({ ...expected })`.',
    'Use `.toBeDefined()` / `.toBeTruthy()` only as supporting assertions.',
  ].join('\n');

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: reason,
    },
  });
}

function handleInput(input, options = {}) {
  metrics.inc('inline-review-gate', 'fired');
  if (!input) {
    return '';
  }

  const filePath = (input.tool_input && (input.tool_input.file_path || '')) || '';
  const lower = normalizePath(filePath);
  if (!filePath || shouldSkipFile(lower)) {
    return '';
  }

  writeState(options.stateRoot || os.tmpdir());

  if (!isTestFile(lower)) {
    return '';
  }

  const analysis = analyzeAssertions(readEditedContent(input));
  return analysis.onlyShallow ? businessAssertionWarning(filePath, analysis) : '';
}

if (require.main === module) {
  try {
    process.stdout.write(handleInput(readInput()));
  } catch (_) {}
  process.exit(0);
}

module.exports = {
  analyzeAssertions,
  handleInput,
  isTestFile,
  readEditedContent,
  shouldSkipFile,
};
