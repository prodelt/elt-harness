#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_NOISY_PREFIXES = [
  'node_modules/',
  'tools/red-team/',
  'graphify-out/cache/',
  'audit/1c-dev-pilot/recon/',
];

const REQUIRED_GRAPHIFY_IGNORE_PREFIXES = [
  'tools/red-team',
  'audit/1c-dev-pilot',
  'graphify-out/cache',
];

const STALE_GRAPHIFY_NODE_TYPES = new Set(['semantic', 'rationale']);

function normalizeSlash(value) {
  return String(value || '').replace(/\\/g, '/');
}

function result(status, id, title, detail, repair, data = {}) {
  return { status, id, title, detail, repair, data };
}

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function sourceFile(node) {
  return normalizeSlash(node && (node.source_file || node.file || node.path || node.label));
}

function isNoisySource(source, prefixes = DEFAULT_NOISY_PREFIXES) {
  return prefixes.some((prefix) => source.startsWith(prefix));
}

function readGraphifyIgnore(root) {
  const file = path.join(root, '.graphifyignore');
  if (!fs.existsSync(file)) return { ok: false, file, patterns: [] };
  const text = fs.readFileSync(file, 'utf8');
  const patterns = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => normalizeSlash(line).replace(/^\/+|\/+$/g, ''));
  return { ok: true, file, patterns };
}

function graphifyPatternCoversPrefix(pattern, prefix) {
  const cleanPattern = pattern.replace(/\/\*\*$/, '');
  return cleanPattern === prefix || cleanPattern.startsWith(`${prefix}/`);
}

function missingGraphifyIgnorePrefixes(root) {
  const ignore = readGraphifyIgnore(root);
  const missing = REQUIRED_GRAPHIFY_IGNORE_PREFIXES.filter(
    (prefix) => !ignore.patterns.some((pattern) => graphifyPatternCoversPrefix(pattern, prefix)),
  );
  return { ...ignore, missing };
}

function ensureGraphifyIgnoreConfig(root) {
  const checked = missingGraphifyIgnorePrefixes(root);
  if (checked.missing.length === 0) {
    return { file: checked.file, changed: false, added: [] };
  }
  const existing = checked.ok ? fs.readFileSync(checked.file, 'utf8') : '';
  const preamble = existing.trim()
    ? `${existing.trimEnd()}\n\n# Added by codemap setup.`
    : '# Added by codemap setup.';
  const next = `${preamble}\n${checked.missing.join('\n')}\n`;
  fs.mkdirSync(path.dirname(checked.file), { recursive: true });
  fs.writeFileSync(checked.file, next, 'utf8');
  return { file: checked.file, changed: true, added: checked.missing };
}

function isOutOfScopeSource(root, source) {
  if (!path.isAbsolute(source)) return false;
  const rootPath = normalizeSlash(path.resolve(root)).toLowerCase();
  return !normalizeSlash(path.resolve(source)).toLowerCase().startsWith(rootPath);
}

function readGraph(root, graphPath = path.join(root, 'graphify-out', 'graph.json')) {
  const parsed = readJson(graphPath);
  if (!parsed.ok) return { ok: false, error: parsed.error, graphPath };
  const nodes = Array.isArray(parsed.value.nodes) ? parsed.value.nodes : [];
  const links = Array.isArray(parsed.value.links) ? parsed.value.links : [];
  return { ok: true, graphPath, nodes, links };
}

function summarizeGraph(root, graphPath = path.join(root, 'graphify-out', 'graph.json')) {
  const graph = readGraph(root, graphPath);
  if (!graph.ok) return graph;
  const { nodes, links } = graph;
  const sources = nodes.map(sourceFile).filter(Boolean);
  const uniqueSources = [...new Set(sources)];
  const noisyNodes = sources.filter((source) => isNoisySource(source)).length;
  const outOfScope = uniqueSources.filter((source) => isOutOfScopeSource(root, source));
  const noisyRatio = sources.length ? noisyNodes / sources.length : 0;
  return {
    ok: true,
    graphPath,
    nodes: nodes.length,
    links: links.length,
    uniqueSources: uniqueSources.length,
    noisyNodes,
    noisyRatio,
    outOfScope,
    topSources: topCounts(sources, 5),
  };
}

function topCounts(values, limit) {
  const counts = values.reduce((acc, value) => ({ ...acc, [value]: (acc[value] || 0) + 1 }), {});
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([source, count]) => ({ source, count }));
}

function checkGraphScope(root, graphPath) {
  const summary = summarizeGraph(root, graphPath);
  if (!summary.ok) {
    return result('fail', 'codemap:graph', 'Codemap graph missing/invalid', summary.error, 'Run cmd /c graphify update .', { graphPath: summary.graphPath });
  }
  if (summary.outOfScope.length > 0) {
    return result('fail', 'codemap:scope', 'Codemap graph includes out-of-project files', summary.outOfScope.slice(0, 5).join('; '), 'Rebuild graph from the project root only.', summary);
  }
  if (summary.noisyRatio > 0.25) {
    return result('warn', 'codemap:scope', 'Codemap graph is dominated by noisy sources', `${Math.round(summary.noisyRatio * 100)}% noisy nodes. Top sources: ${formatTopSources(summary.topSources)}`, 'Exclude vendor/red-team/recon/cache paths and rebuild Graphify.', summary);
  }
  return result('pass', 'codemap:scope', 'Codemap graph scope OK', `${summary.nodes} nodes, ${summary.uniqueSources} source files.`, '', summary);
}

function checkGraphifyIgnoreConfig(root) {
  const ignore = missingGraphifyIgnorePrefixes(root);
  if (!ignore.ok) {
    return result('warn', 'codemap:graphifyignore', 'Graphify ignore config missing', '.graphifyignore not found.', 'Create .graphifyignore with vendor/red-team/recon/cache excludes.', { file: ignore.file });
  }
  if (ignore.missing.length > 0) {
    return result('warn', 'codemap:graphifyignore', 'Graphify ignore config incomplete', `Missing excludes: ${ignore.missing.join(', ')}`, 'Run node tools/codemap.js setup --root <project>, then cmd /c graphify update .', { file: ignore.file, missing: ignore.missing });
  }
  return result('pass', 'codemap:graphifyignore', 'Graphify ignore config OK', `Configured excludes: ${REQUIRED_GRAPHIFY_IGNORE_PREFIXES.join(', ')}`, '', { file: ignore.file });
}

function staleGraphNodeReason(node) {
  const fileType = String(node && node.file_type || '').toLowerCase();
  // Only flag rationale/semantic nodes that have NO source_file — truly orphaned LLM artifacts.
  // Nodes with source_file are legitimate docstring extractions from current code.
  if (STALE_GRAPHIFY_NODE_TYPES.has(fileType) && !node.source_file) return fileType;
  return '';
}

function checkGraphStaleness(root, graphPath) {
  const graph = readGraph(root, graphPath);
  if (!graph.ok) {
    return result('warn', 'codemap:stale', 'Codemap stale-node check skipped', graph.error, 'Create graphify-out/graph.json with cmd /c graphify update .', { graphPath: graph.graphPath });
  }
  const staleNodes = graph.nodes
    .map((node) => ({ node, reason: staleGraphNodeReason(node) }))
    .filter((entry) => entry.reason);
  if (staleNodes.length === 0) {
    return result('pass', 'codemap:stale', 'Codemap graph has no stale semantic/rationale nodes', `${graph.nodes.length} nodes checked.`, '', { graphPath: graph.graphPath });
  }
  const sample = staleNodes.slice(0, 5).map((entry) => entry.node.id || entry.node.label || entry.reason).join(', ');
  return result('warn', 'codemap:stale', 'Codemap graph contains stale semantic/rationale nodes', `${staleNodes.length} stale nodes detected: ${sample}`, 'Fresh rebuild: remove graphify-out/graph.json, then run cmd /c graphify update .', { graphPath: graph.graphPath, staleCount: staleNodes.length });
}

function formatTopSources(items) {
  return items.map((item) => `${item.source} (${item.count})`).join(', ');
}

function chooseSmoke(root) {
  const candidates = [
    {
      file: 'tools/project-docs-core.js',
      query: 'what does project-docs-core do?',
      expected: ['project-docs-core', 'initOrSyncProjectDocs', 'registerProject'],
    },
    {
      file: 'tools/doctor-core.js',
      query: 'what does doctor-core do?',
      expected: ['doctor-core', 'doctor', 'Graphify'],
    },
    {
      file: 'AGENTS.md',
      query: 'what does AGENTS.md describe?',
      expected: ['AGENTS.md', 'Commands', 'Architecture'],
    },
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(root, candidate.file))) || candidates[candidates.length - 1];
}

function defaultRunner(root, query) {
  const completed = spawnSync('cmd.exe', ['/c', 'graphify', 'query', query], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  return {
    status: completed.status,
    error: completed.error && completed.error.message,
    output: `${completed.stdout || ''}${completed.stderr || ''}`.trim(),
  };
}

function checkRelevance(root, runner = defaultRunner) {
  const smoke = chooseSmoke(root);
  const completed = runner(root, smoke.query);
  if (completed.status !== 0) {
    return result('fail', 'codemap:relevance', 'Codemap relevance query failed', completed.error || completed.output, 'Ensure Graphify CLI works and rebuild the graph.', { smoke });
  }
  const output = completed.output || '';
  const normalizedOutput = normalizeSlash(output);
  const matched = smoke.expected.filter((term) => new RegExp(escapeRegExp(term), 'i').test(output));
  const citesCurrentFile = new RegExp(escapeRegExp(smoke.file), 'i').test(normalizedOutput);
  if (matched.length >= 2 && citesCurrentFile) {
    return result('pass', 'codemap:relevance', 'Codemap relevance smoke OK', `Matched ${matched.join(', ')} and cited ${smoke.file}.`, '', { smoke, matched });
  }
  return result('warn', 'codemap:relevance', 'Codemap relevance smoke weak', output.slice(0, 400), `Expected current-project citation: ${smoke.file}.`, { smoke, matched });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runCodemapDoctor(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const checks = [checkGraphifyIgnoreConfig(root), checkGraphScope(root, options.graphPath), checkGraphStaleness(root, options.graphPath)];
  if (options.relevance !== false) checks.push(checkRelevance(root, options.runner));
  const summary = checks.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  return { root: normalizeSlash(root), summary, checks };
}

function setupCodemapProject(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const graphifyignore = ensureGraphifyIgnoreConfig(root);
  const report = runCodemapDoctor({ ...options, root });
  return { root: normalizeSlash(root), graphifyignore: { ...graphifyignore, file: normalizeSlash(graphifyignore.file) }, report };
}

function formatCodemapReport(report) {
  const header = [
    `Codemap root: ${report.root}`,
    `Summary: PASS=${report.summary.pass || 0} WARN=${report.summary.warn || 0} FAIL=${report.summary.fail || 0}`,
    '',
  ].join('\n');
  const lines = report.checks.map((check) => {
    const repair = check.repair ? `\n  repair: ${check.repair}` : '';
    return `[${check.status.toUpperCase()}] ${check.title}\n  ${check.detail}${repair}`;
  });
  return `${header}${lines.join('\n')}\n`;
}

module.exports = {
  checkGraphifyIgnoreConfig,
  checkGraphScope,
  checkGraphStaleness,
  checkRelevance,
  ensureGraphifyIgnoreConfig,
  runCodemapDoctor,
  setupCodemapProject,
  formatCodemapReport,
  summarizeGraph,
};
