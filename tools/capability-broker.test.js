'use strict';
// 020 T018 — Регресс для capability-broker.
//
// Broker контролює access до fs/git/network/secret/process для external pack'ів.
// Default policy: nothing allowed. Core pack: everything allowed.
// Denied операції мають бути явно logged.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  BROKER_SCHEMA,
  CAPABILITIES,
  DEFAULT_POLICY,
  CORE_POLICY,
  checkPermission,
  requestCapability,
  logCapabilityRequest,
  getPolicyForNode,
  checkNodeAvailability,
  validatePromptOnlyNode,
} = require('./capability-broker');

let tmpRoot = null;
function tmpDir() {
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-broker-'));
  return fs.mkdtempSync(path.join(tmpRoot, 'b-'));
}
function cleanup() {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
}

// Denied fs/git/network/secret/process: external pack не дозволяється читати secrets
function testDeniedFsRead() {
  const result = checkPermission(DEFAULT_POLICY, 'fs', 'read');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'denied-by-policy');
}

// Denied fs/git/network/secret/process: core pack може читати
function testCorePolicyAllowsFs() {
  const result = checkPermission(CORE_POLICY, 'fs', 'read');
  assert.equal(result.allowed, true);
}

// Denied git operations для external pack
function testDeniedGitForcePush() {
  const result = checkPermission(DEFAULT_POLICY, 'git', 'force-push');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'denied-by-policy');
}

// Denied secret read для external pack
function testDeniedSecretRead() {
  const result = checkPermission(DEFAULT_POLICY, 'secrets', 'read');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'denied-by-policy');
}

// Denied network для external pack
function testDeniedNetwork() {
  const result = checkPermission(DEFAULT_POLICY, 'network', 'raw-tcp');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'denied-by-policy');
}

// Denied process spawn для external pack
function testDeniedProcessSpawn() {
  const result = checkPermission(DEFAULT_POLICY, 'process', 'spawn-subprocess');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'denied-by-policy');
}

// Core pack дозволяється все
function testCorePackUnrestricted() {
  Object.keys(CAPABILITIES).forEach((capType) => {
    CAPABILITIES[capType].forEach((action) => {
      const result = checkPermission(CORE_POLICY, capType, action);
      assert.equal(result.allowed, true, `${capType}:${action} должен быть разрешён для core`);
    });
  });
}

// Request capability для core pack
function testRequestCapabilityCorePackGranted() {
  const result = requestCapability('elt/oracle', 'core', 'git', 'commit');
  assert.equal(result.granted, true);
  assert.equal(result.reason, 'core-pack-unrestricted');
}

// Request capability для external pack, denied
function testRequestCapabilityExternalPackDenied() {
  const result = requestCapability('external/node', 'reviewed', 'fs', 'write-append');
  assert.equal(result.granted, false);
  assert.equal(result.reason, 'denied-by-policy');
}

// Logging capability requests
function testLogCapabilityRequest() {
  const tmpdir = tmpDir();
  const logPath = path.join(tmpdir, 'broker.log');
  const request = {
    nodeId: 'external/node',
    capabilityType: 'fs',
    action: 'read',
    granted: false,
    ts: new Date().toISOString(),
  };
  const result = logCapabilityRequest(logPath, request);
  assert.equal(result.ok, true);
  const logged = fs.readFileSync(logPath, 'utf8');
  assert.ok(logged.includes('external/node'));
  assert.ok(logged.includes('fs'));
}

// Get policy для node'ів
function testGetPolicyForCoreNode() {
  const policy = getPolicyForNode('elt/oracle', 'core');
  assert.deepEqual(policy, CORE_POLICY);
}

function testGetPolicyForExternalNode() {
  const policy = getPolicyForNode('external/node', 'reviewed');
  assert.deepEqual(policy, DEFAULT_POLICY);
}

// Node availability check
function testNodeAvailabilityCoreAlways() {
  const result = checkNodeAvailability('elt/oracle', 'core', false);
  assert.equal(result.available, true);
}

function testNodeAvailabilityExternalNoPlatform() {
  const result = checkNodeAvailability('external/node', 'reviewed', false);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'unavailable');
}

function testNodeAvailabilityExternalWithPlatform() {
  const result = checkNodeAvailability('external/node', 'reviewed', true);
  assert.equal(result.available, true);
}

// Prompt-only node не можуть мати writes
function testPromptOnlyNodeValidation() {
  const result = validatePromptOnlyNode('prompt/node', { fs: ['read'] });
  assert.equal(result.ok, true);
}

function testPromptOnlyNodeWithWritesFails() {
  const result = validatePromptOnlyNode('prompt/node', { fs: ['write-append'] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'prompt-only-node-with-writes');
}

// Rollback generation receipt: логирование откатных операций
function testLogRollbackReceipt() {
  const tmpdir = tmpDir();
  const logPath = path.join(tmpdir, 'rollback.log');
  const rollbackRequest = {
    nodeId: 'elt/commit',
    operationType: 'rollback-generation',
    fromGeneration: 2,
    toGeneration: 1,
    reason: 'previous-generation-stale',
    ts: new Date().toISOString(),
  };
  const result = logCapabilityRequest(logPath, rollbackRequest);
  assert.equal(result.ok, true);
}

function main() {
  const tests = [
    testDeniedFsRead,
    testCorePolicyAllowsFs,
    testDeniedGitForcePush,
    testDeniedSecretRead,
    testDeniedNetwork,
    testDeniedProcessSpawn,
    testCorePackUnrestricted,
    testRequestCapabilityCorePackGranted,
    testRequestCapabilityExternalPackDenied,
    testLogCapabilityRequest,
    testGetPolicyForCoreNode,
    testGetPolicyForExternalNode,
    testNodeAvailabilityCoreAlways,
    testNodeAvailabilityExternalNoPlatform,
    testNodeAvailabilityExternalWithPlatform,
    testPromptOnlyNodeValidation,
    testPromptOnlyNodeWithWritesFails,
    testLogRollbackReceipt,
  ];
  console.log('Running capability-broker tests...');
  tests.forEach((test) => {
    try {
      test();
      console.log(`PASS: ${test.name}`);
    } catch (e) {
      console.error(`FAIL: ${test.name}`);
      console.error(e.message);
      process.exitCode = 1;
    }
  });
  cleanup();
  console.log('All tests completed.');
  if (process.exitCode === 1) process.exit(1);
}

if (require.main === module) main();
module.exports = {
  testDeniedFsRead,
  testCorePolicyAllowsFs,
  testDeniedGitForcePush,
  testDeniedSecretRead,
  testDeniedNetwork,
  testDeniedProcessSpawn,
  testCorePackUnrestricted,
  testRequestCapabilityCorePackGranted,
  testRequestCapabilityExternalPackDenied,
  testLogCapabilityRequest,
  testGetPolicyForCoreNode,
  testGetPolicyForExternalNode,
  testNodeAvailabilityCoreAlways,
  testNodeAvailabilityExternalNoPlatform,
  testNodeAvailabilityExternalWithPlatform,
  testPromptOnlyNodeValidation,
  testPromptOnlyNodeWithWritesFails,
  testLogRollbackReceipt,
};
