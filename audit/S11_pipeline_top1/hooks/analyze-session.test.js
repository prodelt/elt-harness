#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { analyzeFile } = require('./analyze-session');

const writeJsonl = (dir, name, records) => {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
  return filePath;
};

const runAnalyzer = (filePath) => {
  return analyzeFile(filePath);
};

const withTempDir = (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-session-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const assertIncludes = (text, expected) => {
  assert.ok(text.includes(expected), `Expected output to include: ${expected}`);
};

const codexFixture = () => [
  { type: 'session_meta', payload: { id: 'codex-fixture' } },
  { type: 'response_item', payload: { type: 'function_call', name: 'shell_command', call_id: 'call_1', arguments: '{"command":"dir"}' } },
  { type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_1', output: 'alpha output' } },
  { type: 'event_msg', payload: { type: 'exec_command_end', call_id: 'call_1', stdout: 'beta output', stderr: '' } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done' }] } },
  { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 100 } } } },
];

const claudeFixture = () => [
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: 'C:\\repo\\file.js' } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'file body' }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'summary' }] } },
];

withTempDir((dir) => {
  const codexOutput = runAnalyzer(writeJsonl(dir, 'codex.jsonl', codexFixture()));
  assertIncludes(codexOutput, 'Format: codex');
  assertIncludes(codexOutput, 'response_item/function_call_output');
  assertIncludes(codexOutput, 'shell_command');
  assertIncludes(codexOutput, 'Token usage: last=100 max=100');

  const claudeOutput = runAnalyzer(writeJsonl(dir, 'claude.jsonl', claudeFixture()));
  assertIncludes(claudeOutput, 'Format: claude');
  assertIncludes(claudeOutput, 'Tool outputs by tool:');
  assertIncludes(claudeOutput, 'Read');
  assertIncludes(claudeOutput, 'C:\\repo\\file.js');
});

process.stdout.write('analyze-session tests passed\n');
