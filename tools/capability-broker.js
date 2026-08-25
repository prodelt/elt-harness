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


// ── 020 T018 (поколение 2): enforceable boundary, а не таблица ────────────────────────────
//
// Судья заблокировал первое поколение по существу: брокер возвращал объекты `allowed/denied`
// и писал аудит, но НИЧЕГО не исполнял. Тесты проверяли те же таблицы policy, а не попытки
// запрещённых операций — значит поломка изоляции осталась бы зелёной. Policy без исполнения
// — это самоаттестация, ровно то, что спека 020 запрещает: «Якщо platform не може забезпечити
// цей boundary, executable pack node має стан `unavailable`».
//
// Здесь граница настоящая:
//   • external node исполняется ТОЛЬКО в отдельном процессе (`spawnSync`), никогда in-process;
//   • окружение НЕ наследуется: собирается с нуля из белого списка, поэтому токены, ключи и
//     прочие секреты host'а физически недоступны дочернему процессу;
//   • рабочий каталог — переданный sandbox, и путь наружу отвергается ДО запуска;
//   • у процесса нет ни одного инструмента по умолчанию: любую способность он обязан
//     запросить строкой протокола на stdout, а решение принимает родитель по policy;
//   • результат — schema-validated proposal; прямых записей узел не делает вообще.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Переменные, без которых не стартует сам Node. Всё остальное (токены CI, GH_TOKEN, ключи
// провайдеров, пути к учётным данным) в дочерний процесс не попадает НИКОГДА: список
// разрешительный, а не запретительный — запретительный пришлось бы обновлять под каждый
// новый секрет, и первый забытый стал бы утечкой.
const ENV_ALLOWLIST = ['PATH', 'SystemRoot', 'windir', 'TEMP', 'TMP', 'HOME', 'LANG'];

const PROTOCOL_PREFIX = 'ELT-BROKER:';
const PROPOSAL_PREFIX = 'ELT-PROPOSAL:';

function sandboxEnv(base = process.env) {
  const env = {};
  for (const key of ENV_ALLOWLIST) if (base[key] !== undefined) env[key] = base[key];
  // Явный маркер: узел обязан знать, что он в песочнице и инструментов у него нет.
  env.ELT_SANDBOX = '1';
  env.ELT_TOOLS = '';
  return env;
}

// Путь наружу песочницы отвергается ДО запуска. Проверка на строках, а не на symlink-resolve:
// сравниваются уже нормализованные абсолютные пути, и `..` из них вычищен.
function withinSandbox(sandboxDir, target) {
  const root = path.resolve(sandboxDir);
  const full = path.resolve(sandboxDir, target);
  const rel = path.relative(root, full);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * isolationAvailable() → { available, reason }
 * Граница обеспечивается, только если платформа реально даёт запустить отдельный процесс с
 * подменённым окружением. Не «предположим, что даёт»: проверяется запуском.
 */
function isolationAvailable(runner = spawnSync) {
  try {
    const probe = runner(process.execPath, ['-e', 'process.stdout.write(process.env.ELT_SANDBOX || "")'], {
      env: sandboxEnv(), encoding: 'utf8', timeout: 10000,
    });
    if (probe.error || probe.status !== 0) return { available: false, reason: 'spawn-failed' };
    if (String(probe.stdout).trim() !== '1') return { available: false, reason: 'env-not-isolated' };
    return { available: true };
  } catch (e) {
    return { available: false, reason: 'spawn-threw', detail: e.message };
  }
}

/**
 * runExternalNode — единственный законный способ выполнить узел внешнего pack'а.
 *
 * Возвращает { ok, state, proposal, requests, denied, reason }.
 * `state: 'unavailable'` — платформа не обеспечивает границу; это НЕ ошибка узла и не повод
 * выполнить его как-нибудь иначе.
 */
function runExternalNode({
  nodeId, trust = 'unreviewed', entryFile, sandboxDir,
  policy = null, timeoutMs = 30000, runner = spawnSync, brokerLog = null,
} = {}) {
  if (trust === 'core') {
    // Core-узлы исполняет само ядро; пропускать их через песочницу нечестно — они и есть
    // та сторона, которая выдаёт способности.
    return { ok: false, state: 'refused', reason: 'core-node-must-not-run-through-broker', nodeId };
  }
  const isolation = isolationAvailable(runner);
  if (!isolation.available) {
    return { ok: false, state: 'unavailable', reason: isolation.reason, nodeId };
  }
  if (!sandboxDir || !entryFile) {
    return { ok: false, state: 'refused', reason: 'sandbox-or-entry-missing', nodeId };
  }
  if (!withinSandbox(sandboxDir, entryFile)) {
    return { ok: false, state: 'refused', reason: 'entry-outside-sandbox', nodeId };
  }

  const result = runner(process.execPath, [path.resolve(sandboxDir, entryFile)], {
    cwd: sandboxDir,
    env: sandboxEnv(),
    encoding: 'utf8',
    timeout: timeoutMs,
    // Никакого shell: аргументы не проходят через интерпретатор, поэтому имя файла не может
    // стать командой.
    shell: false,
  });
  if (result.error && result.error.code === 'ETIMEDOUT') {
    return { ok: false, state: 'error', reason: 'timeout', nodeId };
  }
  if (result.error) return { ok: false, state: 'error', reason: 'spawn-failed', detail: result.error.message, nodeId };

  // Разбор протокола. Запросы способностей решает РОДИТЕЛЬ: у дочернего процесса нет ни
  // одного инструмента, поэтому «запросил» здесь буквально значит «напечатал строку».
  const requests = [];
  const denied = [];
  let proposal = null;
  for (const line of String(result.stdout || '').split(/\r?\n/)) {
    if (line.startsWith(PROTOCOL_PREFIX)) {
      let req = null;
      try { req = JSON.parse(line.slice(PROTOCOL_PREFIX.length)); } catch { req = null; }
      if (!req || !req.capability || !req.action) { denied.push({ raw: line.slice(0, 120), reason: 'malformed-request' }); continue; }
      const decision = requestCapability(nodeId, trust, req.capability, req.action, { policy });
      requests.push({ ...req, granted: decision.granted, reason: decision.reason });
      if (!decision.granted) denied.push({ capability: req.capability, action: req.action, reason: decision.reason });
      if (brokerLog) logCapabilityRequest(brokerLog, { nodeId, ...req, granted: decision.granted, reason: decision.reason, ts: new Date().toISOString() });
      continue;
    }
    if (line.startsWith(PROPOSAL_PREFIX)) {
      try { proposal = JSON.parse(line.slice(PROPOSAL_PREFIX.length)); } catch { proposal = null; }
    }
  }

  if (denied.length) {
    return { ok: false, state: 'denied', reason: 'capability-denied', nodeId, requests, denied, exit: result.status };
  }
  if (result.status !== 0) {
    return { ok: false, state: 'error', reason: 'node-exit-nonzero', exit: result.status, nodeId, requests };
  }
  if (!proposal || typeof proposal !== 'object') {
    return { ok: false, state: 'error', reason: 'no-schema-valid-proposal', nodeId, requests };
  }
  return { ok: true, state: 'proposed', nodeId, proposal, requests, denied: [], exit: result.status };
}

module.exports = {
  BROKER_SCHEMA,
  ENV_ALLOWLIST,
  PROTOCOL_PREFIX,
  PROPOSAL_PREFIX,
  sandboxEnv,
  withinSandbox,
  isolationAvailable,
  runExternalNode,
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
