#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { analyzeJsonl, compareReports, measureCommand } = require('./token-impact');

function tempFile(name, lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'token-impact-'));
  const file = path.join(root, name);
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return file;
}

function testAnalyzeCountsToolOutputAndFileReads() {
  const file = tempFile('session.jsonl', [
    { payload: { type: 'function_call', name: 'functions.shell_command', arguments: '{"command":"Get-Content file.js"}' } },
    { payload: { type: 'function_call_output', output: 'x'.repeat(100) }, usage: { total_tokens: 12 } },
    { payload: { type: 'function_call', name: 'web_search' } },
  ]);
  const report = analyzeJsonl(file);
  assert.equal(report.lines, 3);
  assert.equal(report.tool_output_chars, 100);
  assert.equal(report.file_read_events, 1);
  assert.equal(report.full_file_read_risk_events, 1);
  assert.equal(report.token_usage.total, 12);
}

function testCompareReportsShowsProxyDeltas() {
  const before = tempFile('before.jsonl', [
    { payload: { type: 'function_call', name: 'functions.shell_command', arguments: '{"command":"Get-Content big.js"}' } },
    { payload: { type: 'function_call_output', output: 'x'.repeat(200) } },
  ]);
  const after = tempFile('after.jsonl', [
    { payload: { type: 'function_call', name: 'functions.shell_command', arguments: '{"command":"Select-String big.js"}' } },
    { payload: { type: 'function_call_output', output: 'x'.repeat(50) } },
  ]);
  const comparison = compareReports(analyzeJsonl(before), analyzeJsonl(after));
  assert.equal(comparison.delta.tool_output_chars, -150);
  assert.equal(comparison.verdict, 'token telemetry missing; use proxy metrics only');
}

function testMeasureCommandCountsOutput() {
  const report = measureCommand(process.execPath, ['-e', 'console.log("ok")'], process.cwd());
  assert.equal(report.status, 0);
  assert.ok(report.output_chars >= 2);
  assert.equal(report.output_lines, 1);
}

function main() {
  testAnalyzeCountsToolOutputAndFileReads();
  testCompareReportsShowsProxyDeltas();
  testMeasureCommandCountsOutput();
  process.stdout.write('token-impact tests: PASS\n');
}

main();
