#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  applyPlan,
  applySafeActions,
  checkOracleVerifierContract,
  classifyKind,
  detectStack,
  inspectProject,
  migrationPlan,
  planTargetState,
  run: runBootstrap,
  scanProject,
  verifyProject,
} = require('./project-bootstrap');

function validHarness(root) {
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code',
    oracle: 'npm test',
    judge: { enabled: true, model: 'sonnet' },
  }, null, 2), 'utf8');
}

function runCli(args) {
  return spawnSync(process.execPath, [path.join(__dirname, 'project-bootstrap.js'), ...args], { encoding: 'utf8' });
}

function hashTree(root) {
  const hash = crypto.createHash('sha256');
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      hash.update(path.relative(root, full));
      hash.update(fs.readFileSync(full));
    }
  };
  walk(root);
  return hash.digest('hex');
}

// 010 T006: verify теперь требует резолвимый мост судьи при judge.enabled — фикстуры,
// которые ждут зелёный verify, кладут мост в свой временный HOME, а не полагаются на машину.
function homeWithBridge() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  const bridge = path.join(home, '.claude', 'bin', 'judge', 'judge-invoke.js');
  fs.mkdirSync(path.dirname(bridge), { recursive: true });
  fs.writeFileSync(bridge, '// stub bridge\n', 'utf8');
  return home;
}

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo"}\n', 'utf8');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const x = 1;\n', 'utf8');
  return root;
}

function testScanChoosesBoundedGrepForSmallProject() {
  const report = scanProject(tempProject());
  assert.equal(report.kind, 'project-bootstrap');
  assert.equal(report.strategy, 'bounded-grep-first');
  assert.equal(report.stack.name, 'Node.js');
  assert.ok(report.recommended_probes.length > 0);
  assert.equal(report.checks.ai_docs.ok, false);
  assert.ok(report.actions.some((action) => action.id === 'project-docs' && action.safe));
}

function testApplyCreatesOnlySafeInfrastructure() {
  const root = tempProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  const report = applySafeActions(root, { home });
  assert.ok(report.applied.some((item) => item.id === 'project-docs'));
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), true);
  // AC10 + T020: ни legacy .rag, ни .graphifyignore больше не создаются.
  assert.equal(fs.existsSync(path.join(root, '.graphifyignore')), false);
  assert.equal(fs.existsSync(path.join(root, '.rag', 'manifest.json')), false);
  assert.equal(fs.existsSync(path.join(root, '.planning', 'agent-control-plane.json')), false);
  assert.equal(report.after.checks.ai_docs.ok, true);
  assert.equal(report.after.checks.agent_control_plane.ok, false);
  assert.ok(report.after.actions.some((action) => action.id === 'agent-control-plane' && !action.safe));
}

function testDetectsNextAppRouterAndRecommendsBoundedProbes() {
  const root = tempProject();
  fs.mkdirSync(path.join(root, 'src', 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"dependencies":{"next":"1.0.0"}}\n', 'utf8');
  const stack = detectStack(root);
  const report = scanProject(root);
  assert.equal(stack.name, 'Next.js App Router');
  assert.ok(report.recommended_probes.some((probe) => probe.includes('src/app src/lib')));
  assert.ok(report.recommended_probes.every((probe) => /Select-Object -First|-m /.test(probe)));
}

function testScanReportsControlPlaneAndSupplyChainSurface() {
  const root = tempProject();
  const pointer = path.join(root, '.planning', 'agent-control-plane.json');
  fs.mkdirSync(path.dirname(pointer), { recursive: true });
  fs.writeFileSync(pointer, JSON.stringify({
    version: 1,
    managedBy: 'Pipeline Setupper',
    manifestVersion: 1,
    manifest: 'config/agent-skill-sources.json',
    requiredClients: ['claude', 'codex', 'gemini'],
  }, null, 2), 'utf8');
  const report = scanProject(root, {
    supplyChainAudit: {
      kind: 'agent-skill-supply-chain',
      validation: { ok: true, errors: [] },
      clients: {
        claude: { exists: true },
        codex: { exists: true },
        gemini: { exists: true },
      },
      skills: [
        {
          name: 'pipeline',
          clients: {
            claude: { installed: true, matchesSource: true },
            codex: { installed: true, matchesSource: true },
            gemini: { installed: true, matchesSource: true },
          },
        },
      ],
      projects: [{ key: 'demo', path: root, exists: true, controlPlane: true }],
    },
  });

  assert.equal(report.checks.agent_control_plane.ok, true);
  assert.equal(report.checks.agent_skill_supply_chain.ok, true);
  assert.equal(report.actions.some((action) => action.id === 'agent-control-plane'), false);
  assert.equal(report.actions.some((action) => action.id === 'agent-skill-supply-chain'), false);
}

function testScanKeepsSupplyChainRepairsNonSafe() {
  const root = tempProject();
  const report = scanProject(root, {
    supplyChainAudit: {
      kind: 'agent-skill-supply-chain',
      validation: { ok: true, errors: [] },
      clients: { claude: { exists: true }, codex: { exists: true } },
      skills: [
        {
          name: 'pipeline',
          clients: {
            claude: { installed: true, matchesSource: true },
            codex: { installed: false, matchesSource: false },
          },
        },
      ],
      projects: [{ key: 'demo', path: root, exists: true, controlPlane: false }],
    },
  });

  assert.equal(report.checks.agent_control_plane.ok, false);
  assert.equal(report.checks.agent_skill_supply_chain.ok, false);
  assert.ok(report.actions.some((action) => action.id === 'agent-control-plane' && !action.safe));
  assert.ok(report.actions.some((action) => action.id === 'agent-skill-supply-chain' && !action.safe));
}

function testScanCanSkipSupplyChainForStartupAdvisor() {
  const report = scanProject(tempProject(), { supplyChain: false });
  assert.equal(report.checks.agent_skill_supply_chain.ok, true);
  assert.equal(report.checks.agent_skill_supply_chain.skipped, true);
  assert.equal(report.actions.some((action) => action.id === 'agent-skill-supply-chain'), false);
}

function testRunPassesNoSupplyChainOptionThroughCliPath() {
  const report = runBootstrap({ root: tempProject(), apply: false, supplyChain: false });
  assert.equal(report.checks.agent_skill_supply_chain.ok, true);
  assert.equal(report.checks.agent_skill_supply_chain.skipped, true);
}

function testClassifyKindDetectsCodeDocsUnknown() {
  const codeRoot = tempProject();
  assert.equal(classifyKind(codeRoot).kind, 'code');

  const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-docs-'));
  fs.writeFileSync(path.join(docsRoot, 'README.md'), '# demo\n', 'utf8');
  assert.equal(classifyKind(docsRoot).kind, 'docs');

  const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-empty-'));
  assert.equal(classifyKind(emptyRoot).kind, 'unknown');
}

function testInspectIsReadOnly() {
  const root = tempProject();
  const before = hashTree(root);
  const report = inspectProject(root);
  assert.equal(report.kind, 'project-bootstrap-inspect');
  assert.equal(report.classification.kind, 'code');
  assert.equal(hashTree(root), before);
}

function testPlanIsDeterministicAndReadOnly() {
  const root = tempProject();
  const before = hashTree(root);
  const first = planTargetState(root);
  const second = planTargetState(root);
  assert.deepEqual(first, second);
  assert.equal(hashTree(root), before);
}

function testPlanNeverInventsOracleForUnknownKind() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-unknown-'));
  const plan = planTargetState(root);
  assert.equal(plan.classification.kind, 'unknown');
  assert.equal(plan.decisions.oracle.proposed, null);
  assert.equal(plan.decisions.oracle.source, 'none');
  assert.equal(plan.decisions.judge.enabled, false);
}

function testPlanUsesExistingOracleForCodeKind() {
  const root = tempProject();
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code',
    oracle: 'npm test',
    judge: { enabled: true, model: 'sonnet' },
  }, null, 2), 'utf8');
  const plan = planTargetState(root);
  assert.equal(plan.decisions.oracle.source, 'existing');
  assert.equal(plan.decisions.oracle.proposed, 'npm test');
  assert.equal(plan.decisions.judge.enabled, true);
}

function testPlanCodegraphRequiresExplicitFlag() {
  const root = tempProject();
  assert.equal(planTargetState(root).decisions.codegraph.enabled, false);
  assert.equal(planTargetState(root, { codegraph: true }).decisions.codegraph.enabled, true);
}

function testCliInspectAndPlanCommandsRun() {
  const root = tempProject();
  const inspect = runBootstrap({ command: 'inspect', root, supplyChain: false });
  assert.equal(inspect.kind, 'project-bootstrap-inspect');
  const plan = runBootstrap({ command: 'plan', root, supplyChain: false });
  assert.equal(plan.kind, 'project-bootstrap-plan');
}

function testApplyPlanIsIdempotentAndCreatesExactManifest() {
  const root = tempProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  const first = applyPlan(root, { home });
  assert.equal(first.kind, 'project-bootstrap-apply');
  assert.ok(first.changes.some((c) => c.id === 'project-docs'));
  assert.ok(first.changes.some((c) => c.id === 'planning-state'));
  assert.ok(first.changes.some((c) => c.id === 'git-gate'));
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), true);
  assert.equal(fs.existsSync(path.join(root, '.planning', 'STATE.md')), true);
  assert.equal(fs.existsSync(path.join(root, '.githooks', 'pre-commit')), true);
  assert.equal(fs.existsSync(path.join(root, '.rag', 'manifest.json')), false);
  assert.equal(fs.existsSync(path.join(root, '.graphifyignore')), false);

  const beforeSecond = hashTree(root);
  const second = applyPlan(root, { home });
  assert.deepEqual(second.changes, []);
  assert.equal(hashTree(root), beforeSecond);
}

function testApplyPlanKeepsProtectedBlocksAndUserFilesByteIdentical() {
  const root = tempProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  applyPlan(root, { home });
  const userFile = path.join(root, 'src', 'index.js');
  const userContentBefore = fs.readFileSync(userFile);
  const agentsBefore = fs.readFileSync(path.join(root, 'AGENTS.md'));

  applyPlan(root, { home });

  assert.deepEqual(fs.readFileSync(userFile), userContentBefore);
  assert.deepEqual(fs.readFileSync(path.join(root, 'AGENTS.md')), agentsBefore);
}

function testApplyPlanBlocksHarnessWithoutInventingOracle() {
  const root = tempProject();
  const report = applyPlan(root, { home: fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-')) });
  assert.ok(report.blocked.some((b) => b.id === 'harness'));
  assert.equal(fs.existsSync(path.join(root, '.harness', 'harness.json')), false);
}

function testApplyPlanDoesNotBlockWhenHarnessAlreadyValid() {
  const root = tempProject();
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code',
    oracle: 'npm test',
    judge: { enabled: true, model: 'sonnet' },
  }, null, 2), 'utf8');
  const report = applyPlan(root, { home: fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-')) });
  assert.equal(report.blocked.length, 0);
}

function testApplyPlanFillsInMissingApprovalDefaultsOnExistingHarness() {
  const root = tempProject();
  validHarness(root); // no specApproval/ctx7Gate — the pre-006 shape
  const report = applyPlan(root, { home: fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-')) });
  assert.ok(report.changes.some((c) => c.id === 'harness-approval-fields' && c.added.includes('specApproval') && c.added.includes('ctx7Gate')));
  const written = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8'));
  assert.equal(written.specApproval, true);
  assert.equal(written.ctx7Gate, 'warn');
  assert.equal(written.oracle, 'npm test', 'apply must not touch unrelated existing fields');

  const second = applyPlan(root, { home: fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-')) });
  assert.equal(second.changes.some((c) => c.id === 'harness-approval-fields'), false, 'idempotent: no re-patch once fields exist');
}

function testApplyPlanNeverOverridesExplicitApprovalChoice() {
  const root = tempProject();
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'npm test', judge: { enabled: true, model: 'sonnet' },
    specApproval: false, ctx7Gate: 'off',
  }, null, 2), 'utf8');
  applyPlan(root, { home: fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-')) });
  const written = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8'));
  assert.equal(written.specApproval, false, 'explicit opt-out must survive apply');
  assert.equal(written.ctx7Gate, 'off', 'explicit ctx7Gate choice must survive apply');
}

function testVerifyReportsApprovalGateSignalWithoutGatingOverallResult() {
  const root = tempProject();
  const home = homeWithBridge();
  applyPlan(root, { home });
  validHarness(root); // still no specApproval/ctx7Gate
  const report = verifyProject(root, { supplyChain: false, home });
  assert.equal(report.signals.approvalGate.ok, false);
  assert.equal(report.signals.approvalGate.specApproval, false);
  assert.equal(report.signals.approvalGate.ctx7Gate, null);
  assert.equal(report.ok, true, 'approvalGate is a signal, not a gating contract');

  applyPlan(root, { home: fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-')) }); // now patches defaults in
  const after = verifyProject(root, { supplyChain: false, home });
  assert.equal(after.signals.approvalGate.ok, true);
  assert.equal(after.signals.approvalGate.ctx7Gate, 'warn');
}

function testApplyPlanSkipsGitGateForNonCodeKind() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-docs-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# demo\n', 'utf8');
  const report = applyPlan(root, { home: fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-')) });
  assert.equal(report.plan.classification.kind, 'docs');
  assert.equal(fs.existsSync(path.join(root, '.githooks', 'pre-commit')), false);
  assert.equal(report.changes.some((c) => c.id === 'git-gate'), false);
}

function testCliApplyCommandRuns() {
  const root = tempProject();
  const report = runBootstrap({ command: 'apply', root, home: fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-')), supplyChain: false });
  assert.equal(report.kind, 'project-bootstrap-apply');
}

function testVerifyIsReadOnly() {
  const root = tempProject();
  const before = hashTree(root);
  const report = verifyProject(root, { supplyChain: false });
  assert.equal(report.kind, 'project-bootstrap-verify');
  assert.equal(hashTree(root), before);
}

function testVerifyFailsClosedOnMissingDocsHarnessGateForFreshCodeProject() {
  const root = tempProject();
  const report = verifyProject(root, { supplyChain: false });
  assert.equal(report.classification.kind, 'code');
  assert.equal(report.contracts.docs.ok, false);
  assert.equal(report.contracts.harnessConfig.ok, false);
  assert.equal(report.contracts.oracleVerifier.ok, false);
  assert.equal(report.contracts.gate.ok, false);
  assert.equal(report.ok, false);
}

function testVerifyPassesAllContractsAfterApplyAndValidHarness() {
  const root = tempProject();
  const home = homeWithBridge();
  applyPlan(root, { home });
  validHarness(root);
  const report = verifyProject(root, { supplyChain: false, home });
  assert.equal(report.contracts.docs.ok, true);
  assert.equal(report.contracts.judgeBridge.ok, true);
  assert.equal(report.contracts.harnessConfig.ok, true);
  assert.equal(report.contracts.oracleVerifier.ok, true);
  assert.equal(report.contracts.oracleVerifier.command, 'npm test');
  assert.equal(report.contracts.gate.ok, true);
  assert.equal(report.contracts.skillAvailability.ok, true);
  assert.equal(report.ok, true);
}

function testVerifySkipsCodeOnlyContractsForUnknownKind() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-empty-'));
  const report = verifyProject(root, { supplyChain: false });
  assert.equal(report.classification.kind, 'unknown');
  assert.equal(report.contracts.docs.skipped, true);
  assert.equal(report.contracts.harnessConfig.skipped, true);
  assert.equal(report.contracts.oracleVerifier.skipped, true);
  assert.equal(report.contracts.gate.skipped, true);
  assert.equal(report.ok, true);
}

function testVerifyHarnessNegativeFixtureMalformedJson() {
  const root = tempProject();
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), '{not json', 'utf8');
  const report = verifyProject(root, { supplyChain: false });
  assert.equal(report.contracts.harnessConfig.ok, false);
  assert.equal(report.contracts.oracleVerifier.ok, false);
}

function testVerifySkillAvailabilityNegativeFixtureReportsDrift() {
  const root = tempProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  applyPlan(root, { home });
  validHarness(root);
  const report = verifyProject(root, {
    supplyChainAudit: {
      kind: 'agent-skill-supply-chain',
      validation: { ok: true, errors: [] },
      clients: { claude: { exists: true } },
      skills: [{ name: 'elt', clients: { claude: { installed: false, matchesSource: false } } }],
      projects: [],
    },
  });
  assert.equal(report.contracts.skillAvailability.ok, false);
  assert.equal(report.ok, false);
}

// 010 T006 (AC4): контур объявлен в harness.json, но мост физически не резолвится — это
// красный С ПРИЧИНОЙ, а не тихий pass, которым в 9 проектах жил судья-самозаверитель.
function testVerifyJudgeBridgeContractBothOutcomes() {
  const root = tempProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  applyPlan(root, { home });
  validHarness(root);

  const missing = verifyProject(root, { supplyChain: false, home });
  assert.equal(missing.contracts.judgeBridge.ok, false);
  assert.equal(missing.contracts.judgeBridge.reason, 'judge bridge is not resolvable');
  assert.equal(missing.contracts.judgeBridge.looked.length, 2, 'в отчёте видно, где искали');
  assert.equal(missing.ok, false, 'недоступный мост рубит verify целиком');

  const bridge = path.join(home, '.claude', 'bin', 'judge', 'judge-invoke.js');
  fs.mkdirSync(path.dirname(bridge), { recursive: true });
  fs.writeFileSync(bridge, '// stub bridge\n', 'utf8');
  const resolved = verifyProject(root, { supplyChain: false, home });
  assert.equal(resolved.contracts.judgeBridge.ok, true);
  assert.equal(resolved.ok, true);

  // judge выключен — контракта нет вовсе (проект без контура не обязан иметь мост)
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'npm test', judge: { enabled: false },
  }), 'utf8');
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  assert.equal(verifyProject(root, { supplyChain: false, home: emptyHome }).contracts.judgeBridge.skipped, true);
}

// 010 T007 (AC6): непустая строка — не контракт. Раннер подменяется, чтобы тест проверял
// проводку (резолв vs исполнение), а не наличие npm на машине.
function testOracleVerifierContractResolvesAndRunsDeep() {
  const root = tempProject();
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'just test', shell: 'bash', judge: { enabled: false },
  }), 'utf8');
  const inspected = inspectProject(root);

  const calls = [];
  const record = (result) => (file, args, opts) => { calls.push({ file, args, opts }); return result; };

  const unresolvable = checkOracleVerifierContract(inspected, { commandRunner: record({ status: 1, stdout: '' }) });
  assert.equal(unresolvable.ok, false, 'команда не резолвится — контракт красный');
  assert.equal(unresolvable.binary, 'just', 'проверяется исполняемый файл, а не вся строка');
  assert.match(unresolvable.reason, /does not resolve on PATH/);

  const resolvable = checkOracleVerifierContract(inspected, { commandRunner: record({ status: 0, stdout: 'C:\\bin\\just.exe' }) });
  assert.equal(resolvable.ok, true);
  assert.equal(resolvable.deep, false, 'без --deep оракул не запускается');

  calls.length = 0;
  const deepGreen = checkOracleVerifierContract(inspected, { deep: true, commandRunner: record({ status: 0, stdout: 'ok' }) });
  assert.equal(deepGreen.deep, true);
  assert.equal(deepGreen.exit, 0, 'код возврата попадает в отчёт');
  assert.equal(deepGreen.ok, true);
  assert.equal(calls[0].file, 'bash', 'команда идёт через shell из harness.json');
  assert.deepEqual(calls[0].args, ['-c', 'just test']);
  assert.ok(calls[0].opts.timeout > 0, 'R5: у deep-прогона есть таймаут');

  const deepRed = checkOracleVerifierContract(inspected, { deep: true, commandRunner: record({ status: 2, stdout: '' }) });
  assert.equal(deepRed.ok, false);
  assert.equal(deepRed.exit, 2, 'красный оракул виден числом, а не «непустой строкой»');
}

// Судья 010 (codex) заблокировал первую редакцию T007 по делу: с подменённым раннером тест
// проверял собственный мок. Здесь раннер НЕ подменяется — реальный spawn настоящей оболочки,
// команда детерминированная (node -e), проверяется, что её код возврата доезжает до отчёта.
function testOracleVerifierDeepActuallySpawnsShell() {
  const root = tempProject();
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  const shell = process.platform === 'win32' ? 'powershell' : 'bash';
  const harness = (oracle) => fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle, shell, judge: { enabled: false },
  }), 'utf8');

  harness('node -e "process.exit(0)"');
  const green = checkOracleVerifierContract(inspectProject(root), { deep: true });
  assert.equal(green.deep, true);
  assert.equal(green.exit, 0, 'зелёный оракул реально запущен через живой shell');
  assert.equal(green.ok, true);

  harness('node -e "process.exit(3)"');
  const red = checkOracleVerifierContract(inspectProject(root), { deep: true });
  assert.equal(red.exit, 3, 'код возврата живого прогона доезжает в отчёт как есть');
  assert.equal(red.ok, false);

  // Несуществующая команда: контракт красный и без --deep (резолв), и с --deep (запуск).
  harness('заведомо-нет-такой-команды-010 --run');
  assert.equal(checkOracleVerifierContract(inspectProject(root)).ok, false, 'резолв бинаря красный');
  assert.equal(checkOracleVerifierContract(inspectProject(root), { deep: true }).ok, false, 'живой запуск тоже красный');
}

function testVerifySpecReadinessReportsExplicitIdleNotFailure() {
  const root = tempProject();
  const report = verifyProject(root, { supplyChain: false });
  assert.equal(report.signals.specReadiness.status, 'idle');
  assert.equal(report.signals.specReadiness.ok, true);
}

function testVerifySpecReadinessReportsActiveOpenSlicesAsSignalNotGate() {
  const root = tempProject();
  fs.mkdirSync(path.join(root, 'specs', '001-demo'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-demo', 'tasks.md'), '- [ ] **T001** demo\n- [X] **T002** done\n', 'utf8');
  const home = homeWithBridge();
  applyPlan(root, { home });
  validHarness(root);
  const report = verifyProject(root, { supplyChain: false, home });
  assert.equal(report.signals.specReadiness.status, 'active');
  assert.equal(report.signals.specReadiness.open, 1);
  assert.equal(report.signals.specReadiness.done, 1);
  assert.equal(report.ok, true);
}

function testVerifyCleanTreeSignalReportsDirtyWithoutGatingOverallResult() {
  const root = tempProject();
  const home = homeWithBridge();
  applyPlan(root, { home });
  validHarness(root);
  assert.equal(spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' }).status, 0);
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: root });
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const x = 2;\n', 'utf8');

  const report = verifyProject(root, { supplyChain: false, home });
  assert.equal(report.signals.cleanTree.ok, false);
  assert.equal(report.signals.cleanTree.dirty, true);
  assert.equal(report.ok, true);
}

function testCliVerifyCommandRunsAndReportsFailClosed() {
  const root = tempProject();
  const report = runBootstrap({ command: 'verify', root, supplyChain: false });
  assert.equal(report.kind, 'project-bootstrap-verify');
  assert.equal(report.ok, false);
}

function testVerifyCliJsonAndTextExitCodesMatch() {
  const rootFail = tempProject();
  const textFail = runCli(['verify', '--root', rootFail, '--no-supply-chain']);
  const jsonFail = runCli(['verify', '--root', rootFail, '--no-supply-chain', '--json']);
  assert.equal(textFail.status, 1);
  assert.equal(jsonFail.status, 1);

  const rootPass = tempProject();
  const home = homeWithBridge();
  applyPlan(rootPass, { home });
  validHarness(rootPass);
  const textPass = runCli(['verify', '--root', rootPass, '--no-supply-chain', '--home', home]);
  const jsonPass = runCli(['verify', '--root', rootPass, '--no-supply-chain', '--home', home, '--json']);
  assert.equal(textPass.status, 0);
  assert.equal(jsonPass.status, 0);
  assert.deepEqual(JSON.parse(jsonPass.stdout).ok, true);
}

// AC12: read-only migration planner for the whole registry.
function buildRegistry() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-migration-'));
  const home = path.join(dir, 'home');
  const codeProj = path.join(dir, 'code-proj');
  fs.mkdirSync(codeProj, { recursive: true });
  fs.writeFileSync(path.join(codeProj, 'package.json'), '{"name":"c"}', 'utf8');
  const docsProj = path.join(dir, 'docs-proj');
  fs.mkdirSync(docsProj, { recursive: true });
  fs.writeFileSync(path.join(docsProj, 'notes.md'), '# notes\n', 'utf8');
  const unknownProj = path.join(dir, 'unknown-proj');
  fs.mkdirSync(unknownProj, { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'projects-registry.json'), JSON.stringify({
    version: 1,
    projects: {
      c: { key: 'c', name: 'code-proj', path: codeProj },
      d: { key: 'd', name: 'docs-proj', path: docsProj },
      u: { key: 'u', name: 'unknown-proj', path: unknownProj },
      g: { key: 'g', name: 'gone', path: path.join(dir, 'gone') },
    },
  }), 'utf8');
  return { dir, home, codeProj, docsProj, unknownProj };
}

function testMigrationPlanIsReadOnlyReconcilesAndSurvivesMissingPaths() {
  const { dir, home, codeProj, docsProj, unknownProj } = buildRegistry();
  const before = [codeProj, docsProj, unknownProj].map(hashTree);
  const report = migrationPlan(home);
  const after = [codeProj, docsProj, unknownProj].map(hashTree);

  assert.deepEqual(after, before, 'dry-run must not modify any registry project');
  assert.equal(report.dryRun, true);
  assert.equal(report.scanned, 4, 'totals reconcile to registry entry count');
  assert.equal(report.projects.length, 4);
  assert.equal(Object.values(report.totals.byDomain).reduce((a, b) => a + b, 0), 4);
  assert.equal(Object.values(report.totals.byRisk).reduce((a, b) => a + b, 0), 4);

  const byKey = Object.fromEntries(report.projects.map((p) => [p.key, p]));
  assert.equal(byKey.g.domain, 'missing', 'missing path handled, not crashed');
  assert.equal(byKey.g.risk, 'missing');
  assert.equal(byKey.c.domain, 'code');
  assert.equal(byKey.c.risk, 'manual', 'code without oracle needs a human decision');
  assert.ok(byKey.c.actions.includes('declare-oracle'));
  assert.ok(byKey.c.actions.includes('sync-docs'));
  assert.equal(byKey.d.domain, 'docs');
  assert.equal(byKey.d.risk, 'safe');
  assert.ok(!byKey.d.actions.includes('install-gate'), 'docs project never gets a code gate action');
  assert.equal(byKey.u.domain, 'unknown');
  assert.equal(byKey.u.risk, 'review');

  fs.rmSync(dir, { recursive: true, force: true });
}

function testMigrationPlanCliDryRunTouchesNothing() {
  const { dir, home, codeProj, docsProj } = buildRegistry();
  const before = [codeProj, docsProj].map(hashTree);
  const completed = runCli(['migration-plan', '--home', home, '--json']);
  const after = [codeProj, docsProj].map(hashTree);
  assert.equal(completed.status, 0, 'read-only plan exits 0');
  assert.deepEqual(after, before, 'CLI dry-run writes nothing');
  const report = JSON.parse(completed.stdout);
  assert.equal(report.kind, 'project-bootstrap-migration-plan');
  assert.equal(report.dryRun, true);
  assert.equal(report.scanned, 4);
  fs.rmSync(dir, { recursive: true, force: true });
}

function main() {
  testScanChoosesBoundedGrepForSmallProject();
  testApplyCreatesOnlySafeInfrastructure();
  testDetectsNextAppRouterAndRecommendsBoundedProbes();
  testScanReportsControlPlaneAndSupplyChainSurface();
  testScanKeepsSupplyChainRepairsNonSafe();
  testScanCanSkipSupplyChainForStartupAdvisor();
  testRunPassesNoSupplyChainOptionThroughCliPath();
  testClassifyKindDetectsCodeDocsUnknown();
  testInspectIsReadOnly();
  testPlanIsDeterministicAndReadOnly();
  testPlanNeverInventsOracleForUnknownKind();
  testPlanUsesExistingOracleForCodeKind();
  testPlanCodegraphRequiresExplicitFlag();
  testCliInspectAndPlanCommandsRun();
  testApplyPlanIsIdempotentAndCreatesExactManifest();
  testApplyPlanKeepsProtectedBlocksAndUserFilesByteIdentical();
  testApplyPlanBlocksHarnessWithoutInventingOracle();
  testApplyPlanDoesNotBlockWhenHarnessAlreadyValid();
  testApplyPlanFillsInMissingApprovalDefaultsOnExistingHarness();
  testApplyPlanNeverOverridesExplicitApprovalChoice();
  testVerifyReportsApprovalGateSignalWithoutGatingOverallResult();
  testApplyPlanSkipsGitGateForNonCodeKind();
  testCliApplyCommandRuns();
  testVerifyIsReadOnly();
  testVerifyFailsClosedOnMissingDocsHarnessGateForFreshCodeProject();
  testVerifyPassesAllContractsAfterApplyAndValidHarness();
  testVerifySkipsCodeOnlyContractsForUnknownKind();
  testVerifyHarnessNegativeFixtureMalformedJson();
  testVerifySkillAvailabilityNegativeFixtureReportsDrift();
  testVerifyJudgeBridgeContractBothOutcomes();
  testOracleVerifierContractResolvesAndRunsDeep();
  testOracleVerifierDeepActuallySpawnsShell();
  testVerifySpecReadinessReportsExplicitIdleNotFailure();
  testVerifySpecReadinessReportsActiveOpenSlicesAsSignalNotGate();
  testVerifyCleanTreeSignalReportsDirtyWithoutGatingOverallResult();
  testCliVerifyCommandRunsAndReportsFailClosed();
  testVerifyCliJsonAndTextExitCodesMatch();
  testMigrationPlanIsReadOnlyReconcilesAndSurvivesMissingPaths();
  testMigrationPlanCliDryRunTouchesNothing();
  process.stdout.write('project-bootstrap tests: PASS\n');
}

main();
