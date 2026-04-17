#!/usr/bin/env node

/**
 * Codex Hooks Test Suite
 * Reads hooks.json, runs each hook with realistic mock input, validates output.
 * Usage: node ~/.codex/test-codex-hooks.js
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const HOOKS_JSON = path.join(os.homedir(), '.codex', 'hooks.json');
const HOOKS_DIR  = path.join(os.homedir(), '.claude', 'hooks');

// ── Mock inputs per tool name ─────────────────────────────────────────────────
const MOCKS = {
  session:    JSON.stringify({ cwd: 'C:/Users/user', sessionId: 'codex-test-123' }),
  prompt:     JSON.stringify({ prompt: 'Fix the bug', cwd: 'C:/Users/user', context: { totalTokens: 5000 } }),
  read:       JSON.stringify({ tool_name: 'Read',    tool_input: { file_path: 'C:/Users/user/.claude/hooks/test-all-hooks.js' }, cwd: 'C:/Users/user' }),
  glob:       JSON.stringify({ tool_name: 'Glob',    tool_input: { pattern: '*.ts' }, cwd: 'C:/Users/user' }),
  edit:       JSON.stringify({ tool_name: 'Edit',    tool_input: { file_path: 'src/test.ts', content: 'x' }, cwd: 'C:/Users/user' }),
  bash:       JSON.stringify({ tool_name: 'Bash',    tool_input: { command: 'npm test' }, cwd: 'C:/Users/user' }),
  post_edit:  JSON.stringify({ tool_name: 'Edit',    tool_input: { file_path: 'src/test.ts' }, tool_response: { content: 'ok' }, cwd: 'C:/Users/user' }),
  post_bash:  JSON.stringify({ tool_name: 'Bash',    tool_input: { command: 'npm test' }, tool_response: { content: 'passed' }, cwd: 'C:/Users/user' }),
  post_agent: JSON.stringify({ tool_name: 'Agent',   tool_input: { subagent_type: 'code-reviewer' }, tool_response: {}, cwd: 'C:/Users/user' }),
  post_skill: JSON.stringify({ tool_name: 'Skill',   tool_input: { skill: 'pipeline' }, tool_response: {}, cwd: 'C:/Users/user' }),
  post_task:  JSON.stringify({ tool_name: 'TaskCreate', tool_input: { title: 'test' }, tool_response: { id: '1' }, cwd: 'C:/Users/user' }),
  post_ctx7:  JSON.stringify({ tool_name: 'mcp__context7__resolve-library-id', tool_input: { libraryName: 'react' }, tool_response: {}, cwd: 'C:/Users/user' }),
  stop:       JSON.stringify({ cwd: 'C:/Users/user', sessionId: 'codex-test-123' }),
};

// ── Pick mock based on event + matcher ───────────────────────────────────────
function pickMock(event, matcher) {
  if (event === 'SessionStart')      return MOCKS.session;
  if (event === 'UserPromptSubmit')  return MOCKS.prompt;
  if (event === 'Stop')              return MOCKS.stop;
  if (event === 'PreToolUse') {
    if (!matcher)                    return MOCKS.edit;
    if (/Read/i.test(matcher))       return MOCKS.read;
    if (/Glob|Grep/i.test(matcher))  return MOCKS.glob;
    if (/Write|Edit/i.test(matcher)) return MOCKS.edit;
    if (/Bash/i.test(matcher))       return MOCKS.bash;
  }
  if (event === 'PostToolUse') {
    if (!matcher)                       return MOCKS.post_edit;
    if (/Agent/i.test(matcher))         return MOCKS.post_agent;
    if (/Skill/i.test(matcher))         return MOCKS.post_skill;
    if (/TaskCreate/i.test(matcher))    return MOCKS.post_task;
    if (/context7/i.test(matcher))      return MOCKS.post_ctx7;
    if (/Bash/.test(matcher))           return MOCKS.post_bash;
    if (/Edit|Write/.test(matcher))     return MOCKS.post_edit;
  }
  return MOCKS.session;
}

// ── Stop hooks use {decision,reason} not hookSpecificOutput ──────────────────
const DECISION_HOOKS = ['stop-verification.js', 'ship-gate.js', 'task-completed-gate.js'];

// ── Load and flatten hooks from hooks.json ────────────────────────────────────
let config;
try {
  config = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
} catch(e) {
  console.error('FATAL: cannot read hooks.json —', e.message);
  process.exit(1);
}

const rows = []; // { event, matcher, hookFile, description }
for (const [event, blocks] of Object.entries(config.hooks)) {
  for (const block of blocks) {
    const matcher = block.matcher || '';
    for (const h of block.hooks) {
      const hookFile = path.basename(h.command.split(' ').pop());
      rows.push({ event, matcher, hookFile, description: `${event}[${matcher||'*'}]: ${hookFile}` });
    }
  }
}

// ── Clean stateful hook state so stale history can't cross tests ─────────────
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {} }
rmrf(path.join(os.tmpdir(), 'claude-loop-guardian'));
rmrf(path.join(os.tmpdir(), 'claude-context-gate'));
rmrf(path.join(os.tmpdir(), 'claude-session-focus'));

// ── Run tests ─────────────────────────────────────────────────────────────────
const results = { pass: 0, fail: 0, errors: [] };

console.log('\n🔍 Codex Hooks Test Suite');
console.log('='.repeat(70));
console.log(`  Source: ${HOOKS_JSON}`);
console.log(`  Hooks dir: ${HOOKS_DIR}`);
console.log('='.repeat(70));

for (const { event, matcher, hookFile, description } of rows) {
  const hookPath = path.join(HOOKS_DIR, hookFile);
  const mockInput = pickMock(event, matcher);

  if (!fs.existsSync(hookPath)) {
    console.log(`  ❌ MISSING  ${hookFile.padEnd(38)} ${description}`);
    results.fail++;
    results.errors.push(`MISSING: ${hookFile} (referenced in codex hooks.json)`);
    continue;
  }

  const result = spawnSync('node', [hookPath], {
    input: mockInput,
    encoding: 'utf8',
    timeout: 5000,
  });

  const stdout    = result.stdout || '';
  const stderr    = result.stderr || '';
  const exitCode  = result.status;
  const isDecision = DECISION_HOOKS.includes(hookFile);

  let ok = exitCode === 0;
  if (ok && stdout.trim()) {
    try {
      const parsed = JSON.parse(stdout.trim());
      if (isDecision && !parsed.decision)           ok = false;
      if (!isDecision && !parsed.hookSpecificOutput) ok = false;
    } catch {
      ok = false;
    }
  }

  const criticalStderr = stderr && !stderr.includes('ExperimentalWarning') && !stderr.includes('DeprecationWarning');

  if (ok && !criticalStderr) {
    console.log(`  ✅ PASS     ${hookFile.padEnd(38)} ${description}`);
    results.pass++;
  } else {
    const reason = !ok
      ? `exit=${exitCode} stdout=${stdout.slice(0,80).replace(/\n/g,' ')}`
      : `stderr=${stderr.slice(0,80).replace(/\n/g,' ')}`;
    console.log(`  ❌ FAIL     ${hookFile.padEnd(38)} ${description}`);
    console.log(`             reason: ${reason}`);
    results.fail++;
    results.errors.push(`FAIL: ${hookFile} — ${reason}`);
  }
}

console.log('='.repeat(70));
console.log(`\nResult: ${results.pass}/${rows.length} PASS, ${results.fail} FAIL`);
if (results.errors.length > 0) {
  console.log('\nFailed:');
  results.errors.forEach(e => console.log('  •', e));
}
console.log('');
process.exit(results.fail > 0 ? 1 : 0);
