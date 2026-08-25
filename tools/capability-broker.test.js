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
  runExternalNode,
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


// ── 020 T018 (поколение 2): тесты НАСТОЯЩЕЙ границы ──────────────────────────────────────
// Прежние тесты проверяли те же таблицы policy, что и реализация, — то есть согласованность
// объекта с самим собой. Ниже проверяются ПОПЫТКИ: узел реально запускается и реально
// упирается в границу. Каждый тест краснеет, если границу убрать.

const sandboxes = [];
function sandbox(entrySource) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-sandbox-'));
  sandboxes.push(dir);
  fs.writeFileSync(path.join(dir, 'node.js'), entrySource);
  return dir;
}
function cleanupSandboxes() {
  for (const d of sandboxes) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* уборка не гейт */ } }
}

// Главное свойство: секреты host'а физически недоступны. Не «мы их не передаём по политике»,
// а «их нет в процессе»: узел печатает то, что видит, и мы это читаем.
function testExternalNodeCannotSeeHostSecrets() {
  const dir = sandbox([
    "const leaked = ['GH_TOKEN','ANTHROPIC_API_KEY','AWS_SECRET_ACCESS_KEY','ELT_GATE_TRUST_ORACLE']",
    "  .filter((k) => process.env[k]);",
    "process.stdout.write('ELT-PROPOSAL:' + JSON.stringify({ leaked, sandbox: process.env.ELT_SANDBOX }) + '\\n');",
  ].join('\n'));
  const before = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'секрет-который-не-должен-уехать';
  try {
    const r = runExternalNode({ nodeId: 'grail/probe', entryFile: 'node.js', sandboxDir: dir });
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(r.proposal.leaked, [], 'ни одна секретная переменная не имеет права доехать до внешнего узла');
    assert.equal(r.proposal.sandbox, '1');
  } finally {
    if (before === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = before;
  }
}

// Запрещённая способность — отказ, а не «записали в лог и пошли дальше».
function testDeniedCapabilityStopsTheNode() {
  const dir = sandbox([
    "process.stdout.write('ELT-BROKER:' + JSON.stringify({ capability: 'git', action: 'commit' }) + '\\n');",
    "process.stdout.write('ELT-PROPOSAL:' + JSON.stringify({ did: 'commit' }) + '\\n');",
  ].join('\n'));
  const log = path.join(dir, 'broker.log');
  const r = runExternalNode({ nodeId: 'grail/committer', entryFile: 'node.js', sandboxDir: dir, brokerLog: log });
  assert.equal(r.ok, false);
  assert.equal(r.state, 'denied');
  assert.equal(r.denied[0].capability, 'git');
  assert.ok(fs.existsSync(log), 'запрос обязан остаться в журнале брокера');
  assert.match(fs.readFileSync(log, 'utf8'), /"granted":false/);
}

// Пять классов способностей — пять отказов. Ни один не имеет права оказаться разрешённым
// по умолчанию: default-empty toolset и есть смысл всей конструкции.
function testEveryCapabilityClassIsDeniedByDefault() {
  for (const [capability, action] of [['fs', 'write-append'], ['git', 'force-push'], ['network', 'https-fetch'], ['secrets', 'read'], ['process', 'spawn-subprocess']]) {
    const dir = sandbox(`process.stdout.write('ELT-BROKER:' + JSON.stringify({ capability: ${JSON.stringify(capability)}, action: ${JSON.stringify(action)} }) + '\\n');`);
    const r = runExternalNode({ nodeId: 'grail/x', entryFile: 'node.js', sandboxDir: dir });
    assert.equal(r.state, 'denied', `${capability}/${action} обязана быть запрещена внешнему узлу`);
  }
}

// Вход вне песочницы отвергается ДО запуска: иначе `../../tools/elt.js` исполнился бы как
// «узел pack'а» с правами родителя.
function testEntryOutsideSandboxIsRefusedBeforeSpawn() {
  const dir = sandbox('process.stdout.write("ELT-PROPOSAL:{}\\n");');
  const r = runExternalNode({ nodeId: 'grail/escape', entryFile: path.join('..', '..', 'tools', 'elt.js'), sandboxDir: dir });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'entry-outside-sandbox');
}

// Нет границы — нет исполнения. Состояние `unavailable`, а не «выполним как получится».
function testWithoutIsolationNodeIsUnavailable() {
  const dir = sandbox('process.stdout.write("ELT-PROPOSAL:{}\\n");');
  const brokenRunner = () => ({ status: 1, stdout: '', stderr: 'no spawn here' });
  const r = runExternalNode({ nodeId: 'grail/x', entryFile: 'node.js', sandboxDir: dir, runner: brokenRunner });
  assert.equal(r.state, 'unavailable');
  assert.equal(r.ok, false);
}

// Узел без schema-validated proposal не считается отработавшим: «ничего не вернул» — это не
// «согласился».
function testNodeWithoutProposalIsError() {
  const dir = sandbox('process.stdout.write("просто текст\\n");');
  const r = runExternalNode({ nodeId: 'grail/mute', entryFile: 'node.js', sandboxDir: dir });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-schema-valid-proposal');
}

// Core-узел через брокер не исполняется вовсе: ядро — это та сторона, которая выдаёт
// способности, и пропускать его через песочницу значило бы делать вид, что оно ограничено.
function testCoreNodeIsNotRunThroughBroker() {
  const dir = sandbox('process.stdout.write("ELT-PROPOSAL:{}\\n");');
  const r = runExternalNode({ nodeId: 'elt/oracle', trust: 'core', entryFile: 'node.js', sandboxDir: dir });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'core-node-must-not-run-through-broker');
}

function main() {
  const tests = [
    testExternalNodeCannotSeeHostSecrets,
    testDeniedCapabilityStopsTheNode,
    testEveryCapabilityClassIsDeniedByDefault,
    testEntryOutsideSandboxIsRefusedBeforeSpawn,
    testWithoutIsolationNodeIsUnavailable,
    testNodeWithoutProposalIsError,
    testCoreNodeIsNotRunThroughBroker,
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
  cleanupSandboxes();
  if (process.exitCode === 1) { console.error('capability-broker tests: FAIL'); process.exit(1); }
  console.log('capability-broker tests: PASS');
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
