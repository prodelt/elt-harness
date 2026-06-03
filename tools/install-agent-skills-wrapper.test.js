#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  install,
  parseArgs,
} = require('./install-agent-skills-wrapper');

function makeTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-wrapper-root-'));
  const tools = path.join(root, 'tools');
  fs.mkdirSync(tools, { recursive: true });
  fs.writeFileSync(path.join(tools, 'agent-skill-supply-chain.js'), '#!/usr/bin/env node\n', 'utf8');
  return root;
}

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-wrapper-home-'));
}

function wrapperPath(home, name) {
  return path.join(home, '.claude', 'bin', name);
}

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n`);
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

test('parseArgs defaults to dry-run', () => {
  const parsed = parseArgs(['node', 'tools/install-agent-skills-wrapper.js']);
  assert.equal(parsed.apply, false);
  assert.equal(parsed.json, false);
});

test('dry-run reports wrappers without writing', () => {
  const home = makeTempHome();
  const repoRoot = makeTempRoot();
  const result = install({ home, repoRoot, apply: false });

  assert.equal(result.applied, false);
  assert.deepEqual(result.wrappers.map((wrapper) => wrapper.action), ['would-write']);
  assert.equal(fs.existsSync(wrapperPath(home, 'agent-skills.cmd')), false);
  assert.equal(fs.existsSync(wrapperPath(home, 'agent-skills.ps1')), false);
});

test('apply writes cmd wrapper pointing at supply-chain script', () => {
  const home = makeTempHome();
  const repoRoot = makeTempRoot();
  const result = install({ home, repoRoot, apply: true });
  const targetScript = path.join(repoRoot, 'tools', 'agent-skill-supply-chain.js');
  const cmd = fs.readFileSync(wrapperPath(home, 'agent-skills.cmd'), 'utf8');

  assert.equal(result.applied, true);
  assert.deepEqual(result.wrappers.map((wrapper) => wrapper.action), ['written']);
  assert.match(cmd, /node "%SCRIPT%" %\*/);
  assert.match(cmd, new RegExp(targetScript.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
  assert.equal(fs.existsSync(wrapperPath(home, 'agent-skills.ps1')), false);
});

test('with-ps1 writes optional PowerShell wrapper', () => {
  const home = makeTempHome();
  const repoRoot = makeTempRoot();
  const result = install({ home, repoRoot, apply: true, withPs1: true });
  const targetScript = path.join(repoRoot, 'tools', 'agent-skill-supply-chain.js');
  const ps1 = fs.readFileSync(wrapperPath(home, 'agent-skills.ps1'), 'utf8');

  assert.deepEqual(result.wrappers.map((wrapper) => wrapper.action), ['written', 'written']);
  assert.match(ps1, /node \$Script @args/);
  assert.match(ps1, new RegExp(targetScript.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
});

test('apply removes generated ps1 by default to avoid PowerShell policy shadowing', () => {
  const home = makeTempHome();
  const repoRoot = makeTempRoot();
  install({ home, repoRoot, apply: true, withPs1: true });
  const result = install({ home, repoRoot, apply: true });

  assert.deepEqual(result.wrappers.map((wrapper) => wrapper.action), ['up-to-date', 'removed']);
  assert.equal(fs.existsSync(wrapperPath(home, 'agent-skills.ps1')), false);
});

test('second apply is up-to-date', () => {
  const home = makeTempHome();
  const repoRoot = makeTempRoot();
  install({ home, repoRoot, apply: true });
  const result = install({ home, repoRoot, apply: true });

  assert.deepEqual(result.wrappers.map((wrapper) => wrapper.action), ['up-to-date']);
});

if (process.exitCode) process.exit(process.exitCode);
process.stdout.write('install-agent-skills-wrapper tests: 6 passed\n');
