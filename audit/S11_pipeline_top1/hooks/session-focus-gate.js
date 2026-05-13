#!/usr/bin/env node
'use strict';

/**
 * S11 Task 10 — session-focus-gate with focus history aggregation.
 *
 * SessionStart still resets per-session scope state, but now it also scans the
 * project's Claude transcripts and appends any unseen `Focus:` entries to
 * ~/.claude/focus-log.jsonl.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_HOME = process.env.CLAUDE_HOME_DIR || path.join(os.homedir(), '.claude');
const HOOKS_DIR = process.env.CLAUDE_HOOKS_DIR || path.join(CLAUDE_HOME, 'hooks');

const metrics = require(path.join(HOOKS_DIR, 'lib', 'metrics'));
const cfg = require(path.join(HOOKS_DIR, 'lib', 'config'));
const { encodeProjectDir, normCwd } = require(path.join(HOOKS_DIR, 'lib', 'pathnorm'));

const FOCUS_DIR = process.env.CLAUDE_SESSION_FOCUS_DIR || path.join(os.tmpdir(), 'claude-session-focus');
const FOCUS_FILE = path.join(FOCUS_DIR, 'goal.json');
const FOCUS_LOG_PATH = process.env.CLAUDE_FOCUS_LOG_PATH || path.join(CLAUDE_HOME, 'focus-log.jsonl');
const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(CLAUDE_HOME, 'projects');

metrics.inc('session-focus-gate', 'fired');

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonLines(filePath) {
  return safe(() => fs.readFileSync(filePath, 'utf8'), '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => safe(() => JSON.parse(line), null))
    .filter(Boolean);
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item.text === 'string') return item.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function parseSessionSummary(filePath, project) {
  const events = readJsonLines(filePath);
  const initialTimestamp = events.find(event => typeof event.timestamp === 'string')?.timestamp;
  const messageTexts = events
    .map(event => extractText(event.message?.content))
    .filter(Boolean);

  const focus = messageTexts
    .map(text => text.match(/Focus:\s*(.+?)(?=\s+Done when:|\n|$)/i)?.[1]?.trim() || null)
    .filter(Boolean)
    .find(value => value !== '—' && value !== '-');

  if (!focus) return null;

  const doneCriteria = messageTexts
    .map(text => text.match(/Done when:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || null)
    .filter(Boolean)
    .at(-1) || null;

  const fallbackDate = new Date(safe(() => fs.statSync(filePath).mtimeMs, Date.now())).toISOString();
  return {
    date: (initialTimestamp || fallbackDate).slice(0, 10),
    project,
    focus,
    doneCriteria,
    sessionId: path.basename(filePath, '.jsonl')
  };
}

function readLoggedSessionIds() {
  return new Set(
    readJsonLines(FOCUS_LOG_PATH)
      .map(entry => entry.sessionId)
      .filter(Boolean)
  );
}

function appendFocusHistory(cwd) {
  const project = normCwd(cwd);
  if (!project) return 0;

  const projectDir = path.join(PROJECTS_DIR, encodeProjectDir(project));
  if (!fs.existsSync(projectDir)) return 0;

  const logged = readLoggedSessionIds();
  const summaries = safe(
    () => fs.readdirSync(projectDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .filter(entry => !logged.has(path.basename(entry.name, '.jsonl')))
      .map(entry => path.join(projectDir, entry.name))
      .sort((left, right) => safe(() => fs.statSync(left).mtimeMs, 0) - safe(() => fs.statSync(right).mtimeMs, 0))
      .map(filePath => parseSessionSummary(filePath, project))
      .filter(Boolean),
    []
  );

  if (!summaries.length) return 0;

  ensureDir(path.dirname(FOCUS_LOG_PATH));
  const payload = summaries.map(summary => JSON.stringify(summary)).join('\n') + '\n';
  fs.appendFileSync(FOCUS_LOG_PATH, payload, 'utf8');
  summaries.forEach(() => metrics.inc('session-focus-gate', 'focus_logged'));
  return summaries.length;
}

function initSessionState(input) {
  ensureDir(FOCUS_DIR);
  const sessionData = {
    goal: null,
    doneCriteria: null,
    taskCount: 0,
    startedAt: new Date().toISOString(),
    verified: false,
    cwd: normCwd(input.cwd || ''),
    sessionId: input.sessionId || input.session_id || null
  };
  fs.writeFileSync(FOCUS_FILE, JSON.stringify(sessionData, null, 2), 'utf8');
}

function cleanupToolResults() {
  try {
    const ttlDays = (cfg.loopGuardian && cfg.loopGuardian.toolResultsTtlDays) || 7;
    const maxAgeMs = ttlDays * 24 * 60 * 60 * 1000;
    const sentinel = path.join(os.tmpdir(), 'claude-tool-results-cleanup.ts');

    const sentinelFresh = safe(() => Date.now() - fs.statSync(sentinel).mtimeMs < 24 * 60 * 60 * 1000, false);
    if (sentinelFresh) return;
    if (!fs.existsSync(PROJECTS_DIR)) {
      fs.writeFileSync(sentinel, '.', 'utf8');
      return;
    }

    const projectNames = safe(
      () => fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name),
      []
    );

    const purged = projectNames.reduce((total, projectName) => {
      const rootDir = path.join(PROJECTS_DIR, projectName);
      const nestedDirs = safe(
        () => fs.readdirSync(rootDir, { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .map(entry => path.join(rootDir, entry.name, 'tool-results')),
        []
      );
      const candidateDirs = [path.join(rootDir, 'tool-results'), ...nestedDirs];

      return total + candidateDirs.reduce((dirTotal, dirPath) => {
        const files = safe(() => fs.readdirSync(dirPath), []);
        const removed = files.reduce((fileTotal, fileName) => {
          if (!fileName.endsWith('.txt')) return fileTotal;
          const fullPath = path.join(dirPath, fileName);
          const isExpired = safe(() => Date.now() - fs.statSync(fullPath).mtimeMs > maxAgeMs, false);
          if (!isExpired) return fileTotal;
          safe(() => fs.unlinkSync(fullPath), null);
          return fileTotal + 1;
        }, 0);
        return dirTotal + removed;
      }, 0);
    }, 0);

    fs.writeFileSync(sentinel, String(purged), 'utf8');
    if (purged > 0) metrics.inc('session-focus-gate', 'tool_results_purged');
  } catch {}
}

function respond() {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'SESSION FOCUS: Define ONE goal. Format: Focus: [goal] Done when: [criteria]. 1 goal = fully_achieved, 3+ = partially_achieved.'
    }
  }));
}

function main(rawInput) {
  const parsedInput = safe(() => JSON.parse(rawInput || '{}'), {});
  initSessionState(parsedInput);
  safe(() => appendFocusHistory(parsedInput.cwd || ''), 0);
  cleanupToolResults();
  respond();
}

let input = '';
const timeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    main(input);
  } catch {
    respond();
  }
});
