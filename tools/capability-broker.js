'use strict';
// 020 T018 — Core capability broker для сандбокса external pack'ів.
//
// Правило: external executable node не может прямо запустити fs/git/network/secret/process.
// Все must go through this broker, який:
//   • перевіряє declared intent у manifest
//   • дозволяє або відмовляє на підставі policy
//   • журналює request/result для audit
//   • НЕ передає raw host credentials
//
// Якщо платформа не може забезпечити цей boundary, node має status `unavailable`.
// Prompt-only node повертає schema-validated evidence/proposal, не writes.

const fs = require('node:fs');

const BROKER_SCHEMA = 'elt-broker/v1';

// Типи capability, які broker контролює
const CAPABILITIES = {
  fs: ['read', 'write-append', 'remove', 'chmod', 'symlink'],
  git: ['status', 'diff', 'add', 'commit', 'force-push', 'reset-hard', 'branch-delete'],
  network: ['https-fetch', 'raw-tcp', 'listen'],
  secrets: ['read', 'write', 'export'],
  process: ['spawn-subprocess', 'raw-shell-exec', 'install-hook'],
};

// Default policy для external pack: ничего не дозволено
const DEFAULT_POLICY = {
  fs: { allowed: [], denied: Object.values(CAPABILITIES.fs) },
  git: { allowed: [], denied: Object.values(CAPABILITIES.git) },
  network: { allowed: [], denied: Object.values(CAPABILITIES.network) },
  secrets: { allowed: [], denied: Object.values(CAPABILITIES.secrets) },
  process: { allowed: [], denied: Object.values(CAPABILITIES.process) },
};

// Core policy: все дозволено (це внутрішні ноди, які trust'ed)
const CORE_POLICY = {
  fs: { allowed: Object.values(CAPABILITIES.fs), denied: [] },
  git: { allowed: Object.values(CAPABILITIES.git), denied: [] },
  network: { allowed: Object.values(CAPABILITIES.network), denied: [] },
  secrets: { allowed: Object.values(CAPABILITIES.secrets), denied: [] },
  process: { allowed: Object.values(CAPABILITIES.process), denied: [] },
};

// Перевірка, чи запит дозволений
function checkPermission(policy, capabilityType, action) {
  if (!policy || !policy[capabilityType]) {
    return { allowed: false, reason: 'capability-type-unknown' };
  }
  const cap = policy[capabilityType];
  if (cap.denied && cap.denied.includes(action)) {
    return { allowed: false, reason: 'denied-by-policy' };
  }
  if (cap.allowed && cap.allowed.includes(action)) {
    return { allowed: true };
  }
  // Якщо дія не в allowed і не в denied, то чітко відмовляємо
  return { allowed: false, reason: 'not-in-allowed-list' };
}

// Виконання capability request через broker
function requestCapability(nodeId, nodeTrust, capabilityType, action, context = {}) {
  if (nodeTrust === 'core') {
    // Core node не потребує перевірку: всім дозволено
    return {
      ok: true,
      granted: true,
      nodeId,
      capabilityType,
      action,
      reason: 'core-pack-unrestricted',
    };
  }
  // External pack: перевірити проти default policy
  const policy = DEFAULT_POLICY;
  const perm = checkPermission(policy, capabilityType, action);
  return {
    ok: perm.allowed,
    granted: perm.allowed,
    nodeId,
    capabilityType,
    action,
    reason: perm.reason,
    ts: new Date().toISOString(),
  };
}

// Журналювання request'ів для audit trail
function logCapabilityRequest(brokerLog, request) {
  if (!brokerLog) return { ok: false, reason: 'no-log-path' };
  try {
    const line = JSON.stringify(request) + '\n';
    fs.appendFileSync(brokerLog, line, 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'log-write-failed', details: e.message };
  }
}

// Определить politique для node'а: для core full access, для external minimal.
function getPolicyForNode(nodeId, nodeTrust) {
  if (nodeTrust === 'core') return CORE_POLICY;
  return DEFAULT_POLICY;
}

// External executable node доступний лише якщо platform забезпечує isolation.
// Для цього коду: вважаємо, що потребує явного включення через environment check.
function checkNodeAvailability(nodeId, nodeTrust, platformAvailable = false) {
  if (nodeTrust === 'core') {
    return { available: true, reason: 'core-always-available' };
  }
  if (!platformAvailable) {
    return {
      available: false,
      reason: 'unavailable',
      detail: 'External executable nodes require platform isolation capability',
    };
  }
  return { available: true };
}

// Prompt-only node без capability не должны робить direct writes
function validatePromptOnlyNode(nodeId, declaredCapabilities) {
  const writeOps = ['write', 'write-append', 'commit', 'push', 'export', 'install'];
  const hasWrite = Object.keys(CAPABILITIES).some((capType) => {
    const declared = declaredCapabilities[capType] || [];
    return declared.some((op) => writeOps.includes(op));
  });
  if (hasWrite) {
    return {
      ok: false,
      reason: 'prompt-only-node-with-writes',
      nodeId,
      detail: 'Prompt-only nodes cannot declare write capabilities',
    };
  }
  return { ok: true };
}

module.exports = {
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
};
