#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { initOrSyncProjectDocs, verifyProjectDocs } = require('./project-docs-core');
const { ensureGraphifyIgnoreConfig } = require('./codemap-core');
const { run: runAgentSkillSupplyChain } = require('./agent-skill-supply-chain');
const { readHarnessConfig } = require('./elt-config');

const DEFAULT_MANIFEST = path.resolve(__dirname, '..', 'config', 'agent-skill-sources.json');

function fileCount(root) {
  const completed = spawnSync('rg', ['--files'], { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (completed.status !== 0) return { ok: false, count: 0, outputChars: 0, error: completed.stderr || completed.error?.message || '' };
  const files = completed.stdout.split(/\r?\n/).filter(Boolean);
  return { ok: true, count: files.length, outputChars: Buffer.byteLength(completed.stdout, 'utf8') };
}

function exists(root, relative) {
  return fs.existsSync(path.join(root, relative));
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase();
}

const CODE_MANIFESTS = ['package.json', 'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle'];
const CODE_EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.cs', '.rb', '.php', '.cpp', '.c', '.kt', '.swift']);
const DOC_EXTENSIONS = new Set(['.md', '.docx', '.pdf', '.pptx', '.xlsx', '.txt']);

function listFiles(root, limit = 500) {
  const completed = spawnSync('rg', ['--files'], { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (completed.status !== 0) return [];
  return completed.stdout.split(/\r?\n/).filter(Boolean).slice(0, limit);
}

function classifyKind(root) {
  const manifest = CODE_MANIFESTS.find((name) => exists(root, name));
  if (manifest) return { kind: 'code', confidence: 'high', signals: [manifest] };
  const files = listFiles(root);
  const codeFiles = files.filter((file) => CODE_EXTENSIONS.has(path.extname(file)));
  if (codeFiles.length > 0) return { kind: 'code', confidence: 'medium', signals: codeFiles.slice(0, 5) };
  const docFiles = files.filter((file) => DOC_EXTENSIONS.has(path.extname(file)));
  if (docFiles.length > 0) return { kind: 'docs', confidence: 'medium', signals: docFiles.slice(0, 5) };
  return { kind: 'unknown', confidence: 'low', signals: [] };
}

function inspectProject(root, options = {}) {
  const resolved = path.resolve(root || process.cwd());
  const docs = verifyProjectDocs(resolved);
  const harness = readHarnessConfig(resolved);
  const classification = classifyKind(resolved);
  return {
    kind: 'project-bootstrap-inspect',
    root: resolved,
    classification,
    docs: { ok: docs.ok, coreIdentical: Boolean(docs.coreIdentical), missing: docs.missing || [] },
    harness: { exists: fs.existsSync(path.join(resolved, '.harness', 'harness.json')), ok: harness.ok, errors: harness.errors || [], config: harness.config || null },
    codegraph: { indexed: exists(resolved, path.join('.codegraph', 'codegraph.db')) },
    gitGate: { managedHookInstalled: exists(resolved, path.join('.githooks', 'pre-commit')) },
  };
}

function planOracleDecision(inspected) {
  if (inspected.classification.kind !== 'code') {
    return { proposed: null, source: 'none', reason: `kind is ${inspected.classification.kind} — no oracle required or invented` };
  }
  if (inspected.harness.ok && inspected.harness.config && inspected.harness.config.oracle) {
    return { proposed: inspected.harness.config.oracle, source: 'existing', reason: 'valid .harness/harness.json already declares an oracle' };
  }
  return { proposed: null, source: 'none', reason: 'no valid oracle declared — code kind requires an explicit oracle before slices, none will be invented' };
}

function planTargetState(root, options = {}) {
  const inspected = inspectProject(root, options);
  const oracle = planOracleDecision(inspected);
  const codegraphRequested = options.codegraph === true;
  return {
    kind: 'project-bootstrap-plan',
    root: inspected.root,
    classification: inspected.classification,
    decisions: {
      oracle,
      judge: oracle.source === 'existing'
        ? { enabled: true, model: 'sonnet', reason: 'oracle exists for code kind' }
        : { enabled: false, reason: 'no oracle to gate — judge stays disabled' },
      codegraph: {
        enabled: codegraphRequested,
        reason: codegraphRequested ? 'explicit --codegraph flag' : 'not enabled — requires explicit --codegraph flag or interactive confirmation',
      },
      gitGate: {
        managed: inspected.gitGate.managedHookInstalled,
        hookPath: '.githooks/pre-commit',
        reason: inspected.gitGate.managedHookInstalled ? 'already installed' : 'not installed — apply will install the managed pre-commit gate',
      },
    },
    existing: { docs: inspected.docs, harness: inspected.harness, codegraph: inspected.codegraph },
  };
}

const STATE_STUB = '# STATE\n\n> Живий хребет проєкту (`.planning/STATE.md`), створено `project-bootstrap apply`.\n> Заповнити після першого спек-слайсу.\n';

const GIT_GATE_TEMPLATE = [
  '#!/bin/sh',
  '# elt gate — managed pre-commit hook (installed by project-bootstrap apply).',
  '# Enable once per clone:  git config core.hooksPath .githooks',
  'node "$HOME/.claude/bin/elt.js" gate',
  '',
].join('\n');

function applyPlan(root, options = {}) {
  const plan = planTargetState(root, options);
  const resolved = plan.root;
  const changes = [];

  if (!(plan.existing.docs.ok && plan.existing.docs.coreIdentical)) {
    const ragExistedBefore = exists(resolved, path.join('.rag', 'manifest.json'));
    const result = initOrSyncProjectDocs({ root: resolved, mode: 'init', home: options.home });
    if (!ragExistedBefore) fs.rmSync(path.join(resolved, '.rag'), { recursive: true, force: true });
    if (result.success) changes.push({ id: 'project-docs', mode: result.mode });
  }

  const statePath = path.join(resolved, '.planning', 'STATE.md');
  if (!fs.existsSync(statePath)) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, STATE_STUB, 'utf8');
    changes.push({ id: 'planning-state', created: true });
  }

  const hookPath = path.join(resolved, '.githooks', 'pre-commit');
  if (plan.classification.kind === 'code' && !plan.decisions.gitGate.managed) {
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, GIT_GATE_TEMPLATE, { mode: 0o755 });
    changes.push({ id: 'git-gate', created: true });
  }

  const blocked = [];
  if (plan.classification.kind === 'code' && plan.decisions.oracle.source !== 'existing') {
    blocked.push({ id: 'harness', reason: plan.decisions.oracle.reason });
  }

  return {
    kind: 'project-bootstrap-apply',
    root: resolved,
    plan,
    changes,
    blocked,
    after: planTargetState(resolved, options),
  };
}

function detectStack(root) {
  const packageJson = path.join(root, 'package.json');
  if (!fs.existsSync(packageJson)) return { name: 'unknown', confidence: 'low' };
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.next || exists(root, path.join('src', 'app'))) return { name: 'Next.js App Router', confidence: 'high' };
    if (deps.vite || exists(root, 'vite.config.ts') || exists(root, 'vite.config.js')) return { name: 'Vite React', confidence: 'high' };
    if (deps.electron || pkg.main) return { name: 'Electron', confidence: 'medium' };
    return { name: 'Node.js', confidence: 'medium' };
  } catch (error) {
    return { name: 'unknown', confidence: 'low', error: error.message };
  }
}

function recommendedProbes(strategy, stack) {
  if (stack.name === 'Next.js App Router') {
    return [
      'rg --files src/app src/lib | Select-Object -First 80',
      'rg "use server|redirect|createClient|supabase|auth" src/lib src/app/api -n -m 3 | Select-Object -First 80',
      'rg "page.tsx|layout.tsx|route.ts" src/app -n -m 2 | Select-Object -First 60',
    ];
  }
  if (stack.name === 'Vite React') {
    return [
      'rg --files src | Select-Object -First 80',
      'rg "useState|useEffect|useMemo|createRoot|Router|routes" src -n -m 3 | Select-Object -First 80',
      'rg "export default|function |const .* =" src -n -m 2 | Select-Object -First 60',
    ];
  }
  if (strategy === 'bounded-grep-first') {
    return [
      'rg --files | Select-Object -First 80',
      'rg "<task-keyword>" . -n -m 3 | Select-Object -First 60',
    ];
  }
  return [
    'rg --files | Select-Object -First 120',
    'rg "<task-keyword>" src -n -m 3 | Select-Object -First 80',
  ];
}

function controlPlaneStatus(root) {
  const file = path.join(root, '.planning', 'agent-control-plane.json');
  if (!fs.existsSync(file)) return { ok: false, exists: false, file };
  const parsed = readJson(file);
  if (!parsed.ok) return { ok: false, exists: true, file, error: parsed.error };
  const value = parsed.value || {};
  const required = ['version', 'managedBy', 'manifestVersion', 'manifest', 'requiredClients'];
  const missing = required.filter((key) => value[key] === undefined);
  return {
    ok: missing.length === 0 && Array.isArray(value.requiredClients),
    exists: true,
    file,
    missing,
    manifestVersion: value.manifestVersion,
    requiredClients: Array.isArray(value.requiredClients) ? value.requiredClients : [],
  };
}

function summarizeSupplyChain(root, audit) {
  if (!audit || audit.kind !== 'agent-skill-supply-chain') {
    return { ok: false, error: 'supply-chain audit unavailable' };
  }
  const targetClients = audit.validation && audit.validation.ok
    ? Object.keys(audit.clients || {})
    : [];
  const missingClientRoots = targetClients.filter((client) => !(audit.clients[client] && audit.clients[client].exists));
  const missingInstalls = (audit.skills || []).flatMap((skill) => targetClients
    .filter((client) => skill.clients && skill.clients[client] && !skill.clients[client].installed)
    .map((client) => `${client}/${skill.name}`));
  const driftedInstalls = (audit.skills || []).flatMap((skill) => targetClients
    .filter((client) => skill.clients && skill.clients[client] && skill.clients[client].installed && !skill.clients[client].matchesSource)
    .map((client) => `${client}/${skill.name}`));
  const targetProject = (audit.projects || []).find((project) => normalizePath(project.path || '') === normalizePath(root));
  const missingControlPlane = targetProject && targetProject.exists && !targetProject.controlPlane;
  const ok = Boolean(audit.validation && audit.validation.ok)
    && missingClientRoots.length === 0
    && missingInstalls.length === 0
    && driftedInstalls.length === 0
    && missingControlPlane !== true;
  return {
    ok,
    validation: audit.validation || { ok: false, errors: ['missing validation result'] },
    skills: (audit.skills || []).length,
    projects: (audit.projects || []).length,
    target_project: targetProject ? {
      key: targetProject.key,
      exists: targetProject.exists,
      controlPlane: targetProject.controlPlane,
    } : null,
    missing_client_roots: missingClientRoots,
    missing_installs: missingInstalls,
    drifted_installs: driftedInstalls,
  };
}

function supplyChainStatus(root, options = {}) {
  if (options.supplyChain === false) return { ok: true, skipped: true, reason: 'disabled by caller' };
  try {
    const home = path.resolve(options.home || require('node:os').homedir());
    const manifest = path.resolve(options.manifest || DEFAULT_MANIFEST);
    const registry = path.join(home, '.claude', 'projects-registry.json');
    const runner = options.supplyChainRunner || runAgentSkillSupplyChain;
    const audit = options.supplyChainAudit || runner({
      command: 'audit',
      manifest,
      registry,
      home,
      target: 'all',
      apply: false,
      json: true,
      repoRoot: path.resolve(__dirname, '..'),
    });
    return summarizeSupplyChain(root, audit);
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function scanProject(root, options = {}) {
  const resolved = path.resolve(root || process.cwd());
  const docs = verifyProjectDocs(resolved);
  const files = fileCount(resolved);
  const hasRag = exists(resolved, path.join('.rag', 'manifest.json'));
  const hasGraphifyIgnore = exists(resolved, '.graphifyignore');
  const controlPlane = controlPlaneStatus(resolved);
  const supplyChain = supplyChainStatus(resolved, options);
  const harness = readHarnessConfig(resolved);
  const stack = detectStack(resolved);
  const strategy = files.ok && files.count <= 80 ? 'bounded-grep-first' : 'project-docs-codemap-first';
  const actions = [
    docs.ok && docs.coreIdentical ? null : { id: 'project-docs', safe: true, command: 'node tools/project-docs.js init --root <project>' },
    hasGraphifyIgnore ? null : { id: 'graphifyignore', safe: true, command: 'node tools/codemap.js setup --root <project> --no-relevance' },
    hasRag ? null : { id: 'rag-manifest', safe: false, command: 'python tools/rag-ingest.py --project <key> --queue AGENTS.md' },
    controlPlane.ok ? null : { id: 'agent-control-plane', safe: false, command: 'agent-skills.cmd rollout-projects --apply' },
    supplyChain.ok ? null : { id: 'agent-skill-supply-chain', safe: false, command: 'agent-skills.cmd audit; agent-skills.cmd install-skills --target all --apply' },
  ].filter(Boolean);
  return {
    kind: 'project-bootstrap',
    root: resolved,
    strategy,
    stack,
    recommended_probes: recommendedProbes(strategy, stack),
    file_count: files,
    checks: {
      ai_docs: { ok: docs.ok && docs.coreIdentical, missing: docs.missing || [] },
      harness: { ok: harness.ok, errors: harness.errors || [], config: harness.config },
      graphifyignore: { ok: hasGraphifyIgnore },
      rag_manifest: { ok: hasRag },
      agent_control_plane: controlPlane,
      agent_skill_supply_chain: supplyChain,
    },
    actions,
  };
}

function applySafeActions(root, options = {}) {
  const before = scanProject(root, options);
  const docsResult = before.checks.ai_docs.ok ? null : initOrSyncProjectDocs({ root, mode: 'init', home: options.home });
  const graphifyignore = before.checks.graphifyignore.ok ? null : ensureGraphifyIgnoreConfig(path.resolve(root));
  return {
    before,
    applied: [
      docsResult ? { id: 'project-docs', success: docsResult.success, mode: docsResult.mode } : null,
      graphifyignore ? { id: 'graphifyignore', changed: graphifyignore.changed, added: graphifyignore.added } : null,
    ].filter(Boolean),
    after: scanProject(root, options),
  };
}

function parseArgs(argv) {
  const command = ['inspect', 'plan', 'apply'].includes(argv[2]) ? argv[2] : null;
  const defaults = { command, root: process.cwd(), apply: false, json: false, home: undefined, supplyChain: true, codegraph: false };
  const parseNext = (index, state) => {
    if (index >= argv.length) return state;
    const arg = argv[index];
    if (arg === '--apply') return parseNext(index + 1, { ...state, apply: true });
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--codegraph') return parseNext(index + 1, { ...state, codegraph: true });
    if (arg === '--no-supply-chain') return parseNext(index + 1, { ...state, supplyChain: false });
    if (arg === '--root') return parseNext(index + 2, { ...state, root: argv[index + 1] || state.root });
    if (arg === '--home') return parseNext(index + 2, { ...state, home: argv[index + 1] || state.home });
    return parseNext(index + 1, state);
  };
  return parseNext(command ? 3 : 2, defaults);
}

function run(options) {
  if (options.command === 'inspect') return inspectProject(options.root, options);
  if (options.command === 'plan') return planTargetState(options.root, options);
  if (options.command === 'apply') return applyPlan(options.root, options);
  return options.apply ? applySafeActions(options.root, options) : scanProject(options.root, options);
}

const TEXT_SUMMARY = {
  inspect: (report) => `project-bootstrap-inspect: ${report.classification.kind}`,
  plan: (report) => `project-bootstrap-plan: ${report.classification.kind}`,
  apply: (report) => `project-bootstrap-apply: ${report.changes.length} changes, ${report.blocked.length} blocked`,
};

function main() {
  const options = parseArgs(process.argv);
  const report = run(options);
  const legacySummary = () => `${report.kind || 'project-bootstrap'}: ${report.after ? report.after.strategy : report.strategy}\n`;
  process.stdout.write(options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${options.command ? TEXT_SUMMARY[options.command](report) : legacySummary().trimEnd()}\n`);
  if (options.command === 'inspect') { if (!report.harness.ok) process.exitCode = 1; return; }
  if (options.command === 'plan') return;
  if (options.command === 'apply') { if (report.blocked.length > 0) process.exitCode = 1; return; }
  const checks = report.after ? report.after.checks : report.checks;
  if (!checks.harness.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  applyPlan,
  applySafeActions,
  classifyKind,
  controlPlaneStatus,
  detectStack,
  inspectProject,
  planTargetState,
  recommendedProbes,
  run,
  scanProject,
  summarizeSupplyChain,
  supplyChainStatus,
};
