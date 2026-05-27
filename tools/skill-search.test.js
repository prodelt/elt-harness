#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildSkillRouterRecord,
  evaluateBenchmarkRecords,
  searchSkillsSh,
  shouldSearchMarketplace,
  withRouterRelevance,
} = require('./skill-search');

function testMarketplaceUsesRelevance() {
  const strongTotalWeakRelevance = [{
    score: 0.8,
    breakdown: { relevance: 0 },
  }];
  const relevant = [{
    score: 0.4,
    breakdown: { relevance: 0.5 },
  }];
  assert.equal(shouldSearchMarketplace(strongTotalWeakRelevance), true);
  assert.equal(shouldSearchMarketplace(relevant), false);
  assert.equal(shouldSearchMarketplace([]), true);
}

function testMarketplaceErrorsAreVisibleAndCached() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-search-'));
  const cachePath = path.join(dir, 'cache.json');
  const result = searchSkillsSh('zzzzzz', 3, {
    cachePath,
    now: () => 1000,
    runner: () => ({ status: 1, stdout: '', stderr: 'execution policy blocked' }),
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /execution policy/);

  const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8')).zzzzzz;
  assert.equal(cached.status, 'error');
  assert.match(cached.error, /execution policy/);
  assert.match(cached.attemptedCommand, /search zzzzzz --json/);
}

function testMarketplaceSuccessShape() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-search-'));
  const result = searchSkillsSh('architecture refactor', 1, {
    cachePath: path.join(dir, 'cache.json'),
    now: () => 1000,
    runner: () => ({
      status: 0,
      stdout: JSON.stringify({
        skills: [{ skillId: 'market/architect', installs: 42, source: 'skills.sh' }],
      }),
      stderr: '',
    }),
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.results, [{
    name: 'market/architect',
    installs: 42,
    source: 'skills.sh',
    marketplace: true,
  }]);
  assert.match(result.attemptedCommand, /search architecture refactor --json/);
}

function rankedSkill(name, relevance, score = 0.9) {
  return {
    name,
    score,
    token_estimate: 1000,
    risk_level: 'low',
    breakdown: { relevance },
  };
}

function testRouterReturnsNoSkillForNonsense() {
  const record = buildSkillRouterRecord('zzzzzz', [
    rankedSkill('architect-first', 0, 0.8),
    rankedSkill('sprint', 0, 0.7),
  ], {
    status: 'error',
    error: 'skills-sh.cmd search zzzzzz --json: execution policy blocked',
    attemptedCommand: 'skills-sh.cmd search zzzzzz --json',
    results: [],
  }, { now: () => 1000 });

  assert.equal(record.kind, 'skill-router');
  assert.equal(record.selected, 'no skill');
  assert.equal(record.mode, 'direct');
  assert.equal(record.recommendations.length, 0);
  assert.equal(record.rejected.length, 2);
  assert.match(record.marketplace.error, /execution policy/);
}

function testRouterCapsOutputAtThreeSkills() {
  const record = buildSkillRouterRecord('architecture refactor', [
    rankedSkill('architect-first', 1),
    rankedSkill('sprint', 0.8),
    rankedSkill('inline-review', 0.7),
    rankedSkill('ship', 0.6),
  ], {
    status: 'skipped',
    results: [],
  }, { now: () => 1000 });

  assert.equal(record.selected, 'architect-first');
  assert.equal(record.recommendations.length, 3);
  assert.deepEqual(record.recommendations.map(skill => skill.name), [
    'architect-first',
    'sprint',
    'inline-review',
  ]);
  assert.equal(record.tokenBudget.maxSkills, 3);
}

function testRouterRelevanceBoostsSecurityDomain() {
  const reranked = withRouterRelevance('security api input validation', [
    rankedSkill('cto-playbook', 0.25, 0.6),
    rankedSkill('security-best-practices', 0.1, 0.4),
  ]);
  assert.equal(reranked[0].name, 'security-best-practices');
  assert.equal(reranked[0].breakdown.relevance, 0.95);
  assert.equal(shouldSearchMarketplace(reranked.slice(0, 3)), false);
}

function testBenchmarkEvaluatorCatchesWrongSelections() {
  const report = evaluateBenchmarkRecords({
    'browser automation ai agent': { selected: 'init-project' },
    'security api input validation': { selected: 'security-best-practices' },
    'zzzzzz low confidence nonsense': { selected: 'no skill' },
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.results[0].status, 'fail');

  const passed = evaluateBenchmarkRecords({
    'browser automation ai agent': { selected: 'agent-browser' },
    'security api input validation': { selected: 'security-best-practices' },
    'zzzzzz low confidence nonsense': { selected: 'no skill' },
  });
  assert.equal(passed.status, 'pass');
}

function testRouterFiltersWeakMarketplaceMatches() {
  const record = buildSkillRouterRecord('zzzzzz low confidence nonsense', [
    rankedSkill('git-flow', 0.25, 0.5),
  ], {
    status: 'ok',
    results: [
      { name: 'risk-management', source: '0xhubed/agent-trading-arena' },
      { name: 'power-confidence', source: 'dylantarre/animation-principles' },
    ],
  }, { now: () => 1000 });
  assert.equal(record.selected, 'no skill');
  assert.equal(record.recommendations.length, 0);
}

function main() {
  testMarketplaceUsesRelevance();
  testMarketplaceErrorsAreVisibleAndCached();
  testMarketplaceSuccessShape();
  testRouterReturnsNoSkillForNonsense();
  testRouterCapsOutputAtThreeSkills();
  testRouterRelevanceBoostsSecurityDomain();
  testBenchmarkEvaluatorCatchesWrongSelections();
  testRouterFiltersWeakMarketplaceMatches();
  process.stdout.write('skill-search tests: PASS\n');
}

main();
