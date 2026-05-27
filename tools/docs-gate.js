#!/usr/bin/env node
'use strict';

/**
 * tools/docs-gate.js — Docs Delta Gate v1 (P4.2)
 *
 * Checks whether AI documentation was updated when significant code changes exist.
 * Blocks closeout (exit 2 with --strict) when complex changes have no docs delta.
 *
 * Flags:
 *   --root <path>   Project root (default: cwd)
 *   --json          Output JSON
 *   --write         Write .planning/docs-gate-latest.{json,md}
 *   --strict        Exit 2 when status is 'fail'
 *                   (P5.1 Agent Harness will call this to gate run closeout)
 *
 * Complexity (aligned with pipeline-state.js taxonomy):
 *   TRIVIAL  < 2 code files, no hooks/tools changes
 *   MEDIUM   2–6 code files OR 1–2 tools/*.js files
 *   COMPLEX  7+ code files OR 3+ tools/*.js OR 2+ hooks/*.js
 *
 * Docs delta — any of:
 *   AGENTS.md, CLAUDE.md, .gemini/GEMINI.md, CHANGELOG.md, README.md,
 *   .planning/ARCHITECTURE-*.md, ADR-*.md, MEMORY.md
 *
 * Gate result:
 *   TRIVIAL  → pass  (docs not required)
 *   MEDIUM   → warn  (docs recommended)
 *   COMPLEX  → fail  (docs required; --strict exits 2)
 *   test-only → pass (test files exempt)
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CANONICAL_DOC } = require('./project-docs-core');

const PLANNING_DIR = '.planning';
const ARTIFACT_BASE = 'docs-gate-latest';
const TTL_MS = 24 * 60 * 60 * 1000;

// ── File type constants ───────────────────────────────────────────────────────

const CODE_EXTS = new Set([
  '.js', '.mjs', '.mts', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.go', '.rs', '.java', '.cs', '.rb', '.php',
  '.swift', '.kt', '.vue', '.svelte', '.c', '.cpp', '.h',
]);
const TEST_RE = /\.(test|spec)\.(js|ts|mjs|mts|jsx|tsx)$|(?:^|[/\\])__tests__[/\\]/;
const HOOK_RE = /(?:^|[/\\])hooks[/\\][^/\\]+\.js$/;
const TOOL_RE = /^tools[/\\][^/\\]+\.js$/;
const DOC_NAMES = new Set(['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CHANGELOG.md', 'README.md', 'MEMORY.md']);
const DOC_PATH_RE = /\.planning[/\\]ARCHITECTURE-|ADR-[^/\\]*\.md$|\.gemini[/\\]/;

// ── File classifier ───────────────────────────────────────────────────────────

/**
 * @param {string} relPath  — path relative to project root
 * @returns {'docs'|'test'|'hook'|'tool'|'code'|'other'}
 */
function classifyFile(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  const base = path.basename(relPath);
  const ext = path.extname(relPath).toLowerCase();

  if (DOC_NAMES.has(base) || DOC_PATH_RE.test(norm)) return 'docs';
  if (TEST_RE.test(norm)) return 'test';
  if (HOOK_RE.test(norm)) return 'hook';
  if (TOOL_RE.test(norm)) return 'tool';
  if (CODE_EXTS.has(ext)) return 'code';
  return 'other';
}

// ── Complexity classifier ─────────────────────────────────────────────────────

/**
 * @param {{ code: number, tool: number, hook: number }} counts
 * @returns {'TRIVIAL'|'MEDIUM'|'COMPLEX'}
 */
function classifyComplexity(counts) {
  const { code = 0, tool = 0, hook = 0 } = counts;
  if (hook >= 2 || tool >= 3 || code + tool + hook >= 7) return 'COMPLEX';
  if (tool >= 1 || code + tool + hook >= 2) return 'MEDIUM';
  return 'TRIVIAL';
}

// ── Docs delta analysis ───────────────────────────────────────────────────────

/**
 * Pure analysis — accepts pre-built file list for unit testing.
 * @param {Array<{file: string, status: string}>} changedFiles
 * @param {boolean} agentsExists
 * @returns analysis object consumed by buildReport()
 */
function analyzeChanges(changedFiles, agentsExists = true) {
  const counts = { code: 0, tool: 0, hook: 0, docs: 0, test: 0, other: 0 };
  const codeFiles = [];
  const docsFiles = [];

  for (const { file } of changedFiles) {
    const kind = classifyFile(file);
    counts[kind] = (counts[kind] || 0) + 1;
    if (kind === 'code' || kind === 'tool' || kind === 'hook') codeFiles.push(file);
    if (kind === 'docs') docsFiles.push(file);
  }

  const complexity = classifyComplexity(counts);
  const hasDocsDelta = docsFiles.length > 0;
  const testOnly = counts.code === 0 && counts.tool === 0 && counts.hook === 0 && counts.test > 0;
  const noChanges = changedFiles.length === 0;

  return { counts, codeFiles, docsFiles, complexity, hasDocsDelta, testOnly, noChanges, agentsExists };
}

/**
 * Build checks array and summary from analysis result.
 * @param {ReturnType<analyzeChanges>} analysis
 * @returns {{ checks: object[], summary: object }}
 */
function buildChecks(analysis) {
  const { complexity, codeFiles, docsFiles, hasDocsDelta, testOnly, noChanges, agentsExists } = analysis;
  const checks = [];

  // check: docs:delta
  if (noChanges) {
    checks.push({ id: 'docs:no-changes', status: 'pass', detail: 'No changed files — docs gate skipped', repair: '' });
  } else if (testOnly) {
    checks.push({ id: 'docs:test-only', status: 'pass', detail: 'Only test files changed — docs delta not required', repair: '' });
  } else if (complexity === 'TRIVIAL') {
    checks.push({ id: 'docs:trivial', status: 'pass', detail: `Trivial change (${codeFiles.length} code file(s)) — docs delta not required`, repair: '' });
  } else if (hasDocsDelta) {
    checks.push({ id: 'docs:delta', status: 'pass', detail: `Docs updated: ${docsFiles.join(', ')}`, repair: '' });
  } else if (complexity === 'MEDIUM') {
    checks.push({
      id: 'docs:delta',
      status: 'warn',
      detail: `MEDIUM change (${codeFiles.length} code file(s)) but no docs delta — docs recommended`,
      repair: `Update ${CANONICAL_DOC} Current State section, then run /sync-docs.`,
    });
  } else {
    // COMPLEX
    checks.push({
      id: 'docs:delta',
      status: 'fail',
      detail: `COMPLEX change (${codeFiles.length} code file(s)) with no docs delta — docs update required`,
      repair: `Update ${CANONICAL_DOC} (Current State + Architecture). Run /sync-docs. P5.1 hookup pending.`,
    });
  }

  // check: docs:canonical
  if (!agentsExists) {
    checks.push({
      id: 'docs:canonical',
      status: 'warn',
      detail: `${CANONICAL_DOC} (canonical AI doc) not found at project root`,
      repair: 'Run Skill(skill="init-project") to create project docs.',
    });
  } else {
    checks.push({ id: 'docs:canonical', status: 'pass', detail: `${CANONICAL_DOC} exists`, repair: '' });
  }

  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');
  const pass = checks.filter((c) => c.status === 'pass').length;
  const warn = checks.filter((c) => c.status === 'warn').length;
  const fail = checks.filter((c) => c.status === 'fail').length;

  return {
    checks,
    summary: { status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass', pass, warn, fail },
  };
}

// ── Git helpers ───────────────────────────────────────────────────────────────

function gitChangedFiles(cwd) {
  const results = new Map();

  // HEAD diff (committed changes vs HEAD)
  const headDiff = spawnSync('git', ['diff', '--name-status', 'HEAD', '--', '.'], {
    cwd, encoding: 'utf8', timeout: 5000,
  });
  if (headDiff.status === 0 && headDiff.stdout) {
    for (const line of headDiff.stdout.trim().split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const file = parts[parts.length - 1].trim();
      if (file) results.set(file, parts[0] || 'M');
    }
  }

  // Status (staged + unstaged + untracked)
  const statusOut = spawnSync('git', ['status', '--porcelain', '--', '.'], {
    cwd, encoding: 'utf8', timeout: 5000,
  });
  if (statusOut.status === 0 && statusOut.stdout) {
    for (const line of statusOut.stdout.trim().split('\n').filter(Boolean)) {
      const file = line.substring(3).trim().replace(/^"(.*)"$/, '$1');
      if (file && !results.has(file)) results.set(file, line.substring(0, 2).trim() || '?');
    }
  }

  return [...results.entries()].map(([file, status]) => ({ file, status }));
}

// ── Core runner ───────────────────────────────────────────────────────────────

function runDocsGate({ root: rawRoot, write = false } = {}) {
  const root = path.resolve(rawRoot || process.cwd());
  const generatedAt = new Date().toISOString();
  const projectRoot = root.replace(/\\/g, '/');

  // Skip if not a git repo
  const gitCheck = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: root, encoding: 'utf8', timeout: 3000,
  });
  if (gitCheck.status !== 0) {
    const report = {
      generatedAt,
      projectRoot,
      skip: true,
      skipReason: 'Not a git repository',
      complexity: 'TRIVIAL',
      codeChanged: [],
      docsChanged: [],
      summary: { status: 'pass', pass: 1, warn: 0, fail: 0 },
      checks: [{ id: 'docs:no-git', status: 'pass', detail: 'Not a git repo — docs gate skipped', repair: '' }],
    };
    if (write) writeArtifact(root, report);
    return report;
  }

  const changedFiles = gitChangedFiles(root);
  const agentsExists = fs.existsSync(path.join(root, CANONICAL_DOC));
  const analysis = analyzeChanges(changedFiles, agentsExists);
  const { checks, summary } = buildChecks(analysis);

  const report = {
    generatedAt,
    projectRoot,
    complexity: analysis.complexity,
    codeChanged: analysis.codeFiles,
    docsChanged: analysis.docsFiles,
    summary,
    checks,
  };

  if (write) writeArtifact(root, report);
  return report;
}

// ── Artifact I/O ──────────────────────────────────────────────────────────────

function writeArtifact(root, report) {
  const dir = path.join(root, PLANNING_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ARTIFACT_BASE}.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, `${ARTIFACT_BASE}.md`), toMarkdown(report) + '\n', 'utf8');
}

function toMarkdown(report) {
  const icon = { pass: '✅', warn: '⚠️', fail: '❌' };
  const lines = [
    '# Docs Gate',
    '',
    `Generated: ${report.generatedAt}`,
    `Project root: \`${report.projectRoot}\``,
    `Complexity: **${report.complexity}**`,
    '',
    '## Summary',
    '',
    `Status: **${report.summary.status.toUpperCase()}** — ${report.summary.pass} pass / ${report.summary.warn} warn / ${report.summary.fail} fail`,
    '',
    '## Changed Files',
    '',
    `Code: ${report.codeChanged.length > 0 ? report.codeChanged.join(', ') : '(none)'}`,
    `Docs: ${report.docsChanged.length > 0 ? report.docsChanged.join(', ') : '(none)'}`,
    '',
    '## Checks',
    '',
  ];
  for (const check of report.checks) {
    lines.push(`### ${icon[check.status] || '?'} \`${check.id}\``);
    lines.push(`**Status:** ${check.status}  **Detail:** ${check.detail}`);
    if (check.repair) lines.push(`**Repair:** ${check.repair}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * checkArtifact — used by doctor-core.js to read the latest report.
 * @param {string} root
 * @param {Date} now
 */
function checkArtifact(root, now = new Date()) {
  const file = path.join(root, PLANNING_DIR, `${ARTIFACT_BASE}.json`);
  try {
    const text = fs.readFileSync(file, 'utf8');
    const value = JSON.parse(text);
    const generatedAt = typeof value.generatedAt === 'string' ? new Date(value.generatedAt) : null;
    const stale = !generatedAt || Number.isNaN(generatedAt.getTime())
      || now.getTime() - generatedAt.getTime() > TTL_MS;
    return { ok: true, value, stale, file };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { root: process.cwd(), json: false, strict: false, write: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) opts.root = args[++i];
    else if (args[i] === '--json') opts.json = true;
    else if (args[i] === '--strict') opts.strict = true;
    else if (args[i] === '--write') opts.write = true;
  }
  return { ok: true, value: opts };
}

if (require.main === module) {
  const { value: opts } = parseArgs(process.argv);
  const report = runDocsGate({ root: opts.root, write: opts.write });

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
    process.stdout.write(`Docs Gate — ${icon[report.summary.status] || report.summary.status}\n`);
    process.stdout.write(`  complexity: ${report.complexity}\n`);
    process.stdout.write(`  code:       ${report.codeChanged.length} file(s)\n`);
    process.stdout.write(`  docs:       ${report.docsChanged.length} file(s)` +
      (report.docsChanged.length ? ` (${report.docsChanged.join(', ')})` : '') + '\n');
    for (const check of report.checks) {
      if (check.status !== 'pass') {
        process.stdout.write(`  [${check.status.toUpperCase()}] ${check.id}: ${check.detail}\n`);
        if (check.repair) process.stdout.write(`         repair: ${check.repair}\n`);
      }
    }
  }

  // --strict: exit 2 when docs gate fails (P5.1 Agent Harness hookup pending)
  if (opts.strict && report.summary.status === 'fail') process.exit(2);
  process.exit(report.summary.status === 'fail' ? 1 : 0);
}

module.exports = { runDocsGate, analyzeChanges, buildChecks, classifyFile, classifyComplexity, checkArtifact, toMarkdown, parseArgs };
