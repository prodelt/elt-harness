#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const COMPLEXITIES = new Set(['TRIVIAL', 'MEDIUM', 'BUG', 'ARCH', 'COMPLEX', 'RESEARCH']);

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

function validateFinalCloseout(options) {
  const { success, proof = [], artifacts = [], remainingWork = [] } = options;
  if (!success) {
    return { ok: true, reason: '' };
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

module.exports = {
  STATE_TTL_MS,
  appendLedgerEvent,
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
  replaceStateForNewTask,
  routeForComplexity,
  shouldUseInterviewMode,
  validateFinalCloseout,
  writeState,
};
