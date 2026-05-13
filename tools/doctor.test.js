#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  parseArgs,
  projectKey,
  projectStatePath,
  parseSkillFrontmatter,
  checkPipelineState,
  runDoctor,
} = require('./doctor-core');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function testParseArgs() {
  const parsed = parseArgs(['node', 'doctor.js', '--root', 'C:\\tmp\\x', '--json', '--no-graphify']);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.root, 'C:\\tmp\\x');
  assert.equal(parsed.value.json, true);
  assert.equal(parsed.value.graphify, false);

  const invalid = parseArgs(['node', 'doctor.js', '--unknown']);
  assert.equal(invalid.ok, false);
}

function testProjectKeyStable() {
  const first = projectKey('C:\\Claude playground\\Pipiline setupper');
  const second = projectKey('C:/Claude playground/Pipiline setupper');
  assert.equal(first, second);
  assert.match(first, /^pipiline-setupper-[a-f0-9]{8}$/);
}

function testSkillFrontmatter() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-skill-'));
  const good = path.join(dir, 'good', 'SKILL.md');
  const goodBom = path.join(dir, 'good-bom', 'SKILL.md');
  const bad = path.join(dir, 'bad', 'SKILL.md');
  write(good, '---\nname: ok\ndescription: works\n---\n# Body\n');
  write(goodBom, '\uFEFF---\nname: ok\ndescription: works\n---\n# Body\n');
  write(bad, '---\nname ok\n---\n# Body\n');
  assert.equal(parseSkillFrontmatter(good).ok, true);
  assert.equal(parseSkillFrontmatter(goodBom).ok, true);
  assert.equal(parseSkillFrontmatter(bad).ok, false);
}

function testPipelineStateValidation() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-state-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project-a');
  write(projectStatePath(root, home), JSON.stringify({
    cwd: root,
    ts: '2026-05-08T12:00:00Z',
  }));
  write(path.join(home, '.claude', 'pipeline-state.json'), JSON.stringify({
    cwd: path.join(dir, 'project-b'),
    ts: '2026-05-08T12:00:00Z',
  }));
  const checks = checkPipelineState(root, home, new Date('2026-05-08T12:00:00Z'));
  assert.equal(checks[0].status, 'pass');
  assert.equal(checks[0].id, 'state:pipeline');
  assert.equal(checks[1].status, 'warn');
  assert.equal(checks[1].id, 'state:pipeline:legacy');
  assert.match(checks[1].title, /another project/);
}

function testPipelineStateRejectsFutureLegacy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-state-future-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project-a');
  write(projectStatePath(root, home), JSON.stringify({
    cwd: root,
    ts: '2026-05-08T12:00:00Z',
  }));
  write(path.join(home, '.claude', 'pipeline-state.json'), JSON.stringify({
    cwd: root,
    ts: '2026-05-09T12:00:00Z',
  }));
  const checks = checkPipelineState(root, home, new Date('2026-05-08T12:00:00Z'));
  assert.equal(checks[0].status, 'pass');
  assert.equal(checks[1].status, 'warn');
  assert.match(checks[1].title, /future/);
}

function testDoctorSkipsCodemapWithNoGraphify() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-no-graphify-'));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'project');
  write(path.join(root, 'AGENTS.md'), coreDoc());
  write(path.join(root, 'CLAUDE.md'), coreDoc());
  write(path.join(root, '.gemini', 'GEMINI.md'), coreDoc());
  write(path.join(home, '.claude', 'skill-registry', 'digests.jsonl'), JSON.stringify({ name: 'x' }) + '\n');
  const report = withHome(home, () => runDoctor({ root, register: true, graphify: false }));
  assert.equal(report.checks.some((check) => check.id === 'codemap:scope'), false);
  assert.equal(report.checks.some((check) => check.id === 'graphify:skipped'), true);
}

function coreDoc() {
  return [
    '# Test',
    '',
    '## Overview',
    'x',
    '## Stack',
    'x',
    '## Commands',
    'x',
    '## Architecture',
    'x',
    '## Gotchas',
    'x',
    '## Current State',
    'x',
    '',
  ].join('\n');
}

function withHome(home, fn) {
  const previous = process.env.USERPROFILE;
  process.env.USERPROFILE = home;
  try {
    return fn();
  } finally {
    process.env.USERPROFILE = previous;
  }
}

function main() {
  testParseArgs();
  testProjectKeyStable();
  testSkillFrontmatter();
  testPipelineStateValidation();
  testPipelineStateRejectsFutureLegacy();
  testDoctorSkipsCodemapWithNoGraphify();
  process.stdout.write('doctor tests: PASS\n');
}

main();
