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
  classifyKind,
  detectStack,
  inspectProject,
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
  assert.ok(report.actions.some((action) => action.id === 'rag-manifest' && !action.safe));
}

function testApplyCreatesOnlySafeInfrastructure() {
  const root = tempProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  const report = applySafeActions(root, { home });
  assert.ok(report.applied.some((item) => item.id === 'project-docs'));
  assert.ok(report.applied.some((item) => item.id === 'graphifyignore'));
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), true);
  assert.equal(fs.existsSync(path.join(root, '.graphifyignore')), true);
  // AC10: project-docs больше не создаёт legacy .rag (даже на старом safe-actions пути).
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  applyPlan(root, { home });
  validHarness(root);
  const report = verifyProject(root, { supplyChain: false });
  assert.equal(report.contracts.docs.ok, true);
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  applyPlan(root, { home });
  validHarness(root);
  const report = verifyProject(root, { supplyChain: false });
  assert.equal(report.signals.specReadiness.status, 'active');
  assert.equal(report.signals.specReadiness.open, 1);
  assert.equal(report.signals.specReadiness.done, 1);
  assert.equal(report.ok, true);
}

function testVerifyCleanTreeSignalReportsDirtyWithoutGatingOverallResult() {
  const root = tempProject();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  applyPlan(root, { home });
  validHarness(root);
  assert.equal(spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' }).status, 0);
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['commit', '-m', 'init'], { cwd: root });
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const x = 2;\n', 'utf8');

  const report = verifyProject(root, { supplyChain: false });
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-bootstrap-home-'));
  applyPlan(rootPass, { home });
  validHarness(rootPass);
  const textPass = runCli(['verify', '--root', rootPass, '--no-supply-chain']);
  const jsonPass = runCli(['verify', '--root', rootPass, '--no-supply-chain', '--json']);
  assert.equal(textPass.status, 0);
  assert.equal(jsonPass.status, 0);
  assert.deepEqual(JSON.parse(jsonPass.stdout).ok, true);
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
  testApplyPlanSkipsGitGateForNonCodeKind();
  testCliApplyCommandRuns();
  testVerifyIsReadOnly();
  testVerifyFailsClosedOnMissingDocsHarnessGateForFreshCodeProject();
  testVerifyPassesAllContractsAfterApplyAndValidHarness();
  testVerifySkipsCodeOnlyContractsForUnknownKind();
  testVerifyHarnessNegativeFixtureMalformedJson();
  testVerifySkillAvailabilityNegativeFixtureReportsDrift();
  testVerifySpecReadinessReportsExplicitIdleNotFailure();
  testVerifySpecReadinessReportsActiveOpenSlicesAsSignalNotGate();
  testVerifyCleanTreeSignalReportsDirtyWithoutGatingOverallResult();
  testCliVerifyCommandRunsAndReportsFailClosed();
  testVerifyCliJsonAndTextExitCodesMatch();
  process.stdout.write('project-bootstrap tests: PASS\n');
}

main();
