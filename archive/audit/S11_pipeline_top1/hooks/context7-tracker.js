#!/usr/bin/env node
'use strict';

/**
 * Context7 CLI usage tracker + 24h cache gate.
 * PreToolUse[Bash]: denies repeated ctx7 docs/library commands when cache exists.
 * PostToolUse[Bash]: stores first ctx7 docs/library output and marks Context7 used.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const ctx7Cache = require('./lib/ctx7-cache');
let metrics;
try {
  metrics = require('./lib/metrics');
} catch (_) {
  metrics = { inc: () => {} };
}

const HOOK = 'context7-tracker';
const STATE_DIR = path.join(os.tmpdir(), 'claude-context7-tracker');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

metrics.inc(HOOK, 'fired');

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (_) {
    return null;
  }
}

function responseText(input) {
  const response = input && input.tool_response;
  if (typeof response === 'string') return response;
  if (!response || typeof response !== 'object') return '';
  return String(response.stdout || response.output || response.content || '');
}

function writeContext7State(now) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    let state = { reminded: false, context7Used: false, ts: now };
    try {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      state = Date.now() - (saved.ts || 0) < 4 * 60 * 60 * 1000 ? saved : state;
    } catch (_) {}

    const nextState = {
      ...state,
      editsSinceLastReminder: 0,
      reminderCount: 0,
      lastContext7Use: now,
      context7Used: true,
      ts: now,
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(nextState), 'utf8');
  } catch (_) {}
}

function cacheRoot(options = {}) {
  return options.cacheRoot || process.env.CTX7_CACHE_ROOT || ctx7Cache.DEFAULT_ROOT;
}

function preToolUse(command, options = {}) {
  const root = cacheRoot(options);
  const cached = ctx7Cache.readEntry(command, { root });
  if (!cached.hit) {
    ctx7Cache.appendAccess(root, {
      event: 'miss',
      command: ctx7Cache.normalizeCommand(command),
      hash: cached.hash,
    });
    return '';
  }

  metrics.inc(HOOK, 'cache-hit');
  ctx7Cache.appendAccess(root, {
    event: 'cache hit',
    command: ctx7Cache.normalizeCommand(command),
    hash: cached.hash,
    cachePath: cached.path,
  });

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: [
        'CTX7 CACHE HIT: identical ctx7 request was cached within 24h.',
        `Cache file: ${cached.path}`,
        'Read the cached entry instead of running the network request again.'
      ].join('\n')
    }
  });
}

function postToolUse(command, input, options = {}) {
  const root = cacheRoot(options);
  metrics.inc(HOOK, 'ctx7-cli-used');
  const written = ctx7Cache.writeEntry(command, responseText(input), { root });
  ctx7Cache.appendAccess(root, {
    event: 'store',
    command: ctx7Cache.normalizeCommand(command),
    hash: written.hash,
    cachePath: written.path,
  });
  writeContext7State(Date.now());
  return '';
}

function handleInput(input, options = {}) {
  if (!input) return '';
  const command = (input.tool_input && input.tool_input.command) || '';
  if (!ctx7Cache.isCtx7Command(command)) return '';
  if (Object.prototype.hasOwnProperty.call(input, 'tool_response')) {
    return postToolUse(command, input, options);
  }
  return preToolUse(command, options);
}

if (require.main === module) {
  try {
    process.stdout.write(handleInput(readInput()));
  } catch (_) {}
  process.exit(0);
}

module.exports = {
  handleInput,
  postToolUse,
  preToolUse,
};
