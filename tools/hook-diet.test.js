#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCandidates, buildInventory, classifyHook } = require('./hook-diet');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value), 'utf8');
}

function tempFiles() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-diet-'));
  const claudeFile = path.join(root, 'settings.json');
  const codexFile = path.join(root, 'hooks.json');
  const metricsFile = path.join(root, 'metrics.json');
  const errorsLog = path.join(root, 'errors.log');
  writeJson(claudeFile, {
    hooks: {
      SessionStart: [{ hooks: [{ command: 'node hooks/projects-dashboard.js' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'node hooks/secret-scanner.js' }] }],
    },
  });
  writeJson(codexFile, {
    hooks: {
      PostToolUse: [{ matcher: 'Bash', hooks: [{ command: 'node hooks/context7-tracker.js' }, { command: 'node hooks/bash-output-advisor.js' }] }],
    },
  });
  writeJson(metricsFile, {
    _updated: '2026-05-20T00:00:00.000Z',
    hooks: {
      'secret-scanner': { fired: 3, blocked: 1, error: 0, _avgMs: 7, _lastSeen: '2026-05-20T00:00:00.000Z' },
      'projects-dashboard': { fired: 2, warned: 1, _avgMs: 11 },
    },
  });
  fs.writeFileSync(errorsLog, '[ERROR] projects-dashboard: EPERM\n', 'utf8');
  return { claudeFile, codexFile, metricsFile, errorsLog };
}

function testClassifiesHookCommands() {
  assert.equal(classifyHook('node hooks/secret-scanner.js'), 'hard-block');
  assert.equal(classifyHook('node hooks/projects-dashboard.js'), 'background');
  assert.equal(classifyHook('node hooks/context7-tracker.js'), 'telemetry');
  assert.equal(classifyHook('node hooks/bash-output-advisor.js'), 'advisory');
}

function testBuildInventoryIncludesEvidenceFields() {
  const files = tempFiles();
  const report = buildInventory(files);
  assert.equal(report.kind, 'hook-diet-inventory');
  assert.equal(report.summary.total, 4);
  assert.equal(report.summary.by_class['hard-block'], 1);
  assert.ok(report.summary.duplicate_groups.some((group) => group.count === 2));
  assert.ok(report.hooks.every((hook) => hook.failure_policy));
  assert.ok(report.hooks.every((hook) => hook.rollback));
  assert.ok(report.hooks.every((hook) => hook.evidence_required.includes('output_chars')));
  assert.equal(report.sources.metrics.ok, true);
  assert.equal(report.sources.errors.error_lines, 1);
  assert.ok(report.evidence_summary.hooks_with_runtime_metrics >= 2);
  assert.equal(report.hooks.find((hook) => hook.name === 'secret-scanner').evidence.block_count, 1);
}

function testSummaryCliKeepsOutputCompact() {
  const files = tempFiles();
  const completed = spawnSync(process.execPath, [
    path.join(__dirname, 'hook-diet.js'),
    '--summary',
    '--claude-file',
    files.claudeFile,
    '--codex-file',
    files.codexFile,
    '--metrics-file',
    files.metricsFile,
    '--errors-log',
    files.errorsLog,
  ], { encoding: 'utf8' });
  assert.equal(completed.status, 0);
  const parsed = JSON.parse(completed.stdout);
  assert.equal(parsed.total, 4);
  assert.ok(completed.stdout.length < 1000);
}

function testOutFileWritesFullInventory() {
  const files = tempFiles();
  const out = path.join(path.dirname(files.claudeFile), 'inventory.json');
  const completed = spawnSync(process.execPath, [
    path.join(__dirname, 'hook-diet.js'),
    '--summary',
    '--claude-file',
    files.claudeFile,
    '--codex-file',
    files.codexFile,
    '--metrics-file',
    files.metricsFile,
    '--errors-log',
    files.errorsLog,
    '--out',
    out,
  ], { encoding: 'utf8' });
  assert.equal(completed.status, 0);
  const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(parsed.hooks.length, 4);
  assert.equal(parsed.summary.total, 4);
}

function testCandidatesBlockRemovalWithoutOutputChars() {
  const files = tempFiles();
  const report = buildInventory(files);
  const candidates = buildCandidates(report);
  assert.equal(candidates.kind, 'hook-diet-candidates');
  assert.equal(candidates.summary.eligible_for_removal, 0);
  assert.ok(candidates.candidates.some((candidate) => candidate.reason === 'missing output_chars evidence'));
  assert.ok(candidates.candidates.some((candidate) => /hard-block/.test(candidate.reason)));
}

function main() {
  testClassifiesHookCommands();
  testBuildInventoryIncludesEvidenceFields();
  testSummaryCliKeepsOutputCompact();
  testOutFileWritesFullInventory();
  testCandidatesBlockRemovalWithoutOutputChars();
  process.stdout.write('hook-diet tests: PASS\n');
}

main();
