#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const hookPath = path.join(os.homedir(), '.claude', 'hooks', 'session-focus-gate.js');

function writeTranscript(projectDir, sessionId, focus, doneCriteria, timestamp) {
  const payload = [
    { type: 'user', timestamp, message: { role: 'user', content: `Focus: ${focus}\nDone when: ${doneCriteria}` } }
  ];
  fs.writeFileSync(
    path.join(projectDir, `${sessionId}.jsonl`),
    payload.map(line => JSON.stringify(line)).join('\n') + '\n',
    'utf8'
  );
}

function runHook(env, cwd, sessionId) {
  return spawnSync('node', [hookPath], {
    input: JSON.stringify({ cwd, sessionId }),
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env, ...env }
  });
}

function encodeProjectDir(cwd) {
  return cwd.replace(/\\/g, '/').replace(/^([a-z]):/, (_, drive) => `${drive.toUpperCase()}:`).replace(/:/g, '-').replace(/\//g, '-');
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'session-focus-gate-test-'));
  const projectsDir = path.join(tempRoot, 'projects');
  const focusDir = path.join(tempRoot, 'session-focus');
  const focusLogPath = path.join(tempRoot, 'focus-log.jsonl');
  const cwd = 'C:/Claude playground/Pipiline setupper';
  const projectDir = path.join(projectsDir, encodeProjectDir(cwd));

  fs.mkdirSync(projectDir, { recursive: true });

  const env = {
    CLAUDE_PROJECTS_DIR: projectsDir,
    CLAUDE_FOCUS_LOG_PATH: focusLogPath,
    CLAUDE_SESSION_FOCUS_DIR: focusDir
  };

  writeTranscript(projectDir, 'session-1', 'close task 10', 'focus-log contains first session', '2026-04-22T08:00:00.000Z');
  let result = runHook(env, cwd, 'live-session-1');
  assert.equal(result.status, 0, `first run failed: ${result.stderr}`);

  writeTranscript(projectDir, 'session-2', 'verify hook tests', 'full suites stay green', '2026-04-22T09:00:00.000Z');
  result = runHook(env, cwd, 'live-session-2');
  assert.equal(result.status, 0, `second run failed: ${result.stderr}`);

  writeTranscript(projectDir, 'session-3', 'prepare handoff', 'NEXT_SESSION_PROMPT points to task 12', '2026-04-22T10:00:00.000Z');
  result = runHook(env, cwd, 'live-session-3');
  assert.equal(result.status, 0, `third run failed: ${result.stderr}`);

  const rows = fs.readFileSync(focusLogPath, 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  assert.equal(rows.length, 3, `expected 3 focus-log rows, got ${rows.length}`);
  assert.deepEqual(
    rows.map(row => row.focus),
    ['close task 10', 'verify hook tests', 'prepare handoff']
  );
  assert.deepEqual(
    rows.map(row => row.doneCriteria),
    ['focus-log contains first session', 'full suites stay green', 'NEXT_SESSION_PROMPT points to task 12']
  );
  assert.ok(rows.every(row => row.project === cwd), 'project field should keep normalized cwd');

  console.log('PASS session-focus-gate.test.js');
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

main();
