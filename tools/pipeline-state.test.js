#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  closeState,
  projectStatePath,
  readState,
  replaceStateForNewTask,
  routeForComplexity,
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
  assert.equal(ledger.length, 2);
  assert.equal(ledger[1].kind, 'outcome');
}

function main() {
  testTrivialRouteBypassesInterviewAndHeavySkills();
  testArchTaskEntersInterviewAndWritesStateBeforePlanning();
  testStaleStateIsReplacedBeforeNewWork();
  testFinalResponseRequiresArtifactAndProof();
  process.stdout.write('pipeline-state tests: PASS\n');
}

main();
