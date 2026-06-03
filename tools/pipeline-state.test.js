#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  attachHarnessRun,
  closeState,
  projectStatePath,
  readState,
  recordSupplyChainPreflight,
  replaceStateForNewTask,
  routeForComplexity,
  supplyChainCloseoutBlocker,
  validateFinalCloseout,
} = require('./pipeline-state');

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function testTrivialRouteBypassesInterviewAndHeavySkills() {
  const route = routeForComplexity({ complexity: 'TRIVIAL' });
  assert.equal(route.mode, 'auto');
  assert.equal(route.skill.selected, 'none');
  assert.equal(route.heavySkillsBypassed, true);
}

function testArchTaskEntersInterviewAndWritesStateBeforePlanning() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-state-arch-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  const result = replaceStateForNewTask({
    root,
    home,
    nextTask: 'Design pipeline v3',
    nextGoal: 'Close Sprint 1',
    doneWhen: 'Pipeline v3 state and ledger are verified',
    complexity: 'ARCH',
    commands: { doctor: 'node tools/doctor.js --root .' },
    now: new Date('2026-05-20T10:00:00Z'),
  });

  assert.equal(result.action, 'initialize');
  assert.equal(result.state.phase, 'classified');
  assert.equal(result.state.mode, 'interview');
  assert.equal(fs.existsSync(projectStatePath(root, home)), true);
  assert.equal(readState(projectStatePath(root, home)).phase, 'classified');
}

function testStaleStateIsReplacedBeforeNewWork() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-state-stale-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  const statePath = projectStatePath(root, home);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({
    cwd: root,
    goal: 'Old goal',
    phase: 'implementing',
    ts: '2026-05-18T09:00:00Z',
    ledgerPath: path.join(path.dirname(statePath), 'session-ledger.jsonl'),
  }, null, 2), 'utf8');

  const result = replaceStateForNewTask({
    root,
    home,
    nextTask: 'Close Sprint 1',
    nextGoal: 'Pipeline v3 complete',
    doneWhen: 'Acceptance checks pass',
    complexity: 'COMPLEX',
    now: new Date('2026-05-20T10:00:00Z'),
  });

  assert.equal(result.action, 'replace');
  assert.equal(result.state.goal, 'Pipeline v3 complete');
  assert.equal(result.state.phase, 'classified');
}

function testFinalResponseRequiresArtifactAndProof() {
  const invalid = validateFinalCloseout({
    success: true,
    proof: ['node test.js'],
    artifacts: [],
    remainingWork: [],
  });
  assert.equal(invalid.ok, false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-state-close-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  const result = replaceStateForNewTask({
    root,
    home,
    nextTask: 'Close Sprint 1',
    nextGoal: 'Pipeline v3 complete',
    doneWhen: 'Acceptance checks pass',
    complexity: 'COMPLEX',
    now: new Date('2026-05-20T10:00:00Z'),
  });

  recordSupplyChainPreflight({
    root,
    home,
    command: 'agent-skills.cmd audit --json',
    audit: cleanSupplyChainAudit(),
    now: new Date('2026-05-20T10:05:00Z'),
  });

  const closed = closeState({
    root,
    home,
    outcome: 'success',
    proof: ['node tools/pipeline-state.test.js'],
    artifacts: ['tools/pipeline-state.js'],
    remainingWork: [],
    now: new Date('2026-05-20T10:10:00Z'),
  });

  assert.equal(closed.phase, 'closed');
  assert.match(closed.closedAt, /^2026-05-20T10:10:00\.000Z$/);
  const ledger = readJsonl(result.state.ledgerPath);
  assert.equal(ledger.length, 3);
  assert.equal(ledger[1].kind, 'supply-chain-preflight');
  assert.equal(ledger[2].kind, 'outcome');
}

function cleanSupplyChainAudit() {
  return {
    validation: { ok: true, errors: [] },
    clients: { claude: { exists: true }, codex: { exists: true }, gemini: { exists: true } },
    skills: [{
      name: 'pipeline',
      status: 'approved',
      sourceExists: true,
      clients: {
        claude: { installed: true, matchesSource: true },
        codex: { installed: true, matchesSource: true },
        gemini: { installed: true, matchesSource: true },
      },
    }],
    projects: [{ key: 'project-1234', archived: false, exists: true, controlPlane: true }],
  };
}

function driftedSupplyChainAudit() {
  return {
    ...cleanSupplyChainAudit(),
    skills: [{
      name: 'pipeline',
      status: 'approved',
      sourceExists: true,
      clients: {
        claude: { installed: true, matchesSource: true },
        codex: { installed: true, matchesSource: false },
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
      approvedBy: 'pipeline-state-test',
      expiresAt,
    },
  }, null, 2), 'utf8');
}

function testSupplyChainPreflightIsRecordedInStateAndLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-state-supply-chain-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  const result = replaceStateForNewTask({
    root,
    home,
    nextTask: 'Integrate supply-chain preflight',
    nextGoal: 'Preflight is stateful',
    doneWhen: 'State and ledger record audit result',
    complexity: 'MEDIUM',
    now: new Date('2026-06-03T10:00:00Z'),
  });

  const updated = recordSupplyChainPreflight({
    root,
    home,
    command: 'agent-skills.cmd audit --json',
    audit: cleanSupplyChainAudit(),
    now: new Date('2026-06-03T10:01:00Z'),
  });

  assert.equal(updated.supplyChainPreflight.ok, true);
  assert.equal(updated.supplyChainPreflight.command, 'agent-skills.cmd audit --json');
  assert.equal(updated.supplyChainPreflight.drift.count, 0);

  const persisted = readState(projectStatePath(root, home));
  assert.equal(persisted.supplyChainPreflight.ok, true);

  const ledger = readJsonl(result.state.ledgerPath);
  assert.equal(ledger[1].kind, 'supply-chain-preflight');
  assert.equal(ledger[1].ok, true);
}

function testSupplyChainDriftBlocksSuccessCloseout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-state-drift-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  replaceStateForNewTask({
    root,
    home,
    nextTask: 'Integrate supply-chain preflight',
    nextGoal: 'Drift blocks closeout',
    doneWhen: 'Success cannot hide drift',
    complexity: 'COMPLEX',
    now: new Date('2026-06-03T10:00:00Z'),
  });
  const updated = recordSupplyChainPreflight({
    root,
    home,
    command: 'agent-skills.cmd audit --json',
    audit: driftedSupplyChainAudit(),
    now: new Date('2026-06-03T10:01:00Z'),
  });

  assert.match(supplyChainCloseoutBlocker(updated), /Supply-chain drift prevents success closeout/);
  assert.throws(
    () => closeState({
      root,
      home,
      outcome: 'success',
      proof: ['node tools/pipeline-state.test.js'],
      artifacts: ['tools/pipeline-state.js'],
      remainingWork: [],
      now: new Date('2026-06-03T10:02:00Z'),
    }),
    /Supply-chain drift prevents success closeout/
  );
}

function testDocumentedSupplyChainBypassAllowsCloseout() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-state-bypass-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  replaceStateForNewTask({
    root,
    home,
    nextTask: 'Integrate supply-chain preflight',
    nextGoal: 'Bypass is explicit',
    doneWhen: 'Documented bypass is visible',
    complexity: 'MEDIUM',
    now: new Date('2026-06-03T10:00:00Z'),
  });
  writeSupplyChainBypass(root);
  recordSupplyChainPreflight({
    root,
    home,
    command: 'agent-skills.cmd audit --json',
    audit: driftedSupplyChainAudit(),
    now: new Date('2026-06-03T10:01:00Z'),
  });

  const closed = closeState({
    root,
    home,
    outcome: 'success',
    proof: ['node tools/pipeline-state.test.js'],
    artifacts: ['tools/pipeline-state.js'],
    remainingWork: [],
    now: new Date('2026-06-03T10:02:00Z'),
  });

  assert.equal(closed.phase, 'closed');
  assert.equal(closed.supplyChainPreflight.bypass.active, true);
  assert.equal(closed.supplyChainPreflight.bypass.approvedBy, 'pipeline-state-test');
}

function testMissingSupplyChainPreflightBlocksNonTrivialSuccess() {
  const state = { complexity: 'MEDIUM' };
  const result = validateFinalCloseout({
    success: true,
    proof: ['node tools/pipeline-state.test.js'],
    artifacts: ['tools/pipeline-state.js'],
    remainingWork: [],
    state,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /supply-chain preflight/);
}

function testAttachHarnessRunLinksRunId() {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-state-runid-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  replaceStateForNewTask({
    root, home,
    nextTask: 'test task', nextGoal: 'test goal', doneWhen: 'done',
    complexity: 'COMPLEX',
    now: new Date('2026-05-30T10:00:00Z'),
  });

  const updated = attachHarnessRun({ root, home, runId: 'run-20260530100000-abc123' });
  assert.equal(updated.runId, 'run-20260530100000-abc123');

  const persisted = readState(projectStatePath(root, home));
  assert.equal(persisted.runId, 'run-20260530100000-abc123');
  assert.equal(persisted.phase, 'classified'); // other fields preserved
}

function testAttachHarnessRunThrowsWhenNoState() {
  const dir  = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-state-nostate-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  assert.throws(
    () => attachHarnessRun({ root, home, runId: 'run-001' }),
    /pipeline state not found/
  );
}

function main() {
  testTrivialRouteBypassesInterviewAndHeavySkills();
  testArchTaskEntersInterviewAndWritesStateBeforePlanning();
  testStaleStateIsReplacedBeforeNewWork();
  testFinalResponseRequiresArtifactAndProof();
  testSupplyChainPreflightIsRecordedInStateAndLedger();
  testSupplyChainDriftBlocksSuccessCloseout();
  testDocumentedSupplyChainBypassAllowsCloseout();
  testMissingSupplyChainPreflightBlocksNonTrivialSuccess();
  testAttachHarnessRunLinksRunId();
  testAttachHarnessRunThrowsWhenNoState();
  process.stdout.write('pipeline-state tests: PASS\n');
}

main();
