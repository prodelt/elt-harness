#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  searchSkillsSh,
  shouldSearchMarketplace,
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
}

function main() {
  testMarketplaceUsesRelevance();
  testMarketplaceErrorsAreVisibleAndCached();
  testMarketplaceSuccessShape();
  process.stdout.write('skill-search tests: PASS\n');
}

main();
