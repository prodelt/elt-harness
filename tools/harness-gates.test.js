#!/usr/bin/env node
'use strict';

/**
 * tools/harness-gates.test.js — unit tests for harness-gates.js (P2.2)
 *
 * Coverage (3 acceptance criteria):
 *   AC1: verifyCloseout without evidence → ok:false; with runGate evidence → ok:true
 *   AC2: code_review high finding → blocked, phase → implement
 *   AC3: docs-delta COMPLEX without docs → high finding → block; with docs → pass
 *
 * Additional:
 *   - linter-fail → implement + evidence written
 *   - tests-pass → code_review + evidence written
 *   - dry-run: does not execute commands or transition
 *   - commands resolved from pipeline-state
 *   - gate-plan returns phase structure
 */

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const {
  createRun,
  readRun,
  transition,
} = require('./harness-runner');

const {
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
} = require('./harness-gates');

const { replaceStateForNewTask } = require('./pipeline-state');

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`  FAIL  ${name}\n    ${err.message}\n`);
  }
}

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-gates-test-'));
}

/** Advance run through N passing transitions (bypassing gate — for manual tests). */
function advanceN(runId, root, n) {
  for (let i = 0; i < n; i++) transition(runId, true, { root });
}

function supplyChainAudit(overrides = {}) {
  const clientState = overrides.clientState || { installed: true, matchesSource: true };
  return {
    kind: 'agent-skill-supply-chain',
    validation: { ok: true, errors: [] },
    clients: {
      claude: { exists: true },
      codex: { exists: true },
      gemini: { exists: true },
    },
    skills: [{
      id: 'pipeline',
      name: 'pipeline',
      status: 'approved',
      sourceExists: overrides.sourceExists !== false,
      clients: {
        claude: { ...clientState },
        codex: { installed: true, matchesSource: true },
        gemini: { installed: true, matchesSource: true },
      },
    }],
  };
}

function writeSupplyChainBypass(root, expiresAt = '2026-06-04T00:00:00Z') {
  const file = path.join(root, '.planning', 'agent-control-plane.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    managedBy: 'Pipeline Setupper',
    manifestVersion: 1,
    manifest: 'config/agent-skill-sources.json',
    requiredClients: ['claude', 'codex', 'gemini'],
    supplyChainBypass: {
      reason: 'temporary accepted drift during controlled rollout',
      approvedBy: 'agent-3',
      expiresAt,
    },
  }, null, 2), 'utf8');
}

// ── COMMAND_PHASES ────────────────────────────────────────────────────────────

run('COMMAND_PHASES includes linter tests code_review git_push', () => {
  assert.ok(COMMAND_PHASES.has('linter'));
  assert.ok(COMMAND_PHASES.has('tests'));
  assert.ok(COMMAND_PHASES.has('code_review'));
  assert.ok(COMMAND_PHASES.has('git_push'));
  assert.ok(!COMMAND_PHASES.has('implement'));
  assert.ok(!COMMAND_PHASES.has('fetch_context'));
});

// ── resolveCommands ───────────────────────────────────────────────────────────

run('resolveCommands: returns empty strings when no state file', () => {
  const root = makeTmpRoot();
  const cmds = resolveCommands(root);
  assert.equal(cmds.lint, '');
  assert.equal(cmds.test, '');
  assert.equal(cmds.build, '');
});

run('resolveCommands: reads commands from pipeline-state', () => {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-pstate-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  replaceStateForNewTask({
    root, home,
    nextTask: 'task', nextGoal: 'goal', doneWhen: 'done',
    complexity: 'COMPLEX',
    commands: { lint: 'node lint.js', test: 'node test.js' },
    now: new Date('2026-05-30T10:00:00Z'),
  });
  // Override env so resolveCommands picks up the temp home
  const orig = process.env.USERPROFILE;
  process.env.USERPROFILE = home;
  try {
    const cmds = resolveCommands(root);
    assert.equal(cmds.lint, 'node lint.js');
    assert.equal(cmds.test, 'node test.js');
  } finally {
    process.env.USERPROFILE = orig;
  }
});

// ── writeRunPointer ───────────────────────────────────────────────────────────

run('writeRunPointer: writes harness-run-latest.json with generatedAt + summary', () => {
  const root = makeTmpRoot();
  const { runId, run: runObj } = createRun('TASK-001', { root });
  writeRunPointer(runObj, root);
  const artifact = JSON.parse(fs.readFileSync(path.join(root, '.planning', 'harness-run-latest.json'), 'utf8'));
  assert.equal(artifact.runId, runId);
  assert.equal(artifact.summary.status, 'running');
  assert.ok(typeof artifact.generatedAt === 'string');
});

run('writeRunPointer: complete run → summary.status = pass', () => {
  const root   = makeTmpRoot();
  const fakeRun = { runId: 'run-1', taskId: 'T1', phase: 'complete', status: 'complete' };
  writeRunPointer(fakeRun, root);
  const artifact = JSON.parse(fs.readFileSync(path.join(root, '.planning', 'harness-run-latest.json'), 'utf8'));
  assert.equal(artifact.summary.status, 'pass');
});

// ── writeEvidence ─────────────────────────────────────────────────────────────

run('writeEvidence: sets gateEvidence on current phase record', () => {
  const root     = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const evidence = { command: 'node lint.js', exitCode: 0, durationMs: 100 };
  writeEvidence(runId, evidence, root);
  const runObj = readRun(runId, root);
  const current = runObj.phases[runObj.phases.length - 1];
  assert.deepEqual(current.gateEvidence, evidence);
});

run('writeEvidence: does not close the phase record (status stays active)', () => {
  const root     = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  writeEvidence(runId, { skipped: 'auto-pass' }, root);
  const runObj  = readRun(runId, root);
  const current = runObj.phases[runObj.phases.length - 1];
  assert.equal(current.status, 'active');
  assert.equal(current.gateResult, null);
});

// ── Gate functions ────────────────────────────────────────────────────────────

run('GATES.fetch_context: auto-pass with skipped evidence', () => {
  const root     = makeTmpRoot();
  const { runId, run: runObj } = createRun('TASK-001', { root });
  const result   = GATES.fetch_context({ runId, run: runObj, root, dryRun: false });
  assert.equal(result.passed, true);
  assert.ok(result.evidence.skipped);
});

run('GATES.implement: auto-pass with skipped evidence', () => {
  const root     = makeTmpRoot();
  const { runId, run: runObj } = createRun('TASK-001', { root });
  const result   = GATES.implement({ runId, run: runObj, root, dryRun: false });
  assert.equal(result.passed, true);
  assert.ok(result.evidence.skipped);
});

run('GATES.plan_design: passes when ARCHITECTURE-*.md exists', () => {
  const root     = makeTmpRoot();
  const planDir  = path.join(root, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'ARCHITECTURE-2026-05-30-test.md'), '# arch', 'utf8');
  const { runId, run: runObj } = createRun('TASK-001', { root });
  const result   = GATES.plan_design({ run: runObj, root });
  assert.equal(result.passed, true);
  assert.ok(result.evidence.skipped);
});

run('GATES.plan_design: fails when no arch file and no design artifact', () => {
  const root     = makeTmpRoot();
  const { runId, run: runObj } = createRun('TASK-001', { root });
  const result   = GATES.plan_design({ run: runObj, root });
  assert.equal(result.passed, false);
  assert.equal(result.evidence.found, false);
});

run('GATES.linter: skips when lint command empty', () => {
  const root   = makeTmpRoot();
  const result = GATES.linter({ root, dryRun: false });
  assert.equal(result.passed, true);
  assert.ok(result.evidence.skipped);
});

run('GATES.linter: dry-run does not execute, returns skipped', () => {
  const root   = makeTmpRoot();
  const result = GATES.linter({ root, dryRun: true });
  assert.equal(result.passed, true);
  assert.ok(result.evidence.skipped);
});

run('GATES.tests: skips when test command empty', () => {
  const root   = makeTmpRoot();
  const result = GATES.tests({ root, dryRun: false });
  assert.equal(result.passed, true);
  assert.ok(result.evidence.skipped);
});

run('GATES.code_review: returns findings array', () => {
  const root   = makeTmpRoot();
  const result = GATES.code_review({ root });
  assert.ok(Array.isArray(result.findings));
  assert.ok(result.evidence.command === 'submitReview');
});

run('GATES.git_push: skips when no artifact file', () => {
  const root   = makeTmpRoot();
  const result = GATES.git_push({ root, supplyChainAudit: supplyChainAudit() });
  assert.equal(result.passed, true);
  assert.ok(result.evidence.skipped);
  assert.equal(result.evidence.supplyChain.status, 'pass');
});

run('supply-chain summary: detects approved client drift', () => {
  const audit = supplyChainAudit({ clientState: { installed: true, matchesSource: false } });
  const result = summarizeSupplyChainAudit(audit);
  assert.equal(result.ok, false);
  assert.equal(result.driftCounts.driftedInstalls, 1);
});

run('supply-chain preflight: drift fails without documented bypass', () => {
  const root = makeTmpRoot();
  const audit = supplyChainAudit({ clientState: { installed: true, matchesSource: false } });
  const result = runSupplyChainPreflight({ root, audit, now: new Date('2026-06-03T00:00:00Z') });
  assert.equal(result.passed, false);
  assert.equal(result.findings[0].severity, 'high');
  assert.equal(result.evidence.status, 'fail');
});

run('supply-chain preflight: documented bypass allows known drift', () => {
  const root = makeTmpRoot();
  const audit = supplyChainAudit({ clientState: { installed: true, matchesSource: false } });
  writeSupplyChainBypass(root);
  const result = runSupplyChainPreflight({ root, audit, now: new Date('2026-06-03T00:00:00Z') });
  assert.equal(result.passed, true);
  assert.equal(result.evidence.status, 'bypassed');
  assert.equal(result.evidence.bypass.approvedBy, 'agent-3');
});

run('GATES.git_push: supply-chain drift blocks success before git audit', () => {
  const root = makeTmpRoot();
  const audit = supplyChainAudit({ clientState: { installed: true, matchesSource: false } });
  const result = GATES.git_push({ root, supplyChainAudit: audit, now: new Date('2026-06-03T00:00:00Z') });
  assert.equal(result.passed, false);
  assert.equal(result.evidence.supplyChain.status, 'fail');
  assert.equal(result.findings[0].severity, 'high');
});

// ── AC3: docs-delta COMPLEX without docs → high finding → block ───────────────

run('AC3: code_review COMPLEX without docs delta → high finding injected', () => {
  const root = makeTmpRoot();
  // Write a fake docs-gate artifact: COMPLEX, no docs changed
  const planDir = path.join(root, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'docs-gate-latest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    complexity: 'COMPLEX',
    docsChanged: [],
    codeChanged: ['tools/x.js'],
    summary: { status: 'fail' },
  }), 'utf8');

  const result = GATES.code_review({ root });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].severity, 'high');
  assert.ok(result.findings[0].message.includes('COMPLEX'));
});

run('AC3: code_review COMPLEX WITH docs delta → no blocking finding', () => {
  const root    = makeTmpRoot();
  const planDir = path.join(root, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'docs-gate-latest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    complexity: 'COMPLEX',
    docsChanged: ['AGENTS.md'],
    codeChanged: ['tools/x.js'],
    summary: { status: 'pass' },
  }), 'utf8');

  const result = GATES.code_review({ root });
  const highFindings = result.findings.filter(f => f.severity === 'high' || f.severity === 'critical');
  assert.equal(highFindings.length, 0);
});

run('AC3: code_review MEDIUM without docs → low finding (does not block)', () => {
  const root    = makeTmpRoot();
  const planDir = path.join(root, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'docs-gate-latest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    complexity: 'MEDIUM',
    docsChanged: [],
    codeChanged: ['tools/x.js'],
    summary: { status: 'warn' },
  }), 'utf8');

  const result = GATES.code_review({ root });
  const highFindings = result.findings.filter(f => f.severity === 'high' || f.severity === 'critical');
  assert.equal(highFindings.length, 0);
  const lowFindings = result.findings.filter(f => f.severity === 'low');
  assert.equal(lowFindings.length, 1);
});

// ── runGate — dry-run ─────────────────────────────────────────────────────────

run('runGate dry-run: fetch_context — does not transition', () => {
  const root     = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const result   = runGate(runId, { root, dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.phase, 'fetch_context'); // unchanged
  const runObj   = readRun(runId, root);
  assert.equal(runObj.phase, 'fetch_context');  // not transitioned
});

run('runGate dry-run: does not write run pointer', () => {
  const root     = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  runGate(runId, { root, dryRun: true });
  assert.ok(!fs.existsSync(path.join(root, '.planning', 'harness-run-latest.json')));
});

// ── runGate — fetch_context ───────────────────────────────────────────────────

run('runGate fetch_context: transitions to plan_design + writes evidence', () => {
  const root     = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const result   = runGate(runId, { root, dryRun: false });
  assert.equal(result.passed, true);
  assert.equal(result.phase, 'plan_design');

  const runObj    = readRun(runId, root);
  const prevPhase = runObj.phases.find(p => p.phase === 'fetch_context');
  assert.ok(prevPhase, 'fetch_context phase record must exist');
  assert.ok(prevPhase.gateEvidence, 'gateEvidence must be written');
  assert.ok(prevPhase.gateEvidence.skipped);
});

run('runGate fetch_context: writes harness-run-latest.json', () => {
  const root     = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  runGate(runId, { root });
  const artifact = JSON.parse(fs.readFileSync(path.join(root, '.planning', 'harness-run-latest.json'), 'utf8'));
  assert.equal(artifact.runId, runId);
  assert.equal(artifact.phase, 'plan_design');
});

// ── runGate — linter (simulated fail) ────────────────────────────────────────

run('linter fail (non-zero exit): transitions back to implement', () => {
  const root     = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  // Advance to linter manually (fetch_context → plan_design → implement → linter)
  const planDir = path.join(root, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'ARCHITECTURE-test.md'), '# arch', 'utf8');
  runGate(runId, { root }); // fetch_context → plan_design
  runGate(runId, { root }); // plan_design → implement (arch file present)
  runGate(runId, { root }); // implement → linter

  // Now at linter with a real failing command
  // Write pipeline-state with a failing lint command
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-lint-'));
  const home   = path.join(tmpDir, 'home');
  const orig   = process.env.USERPROFILE;
  process.env.USERPROFILE = home;
  try {
    replaceStateForNewTask({
      root, home,
      nextTask: 'task', nextGoal: 'goal', doneWhen: 'done',
      complexity: 'COMPLEX',
      commands: { lint: 'node -e "process.exit(1)"' },
      now: new Date('2026-05-30T10:00:00Z'),
    });
    const result = runGate(runId, { root });
    assert.equal(result.passed, false);
    assert.equal(result.phase, 'implement'); // linter fail → implement (fixloop)

    const runObj  = readRun(runId, root);
    const linter  = runObj.phases.find(p => p.phase === 'linter' && p.status === 'failed');
    assert.ok(linter, 'failed linter phase record must exist');
    assert.ok(linter.gateEvidence, 'gateEvidence must be written before transition');
    assert.equal(linter.gateEvidence.exitCode, 1);
  } finally {
    process.env.USERPROFILE = orig;
  }
});

// ── runGate — tests-pass → code_review ───────────────────────────────────────

run('tests pass: transitions to code_review + evidence written', () => {
  const root     = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const planDir  = path.join(root, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'ARCHITECTURE-test.md'), '# arch', 'utf8');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-tests-'));
  const home   = path.join(tmpDir, 'home');
  const orig   = process.env.USERPROFILE;
  process.env.USERPROFILE = home;
  try {
    replaceStateForNewTask({
      root, home,
      nextTask: 'task', nextGoal: 'goal', doneWhen: 'done',
      complexity: 'COMPLEX',
      commands: { lint: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' },
      now: new Date('2026-05-30T10:00:00Z'),
    });
    runGate(runId, { root }); // fetch_context → plan_design
    runGate(runId, { root }); // plan_design → implement
    runGate(runId, { root }); // implement → linter
    runGate(runId, { root }); // linter pass → tests
    const result = runGate(runId, { root }); // tests pass → code_review
    assert.equal(result.passed, true);
    assert.equal(result.phase, 'code_review');

    const runObj    = readRun(runId, root);
    const testsRec  = runObj.phases.find(p => p.phase === 'tests' && p.status === 'passed');
    assert.ok(testsRec, 'passed tests phase record must exist');
    assert.ok(testsRec.gateEvidence, 'gateEvidence must be written');
    assert.equal(testsRec.gateEvidence.exitCode, 0);
  } finally {
    process.env.USERPROFILE = orig;
  }
});

// ── AC2: code_review high finding → blocked → implement ──────────────────────

run('AC2: code_review with COMPLEX docs-delta finding → blocked → implement', () => {
  const root    = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const planDir = path.join(root, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'ARCHITECTURE-test.md'), '# arch', 'utf8');
  // COMPLEX with no docs delta → high finding
  fs.writeFileSync(path.join(planDir, 'docs-gate-latest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    complexity: 'COMPLEX',
    docsChanged: [],
    codeChanged: ['tools/x.js'],
    summary: { status: 'fail' },
  }), 'utf8');

  // Advance to code_review manually (5 passing transitions)
  advanceN(runId, root, 5);

  const result = runGate(runId, { root });
  // high finding (>= threshold 'high') → blocked
  assert.equal(result.phase, 'implement');

  const runObj     = readRun(runId, root);
  const reviewRec  = runObj.phases.find(p => p.phase === 'code_review' && p.status === 'failed');
  assert.ok(reviewRec, 'failed code_review phase record must exist');
  assert.ok(reviewRec.gateEvidence, 'gateEvidence must be written before transition');
  assert.equal(reviewRec.gateEvidence.command, 'submitReview');
});

run('AC2: code_review with no findings → passes → git_push', () => {
  const root    = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const planDir = path.join(root, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  // Clean docs-gate: docs updated
  fs.writeFileSync(path.join(planDir, 'docs-gate-latest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    complexity: 'COMPLEX',
    docsChanged: ['AGENTS.md'],
    codeChanged: ['tools/x.js'],
    summary: { status: 'pass' },
  }), 'utf8');

  advanceN(runId, root, 5);
  const result = runGate(runId, { root });
  assert.equal(result.phase, 'git_push');
});

// ── AC1: verifyCloseout ───────────────────────────────────────────────────────

run('AC1: verifyCloseout without evidence → ok:false', () => {
  const root    = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  // Advance manually all the way to complete (7 transitions: 5 pre-review + submitReview pass + git_push)
  advanceN(runId, root, 5);
  // code_review → need to use submitReview
  const { submitReview: sr } = require('./harness-runner');
  sr(runId, [], { root }); // no findings → passes → git_push
  transition(runId, true, { root }); // git_push → complete

  const runObj = readRun(runId, root);
  assert.equal(runObj.status, 'complete');

  const result = verifyCloseout(runId, { root });
  assert.equal(result.ok, false);
  assert.ok(result.reason.includes('missing gateEvidence'));
});

run('AC1: verifyCloseout with evidence from runGate → ok:true', () => {
  const root    = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const planDir = path.join(root, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'ARCHITECTURE-test.md'), '# arch', 'utf8');
  // Clean docs-gate
  fs.writeFileSync(path.join(planDir, 'docs-gate-latest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    complexity: 'COMPLEX',
    docsChanged: ['AGENTS.md'],
    codeChanged: ['tools/x.js'],
    summary: { status: 'pass' },
  }), 'utf8');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-closeout-'));
  const home   = path.join(tmpDir, 'home');
  const orig   = process.env.USERPROFILE;
  process.env.USERPROFILE = home;
  try {
    replaceStateForNewTask({
      root, home,
      nextTask: 'task', nextGoal: 'goal', doneWhen: 'done',
      complexity: 'COMPLEX',
      commands: { lint: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' },
      now: new Date('2026-05-30T10:00:00Z'),
    });

    // Run all gates via runGate (all 7 phases)
    for (let i = 0; i < 7; i++) runGate(runId, { root, supplyChainAudit: supplyChainAudit() });

    const runObj = readRun(runId, root);
    assert.equal(runObj.status, 'complete');

    const result = verifyCloseout(runId, { root, supplyChainAudit: supplyChainAudit() });
    assert.equal(result.ok, true);
  } finally {
    process.env.USERPROFILE = orig;
  }
});

run('verifyCloseout: complete run with supply-chain drift в†’ ok:false', () => {
  const root    = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const planDir = path.join(root, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'ARCHITECTURE-test.md'), '# arch', 'utf8');
  fs.writeFileSync(path.join(planDir, 'docs-gate-latest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    complexity: 'COMPLEX',
    docsChanged: ['AGENTS.md'],
    codeChanged: ['tools/x.js'],
    summary: { status: 'pass' },
  }), 'utf8');

  for (let i = 0; i < 7; i++) runGate(runId, { root, supplyChainAudit: supplyChainAudit() });

  const drift = supplyChainAudit({ clientState: { installed: true, matchesSource: false } });
  const result = verifyCloseout(runId, { root, supplyChainAudit: drift, now: new Date('2026-06-03T00:00:00Z') });
  assert.equal(result.ok, false);
  assert.ok(result.reason.includes('supply-chain preflight failed'));
});

run('verifyCloseout: complete run with documented supply-chain bypass в†’ ok:true', () => {
  const root    = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const planDir = path.join(root, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, 'ARCHITECTURE-test.md'), '# arch', 'utf8');
  fs.writeFileSync(path.join(planDir, 'docs-gate-latest.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    complexity: 'COMPLEX',
    docsChanged: ['AGENTS.md'],
    codeChanged: ['tools/x.js'],
    summary: { status: 'pass' },
  }), 'utf8');

  for (let i = 0; i < 7; i++) runGate(runId, { root, supplyChainAudit: supplyChainAudit() });
  writeSupplyChainBypass(root);

  const drift = supplyChainAudit({ clientState: { installed: true, matchesSource: false } });
  const result = verifyCloseout(runId, { root, supplyChainAudit: drift, now: new Date('2026-06-03T00:00:00Z') });
  assert.equal(result.ok, true);
});

run('verifyCloseout: run not complete → ok:false with reason', () => {
  const root     = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const result   = verifyCloseout(runId, { root });
  assert.equal(result.ok, false);
  assert.ok(result.reason.includes('"running"'));
});

// ── buildGatePlan ─────────────────────────────────────────────────────────────

run('buildGatePlan: returns all 7 phases with command info', () => {
  const root     = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const plan     = buildGatePlan(runId, { root });
  assert.equal(plan.runId, runId);
  assert.equal(plan.currentPhase, 'fetch_context');
  assert.equal(plan.gates.length, 7);
  const linterGate = plan.gates.find(g => g.phase === 'linter');
  assert.equal(linterGate.isCommandBacked, true);
  const implementGate = plan.gates.find(g => g.phase === 'implement');
  assert.equal(implementGate.isCommandBacked, false);
});

// ── runGate — terminal phase throws ──────────────────────────────────────────

run('runGate on terminal phase throws', () => {
  const root    = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  // Force terminal
  const runObj  = readRun(runId, root);
  runObj.phase  = 'complete';
  runObj.status = 'complete';
  fs.writeFileSync(path.join(root, '.planning', 'runs', runId, 'run.json'), JSON.stringify(runObj, null, 2), 'utf8');
  assert.throws(() => runGate(runId, { root }), /terminal phase/);
});

// ── Summary ───────────────────────────────────────────────────────────────────

process.stdout.write('\n');
if (failed > 0) {
  process.stderr.write(`harness-gates tests: ${passed} passed, ${failed} FAILED\n`);
  process.exit(1);
} else {
  process.stdout.write(`harness-gates tests: ${passed} passed\n`);
}
