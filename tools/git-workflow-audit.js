#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// ponytail: inlined from the retired pipeline-state module (spec 005 T019) — one-liner.
function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/');
}

// 021/T009 — на windows-latest os.tmpdir() отдаёт 8.3-короткое имя (RUNNER~1), а
// `git rev-parse --show-toplevel` для того же каталога отдаёт длинную форму (runneradmin).
// Строковое сравнение этих двух представлений одного и того же пути никогда не совпадёт —
// см. тот же класс бага в tools/judge-core.js (externalRepoScopes).
function canonicalPath(value) {
  try {
    const resolved = fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
    return resolved.replace(/\\/g, '/');
  } catch {
    return normalizePath(value);
  }
}

const GIT_WORKFLOW_AUDIT_TTL_MS = 24 * 60 * 60 * 1000;
const PLANNING_DIR = '.planning';
const AUDIT_FILE_BASE = 'git-workflow-audit-latest';
const GENERATED_PLANNING_PATTERNS = [
  /\.planning[\\/][^\\/]+-latest\.(json|md)$/,
  /\.planning[\\/]CHECKPOINT-\d{4}-\d{2}-\d{2}-.+\.md$/,
];

function result(status, id, title, detail, repair, data = {}) {
  return { status, id, title, detail, repair, data };
}

function readText(file) {
  try {
    return { ok: true, value: fs.readFileSync(file, 'utf8') };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function parseArgs(argv) {
  const defaults = { root: process.cwd(), json: false, markdown: false, write: true };
  const parseNext = (index, state) => {
    if (index >= argv.length) return { ok: true, value: state };
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--markdown') return parseNext(index + 1, { ...state, markdown: true });
    if (arg === '--no-write') return parseNext(index + 1, { ...state, write: false });
    if (arg === '--root') {
      const val = argv[index + 1];
      if (!val) return { ok: false, error: '--root requires a path' };
      return parseNext(index + 2, { ...state, root: val });
    }
    return { ok: false, error: `Unknown argument: ${arg}` };
  };
  return parseNext(2, defaults);
}

function findProjectRoot(start) {
  const current = path.resolve(start || process.cwd());
  const parent = path.dirname(current);
  const markers = ['AGENTS.md', 'CLAUDE.md', '.rag'];
  const found = markers.some((m) => fs.existsSync(path.join(current, m)));
  if (found || parent === current) return current;
  return findProjectRoot(parent);
}

function git(args, cwd, timeout = 5000) {
  const completed = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });
  return {
    status: completed.status,
    stdout: (completed.stdout || '').trim(),
    stderr: (completed.stderr || '').trim(),
    error: completed.error && completed.error.message,
  };
}

function isDubiousOwnership(stderr) {
  return /dubious ownership/i.test(stderr) || /detected dubious ownership/i.test(stderr);
}

// Распознаются ОБЕ формы корня независимо от того, на какой ОС исполняется код: `path.parse`
// на POSIX не знает про буквы дисков и считает 'C:/' обычным относительным именем, поэтому
// проверка молча теряла смысл на Linux — тест был зелёным на Windows и красным в CI. Путь в
// отчёте может прийти и с другой машины: «репозиторий в корне диска C:» обязан оставаться
// распознанным где угодно.
function isDiskRoot(absPath) {
  const raw = String(absPath || '');
  if (/^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+[\\/]?$/.test(raw)) return true;
  // Windows drive root (C:\, C:/, c:/) is a root regardless of the host platform:
  // path.resolve() only understands drive letters on win32, so on Linux CI the
  // normalized check below silently misses "C:\" — it must be recognized from the
  // raw string, not from a platform-dependent resolve().
  if (/^[a-zA-Z]:[\\/]?$/.test(raw)) return true;
  const normalized = normalizePath(absPath);
  if (normalized === '/') return true;
  return /^[a-zA-Z]:\/?$/.test(normalized);
}

function gitStatusPath(statusLine) {
  const pathText = statusLine.replace(/^[ MARCUD?!]{1,2}\s+/, '');
  const primaryPath = pathText.includes(' -> ') ? pathText.split(' -> ').pop() : pathText;
  return primaryPath.trim().replace(/^"|"$/g, '');
}

function isGeneratedPlanningArtifact(statusLine) {
  const filePath = gitStatusPath(statusLine);
  return GENERATED_PLANNING_PATTERNS.some((pattern) => pattern.test(filePath));
}

function checkGitRoot(projectRoot) {
  // '--show-toplevel' does not accept path arguments; '-- .' would appear in stdout
  const revParse = git(['rev-parse', '--show-toplevel'], projectRoot);

  if (isDubiousOwnership(revParse.stderr)) {
    return [
      result(
        'warn',
        'git:dubious-ownership',
        'Dubious ownership detected',
        revParse.stderr.split('\n')[0].trim(),
        'Run: git config --global --add safe.directory <path>  OR set CODEX_SANDBOX_SAFE_DIR=1 in env. Do not mutate global git config automatically.',
        { projectRoot, suggestion: `git config --global --add safe.directory "${projectRoot}"` },
      ),
    ];
  }

  if (revParse.status !== 0 || !revParse.stdout) {
    return [
      result(
        'warn',
        'git:root',
        'Git root not found',
        revParse.stderr || revParse.error || 'git rev-parse failed',
        'Run git-workflow-audit from inside a git repository.',
        { projectRoot },
      ),
    ];
  }

  const gitRoot = normalizePath(revParse.stdout);
  const normalizedProject = normalizePath(projectRoot);

  if (isDiskRoot(gitRoot)) {
    return [
      result(
        'warn',
        'git:root-is-disk',
        'Git root is disk root — entire drive is a git repo',
        `gitRoot=${gitRoot}  projectRoot=${normalizedProject}`,
        'All git commands must use "-- ." to scope output to the project directory. Never run git status/log/diff without -- . in this repo.',
        { gitRoot, projectRoot: normalizedProject, isDiskRoot: true },
      ),
    ];
  }

  const gitRootLower = gitRoot.toLowerCase();
  const projectRootLower = normalizedProject.toLowerCase();
  const rawMismatch = !projectRootLower.startsWith(gitRootLower + '/') && projectRootLower !== gitRootLower;
  // Строковое сравнение выше даёт ложный mismatch на 8.3-именах (см. canonicalPath) —
  // прежде чем объявить mismatch, сверяем канонические (realpath) формы обеих сторон.
  const mismatch = rawMismatch
    ? (() => {
        const gitRootCanon = canonicalPath(revParse.stdout).toLowerCase();
        const projectRootCanon = canonicalPath(projectRoot).toLowerCase();
        return !projectRootCanon.startsWith(gitRootCanon + '/') && projectRootCanon !== gitRootCanon;
      })()
    : false;

  if (mismatch) {
    return [
      result(
        'warn',
        'git:root-mismatch',
        'Git root is outside project root',
        `gitRoot=${gitRoot}  projectRoot=${normalizedProject}`,
        'Verify you are working from the correct directory. Use -- . to scope all git commands.',
        { gitRoot, projectRoot: normalizedProject },
      ),
    ];
  }

  return [
    result(
      'pass',
      'git:root',
      'Git root is scoped to project',
      `gitRoot=${gitRoot}`,
      '',
      { gitRoot, projectRoot: normalizedProject, isDiskRoot: false },
    ),
  ];
}

function checkBranch(projectRoot) {
  const branch = git(['branch', '--show-current'], projectRoot);
  if (branch.status !== 0 || !branch.stdout) {
    const detached = git(['rev-parse', '--short', 'HEAD'], projectRoot);
    return [
      result(
        'warn',
        'git:branch',
        'Detached HEAD or branch unknown',
        branch.stderr || 'No branch name',
        'Check out a named branch before committing.',
        { branch: null, headSha: detached.stdout || null },
      ),
    ];
  }
  return [
    result('pass', 'git:branch', 'Branch detected', branch.stdout, '', { branch: branch.stdout }),
  ];
}

function checkDirtyFiles(projectRoot) {
  // Always scope with -- . to prevent capturing C:\ level changes
  const status = git(['status', '--short', '--untracked-files=all', '--', '.'], projectRoot);

  if (isDubiousOwnership(status.stderr)) {
    return [
      result(
        'warn',
        'git:dirty',
        'Dirty file check skipped — dubious ownership',
        status.stderr.split('\n')[0].trim(),
        'Resolve safe.directory first, then rerun git-workflow-audit.',
        {},
      ),
    ];
  }

  if (status.status !== 0) {
    return [
      result(
        'warn',
        'git:dirty',
        'Dirty file check failed',
        status.stderr || status.error || 'git status failed',
        'Run git status --short -- . manually to investigate.',
        {},
      ),
    ];
  }

  const lines = status.stdout ? status.stdout.split('\n').filter(Boolean) : [];

  const generatedLines = lines.filter(isGeneratedPlanningArtifact);
  const significantLines = lines.filter((line) => !isGeneratedPlanningArtifact(line));
  const count = significantLines.length;

  if (count === 0) {
    const detail = lines.length > 0
      ? `Only generated planning artifacts modified (${generatedLines.length})`
      : 'git status --short -- . returned no changes.';
    return [result('pass', 'git:dirty', 'Working tree clean (scoped)', detail, '', { count: 0, files: [], ignored: generatedLines.slice(0, 20) })];
  }

  return [
    result(
      'warn',
      'git:dirty',
      `${count} uncommitted change(s) in project scope`,
      significantLines.slice(0, 10).join('; '),
      'Commit or stash changes before session closeout.',
      { count, files: significantLines.slice(0, 20) },
    ),
  ];
}

function checkSafeDirectoryGuidance(projectRoot) {
  const revParse = git(['rev-parse', '--show-toplevel'], projectRoot);
  if (!isDubiousOwnership(revParse.stderr)) return [];

  return [
    result(
      'warn',
      'git:safe-directory',
      'safe.directory guidance: manual action required',
      'Codex/Claude sandbox may run as a different user, causing "dubious ownership" errors.',
      [
        'Option 1 (global, manual): git config --global --add safe.directory <path>',
        'Option 2 (per-session env): CODEX_SANDBOX_SAFE_DIR=<path>',
        'NEVER run git config --global automatically from hooks or tools.',
      ].join(' | '),
      { projectRoot },
    ),
  ];
}

function checkScopeEnforcement(projectRoot) {
  // Advisory: remind all callers to use -- . for git commands in wide git roots
  const revParse = git(['rev-parse', '--show-toplevel'], projectRoot);
  if (revParse.status !== 0 || !revParse.stdout) return [];

  const gitRoot = normalizePath(revParse.stdout);
  if (!isDiskRoot(gitRoot)) return [];

  return [
    result(
      'warn',
      'git:scope-enforcement',
      'All git commands must use -- . in this repo',
      `gitRoot=${gitRoot} covers the entire disk. git status/log/diff without -- . will include unrelated projects.`,
      'Update all hooks and scripts to append "-- ." to git status, git log, git diff when run from project directories.',
      { gitRoot, projectRoot: normalizePath(projectRoot) },
    ),
  ];
}

function runGitWorkflowAudit({ root, write = true, now = new Date() }) {
  const projectRoot = findProjectRoot(root);
  const checks = [
    ...checkGitRoot(projectRoot),
    ...checkBranch(projectRoot),
    ...checkDirtyFiles(projectRoot),
    ...checkSafeDirectoryGuidance(projectRoot),
    ...checkScopeEnforcement(projectRoot),
  ];

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const warnCount = checks.filter((c) => c.status === 'warn').length;
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const overallStatus = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass';

  const gitRootResult = checks.find((c) => c.id === 'git:root' || c.id === 'git:root-is-disk' || c.id === 'git:root-mismatch');
  const branchResult = checks.find((c) => c.id === 'git:branch');

  const audit = {
    generatedAt: now.toISOString(),
    projectRoot: normalizePath(projectRoot),
    gitRoot: gitRootResult && gitRootResult.data && gitRootResult.data.gitRoot
      ? gitRootResult.data.gitRoot
      : null,
    branch: branchResult && branchResult.data && branchResult.data.branch
      ? branchResult.data.branch
      : null,
    summary: {
      status: overallStatus,
      pass: passCount,
      warn: warnCount,
      fail: failCount,
      total: checks.length,
    },
    checks,
  };

  if (write) {
    const planDir = path.join(projectRoot, PLANNING_DIR);
    fs.mkdirSync(planDir, { recursive: true });
    const jsonPath = path.join(planDir, `${AUDIT_FILE_BASE}.json`);
    const mdPath = path.join(planDir, `${AUDIT_FILE_BASE}.md`);
    fs.writeFileSync(jsonPath, JSON.stringify(audit, null, 2) + '\n', 'utf8');
    fs.writeFileSync(mdPath, toMarkdown(audit), 'utf8');
  }

  return audit;
}

function toMarkdown(audit) {
  const statusIcon = { pass: '✅', warn: '⚠️', fail: '❌' };
  const lines = [
    `# Git Workflow Audit`,
    ``,
    `Generated: ${audit.generatedAt}`,
    `Project root: \`${audit.projectRoot}\``,
    `Git root: \`${audit.gitRoot || 'unknown'}\``,
    `Branch: \`${audit.branch || 'unknown'}\``,
    ``,
    `## Summary`,
    ``,
    `Status: **${audit.summary.status.toUpperCase()}** — ${audit.summary.pass} pass / ${audit.summary.warn} warn / ${audit.summary.fail} fail`,
    ``,
    `## Checks`,
    ``,
  ];

  for (const check of audit.checks) {
    const icon = statusIcon[check.status] || '?';
    lines.push(`### ${icon} ${check.title}`);
    lines.push(`**ID:** \`${check.id}\`  **Status:** ${check.status}`);
    lines.push(`**Detail:** ${check.detail}`);
    if (check.repair) lines.push(`**Repair:** ${check.repair}`);
    lines.push('');
  }

  return lines.join('\n');
}

function checkArtifact(root, now = new Date()) {
  const file = path.join(root, PLANNING_DIR, `${AUDIT_FILE_BASE}.json`);
  const text = readText(file);
  if (!text.ok) return { ok: false, error: text.error };
  try {
    const value = JSON.parse(text.value);
    const generatedAt = typeof value.generatedAt === 'string' ? new Date(value.generatedAt) : null;
    const stale = !generatedAt || Number.isNaN(generatedAt.getTime())
      || now.getTime() - generatedAt.getTime() > GIT_WORKFLOW_AUDIT_TTL_MS;
    return { ok: true, value, stale, file };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

if (require.main === module) {
  const parsed = parseArgs(process.argv);
  if (!parsed.ok) {
    process.stderr.write(`Error: ${parsed.error}\n`);
    process.exit(1);
  }
  const { root, json, markdown, write } = parsed.value;
  const audit = runGitWorkflowAudit({ root, write });

  if (json) {
    process.stdout.write(JSON.stringify(audit, null, 2) + '\n');
  } else if (markdown) {
    process.stdout.write(toMarkdown(audit) + '\n');
  } else {
    const icon = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
    process.stdout.write(`Git Workflow Audit — ${icon[audit.summary.status] || audit.summary.status}\n`);
    process.stdout.write(`  projectRoot: ${audit.projectRoot}\n`);
    process.stdout.write(`  gitRoot:     ${audit.gitRoot || 'unknown'}\n`);
    process.stdout.write(`  branch:      ${audit.branch || 'unknown'}\n`);
    process.stdout.write(`  checks:      ${audit.summary.pass}P / ${audit.summary.warn}W / ${audit.summary.fail}F\n`);
    for (const check of audit.checks) {
      if (check.status !== 'pass') {
        process.stdout.write(`  [${check.status.toUpperCase()}] ${check.id}: ${check.detail}\n`);
        if (check.repair) process.stdout.write(`         repair: ${check.repair}\n`);
      }
    }
  }

  process.exit(audit.summary.status === 'fail' ? 1 : 0);
}

module.exports = { runGitWorkflowAudit, checkArtifact, findProjectRoot, parseArgs, isDiskRoot, toMarkdown };
