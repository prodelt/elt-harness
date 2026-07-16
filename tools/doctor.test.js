#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  parseArgs,
  projectKey,
  parseSkillFrontmatter,
  checkSettingsSecrets,
  checkCodexDefaults,
  checkGitHubCli,
  checkCodeGraph,
  checkCodeGraphMcp,
  checkCodeGraphAdoption,
  checkAgentSurfaceAudit,
  checkAgentSkillSupplyChain,
  checkAgentSkillsLock,
  checkAgentSkillsWrapper,
  checkHarnessChecklist,
  checkHarnessGlobal,
  checkFleet,
  checkFleetWorkers,
  checkSelfDriveInvariants,
  runDoctor,
  runFleet,
} = require('./doctor-core');
const { CORE_SECTIONS } = require('./project-docs-core');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function testParseArgs() {
  const parsed = parseArgs(['node', 'doctor.js', '--root', 'C:\\tmp\\x', '--json']);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.root, 'C:\\tmp\\x');
  assert.equal(parsed.value.json, true);

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
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-selfcheck-'));
  execFileSync('git', ['init', '-q'], { cwd: root });

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

  const runlog = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n');
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

// AC13: dangerous Codex default (danger-full-access + approval=never) must be a high-risk
// signal; safe profile passes. The sandbox finding is the second element ([1]).
function testCodexSandboxProfileSignal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-codex-sandbox-'));
  const home = path.join(dir, 'home');
  const cfg = (lines) => write(path.join(home, '.codex', 'config.toml'), lines.join('\n') + '\n');
  const sandboxOf = () => checkCodexDefaults(home).find((c) => c.id === 'codex:sandbox');

  // safe default → pass
  cfg(['model = "gpt-5.5"', 'sandbox_mode = "workspace-write"', 'approval_policy = "on-request"']);
  assert.equal(sandboxOf().status, 'pass');

  // high-risk: no sandbox AND no approvals → fail
  cfg(['model = "gpt-5.5"', 'sandbox_mode = "danger-full-access"', 'approval_policy = "never"']);
  const risky = sandboxOf();
  assert.equal(risky.status, 'fail', 'danger-full-access + approval=never is high-risk');
  assert.match(risky.title, /high-risk/i);

  // full access but with approvals → warn (privileged but gated)
  cfg(['model = "gpt-5.5"', 'sandbox_mode = "danger-full-access"', 'approval_policy = "on-request"']);
  assert.equal(sandboxOf().status, 'warn');

  // sandbox keys unset → pass (Codex built-in default is not danger-full-access)
  cfg(['model = "gpt-5.5"']);
  assert.equal(sandboxOf().status, 'pass');

  // guard: doctor never writes config.toml — file content unchanged after checks
  const contentBefore = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
  checkCodexDefaults(home);
  assert.equal(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8'), contentBefore);

  fs.rmSync(dir, { recursive: true, force: true });
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

  // старый-но-валидный pass → pass по содержанию, не warn-по-возрасту (P2-1)
  write(path.join(root, '.planning', 'agent-surface-audit-latest.json'), JSON.stringify({
    generatedAt: '2026-05-01T11:00:00Z',
    summary: { status: 'pass', unexplainedGaps: [] },
  }));
  const old = checkAgentSurfaceAudit(root, new Date('2026-05-27T12:00:00Z'));
  assert.equal(old[0].status, 'pass');
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

function writeLockFixture(root, home, { skillMdBody, driftGemini, missingCodex } = {}) {
  const body = skillMdBody || [
    '---',
    'name: demo-critical',
    'version: 1.0.0',
    'requires: []',
    '---',
    '',
    '# demo',
  ].join('\n');
  write(path.join(root, 'skills', 'demo-critical', 'SKILL.md'), body);
  write(path.join(home, '.claude', 'skills', 'demo-critical', 'SKILL.md'), body);
  if (!missingCodex) write(path.join(home, '.codex', 'skills', 'demo-critical', 'SKILL.md'), body);
  write(path.join(home, '.gemini', 'skills', 'demo-critical', 'SKILL.md'), driftGemini ? `${body}\nEXTRA\n` : body);
  write(path.join(root, 'agent-skills.lock.json'), JSON.stringify({
    version: 2,
    skills: {
      'demo-critical': {
        sourceKind: 'repo',
        source: 'skills/demo-critical/SKILL.md',
        targets: {
          claude: '.claude/skills/demo-critical/SKILL.md',
          codex: '.codex/skills/demo-critical/SKILL.md',
          gemini: '.gemini/skills/demo-critical/SKILL.md',
        },
      },
    },
  }));
}

function testAgentSkillsLockCheck() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-agent-skills-lock-'));
  const root = path.join(dir, 'project');
  const home = path.join(dir, 'home');

  writeLockFixture(root, home);
  const passed = checkAgentSkillsLock(root, home);
  assert.equal(passed[0].status, 'pass');
  assert.equal(passed[0].id, 'agent-skills:lock');

  writeLockFixture(root, home, { missingCodex: true });
  fs.rmSync(path.join(home, '.codex', 'skills', 'demo-critical', 'SKILL.md'), { force: true });
  const missingMirror = checkAgentSkillsLock(root, home);
  assert.equal(missingMirror[0].status, 'fail');
  assert.match(missingMirror[0].detail, /mirror missing/);

  writeLockFixture(root, home, { driftGemini: true });
  const drifted = checkAgentSkillsLock(root, home);
  assert.equal(drifted[0].status, 'fail');
  assert.match(drifted[0].detail, /content drift/);

  writeLockFixture(root, home, { skillMdBody: 'not: [valid\nno closing fence' });
  const invalidYaml = checkAgentSkillsLock(root, home);
  assert.equal(invalidYaml[0].status, 'fail');
  assert.match(invalidYaml[0].detail, /invalid YAML/);

  fs.rmSync(path.join(root, 'agent-skills.lock.json'));
  const missingLock = checkAgentSkillsLock(root, home);
  assert.equal(missingLock[0].status, 'fail');
  assert.match(missingLock[0].title, /missing\/invalid/);
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

  // старый-но-валидный отчёт → статус по содержанию, НЕ warn-по-возрасту (P2-1: генераторы
  // не гоняются авто, TTL давал вечный шум)
  write(path.join(root, '.planning', 'harness-checklist-latest.json'), JSON.stringify({
    generatedAt: '2026-05-01T11:00:00Z',
    summary: { status: 'pass', counts: { pass: 25, warn: 0, fail: 0, needsJustification: 0 } },
  }));
  const stale = checkHarnessChecklist(root, now);
  assert.equal(stale[0].status, 'pass');
  assert.match(stale[0].detail, /25 pass/);
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

function nineSectionDoc() {
  return '# Managed\n\n' + CORE_SECTIONS.map((section) => `## ${section}\ncontent\n`).join('\n');
}

function writeManagedDocs(root) {
  ['AGENTS.md', 'CLAUDE.md', path.join('.gemini', 'GEMINI.md')]
    .forEach((relative) => write(path.join(root, relative), nineSectionDoc()));
}

// AC11: doctor --fleet — table-driven readiness. Каждый класс = отдельная fixture.
// PASS только при полном контракте типа проекта; файл сам по себе PASS не даёт.
function testFleetCheck() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fleet-'));
  const home = path.join(dir, 'home');

  const make = (name, build) => {
    const root = path.join(dir, name);
    fs.mkdirSync(root, { recursive: true });
    build(root);
    return root;
  };
  const gitDir = (root) => fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const harness = (root, cfg) => write(path.join(root, '.harness', 'harness.json'), JSON.stringify(cfg));
  const gate = (root) => write(path.join(root, '.githooks', 'pre-commit'), '#!/bin/sh\n');

  // code-ready: git + package.json (code) + managed docs + valid oracle + gate → PASS.
  const codeReady = make('code-ready', (root) => {
    gitDir(root); write(path.join(root, 'package.json'), '{"name":"x"}');
    writeManagedDocs(root);
    harness(root, { kind: 'code', oracle: 'node --test', judge: { enabled: true, model: 'sonnet' } });
    gate(root);
  });
  // code-no-gate: valid oracle FILE exists but no managed gate → NOT ready (false-green guard).
  const codeNoGate = make('code-no-gate', (root) => {
    gitDir(root); write(path.join(root, 'package.json'), '{"name":"x"}');
    writeManagedDocs(root);
    harness(root, { kind: 'code', oracle: 'node --test', judge: { enabled: true, model: 'sonnet' } });
  });
  // invalid-harness: harness.json EXISTS but oracle empty → invalid → NOT ready (false-green guard).
  const invalidHarness = make('invalid-harness', (root) => {
    gitDir(root); write(path.join(root, 'package.json'), '{"name":"x"}');
    writeManagedDocs(root); gate(root);
    harness(root, { kind: 'code', oracle: '' });
  });
  // docs-ready: git + managed docs + declared kind=docs + artifactVerifier; NO code gate needed → PASS.
  const docsReady = make('docs-ready', (root) => {
    gitDir(root); writeManagedDocs(root);
    harness(root, { kind: 'docs', artifactVerifier: 'node tools/verify-artifacts.js', judge: { enabled: true, model: 'sonnet' } });
  });
  // non-git: fully-contracted code project but no .git → distinct non-git class, NOT ready.
  const nonGit = make('non-git', (root) => {
    write(path.join(root, 'package.json'), '{"name":"x"}');
    writeManagedDocs(root);
    harness(root, { kind: 'code', oracle: 'node --test', judge: { enabled: true, model: 'sonnet' } });
    gate(root);
  });
  // unknown: empty dir, no manifest/docs/harness → explicit unknown, NOT a false PASS.
  const unknown = make('unknown', () => {});

  write(path.join(home, '.claude', 'projects-registry.json'), JSON.stringify({
    version: 1,
    projects: {
      cr: { key: 'cr', name: 'code-ready', path: codeReady },
      cng: { key: 'cng', name: 'code-no-gate', path: codeNoGate },
      ih: { key: 'ih', name: 'invalid-harness', path: invalidHarness },
      dr: { key: 'dr', name: 'docs-ready', path: docsReady },
      ng: { key: 'ng', name: 'non-git', path: nonGit },
      uk: { key: 'uk', name: 'unknown', path: unknown },
      gone: { key: 'gone', name: 'gone', path: path.join(dir, 'does-not-exist') },
    },
  }));

  const checks = checkFleet(home);
  const byKey = Object.fromEntries(checks.map((c) => [c.id, c]));

  assert.equal(byKey['fleet:cr'].status, 'pass', 'code-ready → pass');
  assert.match(byKey['fleet:cr'].title, /\[ready\]/);

  assert.equal(byKey['fleet:cng'].status, 'warn', 'code missing gate → not ready');
  assert.match(byKey['fleet:cng'].detail, /managed gate/);
  assert.match(byKey['fleet:cng'].title, /\[code\]/);

  assert.equal(byKey['fleet:ih'].status, 'warn', 'invalid harness → not ready even though file exists');
  assert.match(byKey['fleet:ih'].title, /\[invalid-harness\]/);

  assert.equal(byKey['fleet:dr'].status, 'pass', 'docs project ready without a code gate');
  assert.match(byKey['fleet:dr'].title, /\[ready\]/);
  assert.match(byKey['fleet:dr'].detail, /kind=docs/);

  assert.equal(byKey['fleet:ng'].status, 'warn', 'non-git distinguished');
  assert.match(byKey['fleet:ng'].title, /\[non-git\]/);

  assert.equal(byKey['fleet:uk'].status, 'warn', 'unknown is explicit, not false PASS');
  assert.match(byKey['fleet:uk'].title, /\[unknown\]/);

  assert.equal(byKey['fleet:gone'].status, 'warn', 'missing path');
  assert.match(byKey['fleet:gone'].title, /\[missing\]/);

  // text/JSON counts consistent: runFleet summary is derived from the same checks array.
  const report = runFleet({ home });
  const tally = report.checks.reduce((acc, c) => ({ ...acc, [c.status]: (acc[c.status] || 0) + 1 }), {});
  assert.deepEqual(report.summary, tally);
  assert.equal((report.summary.pass || 0) + (report.summary.warn || 0) + (report.summary.fail || 0), report.checks.length);
  assert.equal(report.summary.pass, 2, 'exactly code-ready + docs-ready are PASS');

  fs.rmSync(dir, { recursive: true, force: true });
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
  // T013: doctor сам метёт залежавшийся claim (sweep), не только предупреждает — pass, не warn.
  assert.equal(byId['fleet:claims'].status, 'pass');
  assert.match(byId['fleet:claims'].detail, /T1/);
  assert.equal(fs.existsSync(path.join(claimsDir, 'T1.json')), false, 'claim-файл реально снят');
  assert.equal(byId['fleet:cli:claude'].status, 'pass', 'claude --version ок → pass');
  assert.equal(byId['fleet:cli:codex'].status, 'warn', 'codex недоступен → warn');

  // идемпотентность: повторный прогон подряд не находит уже подметённых claims
  const again = checkFleetWorkers(root, fakeRunner);
  const againById = Object.fromEntries(again.map((c) => [c.id, c]));
  assert.equal(againById['fleet:claims'].status, 'pass');
  assert.match(againById['fleet:claims'].detail, /нет залежавшихся/);

  fs.rmSync(root, { recursive: true, force: true });
}

function testSelfDriveInvariantsCheck() {
  const checks = checkSelfDriveInvariants();
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  // T013: effort-политика (T004) и judge-liveness-инвариант (T002) реально на месте
  // в этом репо (fleet/effort-policy.js, fleet/gate.js) — доктор их видит, не только тесты.
  assert.equal(byId['selfdrive:effort'].status, 'pass', 'effort-policy.js на месте, effortFor — функция');
  assert.equal(byId['selfdrive:judge-liveness'].status, 'pass', 'gate.js несёт runOk-инвариант (dead-judge ≠ block)');

  // проверяем, что self-drive-чеки попадают в ОБЩИЙ отчёт doctor (runDoctor), не только
  // при прямом вызове checkSelfDriveInvariants() — это и есть "единый обзор" из T013.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-selfdrive-report-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  write(path.join(root, 'AGENTS.md'), coreDoc());
  write(path.join(root, 'CLAUDE.md'), coreDoc());
  write(path.join(root, '.gemini', 'GEMINI.md'), coreDoc());
  const report = withHome(home, () => runDoctor({ root }));
  const ids = report.checks.map((c) => c.id);
  assert.ok(ids.includes('selfdrive:effort'), 'общий отчёт doctor несёт selfdrive:effort');
  assert.ok(ids.includes('selfdrive:judge-liveness'), 'общий отчёт doctor несёт selfdrive:judge-liveness');
  fs.rmSync(dir, { recursive: true, force: true });
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
    kind: 'code',
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

  let runLog = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n');
  let entry = JSON.parse(runLog[runLog.length - 1]);
  assert.equal(entry.status, 'red-stop', 'красный оракул оставил red-stop в run-log, а не тишину');
  assert.equal(entry.oracle.exit, 1);

  try {
    execFileSync(process.execPath, [eltPath, 'oracle'], { cwd: root, encoding: 'utf8' });
    assert.fail('standalone elt oracle тоже должен провалиться');
  } catch (err) {
    assert.notEqual(err.status, 0);
  }
  runLog = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n');
  entry = JSON.parse(runLog[runLog.length - 1]);
  assert.equal(entry.status, 'red-stop', 'standalone `elt oracle` тоже оставил red-stop (не только commit)');

  fs.rmSync(root, { recursive: true, force: true });
}

function testRunLogMigrationLeavesTwoCommitsClean() {
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-run-log-migration-'));
  const g = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const eltPath = path.join(__dirname, 'elt.js');
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'test@test.local']);
  g(['config', 'user.name', 'test']);
  write(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'exit 0', shell: 'powershell', branchPolicy: 'feature', push: false,
    judge: { enabled: true, model: 'test' },
  }));
  write(path.join(root, 'specs', '001-test', 'tasks.md'), '- [ ] **T001** first\n- [ ] **T002** second\n');
  const legacyLines = [JSON.stringify({ task: 'legacy-1' }), JSON.stringify({ task: 'legacy-2' })];
  write(path.join(root, '.harness', 'run-log.jsonl'), legacyLines.join('\n') + '\n');
  write(path.join(root, 'work.txt'), 'base\n');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'base']);

  for (const [task, body] of [['T001', 'first\n'], ['T002', 'second\n']]) {
    write(path.join(root, 'work.txt'), body);
    execFileSync(process.execPath, [eltPath, 'oracle'], { cwd: root, encoding: 'utf8' });
    execFileSync(process.execPath, [eltPath, 'judge-proof', 'write', '--task', task, '--verdict', 'pass', '--model', 'test', '--reasons-json', '[]'], { cwd: root, encoding: 'utf8' });
    execFileSync(process.execPath, [eltPath, 'commit', '--task', task, '--skip-oracle'], { cwd: root, encoding: 'utf8' });
    assert.equal(g(['status', '--porcelain']), '', `${task}: successful elt commit leaves the tree clean`);
  }

  const runtimeLines = fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8').trim().split('\n');
  assert.deepEqual(runtimeLines.slice(0, legacyLines.length), legacyLines, 'legacy run-log entries migrate without loss');
  assert.equal(fs.existsSync(path.join(root, '.harness', 'run-log.jsonl')), false, 'tracked legacy run-log is removed after verified migration');
  assert.equal(runtimeLines.filter((line) => JSON.parse(line).commit).length, 2, 'telemetry contains both successful commits');
  fs.rmSync(root, { recursive: true, force: true });
}

function testEltLoopMigratesLegacyRunLogBeforeDryRun() {
  const { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-loop-run-log-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  write(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'exit 0', shell: 'powershell', branchPolicy: 'feature', push: false,
    judge: { enabled: true, model: 'test' },
  }));
  write(path.join(root, 'specs', '001-test', 'tasks.md'), '- [ ] **T001** dry run\n');
  write(path.join(root, '.harness', 'run-log.jsonl'), JSON.stringify({ task: 'legacy' }) + '\n');
  execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'elt-loop.ps1'),
    '-Project', root, '-Slices', '1', '-DryRun',
  ], { encoding: 'utf8' });
  assert.equal(fs.existsSync(path.join(root, '.harness', 'run-log.jsonl')), false, 'elt-loop migrates legacy log before any driver path');
  assert.match(fs.readFileSync(path.join(root, '.git', 'elt', 'run-log.jsonl'), 'utf8'), /"task":"legacy"/);
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

// T011 OPTIONAL (004-elt-selfdrive): elt-selfheal.ps1 — watchdog (T010) → driver
// (elt-loop.ps1) gated self-repair. -DryRun не спавнит живой claude, но реально зовёт
// оба скрипта (не просто печатает намерение) — доказывает провод watchdog→driver.
// Merge в main — дефолт человеком: без --AutoMerge гейт молчит; под -DryRun merge
// пропущен ВСЕГДА, даже если --AutoMerge передан (dry-run не трогает репо).
function testEltSelfhealDryRun() {
  const { execFileSync } = require('node:child_process');
  const script = path.join(__dirname, 'elt-selfheal.ps1');

  // красный оракул — watchdog заводит self-heal слайс, driver вызывается
  const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-selfheal-red-'));
  write(path.join(dir1, '.harness', 'harness.json'), JSON.stringify({ oracle: 'exit 1', shell: 'powershell' }));
  const out1 = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Project', dir1, '-Slices', '1', '-DryRun',
  ], { encoding: 'utf8' });
  assert.match(out1, /оракул харнесса красный/, 'watchdog замечает красный оракул');
  assert.match(out1, /\[DryRun\] impl-промпт/, 'elt-loop.ps1 реально вызван (не просто упомянут)');
  assert.match(out1, /merge в main пропущен.*DryRun/i, 'DryRun блокирует merge даже без явного флага');
  assert.ok(fs.existsSync(path.join(dir1, 'specs', '001-selfheal', 'tasks.md')), 'self-heal слайс заведён на диске');
  assert.doesNotMatch(out1, /смержена в main/, 'реального merge не произошло');
  fs.rmSync(dir1, { recursive: true, force: true });

  // -AutoMerge + -DryRun вместе — dry-run всё равно выигрывает, merge не идёт
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-selfheal-automerge-dryrun-'));
  write(path.join(dir2, '.harness', 'harness.json'), JSON.stringify({ oracle: 'exit 1', shell: 'powershell' }));
  const out2 = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Project', dir2, '-Slices', '1', '-DryRun', '-AutoMerge',
  ], { encoding: 'utf8' });
  assert.match(out2, /merge в main пропущен.*DryRun/i, '--AutoMerge не обходит DryRun');
  assert.doesNotMatch(out2, /смержена в main/, 'реального merge не произошло даже с --AutoMerge');
  fs.rmSync(dir2, { recursive: true, force: true });

  // зелёный оракул — driver вообще не зовётся (нечего чинить)
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-selfheal-green-'));
  write(path.join(dir3, '.harness', 'harness.json'), JSON.stringify({ oracle: 'exit 0', shell: 'powershell' }));
  const out3 = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Project', dir3, '-Slices', '1', '-DryRun',
  ], { encoding: 'utf8' });
  assert.match(out3, /оракул харнесса зелёный/, 'watchdog подтверждает зелёный оракул');
  assert.doesNotMatch(out3, /\[DryRun\] impl-промпт/, 'driver не вызывается, когда чинить нечего');
  fs.rmSync(dir3, { recursive: true, force: true });
}

// T011 OPTIONAL (004-elt-selfdrive): merge-механика elt-selfheal-lib.ps1 — РЕАЛЬНЫЙ git
// (init+branch+merge), изолированно от watchdog/driver (те живого claude просят вне
// DryRun). Судья T011 указал: DryRun-тесты выше доказывают только "гейт по умолчанию
// молчит", но не "merge реально проходит под явным флагом" — эта функция закрывает дыру.
function testEltSelfhealMergeLib() {
  const { execFileSync } = require('node:child_process');
  const lib = path.join(__dirname, 'elt-selfheal-lib.ps1');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-selfheal-merge-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'test@test.local']);
  g(['config', 'user.name', 'test']);
  write(path.join(dir, 'a.txt'), 'main\n');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'init']);
  g(['checkout', '-q', '-b', 'fix/selfheal']);
  write(path.join(dir, 'b.txt'), 'heal\n');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'self-heal fix']);

  // Get-AutoMergeConfig: дефолт (нет harness.json) = false, явный selfHeal.autoMerge:true = true
  const psNoConfig = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `. '${lib}'; (Get-AutoMergeConfig -Project '${dir}') | ConvertTo-Json`,
  ], { encoding: 'utf8' }).trim();
  assert.equal(psNoConfig, 'false', 'без harness.json — гейт выключен по умолчанию');

  write(path.join(dir, '.harness', 'harness.json'), JSON.stringify({ selfHeal: { autoMerge: true } }));
  const psConfig = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `. '${lib}'; (Get-AutoMergeConfig -Project '${dir}') | ConvertTo-Json`,
  ], { encoding: 'utf8' }).trim();
  assert.equal(psConfig, 'true', 'явный selfHeal.autoMerge:true в конфиге читается');

  // Invoke-SelfHealMerge: реальный merge fix/selfheal → main
  const mergeOut = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `. '${lib}'; (Invoke-SelfHealMerge -Project '${dir}' -HealBranch 'fix/selfheal') | ConvertTo-Json -Compress`,
  ], { encoding: 'utf8' }).trim();
  const mergeResult = JSON.parse(mergeOut);
  assert.equal(mergeResult.merged, true, 'merge под явным флагом реально проходит');
  assert.equal(g(['branch', '--show-current']).trim(), 'main', 'после merge мы на main');
  assert.ok(fs.existsSync(path.join(dir, 'b.txt')), 'файл из self-heal ветки реально попал в main');
  const log = g(['log', '--oneline', '-1']);
  assert.match(log, /self-heal: merge fix\/selfheal/, 'merge-коммит с ожидаемым сообщением');

  // Invoke-SelfHealMerge: пустая/main ветка — no-op, не падает
  const noBranchOut = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `. '${lib}'; (Invoke-SelfHealMerge -Project '${dir}' -HealBranch 'main') | ConvertTo-Json -Compress`,
  ], { encoding: 'utf8' }).trim();
  assert.equal(JSON.parse(noBranchOut).reason, 'no-branch', 'merge в саму main распознаётся как no-op, не мержится сам в себя');

  fs.rmSync(dir, { recursive: true, force: true });
}

// T011 OPTIONAL (004-elt-selfdrive): полный ПОЗИТИВНЫЙ путь через реальный CLI
// elt-selfheal.ps1 -AutoMerge (БЕЗ -DryRun) — watchdog → elt-loop.ps1 (impl → оракул →
// судья → elt commit, авто-ветка) → merge в main. Живого claude не спавним: FLEET_BIN_CLAUDE
// (существующий стаб-механизм tools/fleet/providers.js, уже используемый в gate.test.js/
// fleet.test.js) подменяет бинарник на node-стаб. Судья T011 (2-й проход) указал: тест на
// саму функцию Invoke-SelfHealMerge доказывает механику, но НЕ доказывает, что гейт
// elt-selfheal.ps1 реально дошёл до merge через полный CLI-путь под явным флагом — это
// закрывает именно ту дыру (позитивный случай к негативным в testEltSelfhealDryRun).
function testEltSelfhealAutoMergeGate() {
  const { execFileSync } = require('node:child_process');
  const script = path.join(__dirname, 'elt-selfheal.ps1');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-selfheal-automerge-'));
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'test@test.local']);
  g(['config', 'user.name', 'test']);
  write(path.join(dir, 'README.md'), 'seed\n');
  write(path.join(dir, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code',
    oracle: 'if (Test-Path .selfheal-fixed) { exit 0 } else { exit 1 }',
    shell: 'powershell', branchPolicy: 'feature', push: false,
    judge: { enabled: true, model: 'sonnet' },
  }));
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'init']);

  // Стаб: без --json-schema — это impl-вызов, реально "чинит" оракул (пишет маркер-файл
  // в cwd, который providers.run() спавнит РОВНО в $Project); с --json-schema — судья, pass.
  const stub = path.join(dir, 'claude-stub.js');
  write(stub, [
    "const fs = require('fs');",
    'process.stdin.resume();',
    "if (process.argv.includes('--json-schema')) {",
    "  process.stdout.write(JSON.stringify({ verdict: 'pass', reasons: [] }));",
    '} else {',
    "  fs.writeFileSync('.selfheal-fixed', 'fixed\\n');",
    "  process.stdout.write('self-heal stub: fixed\\n');",
    '}',
  ].join('\n'));

  const prevBin = process.env.FLEET_BIN_CLAUDE;
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stub]);
  let out;
  try {
    out = execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Project', dir, '-Slices', '1', '-AutoMerge',
    ], { encoding: 'utf8', timeout: 120000 });
  } finally {
    if (prevBin === undefined) delete process.env.FLEET_BIN_CLAUDE; else process.env.FLEET_BIN_CLAUDE = prevBin;
  }

  assert.match(out, /оракул харнесса красный/, 'watchdog стартует с красного оракула');
  assert.match(out, /--AutoMerge — мержу/, 'гейт реально дошёл до merge-шага (не пропустил)');
  assert.match(out, /смержена в main/, 'merge реально произошёл под явным флагом, без DryRun');
  assert.equal(g(['branch', '--show-current']).trim(), 'main', 'после прогона мы на main');
  assert.ok(fs.existsSync(path.join(dir, '.selfheal-fixed')), 'фикс из self-heal ветки физически в main');
  const log = g(['log', '--oneline', '-1']);
  assert.match(log, /self-heal: merge feature\//, 'merge-коммит смержил именно auto-branch от elt commit (branchPolicy:feature)');
  fs.rmSync(dir, { recursive: true, force: true });
}

function main() {
  testEltSingleSource();
  testStuckDetectorUnit();
  testEltCommitLogsRedStopOnOracleFail();
  testRunLogMigrationLeavesTwoCommitsClean();
  testEltLoopMigratesLegacyRunLogBeforeDryRun();
  testCheckpointWriter();
  testEltDriveDryRun();
  testEltSelfhealDryRun();
  testEltSelfhealMergeLib();
  testEltSelfhealAutoMergeGate();
  testProbePrimitivesParsing();
  testParseArgs();
  testProjectKeyStable();
  testSkillFrontmatter();
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
  testCodexSandboxProfileSignal();
  testAgentSurfaceAuditCheck();
  testAgentSkillSupplyChainCheck();
  testAgentSkillsLockCheck();
  testAgentSkillsWrapperCheck();
  testHarnessChecklistCheck();
  testHarnessGlobalCheck();
  testFleetCheck();
  testFleetWorkersCheck();
  testSelfDriveInvariantsCheck();
  process.stdout.write('doctor tests: PASS\n');
}

main();
