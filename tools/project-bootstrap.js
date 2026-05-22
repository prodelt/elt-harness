#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { initOrSyncProjectDocs, verifyProjectDocs } = require('./project-docs-core');
const { ensureGraphifyIgnoreConfig } = require('./codemap-core');

function fileCount(root) {
  const completed = spawnSync('rg', ['--files'], { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (completed.status !== 0) return { ok: false, count: 0, outputChars: 0, error: completed.stderr || completed.error?.message || '' };
  const files = completed.stdout.split(/\r?\n/).filter(Boolean);
  return { ok: true, count: files.length, outputChars: Buffer.byteLength(completed.stdout, 'utf8') };
}

function exists(root, relative) {
  return fs.existsSync(path.join(root, relative));
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

function scanProject(root) {
  const resolved = path.resolve(root || process.cwd());
  const docs = verifyProjectDocs(resolved);
  const files = fileCount(resolved);
  const hasRag = exists(resolved, path.join('.rag', 'manifest.json'));
  const hasGraphifyIgnore = exists(resolved, '.graphifyignore');
  const stack = detectStack(resolved);
  const strategy = files.ok && files.count <= 80 ? 'bounded-grep-first' : 'project-docs-codemap-first';
  const actions = [
    docs.ok && docs.coreIdentical ? null : { id: 'project-docs', safe: true, command: 'node tools/project-docs.js init --root <project>' },
    hasGraphifyIgnore ? null : { id: 'graphifyignore', safe: true, command: 'node tools/codemap.js setup --root <project> --no-relevance' },
    hasRag ? null : { id: 'rag-manifest', safe: false, command: 'python tools/rag-ingest.py --project <key> --queue AGENTS.md' },
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
    },
    actions,
  };
}

function applySafeActions(root, options = {}) {
  const before = scanProject(root);
  const docsResult = before.checks.ai_docs.ok ? null : initOrSyncProjectDocs({ root, mode: 'init', home: options.home });
  const graphifyignore = before.checks.graphifyignore.ok ? null : ensureGraphifyIgnoreConfig(path.resolve(root));
  return {
    before,
    applied: [
      docsResult ? { id: 'project-docs', success: docsResult.success, mode: docsResult.mode } : null,
      graphifyignore ? { id: 'graphifyignore', changed: graphifyignore.changed, added: graphifyignore.added } : null,
    ].filter(Boolean),
    after: scanProject(root),
  };
}

function parseArgs(argv) {
  const defaults = { root: process.cwd(), apply: false, json: false, home: undefined };
  const parseNext = (index, state) => {
    if (index >= argv.length) return state;
    const arg = argv[index];
    if (arg === '--apply') return parseNext(index + 1, { ...state, apply: true });
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--root') return parseNext(index + 2, { ...state, root: argv[index + 1] || state.root });
    if (arg === '--home') return parseNext(index + 2, { ...state, home: argv[index + 1] || state.home });
    return parseNext(index + 1, state);
  };
  return parseNext(2, defaults);
}

function run(options) {
  return options.apply ? applySafeActions(options.root, { home: options.home }) : scanProject(options.root);
}

function main() {
  const options = parseArgs(process.argv);
  const report = run(options);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${report.kind || 'project-bootstrap'}: ${report.after ? report.after.strategy : report.strategy}\n`);
}

if (require.main === module) main();

module.exports = {
  applySafeActions,
  detectStack,
  recommendedProbes,
  scanProject,
};
