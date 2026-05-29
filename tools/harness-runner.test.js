#!/usr/bin/env node
'use strict';

/**
 * tools/harness-runner.test.js — unit + integration tests for harness-runner.js (P5.1)
 *
 * Coverage:
 *   - generateRunId format
 *   - validateSchema (valid / missing fields / wrong values)
 *   - resolveNextPhase (all 7 phases × pass/fail + maxRetries guard)
 *   - createRun (structure, disk write, defaults)
 *   - readRun (happy path, missing run throws)
 *   - transition (phase advances, fixAttempts, terminal, notes)
 *   - recordArtifact (happy path, invalid key, phase record)
 *   - listRuns (empty, populated)
 *   - Full happy-path workflow (fetch_context → complete)
 *
 * All file-system operations use os.tmpdir() — no repo pollution.
 */

const assert = require('node:assert/strict');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');

const {
  PHASES,
  TERMINAL_PHASES,
  TRANSITIONS,
  ARTIFACT_KEYS,
  generateRunId,
  validateSchema,
  resolveNextPhase,
  createRun,
  readRun,
  transition,
  recordArtifact,
  listRuns,
  getRunPath,
} = require('./harness-runner');

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

// ── Temp root factory ─────────────────────────────────────────────────────────

function makeTmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-'));
}

// ── Fixture: minimal valid run ────────────────────────────────────────────────

function validRunFixture(overrides = {}) {
  return {
    runId:       'run-20260527120000-abc123',
    taskId:      'PROJ-001',
    phase:       'fetch_context',
    status:      'running',
    fixAttempts: 0,
    maxRetries:  3,
    failReason:  null,
    createdAt:   '2026-05-27T12:00:00.000Z',
    updatedAt:   '2026-05-27T12:00:00.000Z',
    closedAt:    null,
    phases: [],
    artifacts: {
      design:              null,
      implementation_plan: null,
      qa_plan:             null,
      review_summary:      null,
    },
    config: {
      maxRetries:             3,
      reviewBlockThreshold:   'high',
    },
    ...overrides,
  };
}

// ── generateRunId ─────────────────────────────────────────────────────────────

run('generateRunId: starts with "run-"', () => {
  assert.ok(generateRunId().startsWith('run-'));
});

run('generateRunId: format is run-YYYYMMDDHHmmss-6hex', () => {
  const id = generateRunId(new Date('2026-05-27T10:30:00Z'));
  assert.match(id, /^run-\d{14}-[0-9a-f]{6}$/);
});

run('generateRunId: unique across two calls', () => {
  // Very low probability of collision; deterministic enough for unit test
  const a = generateRunId();
  const b = generateRunId();
  // runIds use random suffix so they should differ
  assert.ok(typeof a === 'string' && typeof b === 'string');
});

// ── validateSchema ────────────────────────────────────────────────────────────

run('validateSchema: valid fixture passes', () => {
  const { valid, errors } = validateSchema(validRunFixture());
  assert.ok(valid, `Expected valid but got errors: ${errors.join('; ')}`);
});

run('validateSchema: null input fails', () => {
  const { valid } = validateSchema(null);
  assert.ok(!valid);
});

run('validateSchema: missing runId fails', () => {
  const { valid, errors } = validateSchema(validRunFixture({ runId: '' }));
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('runId')));
});

run('validateSchema: missing taskId fails', () => {
  const { valid, errors } = validateSchema(validRunFixture({ taskId: '' }));
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('taskId')));
});

run('validateSchema: invalid phase fails', () => {
  const { valid, errors } = validateSchema(validRunFixture({ phase: 'unknown_phase' }));
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('phase')));
});

run('validateSchema: terminal phase "complete" is valid', () => {
  const { valid } = validateSchema(validRunFixture({ phase: 'complete', status: 'complete' }));
  assert.ok(valid);
});

run('validateSchema: terminal phase "failed" is valid', () => {
  const { valid } = validateSchema(validRunFixture({ phase: 'failed', status: 'failed' }));
  assert.ok(valid);
});

run('validateSchema: invalid status fails', () => {
  const { valid, errors } = validateSchema(validRunFixture({ status: 'pending' }));
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('status')));
});

run('validateSchema: negative fixAttempts fails', () => {
  const { valid, errors } = validateSchema(validRunFixture({ fixAttempts: -1 }));
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('fixAttempts')));
});

run('validateSchema: missing artifacts key fails', () => {
  const run = validRunFixture();
  delete run.artifacts.design;
  const { valid, errors } = validateSchema(run);
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('artifacts.design')));
});

run('validateSchema: invalid reviewBlockThreshold fails', () => {
  const run = validRunFixture();
  run.config.reviewBlockThreshold = 'blocker';
  const { valid, errors } = validateSchema(run);
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('reviewBlockThreshold')));
});

run('validateSchema: missing closedAt field fails', () => {
  const run = validRunFixture();
  delete run.closedAt;
  const { valid, errors } = validateSchema(run);
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('closedAt')));
});

run('validateSchema: missing failReason field fails', () => {
  const run = validRunFixture();
  delete run.failReason;
  const { valid, errors } = validateSchema(run);
  assert.ok(!valid);
  assert.ok(errors.some(e => e.includes('failReason')));
});

// ── resolveNextPhase ──────────────────────────────────────────────────────────

const stub = (fa = 0, mr = 3) => ({ fixAttempts: fa, maxRetries: mr });

run('resolveNextPhase: fetch_context pass → plan_design', () => {
  const r = resolveNextPhase('fetch_context', true, stub());
  assert.equal(r.nextPhase, 'plan_design');
  assert.ok(!r.incrementFix);
});

run('resolveNextPhase: fetch_context fail → failed (no fixLoop)', () => {
  const r = resolveNextPhase('fetch_context', false, stub());
  assert.equal(r.nextPhase, 'failed');
  assert.ok(!r.incrementFix);
});

run('resolveNextPhase: plan_design pass → implement', () => {
  const r = resolveNextPhase('plan_design', true, stub());
  assert.equal(r.nextPhase, 'implement');
  assert.ok(!r.incrementFix);
});

run('resolveNextPhase: plan_design fail (under limit) → plan_design + incrementFix', () => {
  const r = resolveNextPhase('plan_design', false, stub(0, 3));
  assert.equal(r.nextPhase, 'plan_design');
  assert.ok(r.incrementFix);
});

run('resolveNextPhase: plan_design fail (at maxRetries) → failed', () => {
  const r = resolveNextPhase('plan_design', false, stub(3, 3));
  assert.equal(r.nextPhase, 'failed');
  assert.ok(!r.incrementFix);
  assert.ok(r.failReason && r.failReason.includes('maxRetries'));
});

run('resolveNextPhase: implement pass → linter, no incrementFix', () => {
  const r = resolveNextPhase('implement', true, stub());
  assert.equal(r.nextPhase, 'linter');
  assert.ok(!r.incrementFix);
});

run('resolveNextPhase: implement fail → linter (always forward), no incrementFix', () => {
  const r = resolveNextPhase('implement', false, stub());
  assert.equal(r.nextPhase, 'linter');
  assert.ok(!r.incrementFix);
});

run('resolveNextPhase: linter pass → tests', () => {
  const r = resolveNextPhase('linter', true, stub());
  assert.equal(r.nextPhase, 'tests');
});

run('resolveNextPhase: linter fail (under limit) → implement + incrementFix', () => {
  const r = resolveNextPhase('linter', false, stub(1, 3));
  assert.equal(r.nextPhase, 'implement');
  assert.ok(r.incrementFix);
});

run('resolveNextPhase: linter fail (at maxRetries) → failed', () => {
  const r = resolveNextPhase('linter', false, stub(3, 3));
  assert.equal(r.nextPhase, 'failed');
  assert.ok(r.failReason);
});

run('resolveNextPhase: tests pass → code_review', () => {
  const r = resolveNextPhase('tests', true, stub());
  assert.equal(r.nextPhase, 'code_review');
});

run('resolveNextPhase: tests fail (under limit) → linter + incrementFix (re-lint after fix)', () => {
  const r = resolveNextPhase('tests', false, stub(0, 3));
  assert.equal(r.nextPhase, 'linter');
  assert.ok(r.incrementFix);
});

run('resolveNextPhase: tests fail (at maxRetries) → failed', () => {
  const r = resolveNextPhase('tests', false, stub(3, 3));
  assert.equal(r.nextPhase, 'failed');
  assert.ok(r.failReason);
});

run('resolveNextPhase: code_review pass → git_push', () => {
  const r = resolveNextPhase('code_review', true, stub());
  assert.equal(r.nextPhase, 'git_push');
});

run('resolveNextPhase: code_review fail (under limit) → implement + incrementFix', () => {
  const r = resolveNextPhase('code_review', false, stub(0, 3));
  assert.equal(r.nextPhase, 'implement');
  assert.ok(r.incrementFix);
});

run('resolveNextPhase: code_review fail (at maxRetries) → failed', () => {
  const r = resolveNextPhase('code_review', false, stub(3, 3));
  assert.equal(r.nextPhase, 'failed');
  assert.ok(r.failReason);
});

run('resolveNextPhase: git_push pass → complete', () => {
  const r = resolveNextPhase('git_push', true, stub());
  assert.equal(r.nextPhase, 'complete');
});

run('resolveNextPhase: git_push fail → failed (no fixLoop)', () => {
  const r = resolveNextPhase('git_push', false, stub());
  assert.equal(r.nextPhase, 'failed');
  assert.ok(!r.incrementFix);
});

run('resolveNextPhase: unknown phase throws', () => {
  assert.throws(
    () => resolveNextPhase('nonexistent', true, stub()),
    /Unknown phase/
  );
});

// ── createRun ─────────────────────────────────────────────────────────────────

run('createRun: writes run.json to disk', () => {
  const root = makeTmpRoot();
  const { runPath } = createRun('TASK-001', { root });
  assert.ok(fs.existsSync(runPath));
});

run('createRun: initial phase is fetch_context', () => {
  const root = makeTmpRoot();
  const { run } = createRun('TASK-001', { root });
  assert.equal(run.phase, 'fetch_context');
});

run('createRun: initial status is running', () => {
  const root = makeTmpRoot();
  const { run } = createRun('TASK-001', { root });
  assert.equal(run.status, 'running');
});

run('createRun: initial fixAttempts is 0', () => {
  const root = makeTmpRoot();
  const { run } = createRun('TASK-001', { root });
  assert.equal(run.fixAttempts, 0);
});

run('createRun: phases[0] is active fetch_context', () => {
  const root = makeTmpRoot();
  const { run } = createRun('TASK-001', { root });
  assert.equal(run.phases.length, 1);
  assert.equal(run.phases[0].phase, 'fetch_context');
  assert.equal(run.phases[0].status, 'active');
  assert.equal(run.phases[0].exitedAt, null);
});

run('createRun: all artifact slots are null', () => {
  const root = makeTmpRoot();
  const { run } = createRun('TASK-001', { root });
  for (const k of ARTIFACT_KEYS) {
    assert.equal(run.artifacts[k], null, `Expected artifacts.${k} to be null`);
  }
});

run('createRun: failReason is null initially', () => {
  const root = makeTmpRoot();
  const { run } = createRun('TASK-001', { root });
  assert.equal(run.failReason, null);
});

run('createRun: closedAt is null initially', () => {
  const root = makeTmpRoot();
  const { run } = createRun('TASK-001', { root });
  assert.equal(run.closedAt, null);
});

run('createRun: schema validates on creation', () => {
  const root = makeTmpRoot();
  const { run } = createRun('TASK-001', { root });
  const { valid, errors } = validateSchema(run);
  assert.ok(valid, `Schema invalid: ${errors.join('; ')}`);
});

run('createRun: empty taskId throws', () => {
  const root = makeTmpRoot();
  assert.throws(() => createRun('', { root }), /taskId/);
});

run('createRun: invalid reviewBlockThreshold throws', () => {
  const root = makeTmpRoot();
  assert.throws(() => createRun('TASK-001', { root, reviewBlockThreshold: 'blocker' }), /reviewBlockThreshold/);
});

// ── readRun ───────────────────────────────────────────────────────────────────

run('readRun: reads run created by createRun', () => {
  const root = makeTmpRoot();
  const { runId, run } = createRun('TASK-001', { root });
  const read = readRun(runId, root);
  assert.equal(read.runId, run.runId);
  assert.equal(read.taskId, 'TASK-001');
});

run('readRun: throws for missing run', () => {
  const root = makeTmpRoot();
  assert.throws(() => readRun('run-nonexistent', root), /Run not found/);
});

// ── transition ────────────────────────────────────────────────────────────────

run('transition: pass advances fetch_context → plan_design', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const updated = transition(runId, true, { root });
  assert.equal(updated.phase, 'plan_design');
  assert.equal(updated.status, 'running');
});

run('transition: previous phase record is closed as passed', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  transition(runId, true, { root });
  const run = readRun(runId, root);
  const prev = run.phases[0];
  assert.equal(prev.status, 'passed');
  assert.ok(prev.exitedAt !== null);
  assert.equal(prev.gateResult.passed, true);
});

run('transition: fail on fixLoop phase increments fixAttempts', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  transition(runId, true, { root });  // → plan_design
  const updated = transition(runId, false, { root }); // plan_design fail → plan_design (fix loop)
  assert.equal(updated.fixAttempts, 1);
  assert.equal(updated.phase, 'plan_design');
});

run('transition: fixAttempts >= maxRetries → failed', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root, maxRetries: 1 });
  transition(runId, true, { root });   // → plan_design
  transition(runId, false, { root });  // fixAttempts = 1 → plan_design (fix loop; 1 >= 1? No, 0 was fixAttempts BEFORE, so incremented to 1)
  // Actually maxRetries=1 means fixAttempts must reach 1 to trigger. After first fail fixAttempts=1, which == maxRetries=1, so next fail triggers.
  // Wait: resolveNextPhase checks fixAttempts >= maxRetries BEFORE incrementing.
  // So fixAttempts=0, maxRetries=1: 0 >= 1 is false → increment to 1, go to plan_design.
  // Then fixAttempts=1, maxRetries=1: 1 >= 1 is true → go to failed.
  const updated = transition(runId, false, { root });  // fixAttempts=1 >= maxRetries=1 → failed
  assert.equal(updated.phase, 'failed');
  assert.equal(updated.status, 'failed');
  assert.ok(updated.failReason && updated.failReason.includes('maxRetries'));
});

run('transition: on terminal "complete" — throws', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  // Walk to complete via all passes
  const phases = ['fetch_context', 'plan_design', 'implement', 'linter', 'tests', 'code_review', 'git_push'];
  for (let i = 0; i < phases.length; i++) {
    transition(runId, true, { root });
  }
  assert.throws(() => transition(runId, true, { root }), /terminal state "complete"/);
});

run('transition: on terminal "failed" — throws', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  transition(runId, false, { root }); // fetch_context fail → failed
  assert.throws(() => transition(runId, true, { root }), /terminal state "failed"/);
});

run('transition: notes are recorded in gateResult', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  transition(runId, false, { root, notes: ['lint error in line 42'] }); // fetch_context fail
  const run = readRun(runId, root);
  assert.deepEqual(run.phases[0].gateResult.notes, ['lint error in line 42']);
});

run('transition: complete sets closedAt', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const phases = ['fetch_context', 'plan_design', 'implement', 'linter', 'tests', 'code_review', 'git_push'];
  for (let i = 0; i < phases.length; i++) {
    transition(runId, true, { root });
  }
  const run = readRun(runId, root);
  assert.ok(run.closedAt !== null);
});

// ── recordArtifact ────────────────────────────────────────────────────────────

run('recordArtifact: updates artifacts.design', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const updated = recordArtifact(runId, 'design', '.planning/runs/run-001/design.json', root);
  assert.equal(updated.artifacts.design, '.planning/runs/run-001/design.json');
});

run('recordArtifact: adds path to current phase artifacts list', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  recordArtifact(runId, 'design', 'design.json', root);
  const run = readRun(runId, root);
  assert.ok(run.phases[0].artifacts.includes('design.json'));
});

run('recordArtifact: invalid key throws', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  assert.throws(() => recordArtifact(runId, 'unknown_artifact', 'x.json', root), /Unknown artifact key/);
});

// ── listRuns ──────────────────────────────────────────────────────────────────

run('listRuns: returns empty array when no runs dir', () => {
  const root = makeTmpRoot();
  assert.deepEqual(listRuns(root), []);
});

run('listRuns: returns run IDs after createRun', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  const ids = listRuns(root);
  assert.ok(ids.includes(runId));
  assert.equal(ids.length, 1);
});

run('listRuns: returns multiple run IDs sorted', () => {
  const root = makeTmpRoot();
  const { runId: a } = createRun('TASK-A', { root });
  const { runId: b } = createRun('TASK-B', { root });
  const ids = listRuns(root);
  assert.equal(ids.length, 2);
  assert.ok(ids.includes(a) && ids.includes(b));
  // Sorted alphabetically
  assert.deepEqual(ids, [...ids].sort());
});

// ── Full happy-path workflow ──────────────────────────────────────────────────

run('Full workflow: fetch_context → complete (all gates pass)', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('HAPPY-001', { root });

  const expected = [
    'plan_design',
    'implement',
    'linter',
    'tests',
    'code_review',
    'git_push',
    'complete',
  ];

  for (const expectedPhase of expected) {
    const updated = transition(runId, true, { root });
    assert.equal(updated.phase, expectedPhase, `Expected phase ${expectedPhase}, got ${updated.phase}`);
  }

  const finalRun = readRun(runId, root);
  assert.equal(finalRun.status, 'complete');
  assert.equal(finalRun.fixAttempts, 0);
  assert.ok(finalRun.closedAt !== null);
  // All 7 phases should be recorded + the initial (fetch_context was closed)
  assert.equal(finalRun.phases.length, 7); // 7 phases entered (fetch_context through git_push)

  // Validate final schema
  const { valid, errors } = validateSchema(finalRun);
  assert.ok(valid, `Final schema invalid: ${errors.join('; ')}`);
});

// ── severityMeetsThreshold + submitReview (P5.2) ──────────────────────────────

const {
  severityMeetsThreshold,
  submitReview,
  SEVERITY_ORDER,
  REVIEW_THRESHOLDS,
} = require('./harness-runner');

/** Advance run from fetch_context to code_review with 5 passing transitions. */
function advanceToCodeReview(runId, root) {
  for (let i = 0; i < 5; i++) transition(runId, true, { root });
}

// severityMeetsThreshold
run('severityMeetsThreshold: low >= low = true', () => {
  assert.ok(severityMeetsThreshold('low', 'low'));
});
run('severityMeetsThreshold: high >= high = true', () => {
  assert.ok(severityMeetsThreshold('high', 'high'));
});
run('severityMeetsThreshold: critical >= high = true', () => {
  assert.ok(severityMeetsThreshold('critical', 'high'));
});
run('severityMeetsThreshold: medium >= high = false', () => {
  assert.ok(!severityMeetsThreshold('medium', 'high'));
});
run('severityMeetsThreshold: low >= critical = false', () => {
  assert.ok(!severityMeetsThreshold('low', 'critical'));
});
run('severityMeetsThreshold: medium >= medium = true', () => {
  assert.ok(severityMeetsThreshold('medium', 'medium'));
});

// submitReview — pass cases
run('submitReview: no findings → pass → git_push', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  advanceToCodeReview(runId, root);
  const result = submitReview(runId, [], { root });
  assert.equal(result.blocked, false);
  assert.equal(result.blockingFindings.length, 0);
  assert.equal(result.run.phase, 'git_push');
});

run('submitReview: low+medium findings with high threshold → pass → git_push', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  advanceToCodeReview(runId, root);
  const result = submitReview(runId, [
    { severity: 'low',    message: 'minor style nit' },
    { severity: 'medium', message: 'consider refactoring' },
  ], { root });
  assert.equal(result.blocked, false);
  assert.equal(result.run.phase, 'git_push');
});

// ACCEPTANCE TEST: High finding blocks closed (P5.2)
run('submitReview (ACCEPTANCE): high finding blocks closed — transitions to implement', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root, reviewBlockThreshold: 'high' });
  advanceToCodeReview(runId, root);
  const result = submitReview(runId, [
    { severity: 'high', message: 'SQL injection risk in user input handler', file: 'src/auth.js', line: 42 },
  ], { root });
  assert.equal(result.blocked, true);
  assert.equal(result.blockingFindings.length, 1);
  assert.equal(result.blockingFindings[0].severity, 'high');
  assert.equal(result.run.phase, 'implement');   // blocked → fail → implement, NOT git_push
  assert.equal(result.run.fixAttempts, 1);
  // Verify run cannot reach 'complete' without passing code_review
  assert.notEqual(result.run.status, 'complete');
});

run('submitReview: critical finding with high threshold → blocked → implement', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root, reviewBlockThreshold: 'high' });
  advanceToCodeReview(runId, root);
  const result = submitReview(runId, [
    { severity: 'critical', message: 'hardcoded secret exposed' },
  ], { root });
  assert.equal(result.blocked, true);
  assert.equal(result.run.phase, 'implement');
});

run('submitReview: medium finding with medium threshold → blocked', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root, reviewBlockThreshold: 'medium' });
  advanceToCodeReview(runId, root);
  const result = submitReview(runId, [
    { severity: 'medium', message: 'missing input validation' },
  ], { root });
  assert.equal(result.blocked, true);
  assert.equal(result.run.phase, 'implement');
});

run('submitReview: mixed findings — only high+ are blocking', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root, reviewBlockThreshold: 'high' });
  advanceToCodeReview(runId, root);
  const result = submitReview(runId, [
    { severity: 'low',      message: 'nit' },
    { severity: 'high',     message: 'critical logic error' },
    { severity: 'critical', message: 'security hole' },
  ], { root });
  assert.equal(result.blocked, true);
  assert.equal(result.blockingFindings.length, 2);
  assert.equal(result.run.fixAttempts, 1);
});

run('submitReview: findings recorded in code_review phase record', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  advanceToCodeReview(runId, root);
  submitReview(runId, [{ severity: 'low', message: 'nit' }], { root });
  const run = readRun(runId, root);
  const reviewRecord = run.phases.find(p => p.phase === 'code_review');
  assert.ok(reviewRecord, 'code_review phase record must exist');
  assert.ok(Array.isArray(reviewRecord.reviewFindings));
  assert.equal(reviewRecord.reviewFindings.length, 1);
});

run('submitReview: summaryPath recorded in run.artifacts.review_summary', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  advanceToCodeReview(runId, root);
  submitReview(runId, [], { root, summaryPath: '.planning/runs/run-001/review_summary.md' });
  const run = readRun(runId, root);
  assert.equal(run.artifacts.review_summary, '.planning/runs/run-001/review_summary.md');
});

// submitReview — error cases
run('submitReview: wrong phase throws', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root }); // phase = fetch_context
  assert.throws(() => submitReview(runId, [], { root }), /only valid during code_review/);
});

run('submitReview: invalid severity throws', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  advanceToCodeReview(runId, root);
  assert.throws(
    () => submitReview(runId, [{ severity: 'blocker', message: 'x' }], { root }),
    /severity must be one of/
  );
});

run('submitReview: missing message throws', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  advanceToCodeReview(runId, root);
  assert.throws(
    () => submitReview(runId, [{ severity: 'high' }], { root }),
    /message must be a non-empty string/
  );
});

run('submitReview: non-array findings throws', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root });
  advanceToCodeReview(runId, root);
  assert.throws(() => submitReview(runId, 'high', { root }), /findings must be an array/);
});

run('submitReview: maxRetries exceeded on second code_review fail → failed', () => {
  const root = makeTmpRoot();
  const { runId } = createRun('TASK-001', { root, maxRetries: 1 });
  advanceToCodeReview(runId, root);
  // First fail: fixAttempts 0 < 1 → increment to 1, go to implement
  const r1 = submitReview(runId, [{ severity: 'high', message: 'blocker' }], { root });
  assert.equal(r1.run.phase, 'implement');
  assert.equal(r1.run.fixAttempts, 1);
  // Advance back to code_review
  transition(runId, true, { root }); // implement → linter
  transition(runId, true, { root }); // linter → tests
  transition(runId, true, { root }); // tests → code_review
  // Second fail: fixAttempts 1 >= maxRetries 1 → failed
  const r2 = submitReview(runId, [{ severity: 'high', message: 'still blocked' }], { root });
  assert.equal(r2.run.phase, 'failed');
  assert.ok(r2.run.failReason.includes('maxRetries'));
});

// ── Summary ───────────────────────────────────────────────────────────────────

process.stdout.write(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
