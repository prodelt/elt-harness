#!/usr/bin/env node

/**
 * Stop hook: auto checkpoint briefing.
 *
 * If the current session ends without an explicit /checkpoint command,
 * write a short handoff file for the next session. This hook is advisory-only:
 * it must never block Stop and must stay silent on stdout.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function optionalRequire(modulePath, fallback) {
  try {
    return require(modulePath);
  } catch (_) {
    return fallback;
  }
}

const logger = optionalRequire('./lib/logger', { error() {} });
const metrics = optionalRequire('./lib/metrics', { inc() {} });
const { normCwd } = optionalRequire('./lib/pathnorm', {
  normCwd(cwd) {
    if (!cwd || typeof cwd !== 'string') return '';
    return cwd.replace(/\\/g, '/').replace(/^([a-z]):/, (_, drive) => drive.toUpperCase() + ':');
  }
});
const { runHandoffSync } = optionalRequire('./handoff-sync', { runHandoffSync() { return null; } });

const HOOK = 'stop-auto-checkpoint';

metrics.inc(HOOK, 'fired');

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (err) {
    logger.error(HOOK, 'invalid stdin JSON', err);
    return null;
  }
}

function findTranscript(sessionId) {
  if (!sessionId) return '';
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  let bestPath = '';
  let bestTime = 0;
  try {
    for (const dir of fs.readdirSync(projectsDir)) {
      const candidate = path.join(projectsDir, dir, sessionId + '.jsonl');
      try {
        const stat = fs.statSync(candidate);
        if (stat.mtimeMs > bestTime) {
          bestTime = stat.mtimeMs;
          bestPath = candidate;
        }
      } catch (_) {}
    }
  } catch (err) {
    logger.error(HOOK, 'transcript discovery failed', err);
  }
  return bestPath;
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(item => (item && typeof item.text === 'string' ? item.text : ''))
    .filter(Boolean)
    .join('\n');
}

function extractUserText(event) {
  const message = event && event.message;
  if (message && message.role === 'user') return contentToText(message.content);
  if (event && event.type === 'user') return contentToText(event.content || (message && message.content));
  if (event && event.role === 'user') return contentToText(event.content);
  return '';
}

function hasCheckpointCommand(transcriptPath) {
  const content = fs.readFileSync(transcriptPath, 'utf8');
  const lines = content.split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const normalized = line.trimStart().replace(/^\uFEFF/, '');
      const text = extractUserText(JSON.parse(normalized)).trim();
      if (/^\/checkpoint(?:\s|$)/i.test(text)) return true;
    } catch (_) {}
  }
  return false;
}

function runGit(cwd, command) {
  try {
    return execSync(command, { cwd, encoding: 'utf8', timeout: 3000, stdio: 'pipe' }).trim();
  } catch (_) {
    return '';
  }
}

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function runProjectHandoffSync(cwd) {
  if (!cwd) return;
  const configPath = path.join(cwd, '.claude', 'handoff-automation.json');
  if (!fs.existsSync(configPath)) return;
  try {
    const result = runHandoffSync(cwd, configPath);
    if (result) metrics.inc(HOOK, 'handoff_sync_written');
    return;
  } catch (err) {
    metrics.inc(HOOK, 'handoff_sync_failed');
    logger.error(HOOK, 'handoff sync failed', err);
  }
}

function buildBriefing(input, transcriptPath) {
  const cwd = normCwd((input && input.cwd) || '');
  const sessionId = (input && (input.session_id || input.sessionId)) || 'unknown';
  const branch = cwd ? runGit(cwd, 'git branch --show-current') : '';
  const head = cwd ? runGit(cwd, 'git log --oneline -1') : '';
  const status = cwd ? runGit(cwd, 'git status --short -- .') : '';
  const changed = status ? status.split('\n').slice(0, 25).join('\n') : 'clean or unavailable';

  return [
    '---',
    'type: auto-checkpoint',
    'created: ' + new Date().toISOString(),
    '---',
    '',
    '# Auto Checkpoint',
    '',
    'Session ended without an explicit `/checkpoint` command.',
    '',
    '## Context',
    '- CWD: ' + (cwd || 'unknown'),
    '- Session: ' + sessionId,
    '- Transcript: ' + transcriptPath,
    '- Branch: ' + (branch || 'unknown'),
    '- HEAD: ' + (head || 'unknown'),
    '',
    '## Working Tree',
    '```text',
    changed,
    '```',
    '',
    '## Next Step',
    'Review the transcript and run `/checkpoint` if this auto briefing is insufficient.',
    ''
  ].join('\n');
}

function writeCheckpoint(input, transcriptPath) {
  const baseDir = process.env.CLAUDE_AUTO_CHECKPOINT_DIR || path.join(os.homedir(), '.claude', 'auto-checkpoints');
  fs.mkdirSync(baseDir, { recursive: true });
  const filePath = path.join(baseDir, safeTimestamp() + '.md');
  fs.writeFileSync(filePath, buildBriefing(input, transcriptPath), 'utf8');
  metrics.inc(HOOK, 'written');
}

function main(inputOverride) {
  const input = inputOverride || readInput();
  if (!input) return;
  const cwd = normCwd((input && input.cwd) || '');
  const sessionId = input.session_id || input.sessionId;
  const transcriptPath = input.transcript_path || input.transcriptPath || findTranscript(sessionId);
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return;
  if (hasCheckpointCommand(transcriptPath)) {
    metrics.inc(HOOK, 'explicit_checkpoint_found');
    runProjectHandoffSync(cwd);
    return;
  }
  writeCheckpoint(input, transcriptPath);
  runProjectHandoffSync(cwd);
}

try {
  if (require.main === module) {
    main();
  }
} catch (err) {
  metrics.inc(HOOK, 'error');
  logger.error(HOOK, 'auto checkpoint failed', err);
}

module.exports = {
  main,
  hasCheckpointCommand,
  runProjectHandoffSync,
  buildBriefing
};
