#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { summarizeSupplyChainAudit } = require('./agent-skill-supply-chain-status');

const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const COMPLEXITIES = new Set(['TRIVIAL', 'MEDIUM', 'BUG', 'ARCH', 'COMPLEX', 'RESEARCH']);
const SUPPLY_CHAIN_REQUIRED_COMPLEXITIES = new Set(['MEDIUM', 'BUG', 'ARCH', 'COMPLEX', 'RESEARCH']);

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/');
}

function projectKey(root) {
  const normalized = normalizePath(root).toLowerCase();
  const base = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  return `${base || 'project'}-${hash}`;
}

function projectStatePath(root, home) {
  return path.join(home, '.claude', 'projects', projectKey(root), 'pipeline-state.json');
}

function projectLedgerPath(root, home) {
  return path.join(home, '.claude', 'projects', projectKey(root), 'session-ledger.jsonl');
}

function legacyStatePath(home) {
  return path.join(home, '.claude', 'pipeline-state.json');
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function expiresAtFrom(now) {
  return toIso(new Date(new Date(now).getTime() + STATE_TTL_MS));
}

function shouldUseInterviewMode(options) {
  const { complexity, ambiguous = false, multiFile = false, security = false } = options;
  return ambiguous || multiFile || security || ['ARCH', 'COMPLEX', 'RESEARCH'].includes(complexity);
}

function routeForComplexity(options) {
  const { complexity, ambiguous = false, multiFile = false, security = false } = options;
  const mode = shouldUseInterviewMode({ complexity, ambiguous, multiFile, security }) ? 'interview' : 'auto';

  if (complexity === 'TRIVIAL') {
    return {
      mode,
      skill: { selected: 'none', alternatives: [] },
      research: { selected: 'none', alternatives: [] },
      heavySkillsBypassed: true,
    };
  }

  if (complexity === 'ARCH') {
    return {
      mode,
      skill: { selected: 'architect-first', alternatives: ['inline-review', 'ship'] },
      research: { selected: 'project-docs', alternatives: ['graphify'] },
      heavySkillsBypassed: false,
    };
  }

  if (complexity === 'COMPLEX') {
    return {
      mode,
      skill: { selected: 'architect-first', alternatives: ['sprint', 'inline-review', 'ship'] },
      research: { selected: 'project-docs', alternatives: ['graphify'] },
      heavySkillsBypassed: false,
    };
  }

  if (complexity === 'RESEARCH') {
    return {
      mode,
      skill: { selected: 'none', alternatives: ['research-router'] },
      research: { selected: 'graphify', alternatives: ['project-docs'] },
      heavySkillsBypassed: false,
    };
  }

  if (complexity === 'BUG') {
    return {
      mode,
      skill: { selected: 'diagnose', alternatives: ['inline-review', 'ship'] },
      research: { selected: 'graphify', alternatives: ['project-docs'] },
      heavySkillsBypassed: false,
    };
  }

  return {
    mode,
    skill: { selected: 'none', alternatives: ['inline-review', 'ship'] },
    research: { selected: 'project-docs', alternatives: [] },
    heavySkillsBypassed: false,
  };
}

function createClassifiedState(options) {
  const {
    root,
    home,
    task,
    goal,
    doneWhen,
    complexity,
    commands = {},
    confidence = 0.8,
    now = new Date(),
    ambiguous = false,
    multiFile = false,
    security = false,
  } = options;

  if (!COMPLEXITIES.has(complexity)) {
    throw new Error(`Unsupported complexity: ${complexity}`);
  }

  const routes = routeForComplexity({ complexity, ambiguous, multiFile, security });
  const normalizedRoot = normalizePath(root);
  const ts = toIso(now);

  return {
    cwd: normalizedRoot,
    projectKey: projectKey(root),
    task,
    goal,
    doneWhen,
    complexity,
    mode: routes.mode,
    phase: 'classified',
    routers: {
      skill: { ...routes.skill },
      research: { ...routes.research },
    },
    commands: {
      build: commands.build || '',
      test: commands.test || '',
      lint: commands.lint || '',
      doctor: commands.doctor || '',
      hooks: commands.hooks || '',
    },
    ledgerPath: normalizePath(projectLedgerPath(root, home)),
    checkpoints: [{ phase: 'classified', skill: 'pipeline', ts }],
    confidence,
    ts,
    expiresAt: expiresAtFrom(now),
    closedAt: null,
  };
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function writeState(file, state) {
  ensureParent(file);
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
  return state;
}

function appendLedgerEvent(file, event) {
  ensureParent(file);
  fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
  return event;
}

function readState(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function isExpiredState(state, now = new Date()) {
  if (!state || typeof state.ts !== 'string') return true;
  const ts = new Date(state.ts);
  if (Number.isNaN(ts.getTime())) return true;
  return new Date(now).getTime() - ts.getTime() > STATE_TTL_MS;
}

function isClosedState(state) {
  return !!state && ['closed', 'shipped'].includes(state.phase);
}

function replaceStateForNewTask(options) {
  const { root, home, nextTask, nextGoal, doneWhen, complexity, commands = {}, now = new Date() } = options;
  const stateFile = projectStatePath(root, home);
  const current = readState(stateFile);
  const normalizedRoot = normalizePath(root);
  const shouldReplace =
    !current ||
    normalizePath(current.cwd || normalizedRoot).toLowerCase() !== normalizedRoot.toLowerCase() ||
    isClosedState(current) ||
    isExpiredState(current, now) ||
    current.goal !== nextGoal;

  if (!shouldReplace) {
    return { action: 'resume', state: current, replaced: false };
  }

  const nextState = createClassifiedState({
    root,
    home,
    task: nextTask,
    goal: nextGoal,
    doneWhen,
    complexity,
    commands,
    now,
    ambiguous: complexity === 'ARCH' || complexity === 'COMPLEX' || complexity === 'RESEARCH',
    multiFile: complexity === 'ARCH' || complexity === 'COMPLEX',
  });

  writeState(stateFile, nextState);
  appendLedgerEvent(nextState.ledgerPath, {
    kind: 'classification',
    task: nextTask,
    goal: nextGoal,
    complexity,
    mode: nextState.mode,
    action: current ? 'replace' : 'initialize',
    ts: nextState.ts,
  });

  return { action: current ? 'replace' : 'initialize', state: nextState, replaced: !!current };
}

function summarizeSupplyChainPreflight(options) {
  const { root, command, audit, exitCode = 0, now = new Date() } = options;
  const summary = summarizeSupplyChainAudit(audit, { root, now });
  const ok = exitCode === 0 && summary.ok;

  return {
    kind: 'supply-chain-preflight',
    command,
    exitCode,
    ok,
    drift: {
      count: summary.driftCount,
      counts: summary.driftCounts,
      missingSource: summary.missingSource,
      missingInstalls: summary.missingInstalls,
      driftedInstalls: summary.driftedInstalls,
      missingClientRoots: summary.missingClientRoots,
      currentControlPlaneMissing: summary.controlPlane.missing,
    },
    bypass: summary.bypass,
    summary: ok ? 'agent skill supply-chain audit passed' : summary.summary,
    ts: toIso(now),
  };
}

function recordSupplyChainPreflight(options) {
  const { root, home, command, audit, exitCode = 0, now = new Date() } = options;
  const stateFile = projectStatePath(root, home);
  const current = readState(stateFile);
  if (!current) throw new Error('Cannot record supply-chain preflight: pipeline state not found.');

  const preflight = summarizeSupplyChainPreflight({ root, command, audit, exitCode, now });
  const next = {
    ...current,
    supplyChainPreflight: preflight,
    checkpoints: [
      ...(Array.isArray(current.checkpoints) ? current.checkpoints : []),
      { phase: current.phase || 'classified', skill: 'agent-skill-supply-chain', ts: preflight.ts },
    ],
  };

  writeState(stateFile, next);
  appendLedgerEvent(next.ledgerPath, preflight);
  return next;
}

function supplyChainCloseoutBlocker(state) {
  if (!state || !SUPPLY_CHAIN_REQUIRED_COMPLEXITIES.has(state.complexity)) return '';
  const preflight = state.supplyChainPreflight;
  if (!preflight) return 'Success requires supply-chain preflight recorded in state.';
  if (preflight.ok) return '';
  if (preflight.bypass && preflight.bypass.active) return '';
  return `Supply-chain drift prevents success closeout: ${preflight.summary || 'audit did not pass'}.`;
}

function validateFinalCloseout(options) {
  const { success, proof = [], artifacts = [], remainingWork = [], state = null } = options;
  if (!success) {
    return { ok: true, reason: '' };
  }

  const supplyChainBlocker = supplyChainCloseoutBlocker(state);
  if (supplyChainBlocker) {
    return { ok: false, reason: supplyChainBlocker };
  }

  if (!Array.isArray(proof) || proof.length === 0) {
    return { ok: false, reason: 'Success requires verification proof.' };
  }

  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    return { ok: false, reason: 'Success requires at least one artifact.' };
  }

  if (Array.isArray(remainingWork) && remainingWork.length > 0) {
    return { ok: false, reason: 'Success cannot include remaining work.' };
  }

  return { ok: true, reason: '' };
}

/**
 * Attach a harness run ID to an existing pipeline state file.
 * Adds/updates the optional `runId` field; preserves all other fields.
 * @param {{ root: string, home: string, runId: string }} options
 * @returns {object} updated state
 */
function attachHarnessRun({ root, home, runId }) {
  const stateFile = projectStatePath(root, home);
  const current   = readState(stateFile);
  if (!current) throw new Error('Cannot attach harness run: pipeline state not found.');
  const next = { ...current, runId };
  writeState(stateFile, next);
  return next;
}

function closeState(options) {
  const { root, home, outcome, proof = [], artifacts = [], remainingWork = [], now = new Date() } = options;
  const stateFile = projectStatePath(root, home);
  const current = readState(stateFile);
  if (!current) {
    throw new Error('Cannot close missing pipeline state.');
  }

  const closeout = validateFinalCloseout({
    success: outcome === 'success',
    proof,
    artifacts,
    remainingWork,
    state: current,
  });

  if (!closeout.ok) {
    throw new Error(closeout.reason);
  }

  const next = {
    ...current,
    phase: 'closed',
    closedAt: toIso(now),
    checkpoints: [
      ...(Array.isArray(current.checkpoints) ? current.checkpoints : []),
      { phase: 'closed', skill: 'pipeline', ts: toIso(now) },
    ],
  };
  writeState(stateFile, next);
  appendLedgerEvent(next.ledgerPath, {
    kind: 'outcome',
    outcome,
    proof,
    artifacts,
    remainingWork,
    ts: next.closedAt,
  });
  return next;
}

// ── judge_verdict logging (elt-code Step 4) ────────────────────────────────
// ponytail: this CLI exists because the model hand-writing the ledger line
// loses entries under context pressure (audit: 3 judge runs -> 1 logged).
// One deterministic append call replaces free-hand JSON.

const HARD_REQUIRED_KEYS = ['H1', 'H2'];
const HARD_RESULTS = new Set(['pass', 'fail', 'na']);

function buildVerdictEvent(raw, now = new Date()) {
  if (!raw || typeof raw !== 'object') throw new Error('verdict payload must be an object');
  if (raw.verdict !== 'pass' && raw.verdict !== 'block') {
    throw new Error('verdict must be "pass" or "block"');
  }
  const hard = raw.hard || {};
  for (const key of HARD_REQUIRED_KEYS) {
    if (!hard[key] || !HARD_RESULTS.has(hard[key].r)) {
      throw new Error(`hard.${key}.r must be one of pass|fail|na`);
    }
  }
  return {
    type: 'judge_verdict',
    ts: raw.ts || toIso(now),
    task: raw.task || '',
    complexity: raw.complexity || '',
    slice: raw.slice ?? null,
    model: raw.model || '',
    verdict: raw.verdict,
    hard,
    soft: raw.soft || {},
    summary: raw.summary || '',
  };
}

function logVerdictToLedger(options) {
  const { root, home, raw, now } = options;
  const event = buildVerdictEvent(raw, now);
  const stateFile = projectStatePath(root, home);
  const state = readState(stateFile);
  const ledgerPath = (state && state.ledgerPath) || projectLedgerPath(root, home);
  appendLedgerEvent(ledgerPath, event);
  return { event, ledgerPath };
}

// ── cli ──────────────────────────────────────────────────────────────────────

function cliLogVerdict(args) {
  let root = process.cwd();
  let jsonArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') { root = args[++i]; }
    else if (args[i] === '--json') { jsonArg = args[++i]; }
  }
  const raw = jsonArg || (() => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } })();
  if (!raw || !raw.trim()) {
    process.stderr.write('Usage: node tools/pipeline-state.js log-verdict --root <path> --json \'<verdict JSON>\' (or pipe JSON via stdin)\n');
    process.exit(1);
  }

  let parsed;
  try { parsed = JSON.parse(raw); } catch (err) {
    process.stderr.write(`Invalid JSON: ${err.message}\n`);
    process.exit(1);
  }

  try {
    const { ledgerPath } = logVerdictToLedger({ root, home: os.homedir(), raw: parsed });
    const lineCount = fs.readFileSync(ledgerPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).length;
    process.stdout.write(`Logged judge_verdict (${parsed.verdict}) to ${ledgerPath} (line ${lineCount})\n`);
  } catch (err) {
    process.stderr.write(`Invalid verdict: ${err.message}\n`);
    process.exit(1);
  }
}

// Explicit human decision to unblock judge-closeout-gate when judge
// infrastructure itself is failing (not to forgive a real red oracle or a
// missing verdict the agent just hasn't tried to get yet). One-shot: scoped
// to the current pipeline-state.json row, which replaceStateForNewTask()
// replaces wholesale on the next task — so this never leaks into future work.
function cliOverrideJudgeGate(args) {
  let root = process.cwd();
  let reason = null;
  let approvedBy = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') { root = args[++i]; }
    else if (args[i] === '--reason') { reason = args[++i]; }
    else if (args[i] === '--approved-by') { approvedBy = args[++i]; }
  }
  if (!reason || !reason.trim()) {
    process.stderr.write('Usage: node tools/pipeline-state.js override-judge-gate --root <path> --reason "<why, human decision>" [--approved-by <name>]\n');
    process.exit(1);
  }
  const home = os.homedir();
  const stateFile = projectStatePath(root, home);
  const state = readState(stateFile);
  if (!state) {
    process.stderr.write(`No pipeline-state.json at ${stateFile} — nothing to override.\n`);
    process.exit(1);
  }
  state.judgeGateOverride = { reason: reason.trim(), approvedBy: approvedBy || 'user', ts: new Date().toISOString() };
  writeState(stateFile, state);
  process.stdout.write(`judge-closeout-gate override recorded (reason: ${reason.trim()}) — next Stop for this task will allow once.\n`);
}

function cliMain(argv) {
  const [cmd, ...rest] = argv.slice(2);
  if (cmd === 'log-verdict') return cliLogVerdict(rest);
  if (cmd === 'override-judge-gate') return cliOverrideJudgeGate(rest);
  process.stderr.write('Usage: node tools/pipeline-state.js log-verdict --root <path> --json \'<verdict JSON>\'\n');
  process.stderr.write('   or: node tools/pipeline-state.js override-judge-gate --root <path> --reason "<why>"\n');
  process.exit(1);
}

if (require.main === module) {
  cliMain(process.argv);
}

module.exports = {
  STATE_TTL_MS,
  appendLedgerEvent,
  attachHarnessRun,
  buildVerdictEvent,
  closeState,
  createClassifiedState,
  isClosedState,
  isExpiredState,
  legacyStatePath,
  normalizePath,
  projectKey,
  projectLedgerPath,
  projectStatePath,
  readState,
  recordSupplyChainPreflight,
  replaceStateForNewTask,
  routeForComplexity,
  shouldUseInterviewMode,
  summarizeSupplyChainPreflight,
  supplyChainCloseoutBlocker,
  validateFinalCloseout,
  writeState,
};
