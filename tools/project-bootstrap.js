#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { initOrSyncProjectDocs, verifyProjectDocs } = require('./project-docs-core');
const { ensureGraphifyIgnoreConfig } = require('./codemap-core');
const { run: runAgentSkillSupplyChain } = require('./agent-skill-supply-chain');

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
  const defaults = { root: process.cwd(), apply: false, json: false, home: undefined, supplyChain: true };
  const parseNext = (index, state) => {
    if (index >= argv.length) return state;
    const arg = argv[index];
    if (arg === '--apply') return parseNext(index + 1, { ...state, apply: true });
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--no-supply-chain') return parseNext(index + 1, { ...state, supplyChain: false });
    if (arg === '--root') return parseNext(index + 2, { ...state, root: argv[index + 1] || state.root });
    if (arg === '--home') return parseNext(index + 2, { ...state, home: argv[index + 1] || state.home });
    return parseNext(index + 1, state);
  };
  return parseNext(2, defaults);
}

function run(options) {
  return options.apply ? applySafeActions(options.root, options) : scanProject(options.root, options);
}

function main() {
  const options = parseArgs(process.argv);
  const report = run(options);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${report.kind || 'project-bootstrap'}: ${report.after ? report.after.strategy : report.strategy}\n`);
}

if (require.main === module) main();

module.exports = {
  applySafeActions,
  controlPlaneStatus,
  detectStack,
  recommendedProbes,
  run,
  scanProject,
  summarizeSupplyChain,
  supplyChainStatus,
};
