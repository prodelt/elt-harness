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
  checkAgentSkillSupplyChain,
  checkAgentSkillsWrapper,
  checkHarnessChecklist,
  checkHarnessRun,
  checkHarnessGlobal,
  checkFleet,
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

function writeSupplyChainFixture(root) {
  write(path.join(root, 'tools', 'agent-skill-supply-chain.js'), '#!/usr/bin/env node\n');
  write(path.join(root, 'config', 'agent-skill-sources.json'), JSON.stringify({
    version: 1,
    policy: { targetClients: ['claude', 'codex', 'gemini'] },
    skills: [
      {
        id: 'pipeline',
        name: 'pipeline',
        tier: 'core',
        status: 'approved',
        source: { type: 'local-client', client: 'claude', path: 'pipeline' },
      },
    ],
    externalCandidates: [],
  }));
}

function supplyChainAudit(overrides = {}) {
  const clients = {
    claude: { root: 'home/.claude/skills', exists: true },
    codex: { root: 'home/.codex/skills', exists: true },
    gemini: { root: 'home/.gemini/skills', exists: true },
  };
  const skillClients = {
    claude: { installed: true, matchesSource: true },
    codex: { installed: true, matchesSource: true },
    gemini: { installed: true, matchesSource: true },
  };
  return {
    kind: 'agent-skill-supply-chain',
    validation: { ok: true, errors: [] },
    clients,
    skills: [{ id: 'pipeline', name: 'pipeline', status: 'approved', sourceExists: true, clients: skillClients }],
    projects: [{ key: 'demo', exists: true, controlPlane: true }],
    ...overrides,
  };
}

function testAgentSkillSupplyChainCheck() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-agent-skills-'));
  const home = path.join(root, 'home');
  writeSupplyChainFixture(root);

  const passed = checkAgentSkillSupplyChain(root, home, () => supplyChainAudit());
  assert.equal(passed[0].status, 'pass');
  assert.equal(passed[0].id, 'agent-skills:supply-chain');

  const warned = checkAgentSkillSupplyChain(root, home, () => supplyChainAudit({
    skills: [{
      id: 'pipeline',
      name: 'pipeline',
      status: 'approved',
      sourceExists: true,
      clients: {
        claude: { installed: true, matchesSource: true },
        codex: { installed: false, matchesSource: false },
        gemini: { installed: true, matchesSource: false },
      },
    }],
    projects: [{ key: 'missing', exists: false, controlPlane: false }],
  }));
  assert.equal(warned[0].status, 'warn');
  assert.match(warned[0].detail, /missingInstalls=1/);
  assert.match(warned[0].detail, /driftedInstalls=1/);
  assert.match(warned[0].detail, /missingProjects=1/);

  const failed = checkAgentSkillSupplyChain(root, home, () => ({
    kind: 'agent-skill-supply-chain-error',
    validation: { ok: false, errors: ['skills must be an array'] },
  }));
  assert.equal(failed[0].status, 'fail');
  assert.match(failed[0].title, /manifest invalid/);
}

function testAgentSkillsWrapperCheck() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-agent-skills-wrapper-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  fs.mkdirSync(root, { recursive: true });
  write(path.join(home, '.claude', 'projects-registry.json'), JSON.stringify({ pipelineDir: root }));

  const missing = checkAgentSkillsWrapper(root, home, () => ({ status: 0, output: '' }));
  assert.equal(missing[0].status, 'warn');
  assert.equal(missing[0].id, 'agent-skills:wrapper');

  write(path.join(root, 'tools', 'agent-skill-supply-chain.js'), '#!/usr/bin/env node\n');
  write(path.join(root, 'tools', 'install-agent-skills-wrapper.js'), '#!/usr/bin/env node\n');
  const wrapper = path.join(home, '.claude', 'bin', 'agent-skills.cmd');
  const script = path.join(root, 'tools', 'agent-skill-supply-chain.js');
  write(wrapper, '@echo off\nset "SCRIPT=C:\\old\\agent-skill-supply-chain.js"\nnode "%SCRIPT%" %*\n');

  const targetWarn = checkAgentSkillsWrapper(root, home, () => ({ status: 0, output: wrapper }));
  assert.equal(targetWarn[0].status, 'warn');
  assert.match(targetWarn[0].title, /target mismatch/);

  write(wrapper, `@echo off\nset "SCRIPT=${script}"\nnode "%SCRIPT%" %*\n`);
  const passed = checkAgentSkillsWrapper(root, home, () => ({ status: 0, output: wrapper }));
  assert.equal(passed[0].status, 'pass');

  const pathWarn = checkAgentSkillsWrapper(root, home, () => ({ status: 1, output: 'not found' }));
  assert.equal(pathWarn[0].status, 'warn');
  assert.match(pathWarn[0].title, /PATH/);

  const wrongPath = checkAgentSkillsWrapper(root, home, () => ({ status: 0, output: path.join(dir, 'other', 'agent-skills.cmd') }));
  assert.equal(wrongPath[0].status, 'warn');
  assert.match(wrongPath[0].title, /PATH mismatch/);
}

function coreDoc() {
  return [
    '# Test',
    '',
    '## Commands',
    'x',
    '## Stack',
    'x',
    '## Gotchas',
    'x',
    '## Memory',
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

  // stale complete history remains valid evidence
  write(path.join(root, '.planning', 'harness-run-latest.json'), JSON.stringify({
    generatedAt: '2026-05-01T10:00:00Z',
    runId: 'run-001', phase: 'complete', status: 'complete',
    summary: { status: 'pass', phase: 'complete' },
  }));
  const staleComplete = checkHarnessRun(root, now);
  assert.equal(staleComplete[0].status, 'pass');
  assert.match(staleComplete[0].title, /history complete/i);

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

function testHarnessGlobalCheck() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-harness-global-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  fs.mkdirSync(root, { recursive: true });
  write(path.join(home, '.claude', 'projects-registry.json'), JSON.stringify({ pipelineDir: root }));

  const missing = checkHarnessGlobal(root, home, () => ({ status: 0, output: '' }));
  assert.equal(missing[0].status, 'warn');
  assert.equal(missing[0].id, 'harness:global-cli');

  write(path.join(root, 'tools', 'harness-runner.js'), '#!/usr/bin/env node\n');
  write(path.join(root, 'tools', 'harness-gates.js'), '#!/usr/bin/env node\n');
  for (const name of ['harness-runner.cmd', 'harness-runner.ps1', 'harness-gates.cmd', 'harness-gates.ps1']) {
    write(path.join(home, '.claude', 'bin', name), 'echo ok\n');
  }
  const passed = checkHarnessGlobal(root, home, () => ({ status: 0, output: 'ok' }));
  assert.equal(passed[0].status, 'pass');

  const pathWarn = checkHarnessGlobal(root, home, () => ({ status: 1, output: 'not found' }));
  assert.equal(pathWarn[0].status, 'warn');
  assert.match(pathWarn[0].title, /PATH/);
}

function testFleetCheck() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fleet-'));
  const home = path.join(dir, 'home');
  const withHarness = path.join(dir, 'with-harness');
  const bare = path.join(dir, 'bare');
  const halfCycle = path.join(dir, 'half-cycle');
  // Full cycle: oracle armed AND a plan exists (specs/) → pass.
  fs.mkdirSync(path.join(withHarness, '.git'), { recursive: true });
  fs.mkdirSync(path.join(withHarness, '.harness'), { recursive: true });
  write(path.join(withHarness, '.harness', 'harness.json'), '{}');
  write(path.join(withHarness, 'specs', '001-x', 'tasks.md'), '- [ ] **T001** x\n');
  fs.mkdirSync(bare, { recursive: true });
  // Half cycle: oracle armed but no specs/ → front half unused → warn.
  fs.mkdirSync(path.join(halfCycle, '.git'), { recursive: true });
  fs.mkdirSync(path.join(halfCycle, '.harness'), { recursive: true });
  write(path.join(halfCycle, '.harness', 'harness.json'), '{}');
  write(path.join(home, '.claude', 'projects-registry.json'), JSON.stringify({
    version: 1,
    projects: {
      a: { key: 'a', name: 'with-harness', path: withHarness },
      b: { key: 'b', name: 'bare', path: bare },
      c: { key: 'c', name: 'gone', path: path.join(dir, 'does-not-exist') },
      d: { key: 'd', name: 'half-cycle', path: halfCycle },
    },
  }));
  const fakeGit = () => ({ status: 0, output: '' });
  const checks = checkFleet(home, { runner: fakeGit });
  const byKey = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(byKey['fleet:a'].status, 'pass');
  assert.equal(byKey['fleet:b'].status, 'warn');
  assert.match(byKey['fleet:b'].detail, /no oracle/);
  assert.equal(byKey['fleet:c'].status, 'warn');
  assert.match(byKey['fleet:c'].title, /path missing/);
  assert.equal(byKey['fleet:d'].status, 'warn');
  assert.match(byKey['fleet:d'].detail, /half-cycle/);
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
  testAgentSkillSupplyChainCheck();
  testAgentSkillsWrapperCheck();
  testHarnessChecklistCheck();
  testHarnessRunCheck();
  testHarnessGlobalCheck();
  testFleetCheck();
  process.stdout.write('doctor tests: PASS\n');
}

main();
