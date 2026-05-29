#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  parseArgs,
  projectKey,
  projectStatePath,
  parseSkillFrontmatter,
  checkSettingsSecrets,
  checkCodexDefaults,
  checkGitHubCli,
  checkPipelineState,
  checkAgentSurfaceAudit,
  checkHarnessChecklist,
  checkHarnessRun,
  runDoctor,
} = require('./doctor-core');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function testParseArgs() {
  const parsed = parseArgs(['node', 'doctor.js', '--root', 'C:\\tmp\\x', '--json', '--no-graphify']);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.root, 'C:\\tmp\\x');
  assert.equal(parsed.value.json, true);
  assert.equal(parsed.value.graphify, false);

  const invalid = parseArgs(['node', 'doctor.js', '--unknown']);
  assert.equal(invalid.ok, false);
}

function testProjectKeyStable() {
  const first = projectKey('C:\\Claude playground\\Pipiline setupper');
  const second = projectKey('C:/Claude playground/Pipiline setupper');
  assert.equal(first, second);
  assert.match(first, /^pipiline-setupper-[a-f0-9]{8}$/);
}

function testSkillFrontmatter() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-skill-'));
  const good = path.join(dir, 'good', 'SKILL.md');
  const goodBom = path.join(dir, 'good-bom', 'SKILL.md');
  const bad = path.join(dir, 'bad', 'SKILL.md');
  write(good, '---\nname: ok\ndescription: works\n---\n# Body\n');
  write(goodBom, '\uFEFF---\nname: ok\ndescription: works\n---\n# Body\n');
  write(bad, '---\nname ok\n---\n# Body\n');
  assert.equal(parseSkillFrontmatter(good).ok, true);
  assert.equal(parseSkillFrontmatter(goodBom).ok, true);
  assert.equal(parseSkillFrontmatter(bad).ok, false);
}

function testPipelineStateValidation() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-state-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project-a');
  write(projectStatePath(root, home), JSON.stringify({
    cwd: root,
    ts: '2026-05-08T12:00:00Z',
  }));
  write(path.join(home, '.claude', 'pipeline-state.json'), JSON.stringify({
    cwd: path.join(dir, 'project-b'),
    ts: '2026-05-08T12:00:00Z',
  }));
  const checks = checkPipelineState(root, home, new Date('2026-05-08T12:00:00Z'));
  assert.equal(checks[0].status, 'pass');
  assert.equal(checks[0].id, 'state:pipeline');
  assert.equal(checks[1].status, 'warn');
  assert.equal(checks[1].id, 'state:pipeline:legacy');
  assert.match(checks[1].title, /another project/);
}

function testPipelineStateRejectsFutureLegacy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-state-future-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project-a');
  write(projectStatePath(root, home), JSON.stringify({
    cwd: root,
    ts: '2026-05-08T12:00:00Z',
  }));
  write(path.join(home, '.claude', 'pipeline-state.json'), JSON.stringify({
    cwd: root,
    ts: '2026-05-09T12:00:00Z',
  }));
  const checks = checkPipelineState(root, home, new Date('2026-05-08T12:00:00Z'));
  assert.equal(checks[0].status, 'pass');
  assert.equal(checks[1].status, 'warn');
  assert.match(checks[1].title, /future/);
}

function testPipelineStateAcceptsClosedCyrillic() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-state-closed-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project-a');
  write(projectStatePath(root, home), JSON.stringify({
    phase: 'closed',
    closedAt: '2026-05-08T12:00:00Z',
    note: 'Закрито після спринту',
  }, null, 2));
  const checks = checkPipelineState(root, home, new Date('2026-05-09T12:00:00Z'));
  assert.equal(checks[0].status, 'pass');
  assert.match(checks[0].title, /closed/);
  const text = fs.readFileSync(projectStatePath(root, home), 'utf8');
  assert.match(text, /Закрито після спринту/);
}

function testDoctorSkipsCodemapWithNoGraphify() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-no-graphify-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  write(path.join(root, 'AGENTS.md'), coreDoc());
  write(path.join(root, 'CLAUDE.md'), coreDoc());
  write(path.join(root, '.gemini', 'GEMINI.md'), coreDoc());
  write(path.join(home, '.claude', 'skill-registry', 'digests.jsonl'), JSON.stringify({ name: 'x' }) + '\n');
  const report = withHome(home, () => runDoctor({ root, register: true, graphify: false }));
  assert.equal(report.checks.some((check) => check.id === 'codemap:scope'), false);
  assert.equal(report.checks.some((check) => check.id === 'graphify:skipped'), true);
}

function testSettingsSecretsScanner() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-settings-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  const googleKeyFixture = `AI${'zaSy'}${'B0Rr_paSjkdT48jnHbrLFps4cOusOd5q0'}`;
  write(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({
    permissions: {
      allow: [`Bash(export GOOGLE_API_KEY="${googleKeyFixture}")`],
    },
  }));
  write(path.join(home, '.codex', 'config.toml'), 'CONTEXT7_API_KEY = "${CONTEXT7_API_KEY}"\n');
  const failed = checkSettingsSecrets(root, home);
  assert.equal(failed[0].status, 'fail');

  write(path.join(root, '.claude', 'settings.local.json'), JSON.stringify({
    permissions: {
      allow: ['Bash(node tools/doctor.js --root .)'],
    },
  }));
  const passed = checkSettingsSecrets(root, home);
  assert.equal(passed[0].status, 'pass');
}

function testGitHubCliAuthWarningSkipsCodeSearch() {
  const calls = [];
  const fakeRun = (command, args) => {
    calls.push([command, ...args].join(' '));
    if (args[0] === '--version') return { status: 0, output: 'gh version 2.0.0' };
    if (args[0] === 'auth') return { status: 1, output: 'HTTP 401' };
    return { status: 0, output: '' };
  };

  const checks = checkGitHubCli(process.cwd(), fakeRun);
  assert.equal(checks.find((check) => check.id === 'github:auth').status, 'warn');
  assert.equal(checks.find((check) => check.id === 'github:code-search').status, 'warn');
  assert.equal(calls.some((call) => call.startsWith('gh search code')), false);
}

function testCodexDefaultsWarnOnExpensiveRoute() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-codex-defaults-'));
  const home = path.join(dir, 'home');
  // Expensive == legacy model (gpt-4/gpt-3 family), not high effort.
  // checkCodexDefaults treats gpt-5.5 as the current flagship (pass), so the
  // "warn on expensive route" case must use a genuinely legacy expensive model.
  write(path.join(home, '.codex', 'config.toml'), [
    'model = "gpt-4-turbo"',
    'model_reasoning_effort = "xhigh"',
    '',
  ].join('\n'));
  assert.equal(checkCodexDefaults(home)[0].status, 'warn');

  write(path.join(home, '.codex', 'config.toml'), [
    'model = "gpt-5.4"',
    'model_reasoning_effort = "medium"',
    '',
  ].join('\n'));
  assert.equal(checkCodexDefaults(home)[0].status, 'pass');
}

function testAgentSurfaceAuditCheck() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-agent-surface-'));
  const missing = checkAgentSurfaceAudit(root, new Date('2026-05-27T12:00:00Z'));
  assert.equal(missing[0].status, 'warn');

  write(path.join(root, '.planning', 'agent-surface-audit-latest.json'), JSON.stringify({
    generatedAt: '2026-05-27T11:00:00Z',
    summary: { status: 'pass', unexplainedGaps: [] },
  }));
  const passed = checkAgentSurfaceAudit(root, new Date('2026-05-27T12:00:00Z'));
  assert.equal(passed[0].status, 'pass');

  write(path.join(root, '.planning', 'agent-surface-audit-latest.json'), JSON.stringify({
    generatedAt: '2026-05-27T11:00:00Z',
    summary: { status: 'warn', unexplainedGaps: ['codex:Notification'] },
  }));
  const warned = checkAgentSurfaceAudit(root, new Date('2026-05-27T12:00:00Z'));
  assert.equal(warned[0].status, 'warn');
  assert.match(warned[0].detail, /codex:Notification/);
}

function coreDoc() {
  return [
    '# Test',
    '',
    '## Overview',
    'x',
    '## Stack',
    'x',
    '## Commands',
    'x',
    '## Architecture',
    'x',
    '## Gotchas',
    'x',
    '## Current State',
    'x',
    '',
  ].join('\n');
}

function testHarnessChecklistCheck() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-harness-checklist-'));
  const now = new Date('2026-05-29T12:00:00Z');

  const missing = checkHarnessChecklist(root, now);
  assert.equal(missing[0].status, 'warn');
  assert.equal(missing[0].id, 'harness:checklist');

  write(path.join(root, '.planning', 'harness-checklist-latest.json'), JSON.stringify({
    generatedAt: '2026-05-29T11:00:00Z',
    summary: { status: 'pass', counts: { pass: 25, warn: 0, fail: 0, needsJustification: 0 } },
  }));
  const passed = checkHarnessChecklist(root, now);
  assert.equal(passed[0].status, 'pass');
  assert.match(passed[0].detail, /25 pass/);

  // fail status is surfaced as warn (advisory, non-blocking) with a repair hint
  write(path.join(root, '.planning', 'harness-checklist-latest.json'), JSON.stringify({
    generatedAt: '2026-05-29T11:00:00Z',
    summary: { status: 'fail', counts: { pass: 20, warn: 0, fail: 5, needsJustification: 0 } },
  }));
  const failed = checkHarnessChecklist(root, now);
  assert.equal(failed[0].status, 'warn');
  assert.match(failed[0].repair, /harness-checklist\.js/);

  // stale artifact (older than TTL) → warn
  write(path.join(root, '.planning', 'harness-checklist-latest.json'), JSON.stringify({
    generatedAt: '2026-05-01T11:00:00Z',
    summary: { status: 'pass', counts: { pass: 25, warn: 0, fail: 0, needsJustification: 0 } },
  }));
  const stale = checkHarnessChecklist(root, now);
  assert.equal(stale[0].status, 'warn');
}

function testHarnessRunCheck() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-harness-run-'));
  const now  = new Date('2026-05-30T12:00:00Z');

  // missing → warn
  const missing = checkHarnessRun(root, now);
  assert.equal(missing[0].status, 'warn');
  assert.equal(missing[0].id, 'harness:run');

  // stale → warn
  write(path.join(root, '.planning', 'harness-run-latest.json'), JSON.stringify({
    generatedAt: '2026-05-01T10:00:00Z',
    runId: 'run-001', phase: 'linter', status: 'running',
    summary: { status: 'running', phase: 'linter' },
  }));
  const stale = checkHarnessRun(root, now);
  assert.equal(stale[0].status, 'warn');
  assert.match(stale[0].title, /stale/i);

  // running → pass (non-blocking)
  write(path.join(root, '.planning', 'harness-run-latest.json'), JSON.stringify({
    generatedAt: '2026-05-30T11:00:00Z',
    runId: 'run-001', phase: 'linter', status: 'running',
    summary: { status: 'running', phase: 'linter' },
  }));
  const running = checkHarnessRun(root, now);
  assert.equal(running[0].status, 'pass');

  // complete → pass
  write(path.join(root, '.planning', 'harness-run-latest.json'), JSON.stringify({
    generatedAt: '2026-05-30T11:30:00Z',
    runId: 'run-001', phase: 'complete', status: 'complete',
    summary: { status: 'pass', phase: 'complete' },
  }));
  const done = checkHarnessRun(root, now);
  assert.equal(done[0].status, 'pass');
  assert.match(done[0].title, /complete/i);
}

function withHome(home, fn) {
  const previous = process.env.USERPROFILE;
  process.env.USERPROFILE = home;
  try {
    return fn();
  } finally {
    process.env.USERPROFILE = previous;
  }
}

function main() {
  testParseArgs();
  testProjectKeyStable();
  testSkillFrontmatter();
  testPipelineStateValidation();
  testPipelineStateRejectsFutureLegacy();
  testPipelineStateAcceptsClosedCyrillic();
  testDoctorSkipsCodemapWithNoGraphify();
  testSettingsSecretsScanner();
  testGitHubCliAuthWarningSkipsCodeSearch();
  testCodexDefaultsWarnOnExpensiveRoute();
  testAgentSurfaceAuditCheck();
  testHarnessChecklistCheck();
  testHarnessRunCheck();
  process.stdout.write('doctor tests: PASS\n');
}

main();
