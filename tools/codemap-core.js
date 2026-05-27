#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_NOISY_PREFIXES = [
  '.planning/',
  '.rag/',
  '.tmp/',
  'node_modules/',
  'graphify-out/',
  'tools/__pycache__/',
  'tools/red-team/',
  'audit/1c-dev-pilot/recon/',
];

const REQUIRED_GRAPHIFY_IGNORE_PREFIXES = [
  '.planning',
  '.rag',
  '.tmp',
  'graphify-out',
  'tools/__pycache__',
  'tools/red-team',
  'audit/1c-dev-pilot',
];

const STALE_GRAPHIFY_NODE_TYPES = new Set(['semantic', 'rationale']);
const CODEMAP_PROVIDERS = new Set(['graphify', 'codegraph']);
const CODEGRAPH_LOCK_TIMEOUT_MS = 15000;
const CODEGRAPH_LOCK_STALE_MS = 5 * 60 * 1000;

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

function selectedProvider(options = {}) {
  const provider = String(options.provider || process.env.CODEMAP_PROVIDER || 'graphify').toLowerCase();
  return CODEMAP_PROVIDERS.has(provider) ? provider : '';
}

function safePathSegment(value) {
  return String(value || 'project')
    .replace(/^[A-Za-z]:/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'project';
}

function canWriteDirectory(dir) {
  const probe = path.join(dir, `.write-test-${process.pid}-${Date.now()}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, 'ok', { flag: 'wx' });
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    try { fs.rmSync(probe, { force: true }); } catch { /* best effort */ }
    return false;
  }
}

function writableTempCodeGraphDir(root) {
  const baseCandidates = [process.env.TMP, process.env.TEMP, os.tmpdir(), process.platform === 'win32' ? 'C:\\tmp' : '/tmp']
    .filter(Boolean);
  const uniqueBases = [...new Set(baseCandidates.map((item) => path.resolve(item)))];
  const segment = safePathSegment(path.resolve(root));
  const candidates = uniqueBases.map((base) => path.join(base, 'pipeline-setupper-codegraph', segment));
  return candidates.find(canWriteDirectory) || candidates[candidates.length - 1];
}

function codeGraphRuntimePaths(root) {
  const projectCacheDir = path.join(root, '.tmp', 'codegraph');
  const cacheDir = canWriteDirectory(projectCacheDir) ? projectCacheDir : writableTempCodeGraphDir(root);
  return {
    cacheDir,
    lockFile: path.join(cacheDir, 'codegraph.lock'),
    lockPath: path.join(cacheDir, 'codegraph.lock'),
    projectCacheDir,
    fallbackCache: path.resolve(cacheDir) !== path.resolve(projectCacheDir),
  };
}

function readLockInfo(lockFile) {
  try {
    return JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  } catch {
    return {};
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function lockAgeMs(lockFile, info, now) {
  const createdAt = Date.parse(info.createdAt || '');
  if (Number.isFinite(createdAt)) return now() - createdAt;
  try {
    return now() - fs.statSync(lockFile).mtimeMs;
  } catch {
    return 0;
  }
}

function cleanupStaleCodeGraphLock(runtime, root, now) {
  if (!fs.existsSync(runtime.lockFile)) return { removed: false };
  const info = readLockInfo(runtime.lockFile);
  const sameOwner = !info.cwd || path.resolve(info.cwd) === path.resolve(root);
  const stale = lockAgeMs(runtime.lockFile, info, now) > CODEGRAPH_LOCK_STALE_MS;
  const alive = processIsAlive(Number(info.pid));
  if (!sameOwner || !stale || alive) return { removed: false, stale, alive };
  try {
    fs.rmSync(runtime.lockFile, { force: true });
    return { removed: true, stale, alive };
  } catch (error) {
    return { removed: false, stale, alive, error: error.message };
  }
}

function writeCodeGraphLock(handle, runtime, root, now) {
  const payload = {
    pid: process.pid,
    createdAt: new Date(now()).toISOString(),
    cwd: path.resolve(root),
    cachePath: runtime.cacheDir,
  };
  fs.writeFileSync(handle, JSON.stringify(payload, null, 2), 'utf8');
}

function codeGraphLockFailure(error, runtime) {
  return {
    status: 1,
    error: `CodeGraph runner lock unavailable: ${error.message}`,
    output: '',
    attemptedCommand: 'codegraph <locked>',
    cachePath: runtime.cacheDir,
    lockPath: runtime.lockFile,
    fallback: 'graphify',
  };
}

function withCodeGraphLock(root, run, now = Date.now) {
  const runtime = codeGraphRuntimePaths(root);
  fs.mkdirSync(runtime.cacheDir, { recursive: true });
  let handle = null;
  const started = now();
  while (!handle) {
    try {
      cleanupStaleCodeGraphLock(runtime, root, now);
      handle = fs.openSync(runtime.lockFile, 'wx');
      writeCodeGraphLock(handle, runtime, root, now);
    } catch (error) {
      if (error.code !== 'EEXIST' || now() - started >= CODEGRAPH_LOCK_TIMEOUT_MS) {
        return codeGraphLockFailure(error, runtime);
      }
    }
  }
  try {
    const completed = run(runtime);
    return { ...completed, cachePath: runtime.cacheDir, lockPath: runtime.lockFile };
  } finally {
    fs.closeSync(handle);
    fs.rmSync(runtime.lockFile, { force: true });
  }
}

function defaultCodeGraphRunner(root, args) {
  const isWindows = process.platform === 'win32';
  const command = isWindows ? 'cmd.exe' : 'codegraph';
  const finalArgs = isWindows ? ['/c', 'codegraph', ...args] : args;
  return withCodeGraphLock(root, (runtime) => {
    const completed = spawnSync(command, finalArgs, {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
      env: {
        ...process.env,
        CODEGRAPH_CACHE_DIR: runtime.cacheDir,
        XDG_CACHE_HOME: runtime.cacheDir,
      },
    });
    return {
      status: completed.status,
      error: completed.error && completed.error.message,
      output: `${completed.stdout || ''}${completed.stderr || ''}`.trim(),
      attemptedCommand: [command, ...finalArgs].join(' '),
    };
  });
}

function checkCodeGraphStatus(root, runner = defaultCodeGraphRunner) {
  const completed = runner(root, ['status']);
  const runtime = codeGraphRuntimePaths(root);
  const data = {
    attemptedCommand: completed.attemptedCommand || 'codegraph status',
    provider: 'codegraph',
    cachePath: completed.cachePath || runtime.cacheDir,
    lockPath: completed.lockPath || runtime.lockFile,
  };
  if (completed.status !== 0) {
    return result('warn', 'codemap:codegraph:cli', 'CodeGraph CLI provider not promotable', completed.error || completed.output, 'Keep CODEMAP_PROVIDER=graphify until CodeGraph CLI status works in this client.', {
      ...data,
      fallback: 'graphify',
    });
  }
  return result('pass', 'codemap:codegraph:cli', 'CodeGraph CLI provider promotable', 'codegraph status completed.', '', data);
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

function graphifyProviderChecks(root, options) {
  const checks = [checkGraphifyIgnoreConfig(root), checkGraphScope(root, options.graphPath), checkGraphStaleness(root, options.graphPath)];
  return options.relevance === false ? checks : [...checks, checkRelevance(root, options.runner)];
}

function codeGraphProviderChecks(root, options) {
  return [checkCodeGraphStatus(root, options.codegraphRunner)];
}

function runCodemapDoctor(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const provider = selectedProvider(options);
  const checks = provider === 'graphify'
    ? graphifyProviderChecks(root, options)
    : provider === 'codegraph'
      ? codeGraphProviderChecks(root, options)
      : [result('fail', 'codemap:provider', 'Codemap provider invalid', `Unknown provider: ${options.provider}`, 'Use graphify or codegraph.', { provider: options.provider })];
  const summary = checks.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  return { root: normalizeSlash(root), provider: provider || String(options.provider || ''), summary, checks };
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
  checkCodeGraphStatus,
  checkGraphifyIgnoreConfig,
  checkGraphScope,
  checkGraphStaleness,
  checkRelevance,
  ensureGraphifyIgnoreConfig,
  runCodemapDoctor,
  selectedProvider,
  setupCodemapProject,
  codeGraphRuntimePaths,
  withCodeGraphLock,
  formatCodemapReport,
  summarizeGraph,
};
