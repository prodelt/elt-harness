#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  AGENTMEMORY_PORTS,
  buildComparisonReport,
  buildGovernanceSmoke,
  buildRecallPromptSet,
  checkAgentMemoryStatus,
  projectRagStatus,
  selectedMemoryProvider,
} = require('./memory-provider');

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-provider-'));
  fs.mkdirSync(path.join(root, '.rag'), { recursive: true });
  fs.writeFileSync(path.join(root, '.rag', 'queue.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(root, '.rag', 'manifest.json'), '{}\n', 'utf8');
  return root;
}

function testDefaultProviderIsProjectRag() {
  assert.equal(selectedMemoryProvider({}), 'project-rag');
  assert.equal(selectedMemoryProvider({ provider: 'agentmemory' }), 'agentmemory');
  assert.equal(selectedMemoryProvider({ provider: 'invalid' }), '');
}

function testAgentMemoryStatusCapturesCliAndPorts() {
  const report = checkAgentMemoryStatus(tempRoot(), {
    cliStatus: () => ({ status: 1, attemptedCommand: 'where.exe agentmemory', output: 'not found' }),
    portStatus: (root, port) => ({ open: port === 3111, attemptedCommand: `port ${port}`, detail: 'ok' }),
  });
  assert.equal(report.status, 'blocked');
  assert.equal(report.cli.available, false);
  assert.equal(report.ports.length, AGENTMEMORY_PORTS.length);
  assert.deepEqual(report.constraints.injection_budget_tokens, [1000, 2000]);
}

function testProjectRagStatusUsesExistingFiles() {
  const report = projectRagStatus(tempRoot());
  assert.equal(report.status, 'ready');
}

function testRecallPromptSetHasTwentyPrompts() {
  const report = buildRecallPromptSet();
  assert.equal(report.count, 20);
  assert.equal(report.prompts.length, 20);
}

function testComparisonKeepsProjectRagUntilAgentMemoryReady() {
  const report = buildComparisonReport(tempRoot(), {
    cliStatus: () => ({ status: 1, attemptedCommand: 'where.exe agentmemory', output: 'not found' }),
    portStatus: () => ({ open: false, attemptedCommand: 'port', detail: 'closed' }),
  });
  assert.equal(report.promotion.eligible, false);
  assert.equal(report.providers[0].provider, 'project-rag');
}

function testGovernanceSmokeBlocksWithoutHealthyCli() {
  const report = buildGovernanceSmoke(tempRoot(), {
    cliStatus: () => ({ status: 1, attemptedCommand: 'where.exe agentmemory', output: 'not found' }),
    portStatus: () => ({ open: false, attemptedCommand: 'port', detail: 'closed' }),
  });
  assert.equal(report.status, 'blocked');
  assert.ok(report.checks.every((check) => check.status === 'blocked'));
}

function main() {
  testDefaultProviderIsProjectRag();
  testAgentMemoryStatusCapturesCliAndPorts();
  testProjectRagStatusUsesExistingFiles();
  testRecallPromptSetHasTwentyPrompts();
  testComparisonKeepsProjectRagUntilAgentMemoryReady();
  testGovernanceSmokeBlocksWithoutHealthyCli();
  process.stdout.write('memory-provider tests: PASS\n');
}

main();
