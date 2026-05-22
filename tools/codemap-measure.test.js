#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildMeasurement } = require('./codemap-measure');

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-measure-'));
  fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tools', 'doctor.js'), '', 'utf8');
  fs.writeFileSync(path.join(root, 'tools', 'codemap.test.js'), '', 'utf8');
  return root;
}

function testMeasurementIncludesClaudeAndCodexTasks() {
  const report = buildMeasurement(tempRoot());
  assert.equal(report.kind, 'codemap-measurement');
  assert.equal(report.tasks.length, 2);
  assert.ok(report.tasks.some((task) => task.runner === 'Claude'));
  assert.ok(report.tasks.some((task) => task.runner === 'Codex'));
  assert.ok(report.tasks.every((task) => Number.isInteger(task.tool_calls)));
  assert.ok(report.tasks.every((task) => Number.isInteger(task.file_reads)));
}

function main() {
  testMeasurementIncludesClaudeAndCodexTasks();
  process.stdout.write('codemap-measure tests: PASS\n');
}

main();
