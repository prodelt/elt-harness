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
  checkFleet,
  checkJudgeProviders,
  checkSelfDriveInvariants,
  checkExoskeleton,
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

// 019 T015: тесты `harness:global-cli` и `judge:bridge` сняты вместе с проверками, которые
// они держали. Обе меряли состояние deploy-копии в `~/.claude/bin`; у плагина этой копии нет.

function nineSectionDoc() {
  return '# Managed\n\n' + CORE_SECTIONS.map((section) => `## ${section}\ncontent\n`).join('\n');
}

function writeManagedDocs(root) {
  ['AGENTS.md', 'CLAUDE.md', path.join('.gemini', 'GEMINI.md')]
    .forEach((relative) => write(path.join(root, relative), nineSectionDoc()));
}

function testSelfDriveInvariantsCheck() {
  const checks = checkSelfDriveInvariants();
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));
  // T013: effort-политика (T004) и judge-liveness-инвариант (T002) реально на месте
  // в этом репо (effort-policy.js, judge-core.js) — доктор их видит, не только тесты.
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

// 020 T011: подменяются ОБЕ переменные. `os.homedir()` читает `USERPROFILE` на Windows и
// `HOME` на Linux/macOS, поэтому подмена одной изолировала тест только на той машине, где его
// писали: на второй машине CI он читал бы настоящий домашний каталог раннера — то есть проверял
// бы чужое состояние вместо фикстуры. Это тот же класс, что и два красных файла фронт-гейта.
function withHome(home, fn) {
  const previous = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
  process.env.USERPROFILE = home;
  process.env.HOME = home;
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// 019 T015: побайтная сверка `tools/elt.js` с `~/.claude/bin/elt.js` снята. Она держала
// инвариант «две копии одного файла не разошлись» — инвариант, который у плагина выполняется
// по построению: копии больше нет, установленный каталог и есть репозиторий. Замену того же
// класса (замыкание цело, манифесты не разошлись) держит `bin/doctor.test.js`.

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

// T006 (004-elt-selfdrive): checkpoint-writer. Below stage2 → silent, no
// .planning/ side-effect; above stage2 → writes a checkpoint file sourced
// from a REAL `elt status` spawn (T001 single-source), not a hand-built
// fixture — proves git/last-run/next-slice/resume-prompt round-trip through
// the actual harness CLI, not just through renderCheckpoint's string glue.
function testCheckpointWriter() {
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [path.join(__dirname, 'checkpoint-writer.js'), '--selftest'], { encoding: 'utf8' });
}


// 014 T017 (AC13): состояние экзоскелета видно в докторе при ОБОИХ режимах verify — иначе
// фоновый контур невидим, а невидимый режим не используют и не замечают его смерти.
function testExoskeletonCheck() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-exo-'));
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  const harness = (extra) => fs.writeFileSync(path.join(root, '.harness', 'harness.json'),
    JSON.stringify({ kind: 'code', oracle: 'npm test', judge: { enabled: true, model: 'sonnet' }, ...extra }));

  harness({});
  const sync = checkExoskeleton(root);
  assert.equal(sync.length, 1, 'секция есть и в sync — иначе не видно, что фон выключен');
  assert.equal(sync[0].status, 'pass');
  assert.match(sync[0].detail, /verify: sync/);

  harness({ verify: 'background' });
  fs.writeFileSync(path.join(root, '.harness', 'review-queue.jsonl'), [
    JSON.stringify({ kind: 'bg-red', task: 'T001', layer: 'suite' }),
    JSON.stringify({ kind: 'bg-red', task: 'T002', layer: 'judge', closedAt: '2026-08-09T00:00:00Z' }),
    JSON.stringify({ task: 'T003', reason: 'inconclusive — не bg-red' }),
  ].join(String.fromCharCode(10)) + String.fromCharCode(10));
  const bg = checkExoskeleton(root);
  assert.match(bg[0].detail, /verify: background/);
  assert.equal(bg[0].data.bgRed, 1, 'закрытые и inconclusive-строки в счётчик не входят');
  assert.equal(bg[0].status, 'pass', 'красное в очереди — работа, а не отказ доктора');

  fs.writeFileSync(path.join(root, '.harness', 'health.jsonl'),
    JSON.stringify({ kind: 'bg-silent', key: 'bg-silent:abc' }) + String.fromCharCode(10));
  const silent = checkExoskeleton(root);
  assert.equal(silent[0].status, 'warn', 'молчание фона — единственное, что здесь warn');
  assert.equal(silent[0].data.silent, 1);

  // 014 T024: окно. Раньше складывалась вся история, и один разобранный полгода назад инцидент
  // держал doctor в warn навсегда — сигнал, который не гаснет, перестают читать.
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(path.join(root, '.harness', 'health.jsonl'),
    JSON.stringify({ kind: 'bg-silent', key: 'bg-silent:old', ts: old }) + String.fromCharCode(10));
  const aged = checkExoskeleton(root);
  assert.equal(aged[0].data.silent, 0, 'инцидент за пределами окна не считается');
  assert.equal(aged[0].status, 'pass', 'старое молчание больше не держит doctor в warn');

  const fresh = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  fs.appendFileSync(path.join(root, '.harness', 'health.jsonl'),
    JSON.stringify({ kind: 'bg-silent', key: 'bg-silent:fresh', ts: fresh }) + String.fromCharCode(10));
  assert.equal(checkExoskeleton(root)[0].data.silent, 1, 'свежий инцидент виден');
  fs.rmSync(root, { recursive: true, force: true });
}

function main() {
  testEltCommitLogsRedStopOnOracleFail();
  testRunLogMigrationLeavesTwoCommitsClean();
  testCheckpointWriter();
  testParseArgs();
  testProjectKeyStable();
  testSkillFrontmatter();
  testCodeGraphStatusMissingDb();
  testCodeGraphStatusMockedGreenAndStale();
  testCodeGraphMcpCheck();
  testCodeGraphAdoptionCheck();
  testHarnessSelfcheck();
  testSettingsSecretsScanner();
  testGitHubCliAuthWarningSkipsCodeSearch();
  testCodexDefaultsWarnOnExpensiveRoute();
  testCodexSandboxProfileSignal();
  testAgentSkillSupplyChainCheck();
  testAgentSkillsLockCheck();
  testAgentSkillsWrapperCheck();
  testHarnessChecklistCheck();
  testSelfDriveInvariantsCheck();
  testExoskeletonCheck();
  process.stdout.write('doctor tests: PASS\n');
}

main();
