'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  auditProjects,
  formatTextReport,
  parseArgs,
} = require('./git-project-audit');

function makeTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 's11-git-audit-'));
}

function runGit(args, cwd) {
  childProcess.execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('reports OK when project owns its git root', () => {
  const root = makeTempRoot();
  runGit(['init'], root);

  const [result] = auditProjects([root]);

  assert.equal(result.status, 'ok');
  assert.equal(result.path, fs.realpathSync.native(root));
  assert.equal(result.gitTopLevel, fs.realpathSync.native(root));
});

test('reports NEED INIT when project inherits parent git root', () => {
  const root = makeTempRoot();
  const child = path.join(root, 'child-project');
  fs.mkdirSync(child);
  runGit(['init'], root);

  const [result] = auditProjects([child]);

  assert.equal(result.status, 'needs-init');
  assert.equal(result.gitTopLevel, fs.realpathSync.native(root));
});

test('reports MISSING when configured project path does not exist', () => {
  const missingPath = path.join(makeTempRoot(), 'missing');

  const [result] = auditProjects([missingPath]);

  assert.equal(result.status, 'missing');
  assert.equal(result.gitTopLevel, null);
});

test('formats actionable text without mutating projects', () => {
  const report = formatTextReport([
    {
      inputPath: 'C:\\project',
      path: 'C:\\project',
      status: 'ok',
      gitTopLevel: 'C:\\project',
      reason: 'project owns .git',
    },
    {
      inputPath: 'C:\\project\\nested',
      path: 'C:\\project\\nested',
      status: 'needs-init',
      gitTopLevel: 'C:\\project',
      reason: 'inherits git root from parent',
    },
  ]);

  assert.match(report, /OK: C:\\project -> C:\\project/);
  assert.match(report, /NEED INIT: C:\\project\\nested \(inherits C:\\project\)/);
});

test('parses explicit paths and json flag', () => {
  const parsed = parseArgs(['--json', '--path', 'C:\\one', '--path', 'D:\\two']);

  assert.equal(parsed.json, true);
  assert.deepEqual(parsed.paths, ['C:\\one', 'D:\\two']);
  assert.equal(parsed.help, false);
});
