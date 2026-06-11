#!/usr/bin/env node
'use strict';

/**
 * tools/harness-gates.js — Agent Harness Gate Integration (P2.2)
 *
 * Orchestrates tools/harness-runner.js without touching it.
 * For each run phase, executes the appropriate gate command, writes
 * gateEvidence into run.phases[last] BEFORE transition, then calls
 * transition / submitReview.
 *
 * CLI:
 *   node tools/harness-gates.js run-gate <runId> [--dry-run] [--root <p>] [--json]
 *   node tools/harness-gates.js closeout  <runId> [--root <p>] [--json]
 *   node tools/harness-gates.js gate-plan <runId> [--root <p>] [--json]
 */

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');
const { spawnSync } = require('node:child_process');

const {
  PHASES,
  TERMINAL_PHASES,
  getRunPath,
  readRun,
  transition,
  submitReview,
} = require('./harness-runner');

const { projectStatePath, readState } = require('./pipeline-state');
const { readControlPlane, summarizeSupplyChainAudit } = require('./agent-skill-supply-chain-status');

// ── Constants ────────────────────────────────────────────────────────────────

const PLANNING_DIR = '.planning';
const HARNESS_RUN_ARTIFACT = 'harness-run-latest.json';
const EXEC_TIMEOUT_MS = 60000;

/** Phases that run real commands and produce {command, exitCode} evidence. */
const COMMAND_PHASES = new Set(['linter', 'tests', 'code_review', 'git_push']);

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveCommands(root) {
  try {
    const stateFile = projectStatePath(root, os.homedir());
    const state = readState(stateFile);
    const c = (state && state.commands) || {};
    return { lint: c.lint || '', test: c.test || '', build: c.build || '' };
  } catch {
    return { lint: '', test: '', build: '' };
  }
}

function writeRunPointer(run, root) {
  const file = path.join(root, PLANNING_DIR, HARNESS_RUN_ARTIFACT);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const isComplete = run.status === 'complete';
  const isFailed   = run.status === 'failed';
  fs.writeFileSync(file, JSON.stringify({
    generatedAt: new Date().toISOString(),
    runId:       run.runId,
    taskId:      run.taskId,
    phase:       run.phase,
    status:      run.status,
    summary: {
      status: isComplete ? 'pass' : isFailed ? 'fail' : 'running',
      phase:  run.phase,
    },
  }, null, 2), 'utf8');
}

/**
 * Write gateEvidence into run.phases[last] BEFORE calling transition.
 * Transition does its own readRun, so writing to disk first is required.
 */
function writeEvidence(runId, evidence, root) {
  const run     = readRun(runId, root);
  const current = run.phases[run.phases.length - 1];
  if (current) current.gateEvidence = evidence;
  fs.writeFileSync(getRunPath(runId, root), JSON.stringify(run, null, 2), 'utf8');
}

function execCmd(cmd, root) {
  const start  = Date.now();
  const result = spawnSync(cmd, [], {
    cwd: root, encoding: 'utf8', timeout: EXEC_TIMEOUT_MS, shell: true,
  });
  return {
    command:       cmd,
    exitCode:      result.status ?? (result.error ? 1 : 0),
    stdoutExcerpt: (result.stdout || '').slice(0, 500),
    stderrExcerpt: (result.stderr || '').slice(0, 500),
    durationMs:    Date.now() - start,
  };
}

function buildSupplyChainAudit(root) {
  const { buildAudit } = require('./agent-skill-supply-chain');
  const home = os.homedir();
  const repoRoot = path.resolve(__dirname, '..');
  return buildAudit({
    command:  'audit',
    manifest: path.join(repoRoot, 'config', 'agent-skill-sources.json'),
    registry: path.join(home, '.claude', 'projects-registry.json'),
    home,
    target:   'all',
    apply:    false,
    json:     true,
    repoRoot,
  });
}

function runSupplyChainPreflight({ root, audit, now = new Date() }) {
  let auditResult = audit;
  let loadError = null;
  if (!auditResult) {
    try {
      auditResult = buildSupplyChainAudit(root);
    } catch (err) {
      loadError = err;
    }
  }

  const summary = loadError
    ? { ok: false, summary: `supply-chain audit unavailable: ${loadError.message}`, driftCount: 1, bypass: null }
    : summarizeSupplyChainAudit(auditResult, { root, now });
  const controlPlane = readControlPlane(root, now);
  const passed = summary.ok || !!summary.bypass;
  const findings = passed ? [] : [{ severity: 'high', message: summary.summary }];

  return {
    passed,
    findings,
    evidence: {
      command:      'node tools/agent-skill-supply-chain.js audit --json',
      status:       summary.validationOk && summary.driftCount === 0 ? 'pass' : summary.bypass ? 'bypassed' : 'fail',
      issueCount:   summary.driftCount || 0,
      issues:       summary.driftCounts || {},
      bypass:       summary.bypass || { file: controlPlane.file, reason: 'no active supplyChainBypass in agent-control-plane.json' },
      repairCommand: 'agent-skills.cmd install-skills --target all --apply',
    },
  };
}

// ── Gate implementations ─────────────────────────────────────────────────────

function gateFetchContext() {
  return { passed: true, evidence: { skipped: 'auto-pass: fetch_context always passes' }, findings: [] };
}

function gatePlanDesign({ run, root }) {
  const planDir    = path.join(root, PLANNING_DIR);
  const hasArtifact = !!(run.artifacts && run.artifacts.design);
  let hasArchFile   = false;
  try {
    hasArchFile = fs.readdirSync(planDir).some(f => /^ARCHITECTURE-.*\.md$/.test(f));
  } catch {}
  let passed = hasArtifact || hasArchFile;
  const findings = [];

  // Sprint 4: COMPLEX changes require a fresh `amos preflight "<task>" --write` before planning.
  try {
    const { checkArtifact } = require('./docs-gate');
    const docsResult = checkArtifact(root);
    if (docsResult.ok && !docsResult.stale && (docsResult.value.complexity || '').toUpperCase() === 'COMPLEX') {
      const { checkPreflightArtifact } = require('../amos/lib/preflight');
      const preflightResult = checkPreflightArtifact(root);
      if (!preflightResult.ok || preflightResult.stale) {
        passed = false;
        findings.push({ severity: 'high', message: 'COMPLEX change requires `amos preflight "<task>" --write` before planning' });
      }
    }
  } catch {}

  return {
    passed,
    evidence: { command: null, skipped: passed ? 'design artifact present' : undefined, found: hasArtifact || hasArchFile, findings },
    findings,
  };
}

function gateImplement() {
  return { passed: true, evidence: { skipped: 'no gate: implement always forwards to linter' }, findings: [] };
}

function gateLinter({ root, dryRun }) {
  const { lint } = resolveCommands(root);
  if (!lint) {
    return { passed: true, evidence: { command: null, skipped: 'lint command not configured' }, findings: [] };
  }
  if (dryRun) {
    return { passed: true, evidence: { command: lint, skipped: 'dry-run' }, findings: [] };
  }
  const exec = execCmd(lint, root);
  return { passed: exec.exitCode === 0, evidence: exec, findings: [] };
}

function gateTests({ root, dryRun }) {
  const { test: testCmd } = resolveCommands(root);
  if (!testCmd) {
    return { passed: true, evidence: { command: null, skipped: 'test command not configured' }, findings: [] };
  }
  if (dryRun) {
    return { passed: true, evidence: { command: testCmd, skipped: 'dry-run' }, findings: [] };
  }
  const exec = execCmd(testCmd, root);
  return { passed: exec.exitCode === 0, evidence: exec, findings: [] };
}

function gateCodeReview({ root }) {
  const findings = [];
  try {
    const { checkArtifact } = require('./docs-gate');
    const docsResult = checkArtifact(root);
    if (docsResult.ok && !docsResult.stale) {
      const gate       = docsResult.value;
      const complexity = (gate.complexity || 'TRIVIAL').toUpperCase();
      const docCount   = Array.isArray(gate.docsChanged) ? gate.docsChanged.length : 0;
      if (docCount === 0 && complexity === 'COMPLEX') {
        findings.push({ severity: 'high', message: 'COMPLEX change requires docs update (AGENTS.md)' });
      } else if (docCount === 0 && (complexity === 'MEDIUM' || complexity === 'ARCH')) {
        findings.push({ severity: 'low', message: `${complexity} change: docs update recommended` });
      }
    }
  } catch (err) {
    findings.push({ severity: 'low', message: `docs-gate check unavailable: ${err.message}` });
  }
  return {
    findings,
    evidence: {
      command:      'submitReview',
      findingCount: findings.length,
      findings:     findings.map(f => ({ severity: f.severity, message: f.message })),
    },
  };
}

function gateGitPush({ root, supplyChainAudit, now }) {
  const supplyChain = runSupplyChainPreflight({ root, audit: supplyChainAudit, now });
  if (!supplyChain.passed) {
    return {
      passed: false,
      evidence: { command: null, supplyChain: supplyChain.evidence },
      findings: supplyChain.findings,
    };
  }

  try {
    const { checkArtifact } = require('./git-workflow-audit');
    const gitResult = checkArtifact(root);
    if (!gitResult.ok || gitResult.stale) {
      return { passed: true, evidence: { command: null, skipped: 'git-workflow-audit artifact missing or stale', supplyChain: supplyChain.evidence }, findings: [] };
    }
    const audit  = gitResult.value;
    const status = (audit.summary && audit.summary.status) || 'unknown';
    const passed = ['pass', 'warn'].includes(status);
    return {
      passed,
      evidence: { command: 'node tools/git-workflow-audit.js --root .', exitCode: passed ? 0 : 1, status, supplyChain: supplyChain.evidence },
      findings: [],
    };
  } catch {
    return { passed: true, evidence: { command: null, skipped: 'git-workflow-audit not available', supplyChain: supplyChain.evidence }, findings: [] };
  }
}

const GATES = {
  fetch_context: gateFetchContext,
  plan_design:   gatePlanDesign,
  implement:     gateImplement,
  linter:        gateLinter,
  tests:         gateTests,
  code_review:   gateCodeReview,
  git_push:      gateGitPush,
};

// ── Core API ─────────────────────────────────────────────────────────────────

/**
 * Execute the gate for the run's current phase: write evidence, then transition.
 *
 * @param {string} runId
 * @param {{ root?: string, dryRun?: boolean }} options
 */
function runGate(runId, { root = process.cwd(), dryRun = false, supplyChainAudit, now } = {}) {
  const run = readRun(runId, root);

  if (TERMINAL_PHASES.has(run.phase)) {
    throw new Error(`Run ${runId} is already in terminal phase: ${run.phase}`);
  }

  const gateImpl = GATES[run.phase];
  if (!gateImpl) throw new Error(`No gate for phase: ${run.phase}`);

  const gateResult = gateImpl({ runId, run, root, dryRun, supplyChainAudit, now });

  if (dryRun) {
    return { passed: gateResult.passed, evidence: gateResult.evidence, runId, phase: run.phase, status: run.status, dryRun: true };
  }

  // Write evidence BEFORE transition so it survives the transition's readRun.
  writeEvidence(runId, gateResult.evidence, root);

  let updatedRun;
  if (run.phase === 'code_review') {
    // submitReview auto-transitions; do not also call transition.
    const reviewResult = submitReview(runId, gateResult.findings || [], { root });
    updatedRun = reviewResult.run;
  } else {
    updatedRun = transition(runId, gateResult.passed, { root });
  }

  writeRunPointer(updatedRun, root);
  return { passed: gateResult.passed, evidence: gateResult.evidence, runId, phase: updatedRun.phase, status: updatedRun.status };
}

/**
 * Verify a run is valid for closeout: complete status AND every phase record
 * has gateEvidence (written by runGate; absent if transitions were manual).
 *
 * @param {string} runId
 * @param {{ root?: string }} options
 */
function verifyCloseout(runId, { root = process.cwd(), supplyChainAudit, now } = {}) {
  const run = readRun(runId, root);

  if (run.status !== 'complete') {
    return { ok: false, runId, reason: `run status is "${run.status}", not "complete"` };
  }

  const missing = run.phases.filter(p => !p.gateEvidence);
  if (missing.length > 0) {
    return {
      ok:     false,
      runId,
      reason: `${missing.length} phase(s) missing gateEvidence: ${missing.map(p => p.phase).join(', ')}`,
    };
  }

  const supplyChain = runSupplyChainPreflight({ root, audit: supplyChainAudit, now });
  if (!supplyChain.passed) {
    return {
      ok:       false,
      runId,
      reason:   `supply-chain preflight failed: ${supplyChain.evidence.issueCount} issue(s); run agent-skills.cmd install-skills --target all --apply or document supplyChainBypass in .planning/agent-control-plane.json`,
      evidence: supplyChain.evidence,
    };
  }

  return { ok: true, runId };
}

/**
 * Return a gate plan for a run: current phase, gate types, and resolved commands.
 */
function buildGatePlan(runId, { root = process.cwd() } = {}) {
  const run  = readRun(runId, root);
  const cmds = resolveCommands(root);
  return {
    runId,
    taskId:       run.taskId,
    currentPhase: run.phase,
    status:       run.status,
    gates: PHASES.map(phase => ({
      phase,
      isCommandBacked: COMMAND_PHASES.has(phase),
      command: phase === 'linter' ? (cmds.lint || null) : phase === 'tests' ? (cmds.test || null) : null,
    })),
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags      = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key  = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else { flags[key] = true; }
    } else {
      positional.push(argv[i]);
    }
  }
  return { flags, positional };
}

function cliMain(argv) {
  const { flags, positional } = parseArgs(argv);
  const asJson = Boolean(flags.json);
  const root   = typeof flags.root === 'string' ? path.resolve(flags.root) : process.cwd();
  const dryRun = Boolean(flags['dry-run']);
  const [cmd, ...rest] = positional;

  function emit(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
  function fail(msg) {
    if (asJson) emit({ ok: false, error: msg });
    else process.stderr.write(`ERROR: ${msg}\n`);
    process.exit(1);
  }

  try {
    if (cmd === 'run-gate') {
      const [runId] = rest;
      if (!runId) return fail('Usage: run-gate <runId> [--dry-run] [--root <path>] [--json]');
      const result = runGate(runId, { root, dryRun });
      emit({ ok: true, ...result });
      return;
    }

    if (cmd === 'closeout') {
      const [runId] = rest;
      if (!runId) return fail('Usage: closeout <runId> [--root <path>] [--json]');
      const result = verifyCloseout(runId, { root });
      emit({ ok: result.ok, ...result });
      if (!result.ok) process.exit(1);
      return;
    }

    if (cmd === 'gate-plan') {
      const [runId] = rest;
      if (!runId) return fail('Usage: gate-plan <runId> [--root <path>] [--json]');
      const plan = buildGatePlan(runId, { root });
      emit({ ok: true, ...plan });
      return;
    }

    fail(`Unknown command: ${cmd || '<none>'}. Use: run-gate | closeout | gate-plan`);
  } catch (err) {
    fail(err.message);
  }
}

// ── Artifact reader (used by doctor-core) ────────────────────────────────────

const ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Read the harness-run-latest.json artifact for doctor-core integration.
 * Returns { ok, value, stale, file } or { ok: false, error }.
 */
function checkArtifact(root, now = new Date()) {
  const file = path.join(root, PLANNING_DIR, HARNESS_RUN_ARTIFACT);
  try {
    const value       = JSON.parse(fs.readFileSync(file, 'utf8'));
    const generatedAt = typeof value.generatedAt === 'string' ? new Date(value.generatedAt) : null;
    const stale       = !generatedAt || Number.isNaN(generatedAt.getTime())
      || now.getTime() - generatedAt.getTime() > ARTIFACT_TTL_MS;
    return { ok: true, value, stale, file };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

if (require.main === module) {
  cliMain(process.argv.slice(2));
}

module.exports = {
  GATES,
  COMMAND_PHASES,
  resolveCommands,
  summarizeSupplyChainAudit,
  runSupplyChainPreflight,
  writeRunPointer,
  writeEvidence,
  runGate,
  verifyCloseout,
  buildGatePlan,
  checkArtifact,
};
