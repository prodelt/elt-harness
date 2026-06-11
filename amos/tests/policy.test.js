const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { loadPolicy, evaluateToolPolicy } = require('../lib/policy.js');

const AMOS_DIR = process.env.AMOS_HOME || path.join(os.homedir(), '.amos');
const AMOS_JS = path.join(AMOS_DIR, 'bin', 'amos.js');

function runAmos(args, env = {}, stdin = null) {
  const spawnEnv = { ...process.env, ...env };
  if (!env.hasOwnProperty('AMOS_PROFILE')) delete spawnEnv.AMOS_PROFILE;
  if (!env.hasOwnProperty('AMOS_DISABLE')) delete spawnEnv.AMOS_DISABLE;
  const options = { env: spawnEnv, encoding: 'utf8' };
  if (stdin !== null) options.input = typeof stdin === 'string' ? stdin : JSON.stringify(stdin);
  const result = cp.spawnSync('node', [AMOS_JS, ...args], options);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ==========================================
// lib/policy.js — pure unit tests
// ==========================================

test('loadPolicy: reads ~/.amos/policy.json with rules', () => {
  const policy = loadPolicy();
  assert.ok(Array.isArray(policy.rules));
  assert.ok(policy.rules.length >= 4);
});

test('loadPolicy: missing file returns empty rules (fail-soft)', () => {
  const policy = loadPolicy(path.join(os.tmpdir(), 'amos-policy-does-not-exist.json'));
  assert.deepStrictEqual(policy.rules, []);
});

test('loadPolicy: invalid JSON returns empty rules (fail-soft)', () => {
  const tmpFile = path.join(os.tmpdir(), `amos-policy-invalid-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, '{ not valid json', 'utf8');
  try {
    const policy = loadPolicy(tmpFile);
    assert.deepStrictEqual(policy.rules, []);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});

// ==========================================
// evaluateToolPolicy — deny+redirect matrix
// ==========================================

const DENY_MATRIX = [
  { tool: 'mcp__claude-in-chrome__navigate', ruleId: 'browser-mcp-claude-in-chrome', redirect: 'agent-browser' },
  { tool: 'mcp__claude-in-chrome__tabs_create_mcp', ruleId: 'browser-mcp-claude-in-chrome', redirect: 'agent-browser' },
  { tool: 'mcp__chrome-devtools__click', ruleId: 'browser-mcp-chrome-devtools', redirect: 'agent-browser' },
  { tool: 'mcp__chrome-devtools__navigate_page', ruleId: 'browser-mcp-chrome-devtools', redirect: 'agent-browser' },
  { tool: 'mcp__context7__resolve-library-id', ruleId: 'context7-mcp', redirect: 'context7-cli' },
  { tool: 'mcp__context7__query-docs', ruleId: 'context7-mcp', redirect: 'context7-cli' },
  { tool: 'WebSearch', ruleId: 'websearch-forbidden', redirect: 'agent-browser' }
];

for (const { tool, ruleId, redirect } of DENY_MATRIX) {
  test(`evaluateToolPolicy: ${tool} -> deny (${ruleId} -> ${redirect})`, () => {
    const rule = evaluateToolPolicy(tool);
    assert.ok(rule, `expected ${tool} to be denied`);
    assert.strictEqual(rule.id, ruleId);
    assert.strictEqual(rule.redirect, redirect);
    assert.ok(rule.message && rule.message.length > 0);
  });
}

const ALLOW_MATRIX = [
  'Read',
  'Edit',
  'Write',
  'Bash',
  'Glob',
  'Grep',
  'WebFetch',
  'mcp__codegraph__codegraph_search',
  'mcp__plugin_github_github__get_me',
  'mcp__claude_ai_Supabase__list_tables'
];

for (const tool of ALLOW_MATRIX) {
  test(`evaluateToolPolicy: ${tool} -> allow`, () => {
    assert.strictEqual(evaluateToolPolicy(tool), null);
  });
}

test('evaluateToolPolicy: empty/undefined tool name -> allow', () => {
  assert.strictEqual(evaluateToolPolicy(''), null);
  assert.strictEqual(evaluateToolPolicy(undefined), null);
});

// ==========================================
// amos event pre-tool — CLI integration matrix
// ==========================================

test('amos event pre-tool: denies mcp__claude-in-chrome__* with PreToolUse deny JSON', () => {
  const res = runAmos(['event', 'pre-tool'], {}, { hook_event_name: 'pre-tool', tool_name: 'mcp__claude-in-chrome__navigate' });
  assert.strictEqual(res.status, 0);
  const output = JSON.parse(res.stdout.trim());
  assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /agent-browser/);
});

test('amos event pre-tool: denies mcp__chrome-devtools__* with redirect to agent-browser', () => {
  const res = runAmos(['event', 'pre-tool'], {}, { hook_event_name: 'pre-tool', tool_name: 'mcp__chrome-devtools__click' });
  assert.strictEqual(res.status, 0);
  const output = JSON.parse(res.stdout.trim());
  assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /agent-browser/);
});

test('amos event pre-tool: denies mcp__context7__* with redirect to Context7 CLI', () => {
  const res = runAmos(['event', 'pre-tool'], {}, { hook_event_name: 'pre-tool', tool_name: 'mcp__context7__resolve-library-id' });
  assert.strictEqual(res.status, 0);
  const output = JSON.parse(res.stdout.trim());
  assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /ctx7|Context7 CLI/);
});

test('amos event pre-tool: denies WebSearch with redirect to agent-browser', () => {
  const res = runAmos(['event', 'pre-tool'], {}, { hook_event_name: 'pre-tool', tool_name: 'WebSearch' });
  assert.strictEqual(res.status, 0);
  const output = JSON.parse(res.stdout.trim());
  assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /agent-browser/);
});

test('amos event pre-tool: allows Read with silent (empty) stdout', () => {
  const res = runAmos(['event', 'pre-tool'], {}, { hook_event_name: 'pre-tool', tool_name: 'Read' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout.trim(), '');
});

test('amos event pre-tool: allows mcp__codegraph__* with silent (empty) stdout', () => {
  const res = runAmos(['event', 'pre-tool'], {}, { hook_event_name: 'pre-tool', tool_name: 'mcp__codegraph__codegraph_search' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout.trim(), '');
});

test('amos event pre-tool: missing tool_name -> silent allow', () => {
  const res = runAmos(['event', 'pre-tool'], {}, { hook_event_name: 'pre-tool' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout.trim(), '');
});

test('amos event pre-tool: AMOS_DISABLE=1 -> silent exit 0 even for blocked tool', () => {
  const res = runAmos(['event', 'pre-tool'], { AMOS_DISABLE: '1' }, { hook_event_name: 'pre-tool', tool_name: 'WebSearch' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout.trim(), '');
});
