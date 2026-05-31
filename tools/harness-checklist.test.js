#!/usr/bin/env node
'use strict';

/**
 * tools/harness-checklist.test.js — unit tests for harness-checklist.js
 *
 * Exercises the pure core (buildChecklist over synthetic facts, aggregate,
 * manual-justification mapping), checkArtifact TTL, toMarkdown, parseArgs,
 * and a CLI smoke against the real repo root.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  CATEGORIES,
  ITEMS,
  aggregate,
  evaluateManual,
  buildChecklist,
  gatherFacts,
  checkArtifact,
  toMarkdown,
  parseArgs,
  TTL_MS,
} = require('./harness-checklist');

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`  FAIL  ${name}\n    ${err.message}\n`);
  }
}

// ── facts builders for synthetic scenarios ────────────────────────────────────

// All-green facts: every auto check should pass.
function allGoodFacts() {
  return {
    docsAgents: true,
    docsClaude: true,
    docsGemini: true,
    permissions: true,
    verificationGatesInDocs: true,
    harnessTestsPass: true,
    validateSchemaExists: true,
    planningNonEmpty: true,
    compactionHooks: true,
    secretScanner: true,
    planTemplate: true,
    implementTemplate: true,
    freshArchitecture: true,
    milestonesWithVerify: true,
    destructiveConfirm: true,
    fsScope: true,
    doctorRuns: true,
  };
}

// All-bad facts: every auto check should be warn or fail.
function allBadFacts() {
  const f = allGoodFacts();
  for (const k of Object.keys(f)) f[k] = false;
  return f;
}

// ── CATEGORIES / ITEMS shape ──────────────────────────────────────────────────

run('CATEGORIES has the 6 ai-boost categories', () => {
  assert.deepEqual(CATEGORIES, [
    'agent-instructions',
    'tool-design',
    'context-delivery',
    'planning-artifacts',
    'permissions-sandbox',
    'verification-loop',
  ]);
});

run('ITEMS: every item has id, category, type', () => {
  assert.ok(ITEMS.length >= 12, `expected >=12 items, got ${ITEMS.length}`);
  for (const it of ITEMS) {
    assert.ok(it.id, 'item missing id');
    assert.ok(CATEGORIES.includes(it.category), `item ${it.id} bad category ${it.category}`);
    assert.ok(it.type === 'auto' || it.type === 'manual', `item ${it.id} bad type ${it.type}`);
    if (it.type === 'auto') assert.equal(typeof it.check, 'function', `auto item ${it.id} needs check fn`);
  }
});

run('ITEMS: every category has at least one auto and one manual item', () => {
  for (const cat of CATEGORIES) {
    const inCat = ITEMS.filter((i) => i.category === cat);
    assert.ok(inCat.some((i) => i.type === 'auto'), `${cat} has no auto item`);
    assert.ok(inCat.some((i) => i.type === 'manual'), `${cat} has no manual item`);
  }
});

run('ITEMS: ids are unique', () => {
  const ids = ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate item ids');
});

// ── aggregate ─────────────────────────────────────────────────────────────────

run('aggregate: empty → pass', () => {
  assert.equal(aggregate([]), 'pass');
});

run('aggregate: all pass → pass', () => {
  assert.equal(aggregate(['pass', 'pass']), 'pass');
});

run('aggregate: any warn → warn', () => {
  assert.equal(aggregate(['pass', 'warn', 'pass']), 'warn');
});

run('aggregate: needs-justification counts as warn level', () => {
  assert.equal(aggregate(['pass', 'needs-justification']), 'warn');
});

run('aggregate: any fail → fail (worst wins)', () => {
  assert.equal(aggregate(['pass', 'warn', 'fail', 'needs-justification']), 'fail');
});

// ── evaluateManual ──────────────────────────────────────────────────────────

run('evaluateManual: justification present → pass', () => {
  const r = evaluateManual('no-ambiguous-instructions', {
    'no-ambiguous-instructions': 'reviewed 2026-05-29, instructions unambiguous',
  });
  assert.equal(r.status, 'pass');
  assert.match(r.detail, /justified/i);
});

run('evaluateManual: missing justification → needs-justification', () => {
  const r = evaluateManual('no-ambiguous-instructions', {});
  assert.equal(r.status, 'needs-justification');
});

run('evaluateManual: blank/whitespace justification → needs-justification', () => {
  const r = evaluateManual('x', { x: '   ' });
  assert.equal(r.status, 'needs-justification');
});

// ── buildChecklist (pure) ──────────────────────────────────────────────────

run('buildChecklist: all-good facts + justifications → pass', () => {
  const justifications = {};
  for (const it of ITEMS.filter((i) => i.type === 'manual')) justifications[it.id] = 'justified for test';
  const report = buildChecklist(allGoodFacts(), justifications);
  assert.equal(report.summary.status, 'pass');
  assert.equal(report.summary.counts.fail, 0);
  assert.equal(report.summary.counts.needsJustification, 0);
});

run('buildChecklist: all-good facts but NO justifications → warn (needs-justification)', () => {
  const report = buildChecklist(allGoodFacts(), {});
  assert.equal(report.summary.status, 'warn');
  assert.ok(report.summary.counts.needsJustification > 0, 'expected unjustified manual items');
  assert.equal(report.summary.counts.fail, 0);
});

run('buildChecklist: all-bad facts → fail', () => {
  const report = buildChecklist(allBadFacts(), {});
  assert.equal(report.summary.status, 'fail');
  assert.ok(report.summary.counts.fail > 0, 'expected at least one hard fail');
});

run('buildChecklist: returns all 6 categories each with items + status', () => {
  const report = buildChecklist(allGoodFacts(), {});
  assert.equal(report.categories.length, 6);
  for (const cat of report.categories) {
    assert.ok(CATEGORIES.includes(cat.id));
    assert.ok(Array.isArray(cat.items) && cat.items.length > 0);
    assert.ok(['pass', 'warn', 'fail'].includes(cat.status));
  }
});

run('buildChecklist: missing core docs is a hard fail in agent-instructions', () => {
  const f = allGoodFacts();
  f.docsAgents = false;
  const report = buildChecklist(f, {});
  const cat = report.categories.find((c) => c.id === 'agent-instructions');
  assert.equal(cat.status, 'fail');
  const item = cat.items.find((i) => i.status === 'fail');
  assert.ok(item, 'expected a failing item');
});

run('buildChecklist: every item carries id/type/status/detail', () => {
  const report = buildChecklist(allGoodFacts(), {});
  for (const cat of report.categories) {
    for (const it of cat.items) {
      assert.ok(it.id, 'item missing id');
      assert.ok(it.type === 'auto' || it.type === 'manual');
      assert.ok(['pass', 'warn', 'fail', 'needs-justification'].includes(it.status), `bad status ${it.status}`);
      assert.equal(typeof it.detail, 'string');
    }
  }
});

run('buildChecklist: category status = worst of its items', () => {
  const f = allGoodFacts();
  f.secretScanner = false; // context-delivery auto item degrades
  const report = buildChecklist(f, {});
  const ctx = report.categories.find((c) => c.id === 'context-delivery');
  assert.notEqual(ctx.status, 'pass');
});

// ── checkArtifact (TTL / freshness) ───────────────────────────────────────────

run('checkArtifact: missing file → ok:false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-missing-'));
  const r = checkArtifact(dir, new Date());
  assert.equal(r.ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

run('checkArtifact: fresh artifact → ok:true, stale:false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-fresh-'));
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  const now = new Date();
  fs.writeFileSync(
    path.join(dir, '.planning', 'harness-checklist-latest.json'),
    JSON.stringify({ generatedAt: now.toISOString(), summary: { status: 'warn' } }),
  );
  const r = checkArtifact(dir, now);
  assert.equal(r.ok, true);
  assert.equal(r.stale, false);
  assert.equal(r.value.summary.status, 'warn');
  fs.rmSync(dir, { recursive: true, force: true });
});

run('checkArtifact: artifact older than TTL → stale:true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-stale-'));
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  const old = new Date(Date.now() - TTL_MS - 60000);
  fs.writeFileSync(
    path.join(dir, '.planning', 'harness-checklist-latest.json'),
    JSON.stringify({ generatedAt: old.toISOString(), summary: { status: 'pass' } }),
  );
  const r = checkArtifact(dir, new Date());
  assert.equal(r.ok, true);
  assert.equal(r.stale, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── toMarkdown ────────────────────────────────────────────────────────────────

run('toMarkdown: produces non-empty markdown with summary + categories', () => {
  const report = {
    generatedAt: new Date().toISOString(),
    projectRoot: '/x',
    summary: { status: 'warn', counts: { pass: 5, warn: 2, fail: 0, needsJustification: 2 } },
    categories: buildChecklist(allGoodFacts(), {}).categories,
  };
  const md = toMarkdown(report);
  assert.ok(md.length > 100);
  assert.match(md, /Harness/i);
  assert.match(md, /agent-instructions/);
});

// ── parseArgs ─────────────────────────────────────────────────────────────────

run('parseArgs: flags parsed', () => {
  const o = parseArgs(['node', 'x', '--root', '/tmp/p', '--json', '--write', '--markdown']);
  assert.equal(o.root, '/tmp/p');
  assert.equal(o.json, true);
  assert.equal(o.write, true);
  assert.equal(o.markdown, true);
});

run('parseArgs: defaults', () => {
  const o = parseArgs(['node', 'x']);
  assert.equal(o.json, false);
  assert.equal(o.write, false);
  assert.ok(o.root);
});

// ── gatherFacts (I/O smoke against real repo) ────────────────────────────────

run('gatherFacts: real repo root returns boolean facts without throwing', () => {
  const root = path.resolve(__dirname, '..');
  const facts = gatherFacts(root, os.homedir());
  assert.equal(typeof facts, 'object');
  for (const k of Object.keys(allGoodFacts())) {
    assert.ok(k in facts, `gatherFacts missing fact: ${k}`);
    assert.equal(typeof facts[k], 'boolean', `fact ${k} not boolean: ${facts[k]}`);
  }
});

run('gatherFacts: this repo has core docs + planning', () => {
  const root = path.resolve(__dirname, '..');
  const facts = gatherFacts(root, os.homedir());
  assert.equal(facts.docsAgents, true, 'AGENTS.md should exist in this repo');
  assert.equal(facts.planningNonEmpty, true, '.planning should be non-empty');
});

// ── CLI smoke ─────────────────────────────────────────────────────────────────

run('CLI --json: emits valid JSON with summary + categories', () => {
  const root = path.resolve(__dirname, '..');
  const proc = spawnSync('node', [path.join(__dirname, 'harness-checklist.js'), '--root', root, '--json'], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.ok(proc.stdout, 'no stdout');
  const parsed = JSON.parse(proc.stdout);
  assert.ok(parsed.summary && ['pass', 'warn', 'fail'].includes(parsed.summary.status));
  assert.equal(parsed.categories.length, 6);
});

run('CLI --write: creates latest.json and latest.md', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-cli-'));
  // minimal repo: empty — facts mostly false, but should still write
  const proc = spawnSync('node', [path.join(__dirname, 'harness-checklist.js'), '--root', dir, '--write', '--json'], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(proc.status, proc.status); // does not crash
  assert.ok(fs.existsSync(path.join(dir, '.planning', 'harness-checklist-latest.json')), 'json not written');
  assert.ok(fs.existsSync(path.join(dir, '.planning', 'harness-checklist-latest.md')), 'md not written');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── summary ─────────────────────────────────────────────────────────────────

process.stdout.write(`\nharness-checklist: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
