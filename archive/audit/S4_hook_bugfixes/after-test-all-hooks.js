#!/usr/bin/env node

/**
 * Hook System Test Suite
 * Tests all 23 hooks for basic sanity: valid JSON output or silent exit.
 * Usage: node ~/.claude/hooks/test-all-hooks.js
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const HOOKS_DIR = path.join(os.homedir(), '.claude', 'hooks');

// Mock inputs per hook type
const MOCKS = {
  // SessionStart hooks
  'session': JSON.stringify({ cwd: 'C:/Users/user', sessionId: 'test-123' }),
  // PreToolUse Write/Edit
  'edit': JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/test.ts', content: 'x' }, cwd: 'C:/Users/user' }),
  // PreToolUse Bash
  'bash': JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' }, cwd: 'C:/Users/user' }),
  // PreToolUse Glob/Grep (graphify-preuse)
  'glob': JSON.stringify({ tool_name: 'Glob', tool_input: { pattern: '*.ts' }, cwd: 'C:/Users/user' }),
  // PostToolUse
  'post_edit': JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'src/test.ts' }, tool_response: { content: 'ok' }, cwd: 'C:/Users/user' }),
  'post_bash': JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { content: 'passed' }, cwd: 'C:/Users/user' }),
  'post_agent': JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: 'code-reviewer' }, tool_response: {}, cwd: 'C:/Users/user' }),
  'post_skill': JSON.stringify({ tool_name: 'Skill', tool_input: { skill: 'pipeline' }, tool_response: {}, cwd: 'C:/Users/user' }),
  'post_task': JSON.stringify({ tool_name: 'TaskCreate', tool_input: { title: 'test' }, tool_response: { id: '1' }, cwd: 'C:/Users/user' }),
  'post_ctx7': JSON.stringify({ tool_name: 'mcp__context7__resolve-library-id', tool_input: { libraryName: 'react' }, tool_response: {}, cwd: 'C:/Users/user' }),
  // Stop
  'stop': JSON.stringify({ cwd: 'C:/Users/user', sessionId: 'test-123' }),
  // Notification
  'notification': JSON.stringify({ notification: { type: 'TaskCompleted', taskId: '1' }, cwd: 'C:/Users/user' }),
  // UserPromptSubmit
  'prompt': JSON.stringify({ prompt: 'Hello', cwd: 'C:/Users/user', context: { totalTokens: 5000 } }),
  // PreToolUse Read
  'read': JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'C:/Users/user/.claude/hooks/test-all-hooks.js' }, cwd: 'C:/Users/user' }),
};

// Hook definitions: [filename, mock_key, description]
const HOOKS = [
  // SessionStart
  ['session-focus-gate.js',     'session',       'SessionStart: focus gate'],
  ['project-docs-gate.js',      'session',       'SessionStart: docs gate'],
  ['autoskills-check.js',       'session',       'SessionStart: autoskills'],
  ['graphify-session-init.js',  'session',       'SessionStart: graphify init'],
  ['memory-discipline.js',      'session',       'SessionStart: memory discipline'],
  // UserPromptSubmit
  ['context-budget-gate.js',    'prompt',        'UserPromptSubmit: budget gate'],
  // PreToolUse
  ['graphify-read-gate.js',     'read',          'PreToolUse Read: graphify gate'],
  ['graphify-preuse.js',        'glob',          'PreToolUse Glob|Grep: graphify'],
  ['config-protection.js',      'edit',          'PreToolUse Write|Edit: config protect'],
  ['domain-agent-gate.js',      'edit',          'PreToolUse Write|Edit: domain gate'],
  ['edit-enforcer.js',          'edit',          'PreToolUse Write|Edit: enforcer'],
  ['secret-scanner.js',         'bash',          'PreToolUse Bash: secret scan'],
  ['quality-gate-runner.js',    'bash',          'PreToolUse Bash: quality gate'],
  // PostToolUse
  ['post-edit-combined.js',     'post_edit',     'PostToolUse Edit|Write: combined'],
  ['context7-reminder.js',      'post_edit',     'PostToolUse Edit|Write: ctx7 reminder'],
  ['inline-review-gate.js',     'post_edit',     'PostToolUse Edit|Write: inline review'],
  ['verification-tracker.js',   'post_bash',     'PostToolUse Edit|Write|Bash: verify'],
  ['loop-guardian.js',          'post_bash',     'PostToolUse Edit|Write|Bash: loop guard'],
  ['secret-output-scanner.js',  'post_bash',     'PostToolUse Bash: output scan'],
  ['inline-review-tracker.js',  'post_agent',    'PostToolUse Agent: review tracker'],
  ['pipeline-tracker.js',       'post_skill',    'PostToolUse Skill: pipeline tracker'],
  ['scope-guard.js',            'post_task',     'PostToolUse TaskCreate: scope guard'],
  ['context7-tracker.js',       'post_ctx7',     'PostToolUse Context7: tracker'],
  // Stop
  ['stop-verification.js',      'stop',          'Stop: verification'],
  ['ship-gate.js',              'stop',          'Stop: ship gate'],
  // Notification
  ['task-completed-gate.js',    'notification',  'Notification TaskCompleted: gate'],
];

// Clear stateful hook state so stale history can't cross tests
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
rmrf(path.join(os.tmpdir(), 'claude-loop-guardian'));
rmrf(path.join(os.tmpdir(), 'claude-context-gate'));
rmrf(path.join(os.tmpdir(), 'claude-session-focus'));

const results = { pass: 0, fail: 0, errors: [] };

console.log('\n🔍 Hook System Test Suite');
console.log('='.repeat(65));

for (const [hookFile, mockKey, description] of HOOKS) {
  const hookPath = path.join(HOOKS_DIR, hookFile);
  const mockInput = MOCKS[mockKey] || MOCKS['session'];

  if (!fs.existsSync(hookPath)) {
    console.log(`  ❌ MISSING  ${hookFile.padEnd(35)} ${description}`);
    results.fail++;
    results.errors.push(`MISSING: ${hookFile}`);
    continue;
  }

  const result = spawnSync('node', [hookPath], {
    input: mockInput,
    encoding: 'utf8',
    timeout: 5000,
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const exitCode = result.status;

  // Validate: exit 0 AND (empty stdout OR valid JSON)
  // Stop + Notification hooks use {decision, reason} format (not hookSpecificOutput)
  const isDecisionHook = ['task-completed-gate.js', 'stop-verification.js', 'ship-gate.js'].includes(hookFile);
  let ok = exitCode === 0;
  if (ok && stdout.trim()) {
    try {
      const parsed = JSON.parse(stdout.trim());
      // Stop/Notification hooks: {decision, reason} is valid
      // PreToolUse/PostToolUse hooks: must have hookSpecificOutput
      if (!isDecisionHook && !parsed.hookSpecificOutput) ok = false;
      if (isDecisionHook && !parsed.decision) ok = false;
    } catch {
      ok = false;
    }
  }
  // Ignore benign stderr (Node.js warnings etc)
  const hasCriticalStderr = stderr && !stderr.includes('ExperimentalWarning') && !stderr.includes('DeprecationWarning');

  if (ok && !hasCriticalStderr) {
    console.log(`  ✅ PASS     ${hookFile.padEnd(35)} ${description}`);
    results.pass++;
  } else {
    const reason = !ok ? `exit=${exitCode}, stdout=${stdout.slice(0,80)}` : `stderr=${stderr.slice(0,80)}`;
    console.log(`  ❌ FAIL     ${hookFile.padEnd(35)} ${description}`);
    console.log(`             reason: ${reason}`);
    results.fail++;
    results.errors.push(`FAIL: ${hookFile} — ${reason}`);
  }
}

console.log('='.repeat(65));
console.log(`\nResult: ${results.pass}/${HOOKS.length} PASS, ${results.fail} FAIL`);
if (results.errors.length > 0) {
  console.log('\nFailed hooks:');
  results.errors.forEach(e => console.log(' •', e));
}
console.log('\nFor behavioral (BLOCK/ALLOW) tests:');
console.log('  node ~/.claude/hooks/test-hooks-behavior.js');
console.log('\nFor Codex hooks sync test:');
console.log('  node ~/.codex/test-codex-hooks.js');
console.log('');
process.exit(results.fail > 0 ? 1 : 0);
