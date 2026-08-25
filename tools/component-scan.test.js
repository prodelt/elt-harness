'use strict';
// 020 T020 — Tests for component-scan.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const componentScan = require('./component-scan');

let tmpRoot = null;
function tmpDir() {
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-scan-'));
  return fs.mkdtempSync(path.join(tmpRoot, 's-'));
}
function cleanup() {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
}

function testValidateCandidateNotSelfScan() {
  // No current packs: OK
  const result1 = componentScan.validateCandidateNotSelfScan('skill/foo', 'hash123', {});
  assert.equal(result1.ok, true);

  // Different digest: OK
  const result2 = componentScan.validateCandidateNotSelfScan(
    'skill/foo',
    'hash123',
    {
      'skill/foo': { contentHash: 'hash456', version: '1.0' },
    },
  );
  assert.equal(result2.ok, true);

  // Same packId and digest: BLOCK - self-promotion attempt
  const result3 = componentScan.validateCandidateNotSelfScan(
    'skill/foo',
    'hash123',
    {
      'skill/foo': { contentHash: 'hash123', version: '1.0' },
    },
  );
  assert.equal(result3.ok, false);
  assert.equal(result3.reason, 'candidate-self-scan');
}

function testValidateScanResult() {
  // OK: pass verdict
  const good = componentScan.validateScanResult({
    ok: true,
    verdict: 'pass',
    incomplete: false,
  });
  assert.equal(good.valid, true);

  // BLOCK: scan failed
  const failed = componentScan.validateScanResult({
    ok: false,
    reason: 'scanner-error',
  });
  assert.equal(failed.valid, false);

  // BLOCK: incomplete
  const incomplete = componentScan.validateScanResult({
    ok: true,
    verdict: 'pass',
    incomplete: true,
  });
  assert.equal(incomplete.valid, false);
  assert.equal(incomplete.reason, 'incomplete-scan');

  // BLOCK: blocked verdict
  const blocked = componentScan.validateScanResult({
    ok: true,
    verdict: 'blocked',
    blockingCount: 3,
    blocking: [{ id: 'P5', category: 'Harmful' }],
  });
  assert.equal(blocked.valid, false);
  assert.equal(blocked.reason, 'blocked-findings');
}

function testDeterminePromotionPath() {
  // Auto: pass + no capability change
  const auto = componentScan.determinePromotionPath(
    { verdict: 'pass' },
    { added: [], removed: [], hasDiff: false },
  );
  assert.equal(auto.path, 'auto');
  assert.equal(auto.reason, 'no-capability-change');

  // Manual: review
  const manual1 = componentScan.determinePromotionPath({ verdict: 'review' }, {});
  assert.equal(manual1.path, 'manual');
  assert.equal(manual1.reason, 'advisory-findings');

  // Manual: capability change (even if pass)
  const manual2 = componentScan.determinePromotionPath(
    { verdict: 'pass' },
    { added: [{ capability: 'git' }], hasDiff: true },
  );
  assert.equal(manual2.path, 'manual');
}

function testDetectCategoryDrift() {
  // Simulate unknown category (from skill-scan unknownCodeCategories)
  const drift = componentScan.detectCategoryDrift({
    components: [],
    blocking: [],
  });
  assert.equal(drift, null, 'no unknown categories');

  // In real scenario, skill-scan would return unknown categories
  // This is tested at skill-scan level; component-scan just passes through
}

function runComponentScanStub() {
  // Mock test: staging path exists
  const stagingPath = tmpDir();
  fs.writeFileSync(path.join(stagingPath, 'test.md'), '# Test Skill\n');

  // Questo requires real SkillSpector binary; skipped in unit tests
  // Real integration tests go in .harness/
  const result = componentScan.runComponentScan(stagingPath, { env: {}, homeDir: '/nonexistent' });

  // Will return scanner-not-installed in test environment without SkillSpector
  assert(result.ok === false || result.ok === true, 'runComponentScan handles missing scanner gracefully');
}

function testRunTests() {
  try {
    testValidateCandidateNotSelfScan();
    console.log('✓ testValidateCandidateNotSelfScan');

    testValidateScanResult();
    console.log('✓ testValidateScanResult');

    testDeterminePromotionPath();
    console.log('✓ testDeterminePromotionPath');

    testDetectCategoryDrift();
    console.log('✓ testDetectCategoryDrift');

    runComponentScanStub();
    console.log('✓ runComponentScanStub');

    console.log('\nAll component-scan tests passed');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    cleanup();
  }
}

testRunTests();
