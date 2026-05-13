#!/usr/bin/env node
'use strict';
// Task 38 — skill-distiller tests

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  distillSkill,
  checkBudget,
  isFresh,
  parseFrontmatter,
  estimateTokens,
} = require('./skill-distiller');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ✅ ${name}\n`);
  } catch (e) {
    failed++;
    process.stderr.write(`  ❌ ${name}: ${e.message}\n`);
  }
}

// ─── Fixture helpers ──────────────────────────────────────────────────────

function mkTmpSkill(name, content) {
  const dir = path.join(os.tmpdir(), `distiller-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
  return dir;
}

const LARGE_SKILL_MD = `---
name: large-orchestrator
description: Orchestrator v3 — real Skill tool delegation with shared pipeline-state.json context. Use for any new task, feature, bug fix, or refactor. Classifies work, writes shared state, then delegates.
trigger: start task, new feature, implement, fix bug
version: 2.1.0
requires: []
changelog:
  - 2.1.0 (2026-04-26): add interview gate
  - 2.0.0 (2026-04-22): add plan mode
  - 1.0.0 (2026-04-01): initial
---

# /large-orchestrator

Real orchestrator. Long body with lots of content to simulate a real large SKILL.md file.

## When NOT to Use

Skip this skill for trivial one-line fixes, pure read-only research, or when the user explicitly wants a quick patch without the full pipeline overhead.

## Step 1 — Classify

Classify the task as TRIVIAL, MEDIUM, or COMPLEX based on file count and impact.

## Step 2 — Execute

Run sub-skills for each phase. Call WebFetch if documentation is needed.
Use git reset --hard only in extreme emergencies.

## Step 3 — Verify

Check outputs. Deploy to production after sign-off.
` + 'x'.repeat(3000);

const SIMPLE_SKILL_MD = `---
name: simple-utility
description: Simple utility skill for quick formatting tasks.
version: 1.0.0
requires: []
changelog:
  - 1.0.0 (2026-04-01): initial
---

# /simple-utility

Does one simple thing quickly.
`;

// ─── Tests: parseFrontmatter ──────────────────────────────────────────────

test('parseFrontmatter extracts name and version', () => {
  const fm = parseFrontmatter('---\nname: foo\nversion: 1.2.3\n---\nbody');
  assert.strictEqual(fm.name, 'foo');
  assert.strictEqual(fm.version, '1.2.3');
});

test('parseFrontmatter returns empty object when no frontmatter', () => {
  const fm = parseFrontmatter('no frontmatter here');
  assert.deepStrictEqual(fm, {});
});

// ─── Tests: estimateTokens ────────────────────────────────────────────────

test('estimateTokens is proportional to length', () => {
  const t = estimateTokens('a'.repeat(400));
  assert.strictEqual(t, 100);
});

// ─── Tests: distillSkill ─────────────────────────────────────────────────

test('large skill produces short digest', () => {
  const dir = mkTmpSkill('large-orchestrator', LARGE_SKILL_MD);
  const digest = distillSkill(dir);
  assert.strictEqual(digest.name, 'large-orchestrator');
  assert.ok(digest.token_estimate > 800, 'source is large');
  assert.ok(digest.use_when.length <= 220, `use_when capped: ${digest.use_when.length}`);
  assert.ok(digest.avoid_when, 'avoid_when extracted from section');
  assert.ok(digest.avoid_when.length <= 210, 'avoid_when capped');
  assert.strictEqual(digest.requires_network, true, 'WebFetch detected');
  assert.strictEqual(digest.risk, 'high', 'destructive + production detected');
  assert.strictEqual(digest.verified, true, 'has version + changelog');
  assert.strictEqual(digest.category, 'orchestrator');
});

test('simple skill has correct category and low risk', () => {
  const dir = mkTmpSkill('simple-utility', SIMPLE_SKILL_MD);
  const digest = distillSkill(dir);
  assert.strictEqual(digest.category, 'utility');
  assert.strictEqual(digest.risk, 'low');
  assert.strictEqual(digest.requires_network, false);
  assert.strictEqual(digest.verified, true);
});

test('distillSkill throws on missing SKILL.md', () => {
  const dir = path.join(os.tmpdir(), 'no-skill-here-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });
  assert.throws(() => distillSkill(dir), /SKILL\.md not found/);
});

test('pipeline skill classified as orchestrator by name', () => {
  const dir = mkTmpSkill('pipeline', `---\nname: pipeline\ndescription: Routes tasks.\nversion: 1.0.0\nrequires: []\nchangelog:\n  - 1.0.0 (2026-04-01): init\n---\n# /pipeline\nOrchestrator.`);
  const digest = distillSkill(dir);
  assert.strictEqual(digest.category, 'orchestrator');
});

test('inline-review skill classified as verifier by name', () => {
  const dir = mkTmpSkill('inline-review', `---\nname: inline-review\ndescription: Reviews code quality.\nversion: 1.0.0\nrequires: []\nchangelog:\n  - 1.0.0 (2026-04-01): init\n---\n# /inline-review\nReviews.`);
  const digest = distillSkill(dir);
  assert.strictEqual(digest.category, 'verifier');
});

// ─── Tests: checkBudget ───────────────────────────────────────────────────

test('checkBudget allows 1 orchestrator + 1 domain + 1 verifier', () => {
  const skills = [
    { name: 'pipeline', category: 'orchestrator' },
    { name: 'architect-first', category: 'domain' },
    { name: 'inline-review', category: 'verifier' },
  ];
  const result = checkBudget(skills);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.violations, []);
});

test('checkBudget rejects 2 orchestrators', () => {
  const skills = [
    { name: 'pipeline', category: 'orchestrator' },
    { name: 'company', category: 'orchestrator' },
    { name: 'architect-first', category: 'domain' },
  ];
  const result = checkBudget(skills);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('orchestrator')));
});

test('checkBudget rejects 4th active skill when 2 domain', () => {
  const skills = [
    { name: 'pipeline', category: 'orchestrator' },
    { name: 'architect-first', category: 'domain' },
    { name: 'cto-playbook', category: 'domain' },
    { name: 'inline-review', category: 'verifier' },
  ];
  const result = checkBudget(skills);
  assert.strictEqual(result.ok, false);
  assert.ok(result.violations.some(v => v.includes('domain')));
});

test('checkBudget override mode always passes', () => {
  const skills = [
    { name: 'pipeline', category: 'orchestrator' },
    { name: 'company', category: 'orchestrator' },
    { name: 'architect-first', category: 'domain' },
    { name: 'cto-playbook', category: 'domain' },
  ];
  const result = checkBudget(skills, true);
  assert.strictEqual(result.ok, true);
});

// ─── Tests: isFresh ──────────────────────────────────────────────────────

test('isFresh returns false for missing digest', () => {
  assert.strictEqual(isFresh(null), false);
  assert.strictEqual(isFresh(undefined), false);
  assert.strictEqual(isFresh({}), false);
});

test('isFresh returns true for recent digest', () => {
  assert.strictEqual(isFresh({ digest_ts: new Date().toISOString() }), true);
});

test('isFresh returns false for stale digest (>48h)', () => {
  const old = new Date(Date.now() - 49 * 3_600_000).toISOString();
  assert.strictEqual(isFresh({ digest_ts: old }), false);
});

// ─── Summary ──────────────────────────────────────────────────────────────

process.stdout.write(`\nskill-distiller.test.js: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
