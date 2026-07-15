#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  applySafeActions,
  classifyKind,
  detectStack,
  inspectProject,
  planTargetState,
  run: runBootstrap,
  scanProject,
} = require('./project-bootstrap');

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
  assert.equal(fs.existsSync(path.join(root, '.rag', 'manifest.json')), true);
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
  process.stdout.write('project-bootstrap tests: PASS\n');
}

main();
