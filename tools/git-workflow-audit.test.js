#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runGitWorkflowAudit, checkArtifact, findProjectRoot, parseArgs, isDiskRoot, toMarkdown } = require('./git-workflow-audit');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`  PASS: ${name}\n`);
    passed++;
  } catch (error) {
    process.stdout.write(`  FAIL: ${name}\n    ${error.message}\n`);
    failed++;
  }
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function runGit(root, args) {
  const completed = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (completed.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${completed.stderr || completed.error}`);
  }
  return (completed.stdout || '').trim();
}

// --- parseArgs ---

test('parseArgs: defaults', () => {
  const result = parseArgs(['node', 'git-workflow-audit.js']);
  assert.equal(result.ok, true);
  assert.equal(result.value.json, false);
  assert.equal(result.value.markdown, false);
  assert.equal(result.value.write, true);
});

test('parseArgs: --json --markdown --no-write --root flags', () => {
  const result = parseArgs(['node', 'git-workflow-audit.js', '--json', '--markdown', '--no-write', '--root', 'C:\\project']);
  assert.equal(result.ok, true);
  assert.equal(result.value.json, true);
  assert.equal(result.value.markdown, true);
  assert.equal(result.value.write, false);
  assert.equal(result.value.root, 'C:\\project');
});

test('parseArgs: --root requires path', () => {
  const result = parseArgs(['node', 'git-workflow-audit.js', '--root']);
  assert.equal(result.ok, false);
  assert.match(result.error, /--root requires/);
});

test('parseArgs: unknown flag returns error', () => {
  const result = parseArgs(['node', 'git-workflow-audit.js', '--unknown']);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unknown argument/);
});

// --- isDiskRoot ---

test('isDiskRoot: C:\\ returns true', () => {
  assert.equal(isDiskRoot('C:\\'), true);
  assert.equal(isDiskRoot('C:/'), true);
  assert.equal(isDiskRoot('c:/'), true);
});

test('isDiskRoot: project path returns false', () => {
  assert.equal(isDiskRoot('C:\\Claude playground\\Pipiline setupper'), false);
  assert.equal(isDiskRoot('C:/Claude playground/Pipiline setupper'), false);
});

test('isDiskRoot: D:\\ returns true', () => {
  assert.equal(isDiskRoot('D:\\'), true);
  assert.equal(isDiskRoot('D:/'), true);
});

// --- findProjectRoot ---

test('findProjectRoot: finds dir with AGENTS.md', () => {
  const root = tempDir('git-audit-root');
  write(path.join(root, 'AGENTS.md'), '# Test');
  const nested = path.join(root, 'src', 'lib');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findProjectRoot(nested), root);
});

test('findProjectRoot: finds dir with CLAUDE.md', () => {
  const root = tempDir('git-audit-root2');
  write(path.join(root, 'CLAUDE.md'), '# Test');
  assert.equal(findProjectRoot(root), root);
});

test('findProjectRoot: returns start when no marker found (filesystem root)', () => {
  // When no markers exist anywhere, returns filesystem root (path.dirname(x) === x)
  const root = findProjectRoot(os.tmpdir());
  assert.ok(typeof root === 'string' && root.length > 0);
});

// --- checkArtifact ---

test('checkArtifact: missing file returns not ok', () => {
  const root = tempDir('git-audit-artifact');
  const result = checkArtifact(root);
  assert.equal(result.ok, false);
});

test('checkArtifact: fresh artifact returns ok and not stale', () => {
  const root = tempDir('git-audit-artifact2');
  const now = new Date();
  const artifact = { generatedAt: now.toISOString(), summary: { status: 'pass' }, checks: [] };
  write(path.join(root, '.planning', 'git-workflow-audit-latest.json'), JSON.stringify(artifact));
  const result = checkArtifact(root, now);
  assert.equal(result.ok, true);
  assert.equal(result.stale, false);
});

test('checkArtifact: stale artifact (>24h) returns stale=true', () => {
  const root = tempDir('git-audit-artifact3');
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const artifact = { generatedAt: old.toISOString(), summary: { status: 'pass' }, checks: [] };
  write(path.join(root, '.planning', 'git-workflow-audit-latest.json'), JSON.stringify(artifact));
  const now = new Date();
  const result = checkArtifact(root, now);
  assert.equal(result.ok, true);
  assert.equal(result.stale, true);
});

test('checkArtifact: invalid JSON returns not ok', () => {
  const root = tempDir('git-audit-artifact4');
  write(path.join(root, '.planning', 'git-workflow-audit-latest.json'), 'not json {{{');
  const result = checkArtifact(root);
  assert.equal(result.ok, false);
});

// --- toMarkdown ---

test('toMarkdown: returns string with project root and checks', () => {
  const audit = {
    generatedAt: new Date().toISOString(),
    projectRoot: '/test/project',
    gitRoot: '/test/project',
    branch: 'main',
    summary: { status: 'pass', pass: 1, warn: 0, fail: 0, total: 1 },
    checks: [
      { status: 'pass', id: 'git:root', title: 'Git root is scoped to project', detail: 'gitRoot=/test/project', repair: '' },
    ],
  };
  const md = toMarkdown(audit);
  assert.ok(md.includes('/test/project'));
  assert.ok(md.includes('PASS'));
  assert.ok(md.includes('git:root'));
});

test('toMarkdown: includes repair text for warn checks', () => {
  const audit = {
    generatedAt: new Date().toISOString(),
    projectRoot: 'C:/project',
    gitRoot: 'C:/',
    branch: 'main',
    summary: { status: 'warn', pass: 0, warn: 1, fail: 0, total: 1 },
    checks: [
      { status: 'warn', id: 'git:root-is-disk', title: 'Git root is disk root', detail: 'gitRoot=C:/', repair: 'Use -- .' },
    ],
  };
  const md = toMarkdown(audit);
  assert.ok(md.includes('Use -- .'));
  assert.ok(md.includes('git:root-is-disk'));
});

// --- runGitWorkflowAudit integration (live, no-write) ---

test('runGitWorkflowAudit: runs against real project dir without writing', () => {
  const cwd = path.resolve(__dirname, '..');
  const audit = runGitWorkflowAudit({ root: cwd, write: false });
  assert.ok(audit && typeof audit === 'object', 'returns audit object');
  assert.ok(typeof audit.generatedAt === 'string', 'has generatedAt');
  assert.ok(typeof audit.projectRoot === 'string', 'has projectRoot');
  assert.ok(Array.isArray(audit.checks), 'checks is array');
  assert.ok(audit.checks.length > 0, 'at least one check');
  assert.ok(['pass', 'warn', 'fail'].includes(audit.summary.status), 'valid status');
});

test('runGitWorkflowAudit: real project detects disk-root git repo (C:\\ known issue)', () => {
  const cwd = path.resolve(__dirname, '..');
  const audit = runGitWorkflowAudit({ root: cwd, write: false });
  const gitRootCheck = audit.checks.find((c) => c.id === 'git:root-is-disk' || c.id === 'git:root' || c.id === 'git:root-mismatch' || c.id === 'git:dubious-ownership');
  assert.ok(gitRootCheck, 'has git root check result');
  // disk-root issue is known in this repo — should be warn or pass depending on git config
  assert.ok(['pass', 'warn'].includes(gitRootCheck.status), 'git root is pass or warn');
});

test('runGitWorkflowAudit: writes artifact when write=true', () => {
  const root = tempDir('git-audit-write');
  write(path.join(root, 'AGENTS.md'), '# Test project\n## Overview\n## Stack\n## Commands\n## Architecture\n## Gotchas\n## Current State');
  // This temp dir has no git, so gitRoot check will warn — that's expected
  const audit = runGitWorkflowAudit({ root, write: true });
  const jsonPath = path.join(root, '.planning', 'git-workflow-audit-latest.json');
  const mdPath = path.join(root, '.planning', 'git-workflow-audit-latest.md');
  assert.ok(fs.existsSync(jsonPath), 'JSON artifact written');
  assert.ok(fs.existsSync(mdPath), 'Markdown artifact written');
  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.equal(parsed.generatedAt, audit.generatedAt);
});

test('runGitWorkflowAudit: generated planning state does not dirty-block closeout', () => {
  const root = tempDir('git-audit-generated');
  write(path.join(root, 'AGENTS.md'), '# Test project\n## Overview\n## Stack\n## Commands\n## Architecture\n## Gotchas\n## Current State');
  runGit(root, ['init']);
  runGit(root, ['config', 'user.email', 'codex@example.test']);
  runGit(root, ['config', 'user.name', 'Codex Test']);
  runGit(root, ['add', 'AGENTS.md']);
  runGit(root, ['commit', '-m', 'init']);

  write(path.join(root, '.planning', 'harness-checklist-latest.json'), '{}\n');
  write(path.join(root, '.planning', 'harness-checklist-latest.md'), '# Latest\n');
  write(path.join(root, '.planning', 'CHECKPOINT-2026-05-30-p2.2.md'), '# Checkpoint\n');

  const audit = runGitWorkflowAudit({ root, write: false });
  const dirty = audit.checks.find((c) => c.id === 'git:dirty');
  assert.equal(dirty.status, 'pass');
  assert.match(dirty.detail, /Only generated planning artifacts modified \(3\)/);
  assert.equal(audit.summary.status, 'pass');
});

// --- summary ---

process.stdout.write(`\ngit-workflow-audit.test.js\n`);
process.stdout.write(`  ${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
