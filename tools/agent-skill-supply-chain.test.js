#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert');

const {
  installApprovedSkills,
  rolloutProjects,
  validateManifest,
} = require('./agent-skill-supply-chain');

function makeTemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skill-supply-chain-'));
}

function writeSkill(home, client, name, body = '# Skill\n') {
  const dir = path.join(home, `.${client}`, 'skills', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n---\n\n${body}`, 'utf8');
  return dir;
}

function manifest() {
  return {
    version: 1,
    policy: { targetClients: ['claude', 'codex', 'gemini'] },
    skills: [
      {
        id: 'pipeline',
        name: 'pipeline',
        tier: 'core',
        status: 'approved',
        source: { type: 'local-client', client: 'claude', path: 'pipeline' },
      },
    ],
    externalCandidates: [
      { id: 'superpowers', repo: 'obra/superpowers', status: 'review-required' },
    ],
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message);
    process.exitCode = 1;
  }
}

test('validateManifest accepts safe local-client source and external candidate', () => {
  assert.deepStrictEqual(validateManifest(manifest()), { ok: true, errors: [] });
});

test('validateManifest rejects path traversal', () => {
  const bad = manifest();
  bad.skills[0].source.path = '../pipeline';
  const result = validateManifest(bad);
  assert.strictEqual(result.ok, false);
  assert.match(result.errors.join('\n'), /safe relative/);
});

test('installApprovedSkills dry-run reports would-copy without writing', () => {
  const home = makeTemp();
  writeSkill(home, 'claude', 'pipeline');
  const result = installApprovedSkills(manifest(), { home, target: 'codex', apply: false });
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.actions.some((action) => action.action === 'would-copy'), true);
  assert.strictEqual(fs.existsSync(path.join(home, '.codex', 'skills', 'pipeline')), false);
});

test('installApprovedSkills apply copies approved skill to target client', () => {
  const home = makeTemp();
  writeSkill(home, 'claude', 'pipeline');
  const result = installApprovedSkills(manifest(), { home, target: 'codex', apply: true });
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(fs.existsSync(path.join(home, '.codex', 'skills', 'pipeline', 'SKILL.md')), true);
});

test('rolloutProjects dry-run reports would-write pointer', () => {
  const root = makeTemp();
  const registry = { projects: { demo: { key: 'demo', name: 'Demo', path: root } } };
  const result = rolloutProjects(manifest(), registry, { apply: false, manifest: 'config/agent-skill-sources.json' });
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(result.actions[0].action, 'would-write');
  assert.strictEqual(fs.existsSync(path.join(root, '.planning', 'agent-control-plane.json')), false);
});

test('rolloutProjects apply writes control-plane pointer', () => {
  const root = makeTemp();
  const registry = { projects: { demo: { key: 'demo', name: 'Demo', path: root } } };
  const result = rolloutProjects(manifest(), registry, { apply: true, manifest: 'config/agent-skill-sources.json' });
  assert.deepStrictEqual(result.errors, []);
  assert.strictEqual(fs.existsSync(path.join(root, '.planning', 'agent-control-plane.json')), true);
});

if (process.exitCode) process.exit(process.exitCode);
console.log('agent-skill-supply-chain tests: 6 passed');
