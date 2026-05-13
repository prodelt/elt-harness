#!/usr/bin/env node
'use strict';
// Task 39 — skill-ranker tests

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  scoreSkill,
  rankSkills,
  relevanceScore,
  tokenScore,
  riskScore,
  recordOutcome,
  loadHistory,
} = require('./skill-ranker');

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

// ─── Fixtures ─────────────────────────────────────────────────────────────

const HIGH_RISK_EXPENSIVE = {
  name: 'danger-skill',
  category: 'domain',
  use_when: 'Use for deployment to production with data migration',
  token_estimate: 15000,
  risk: 'high',
  verified: false,
};

const LOW_RISK_CHEAP_VERIFIED = {
  name: 'safe-skill',
  category: 'verifier',
  use_when: 'Use for quick code review and formatting checks',
  token_estimate: 400,
  risk: 'low',
  verified: true,
};

const MEDIUM_RISK_MODERATE = {
  name: 'medium-skill',
  category: 'domain',
  use_when: 'Architecture review for new features',
  token_estimate: 1500,
  risk: 'medium',
  verified: true,
};

// ─── relevanceScore tests ─────────────────────────────────────────────────

test('relevanceScore: exact match returns 1.0', () => {
  const score = relevanceScore('safe-skill', { name: 'safe-skill', use_when: '', description: '' });
  assert.strictEqual(score, 1.0);
});

test('relevanceScore: no query returns 0.5', () => {
  assert.strictEqual(relevanceScore('', LOW_RISK_CHEAP_VERIFIED), 0.5);
  assert.strictEqual(relevanceScore(null, LOW_RISK_CHEAP_VERIFIED), 0.5);
});

test('relevanceScore: partial match is proportional', () => {
  const s = relevanceScore('code review security', LOW_RISK_CHEAP_VERIFIED);
  assert.ok(s > 0 && s < 1, `expected partial match, got ${s}`);
});

test('relevanceScore: unrelated query returns 0', () => {
  const s = relevanceScore('kubernetes helm chart', LOW_RISK_CHEAP_VERIFIED);
  assert.strictEqual(s, 0);
});

// ─── tokenScore tests ─────────────────────────────────────────────────────

test('tokenScore: cheap skill (<=500) gets 1.0', () => {
  assert.strictEqual(tokenScore(100), 1.0);
  assert.strictEqual(tokenScore(500), 1.0);
});

test('tokenScore: expensive skill (>8000) gets 0.1', () => {
  assert.strictEqual(tokenScore(15000), 0.1);
});

test('tokenScore: moderate skill gets 0.7', () => {
  assert.strictEqual(tokenScore(1000), 0.7);
});

// ─── riskScore tests ──────────────────────────────────────────────────────

test('riskScore: low risk = 1.0', () => {
  assert.strictEqual(riskScore('low'), 1.0);
});

test('riskScore: high risk ≈ 0.3', () => {
  assert.ok(Math.abs(riskScore('high') - 0.3) < 1e-9, `expected ~0.3, got ${riskScore('high')}`);
});

test('riskScore: medium risk = 0.7', () => {
  assert.strictEqual(riskScore('medium'), 0.7);
});

// ─── scoreSkill tests ─────────────────────────────────────────────────────

test('high-risk expensive unverified scores lower than low-risk cheap verified', () => {
  const query = 'code review';
  const dangerous = scoreSkill(HIGH_RISK_EXPENSIVE, query, [], null);
  const safe      = scoreSkill(LOW_RISK_CHEAP_VERIFIED, query, [], null);
  assert.ok(safe.score > dangerous.score,
    `safe=${safe.score} should beat dangerous=${dangerous.score}`);
});

test('scoreSkill: breakdown fields all present', () => {
  const result = scoreSkill(LOW_RISK_CHEAP_VERIFIED, 'review', [], null);
  assert.ok('relevance'   in result.breakdown);
  assert.ok('sourceTrust' in result.breakdown);
  assert.ok('verified'    in result.breakdown);
  assert.ok('tokenCost'   in result.breakdown);
  assert.ok('risk'        in result.breakdown);
  assert.ok('successRate' in result.breakdown);
});

test('scoreSkill: verified=true boosts score vs unverified', () => {
  const base = { name: 'x', category: 'utility', use_when: 'test', token_estimate: 500, risk: 'low' };
  const verified   = scoreSkill({ ...base, verified: true  }, '', [], null);
  const unverified = scoreSkill({ ...base, verified: false }, '', [], null);
  assert.ok(verified.score > unverified.score);
});

test('scoreSkill: high success history boosts score', () => {
  const digest = { ...LOW_RISK_CHEAP_VERIFIED };
  const goodHistory = [
    { name: 'safe-skill', success: true },
    { name: 'safe-skill', success: true },
    { name: 'safe-skill', success: true },
  ];
  const badHistory = [
    { name: 'safe-skill', success: false },
    { name: 'safe-skill', success: false },
  ];
  const withGood = scoreSkill(digest, '', goodHistory, null);
  const withBad  = scoreSkill(digest, '', badHistory, null);
  assert.ok(withGood.score > withBad.score,
    `good=${withGood.score} should beat bad=${withBad.score}`);
});

// ─── rankSkills tests ─────────────────────────────────────────────────────

test('rankSkills: returns sorted descending by score', () => {
  const digests = [HIGH_RISK_EXPENSIVE, LOW_RISK_CHEAP_VERIFIED, MEDIUM_RISK_MODERATE];
  const ranked = rankSkills(digests, 'code review', [], {});
  for (let i = 0; i < ranked.length - 1; i++) {
    assert.ok(ranked[i].score >= ranked[i + 1].score,
      `rank[${i}].score=${ranked[i].score} should >= rank[${i+1}].score=${ranked[i+1].score}`);
  }
});

test('rankSkills: high-risk expensive skill ranked last for safe query', () => {
  const digests = [HIGH_RISK_EXPENSIVE, LOW_RISK_CHEAP_VERIFIED, MEDIUM_RISK_MODERATE];
  const ranked = rankSkills(digests, 'quick safe review', [], {});
  assert.strictEqual(ranked[ranked.length - 1].name, 'danger-skill',
    `expected danger-skill last, got ${ranked[ranked.length - 1].name}`);
});

test('rankSkills: empty digests returns empty array', () => {
  const ranked = rankSkills([], 'anything', [], {});
  assert.deepStrictEqual(ranked, []);
});

// ─── recordOutcome + loadHistory tests ───────────────────────────────────

test('recordOutcome writes readable history entry', () => {
  const tmp = path.join(os.tmpdir(), `ranker-history-${Date.now()}.jsonl`);
  recordOutcome(tmp, 'safe-skill', true, 1200);
  recordOutcome(tmp, 'safe-skill', false, 800);
  const history = loadHistory(tmp);
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].name, 'safe-skill');
  assert.strictEqual(history[0].success, true);
  assert.strictEqual(history[1].success, false);
  fs.unlinkSync(tmp);
});

test('loadHistory: missing file returns empty array', () => {
  const history = loadHistory('/nonexistent/path/history.jsonl');
  assert.deepStrictEqual(history, []);
});

// ─── Summary ─────────────────────────────────────────────────────────────

process.stdout.write(`\nskill-ranker.test.js: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
