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
  checkCodeGraph,
  checkCodeGraphMcp,
  checkCodeGraphAdoption,
  checkAgentSurfaceAudit,
  checkAgentSkillSupplyChain,
  checkAgentSkillsWrapper,
  checkHarnessChecklist,
  checkHarnessRun,
  checkHarnessGlobal,
  checkFleet,
  checkFleetWorkers,
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

// T008 (004-elt-selfdrive): codegraph-liveness must actually check, not
// silently skip — missing db / stale status must surface as WARN with repair.
function testCodeGraphStatusMissingDb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cg-missing-'));
  const checks = checkCodeGraph(root);
  assert.equal(checks.length, 1);
  assert.equal(checks[0].status, 'warn');
  assert.match(checks[0].repair, /codegraph init/);
}

function testCodeGraphStatusMockedGreenAndStale() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cg-'));
  fs.mkdirSync(path.join(root, '.codegraph'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codegraph', 'codegraph.db'), '');

  const green = 'Files: 10\nNodes: 100\nBackend: node:sqlite\n[OK] Index is up to date\n';
  const greenChecks = checkCodeGraph(root, () => ({ status: 0, output: green, error: '' }));
  assert.equal(greenChecks[0].id, 'codegraph:status');
  assert.equal(greenChecks[0].status, 'pass');
  assert.match(greenChecks[0].detail, /files=10/);

  const stale = 'Files: 10\nNodes: 100\nBackend: node:sqlite\nPending Changes:\n  Modified: 2 files\n';
  const staleChecks = checkCodeGraph(root, () => ({ status: 0, output: stale, error: '' }));
  assert.equal(staleChecks[0].status, 'warn');
  assert.match(staleChecks[0].repair, /codegraph sync/);

  const failed = checkCodeGraph(root, () => ({ status: 1, output: '', error: 'spawn ENOENT' }));
  assert.equal(failed[0].status, 'warn');
  assert.match(failed[0].repair, /codegraph sync/);
}

function testCodeGraphMcpCheck() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cg-home-'));
  assert.equal(checkCodeGraphMcp(home).status, 'warn');

  write(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { codegraph: { command: 'codegraph' } } }));
  assert.equal(checkCodeGraphMcp(home).status, 'pass');
}

function testCodeGraphAdoptionCheck() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cg-adopt-home-'));
  const root = 'C:\\fake\\project-adopt';
  const dirName = path.resolve(root).replace(/\\/g, '/').replace(/[^A-Za-z0-9]/g, '-');
  const sessionsDir = path.join(home, '.claude', 'projects', dirName);

  assert.equal(checkCodeGraphAdoption(root, home)[0].status, 'warn');

  write(path.join(sessionsDir, 's1.jsonl'), JSON.stringify({ type: 'user' }));
  const noToolUse = checkCodeGraphAdoption(root, home);
  assert.equal(noToolUse[0].status, 'warn');
  assert.match(noToolUse[0].detail, /0 codegraph_\* calls \/ 0 tool calls/);

  write(path.join(sessionsDir, 's2.jsonl'), [
    JSON.stringify({ type: 'tool_use', name: 'Read' }),
    JSON.stringify({ type: 'tool_use', name: 'Grep' }),
  ].join('\n'));
  const ignoredMandate = checkCodeGraphAdoption(root, home);
  assert.equal(ignoredMandate[0].status, 'warn');
  assert.match(ignoredMandate[0].detail, /0 codegraph_\* calls \/ 2 tool calls/);

  write(path.join(sessionsDir, 's3.jsonl'), JSON.stringify({ type: 'tool_use', name: 'mcp__codegraph__codegraph_context' }));
  const adopted = checkCodeGraphAdoption(root, home);
  assert.equal(adopted[0].status, 'pass');
  assert.match(adopted[0].detail, /1 codegraph_\* calls \/ 3 tool calls/);
}

// T009 (004-elt-selfdrive): opt-in pre-slice codegraph guard. Reuses
// checkCodeGraph (T008) — no config / codegraphGuard:false = no-op even with
// a missing db (most projects don't opt in); codegraphGuard:true must fail
// loud on a dead/stale index instead of letting the driver silently degrade
// to Read.
function testCodegraphGuard() {
  const { guard } = require('./codegraph-guard');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-cg-guard-'));

  const noConfig = guard(root);
  assert.equal(noConfig.ok, true, 'нет harness.json — гард молчит');

  write(path.join(root, '.harness', 'harness.json'), JSON.stringify({ codegraphGuard: false }));
  const disabled = guard(root);
  assert.equal(disabled.ok, true, 'codegraphGuard:false — no-op даже без db');

  write(path.join(root, '.harness', 'harness.json'), JSON.stringify({ codegraphGuard: true }));
  const missingDb = guard(root);
  assert.equal(missingDb.ok, false, 'codegraphGuard:true + нет db — громкий fail');

  fs.mkdirSync(path.join(root, '.codegraph'), { recursive: true });
  fs.writeFileSync(path.join(root, '.codegraph', 'codegraph.db'), '');

  const stale = 'Files: 10\nNodes: 100\nBackend: node:sqlite\nPending Changes:\n  Modified: 2 files\n';
  const staleResult = guard(root, () => ({ status: 0, output: stale, error: '' }));
  assert.equal(staleResult.ok, false, 'codegraphGuard:true + stale — громкий fail');

  const green = 'Files: 10\nNodes: 100\nBackend: node:sqlite\n[OK] Index is up to date\n';
  const healthy = guard(root, () => ({ status: 0, output: green, error: '' }));
  assert.equal(healthy.ok, true, 'codegraphGuard:true + свежий индекс — no-op');

  fs.rmSync(root, { recursive: true, force: true });
}

function testFleetExperimentalLabelHonest() {
  // T012: specs/003-elt-fleet-hardening ЗАКРЫТА (verdict 2.66x/3.31x) — CLAUDE.md
  // не должен молча утверждать обратное. Если experimental-метка ещё стоит
  // (реальный live-fire не завершён), рядом обязано быть явное «003 закрыта, но...»,
  // не голое устаревшее «пока 003 не закрыт».
  const claudeMd = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');
  assert.doesNotMatch(
    claudeMd,
    /пока `specs\/003-elt-fleet-hardening` не закрыт/,
    'устаревшее «003 не закрыта» — 003 закрыта (verdict 2.66x/3.31x), текст врёт'
  );
  if (/fleet/i.test(claudeMd) && /experimental/i.test(claudeMd)) {
    assert.match(
      claudeMd,
      /003-elt-fleet-hardening`? закрыт/i,
      'experimental-метка стоит без явного обоснования «003 закрыта, но...»'
    );
  }
}

function testHarnessSelfcheck() {
  const { selfcheck } = require('./harness-selfcheck');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-selfcheck-'));

  const noConfig = selfcheck(root, () => { throw new Error('runner не должен звать без harness.json'); });
  assert.equal(noConfig.ok, true, 'нет harness.json — молчит, оракул не зовётся');

  write(path.join(root, '.harness', 'harness.json'), JSON.stringify({ oracle: 'echo ok', shell: 'bash' }));

  const green = selfcheck(root, () => 0);
  assert.equal(green.ok, true, 'зелёный оракул — no-op');
  assert.equal(fs.existsSync(path.join(root, 'specs')), false, 'зелёный оракул не заводит specs/');

  const red = selfcheck(root, () => 1);
  assert.equal(red.ok, false, 'красный оракул — watchdog сообщает fail');
  assert.equal(red.slice.id, 'T001', 'первый слайс — T001');
  const tasksBody = fs.readFileSync(red.slice.tasksFile, 'utf8');
  assert.match(tasksBody, /\[ \] \*\*T001\*\*/, 'слайс-запись открыта [ ]');
  assert.match(tasksBody, /echo ok/, 'команда оракула упомянута в слайсе');

  const runlog = fs.readFileSync(path.join(root, '.harness', 'run-log.jsonl'), 'utf8').trim().split('\n');
  const marker = JSON.parse(runlog[runlog.length - 1]);
  assert.equal(marker.status, 'harness-selfcheck-red', 'маркер в run-log');
  assert.equal(marker.selfheal, 'T001', 'маркер ссылается на заведённый слайс');

  const redAgain = selfcheck(root, () => 1);
  assert.equal(redAgain.slice.id, 'T002', 'повторный красный — следующий ID, не перезапись');

  fs.rmSync(root, { recursive: true, force: true });
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

function testFleetWorkersCheck() {
  // проект без fleet → тихо (пустой массив)
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-fleet-bare-'));
  assert.deepEqual(checkFleetWorkers(bare), [], 'нет fleet → нет чеков');
  fs.rmSync(bare, { recursive: true, force: true });

  // проект с политикой + залежавшийся claim + CLI pre-flight (инжект runner)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-fleet-'));
  require('node:child_process').execFileSync('git', ['init', '-q'], { cwd: root }); // worktree.list тихо
  const claimsDir = path.join(root, '.harness', 'fleet', 'claims');
  write(path.join(claimsDir, 'T1.json'), JSON.stringify({ tid: 'T1', pid: 2147480000, worker: 'ghost' }));
  write(path.join(root, '.harness', 'fleet', 'fleet.json'), JSON.stringify({ default: ['claude'], policy: { S: ['codex'] } }));
  const fakeRunner = (cmd) => (cmd === 'claude' ? { status: 0, output: 'claude 2.1.0' } : { status: 1, error: 'not found' });

  const checks = checkFleetWorkers(root, fakeRunner);
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(byId['fleet:claims'].status, 'warn');
  assert.match(byId['fleet:claims'].detail, /T1/);
  assert.equal(byId['fleet:cli:claude'].status, 'pass', 'claude --version ок → pass');
  assert.equal(byId['fleet:cli:codex'].status, 'warn', 'codex недоступен → warn');
  fs.rmSync(root, { recursive: true, force: true });
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

// T001 (004-elt-selfdrive): single-source elt.js. Каждый реальный вызыватель (elt-loop.ps1,
// tools/fleet/*.js) зовёт ~/.claude/bin/elt.js — глобальный деплой; tools/elt.js — версионируемая
// копия в репо. Они ДОЛЖНЫ быть идентичны по контенту, иначе дрейф (bin имел fallback в findTasks,
// tools — нет → на нескольких spec-папках вернул бы не тот план). Сравнение нормализует CRLF
// (autocrlf в этом репо). bin отсутствует (свежий клон/CI без глобального деплоя) → скип, не false-fail.
function testEltSingleSource() {
  const binElt = path.join(os.homedir(), '.claude', 'bin', 'elt.js');
  const repoElt = path.join(__dirname, 'elt.js');
  if (!fs.existsSync(binElt)) return; // нет глобального деплоя — нечего сверять
  const norm = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/﻿/g, '');
  assert.equal(
    norm(repoElt),
    norm(binElt),
    'DRIFT: tools/elt.js != ~/.claude/bin/elt.js — синхронизируй (bin = деплой, tools = репо-копия), иначе драйвер/fleet и тесты расходятся',
  );
}

// T005 (004-elt-selfdrive): stuck-detector. Unit-level streak/threshold logic
// PLUS a live spawn of `elt.js commit` against a deliberately failing oracle —
// proves the red-stop entry the hook reads is real, not just a synthetic
// fixture (same dead-signal class T002 fixed for the judge).
function testStuckDetectorUnit() {
  const { runLogStreak, buildNudge, THRESHOLD } = require('./stuck-detector');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stuck-detector-'));
  const rl = path.join(dir, 'run-log.jsonl');
  assert.equal(runLogStreak(rl), 0, 'нет файла → 0');

  const lines = [];
  for (let i = 0; i < THRESHOLD - 1; i++) lines.push(JSON.stringify({ status: 'red-stop' }));
  write(rl, lines.join('\n') + '\n');
  assert.equal(runLogStreak(rl), THRESHOLD - 1);
  assert.equal(buildNudge(runLogStreak(rl)), null, 'ниже порога — тишина');

  fs.appendFileSync(rl, JSON.stringify({ status: 'red-stop' }) + '\n');
  assert.equal(runLogStreak(rl), THRESHOLD);
  assert.match(buildNudge(runLogStreak(rl)), /Застрял/, 'на пороге — nudge');

  fs.appendFileSync(rl, JSON.stringify({ commit: 'deadbee' }) + '\n');
  assert.equal(runLogStreak(rl), 0, 'зелёный commit сбрасывает счётчик');
  fs.rmSync(dir, { recursive: true, force: true });
}

// Both `elt commit` (red oracle blocks the commit) AND standalone `elt oracle`
// must log red-stop. Found live: the transcript-fallback this test's OWN
// deliberate-failure fixture used to feed produced a false stuck-detector nudge
// with zero real red-stops in run-log — fixed by dropping the transcript path
// entirely and making `elt oracle` log too, so run-log alone is complete.
function testEltCommitLogsRedStopOnOracleFail() {
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-redstop-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  write(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    oracle: 'exit 1', shell: 'powershell', branchPolicy: 'feature', push: false, judge: { enabled: false },
  }));
  write(path.join(root, 'dirty.txt'), 'change\n');

  const eltPath = path.join(__dirname, 'elt.js');
  try {
    execFileSync(process.execPath, [eltPath, 'commit'], { cwd: root, encoding: 'utf8' });
    assert.fail('красный оракул должен был провалить elt commit');
  } catch (err) {
    assert.notEqual(err.status, 0, 'elt commit падает на красном оракуле');
  }

  let runLog = fs.readFileSync(path.join(root, '.harness', 'run-log.jsonl'), 'utf8').trim().split('\n');
  let entry = JSON.parse(runLog[runLog.length - 1]);
  assert.equal(entry.status, 'red-stop', 'красный оракул оставил red-stop в run-log, а не тишину');
  assert.equal(entry.oracle.exit, 1);

  try {
    execFileSync(process.execPath, [eltPath, 'oracle'], { cwd: root, encoding: 'utf8' });
    assert.fail('standalone elt oracle тоже должен провалиться');
  } catch (err) {
    assert.notEqual(err.status, 0);
  }
  runLog = fs.readFileSync(path.join(root, '.harness', 'run-log.jsonl'), 'utf8').trim().split('\n');
  entry = JSON.parse(runLog[runLog.length - 1]);
  assert.equal(entry.status, 'red-stop', 'standalone `elt oracle` тоже оставил red-stop (не только commit)');

  fs.rmSync(root, { recursive: true, force: true });
}

// T014 (004-elt-selfdrive): probe-primitives parsing logic, tested against synthetic
// fixtures — NOT a live claude spawn (install path/version varies per machine, so this
// stays portable; the real live probe is `node tools/probe-primitives.js`, run manually
// and committed as specs/004-elt-selfdrive/primitives.md).
function testProbePrimitivesParsing() {
  const {
    parseHelpFlags, scanTokens, renderPrimitivesMd, probe, FLAG_CHECKS,
  } = require('./probe-primitives');

  const fakeHelp = '  --session-id <uuid>   Use a specific session ID\n  --effort <level>      Effort level\n';
  const flags = parseHelpFlags(fakeHelp, FLAG_CHECKS);
  assert.equal(flags['--session-id'], true, 'присутствующий флаг найден');
  assert.equal(flags['--effort'], true);
  assert.equal(flags['-r/--resume'], false, 'отсутствующий флаг — false, не throw');

  const tokens = scanTokens(['SessionEnd', 'Stop', 'agent_completed'], ['SessionEnd', 'Notification']);
  assert.equal(tokens.SessionEnd, true);
  assert.equal(tokens.Notification, false, 'отсутствующий токен — false');

  const results = probe({ helpText: fakeHelp, agentsHelpText: '', exeStrings: null, version: 'test-1.0' });
  const md = renderPrimitivesMd(results);
  assert.match(md, /--session-id \| confirmed/, 'найденный флаг попал в таблицу как confirmed');
  assert.match(md, /-r\/--resume \| absent/, 'отсутствующий флаг — absent, не молчание');
  assert.match(md, /hook: SessionEnd \| unknown/, 'без exeStrings хук-события честно unknown, не false-confirmed');
}

// T006 (004-elt-selfdrive): checkpoint-writer. Below stage2 → silent, no
// .planning/ side-effect; above stage2 → writes a checkpoint file sourced
// from a REAL `elt status` spawn (T001 single-source), not a hand-built
// fixture — proves git/last-run/next-slice/resume-prompt round-trip through
// the actual harness CLI, not just through renderCheckpoint's string glue.
function testCheckpointWriter() {
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(__dirname, 'checkpoint-writer.js'), '--selftest'], { encoding: 'utf8' });
}

// T007 (004-elt-selfdrive): elt-drive.ps1 session-rotation драйвер. -DryRun не спавнит
// живой claude — только он и портативно тестируем через оракул. Проверяем: N раундов
// показаны с session-id, чекпоинт-между упомянут, STOP-файл (до старта) обрывает ВСЕ раунды —
// тот же STOP-до-старта паттерн, что и fleet.test.js.
function testEltDriveDryRun() {
  const { execFileSync } = require('node:child_process');
  const script = path.join(__dirname, 'elt-drive.ps1');

  const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-drive-'));
  const out1 = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Project', dir1, '-Goal', 'test goal', '-Rounds', '3', '-DryRun',
  ], { encoding: 'utf8' });
  const rounds = out1.match(/раунд \d+\/3/g) || [];
  assert.equal(rounds.length, 3, 'DryRun показывает все 3 раунда');
  assert.match(out1, /session-id=/, 'session-id проброшен в вывод раунда');
  assert.match(out1, /чекпоинт/i, 'чекпоинт между раундами упомянут');
  fs.rmSync(dir1, { recursive: true, force: true });

  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-drive-stop-'));
  fs.mkdirSync(path.join(dir2, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(dir2, '.harness', 'STOP'), '');
  const out2 = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Project', dir2, '-Goal', 'test goal', '-Rounds', '3', '-DryRun',
  ], { encoding: 'utf8' });
  const rounds2 = out2.match(/раунд \d+\/3/g) || [];
  assert.equal(rounds2.length, 0, 'STOP-файл до старта — ни одного раунда');
  assert.match(out2, /STOP/i, 'STOP явно упомянут в выводе');
  fs.rmSync(dir2, { recursive: true, force: true });
}

function main() {
  testEltSingleSource();
  testStuckDetectorUnit();
  testEltCommitLogsRedStopOnOracleFail();
  testCheckpointWriter();
  testEltDriveDryRun();
  testProbePrimitivesParsing();
  testParseArgs();
  testProjectKeyStable();
  testSkillFrontmatter();
  testPipelineStateValidation();
  testPipelineStateRejectsFutureLegacy();
  testPipelineStateAcceptsClosedCyrillic();
  testDoctorSkipsCodemapWithNoGraphify();
  testCodeGraphStatusMissingDb();
  testCodeGraphStatusMockedGreenAndStale();
  testCodeGraphMcpCheck();
  testCodeGraphAdoptionCheck();
  testCodegraphGuard();
  testFleetExperimentalLabelHonest();
  testHarnessSelfcheck();
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
  testFleetWorkersCheck();
  process.stdout.write('doctor tests: PASS\n');
}

main();
