#!/usr/bin/env node

/**
 * SessionStart hook: Graphify Session Init
 *
 * Checks graphify state for current project:
 *   - Installed + graph exists → inject graph stats as context (replaces file reading)
 *   - Installed but no graph → one-time setup suggestion
 *   - Not installed → silent (project-docs-gate already advised)
 *
 * Does NOT run graphify scan (too slow for SessionStart).
 * Reads graph.json directly for fast stats.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const metrics = require('./lib/metrics');
const { normCwd } = require('./lib/pathnorm');
metrics.inc('graphify-session-init', 'fired');
const { execSync } = require('child_process');

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = normCwd((input && input.cwd) || process.cwd());

// ── Check if this is a real project ──────────────────────────────────────────
const PROJECT_INDICATORS = ['package.json', 'go.mod', 'pyproject.toml', '.git', 'src', 'app'];
const isProject = PROJECT_INDICATORS.some(f => {
  try { return fs.existsSync(path.join(cwd, f)); } catch { return false; }
});
if (!isProject) process.exit(0);

// ── Check graphify installation ───────────────────────────────────────────────
// On Windows, graphify.exe lives in Python Scripts — not always in bash PATH.
// Try bash PATH first, then well-known Windows location.
const GRAPHIFY_FULL_PATH = 'C:/Users/espad/AppData/Local/Programs/Python/Python311/Scripts/graphify.exe';

let graphifyBin = null;
const binCandidates = ['graphify', GRAPHIFY_FULL_PATH];
for (const bin of binCandidates) {
  try {
    execSync(`"${bin}" --version`, { stdio: 'pipe', timeout: 3000 });
    graphifyBin = bin;
    break;
  } catch { /* try next */ }
}
if (!graphifyBin) process.exit(0); // not installed → silent

// ── Check for graph.json ──────────────────────────────────────────────────────
const GRAPH_PATHS = [
  path.join(cwd, 'graphify-out', 'graph.json'),
  path.join(cwd, '.graphify', 'graph.json'),
  path.join(cwd, 'graph.json'),
];

let graphPath = null;
for (const p of GRAPH_PATHS) {
  if (fs.existsSync(p)) { graphPath = p; break; }
}

// ── No graph yet → setup suggestion ──────────────────────────────────────────
if (!graphPath) {
  // Check if git hook is installed
  const gitHookPath = path.join(cwd, '.git', 'hooks', 'post-commit');
  const hookInstalled = fs.existsSync(gitHookPath) &&
    readSafe(gitHookPath).includes('graphify');

  const bin = graphifyBin === 'graphify' ? 'graphify' : `"${GRAPHIFY_FULL_PATH}"`;
  const msg = [
    'GRAPHIFY: Not initialized for this project.',
    'Run once to enable knowledge graph (71.5x fewer tokens on code queries):',
    '',
    `  ${bin} update .            # build graph (~30 sec)`,
    `  ${bin} hook install       # auto-rebuild on git commit`,
    `  ${bin} claude install     # WARNING on Windows: installs broken PS hook!`,
    '  # Instead add graphify-preuse.js manually (already done globally)',
    '',
    `After setup: use "${bin} query <question>" instead of reading source files.`,
  ].join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: msg
    }
  }));
  process.exit(0);
}

// ── Graph exists → inject stats ───────────────────────────────────────────────
function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

let statsContext = 'GRAPHIFY ACTIVE for this project.';

try {
  const raw  = fs.readFileSync(graphPath, 'utf8');
  const graph = JSON.parse(raw);

  const nodeCount = graph.nodes ? Object.keys(graph.nodes).length : 0;
  const edgeCount = graph.edges ? graph.edges.length : 0;

  // Get top god-nodes (most connected) if available
  let topNodes = '';
  if (graph.nodes && nodeCount > 0) {
    const nodeDegrees = {};
    if (graph.edges) {
      for (const e of graph.edges) {
        nodeDegrees[e.source] = (nodeDegrees[e.source] || 0) + 1;
        nodeDegrees[e.target] = (nodeDegrees[e.target] || 0) + 1;
      }
    }
    const top5 = Object.entries(nodeDegrees)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n, d]) => `${n}(${d})`);
    if (top5.length > 0) topNodes = '\n  Key nodes: ' + top5.join(', ');
  }

  // Graph age
  const stat = fs.statSync(graphPath);
  const hoursAgo = Math.floor((Date.now() - stat.mtimeMs) / 3600000);
  const ageStr = hoursAgo < 1   ? 'just now'
               : hoursAgo < 24  ? `${hoursAgo}h ago`
               : `${Math.floor(hoursAgo/24)}d ago`;

  const qBin = graphifyBin === 'graphify' ? 'graphify' : `"${GRAPHIFY_FULL_PATH}"`;

  // Auto-update if graph is stale (>6h) — background, non-blocking
  let autoUpdateNote = '';
  if (hoursAgo >= 6) {
    try {
      const { spawn } = require('child_process');
      const bin = graphifyBin === 'graphify' ? graphifyBin : GRAPHIFY_FULL_PATH;
      spawn(bin, ['update', '.'], { cwd, detached: true, stdio: 'ignore' }).unref();
      autoUpdateNote = ' [AUTO-UPDATE started in background]';
    } catch (_) {}
  }

  statsContext = [
    `GRAPHIFY ACTIVE: ${nodeCount} nodes, ${edgeCount} edges (updated ${ageStr}${autoUpdateNote})${topNodes}`,
    'Use these commands instead of reading files:',
    `  ${qBin} query "what does X do?"     — answer without file reads`,
    `  ${qBin} query "what calls Y?"       — find callers`,
    `  ${qBin} query "list all API routes" — structural queries`,
    `  ${qBin} update .                    — rebuild if stale`,
  ].join('\n');

} catch { /* keep default statsContext */ }

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: statsContext
  }
}));
