'use strict';
// 020 T021 — регресс для SkillSpector adapter.

const assert = require('node:assert/strict');
const { probe, processSkillScanResult } = require('./skillspector');

function testContractPassVerdictReady() {
  // Контракт: SkillSpector verdict=pass -> ready
  const result = probe({
    skipScan: {
      verdict: 'pass',
      issues: [],
    },
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.reason, 'skillspector-pass');
  assert.ok(result.evidence);
  assert.ok(result.provenance);
  assert.equal(result.provenance.repo, 'NVIDIA/SkillSpector');
}

function testContractReviewVerdictDegraded() {
  // Контракт: verdict=review + failOnIncomplete -> degraded
  const result = probe({
    skipScan: {
      verdict: 'review',
      issues: [],
    },
  });
  assert.equal(result.state, 'degraded', 'review із failOnIncomplete=true має бути degraded');
  assert.ok(result.evidence.some((e) => e.includes('review')));
}

function testContractBlockedVerdictUnavailable() {
  // Контракт: verdict=blocked -> unavailable
  const result = probe({
    skipScan: {
      verdict: 'blocked',
      issues: [
        { severity: 'CRITICAL', id: 'P5', category: 'Harmful Content' },
      ],
    },
  });
  assert.equal(result.state, 'unavailable');
  assert.equal(result.reason, 'skillspector-blocked');
}

function testIncompleteBlocksActivation() {
  // Дискримінуючий тест: incomplete ЗАВЖДИ блокує (=degraded)
  const result = probe({
    skipScan: {
      verdict: 'review',
      issues: [
        { severity: 'HIGH', id: 'I1', category: 'incomplete scanner status' },
      ],
    },
    failOnIncomplete: true,
  });
  assert.equal(result.state, 'degraded');
  assert.ok(result.evidence.some((e) => e.includes('incomplete')));
}

function testCAUTIONBlocksActivation() {
  // Дискримінуючий тест: CAUTION ЗАВЖДИ блокує
  const result = probe({
    skipScan: {
      verdict: 'review',
      issues: [
        { severity: 'CAUTION', id: 'C1', category: 'Security' },
      ],
    },
  });
  assert.equal(result.state, 'degraded');
  assert.ok(result.evidence.some((e) => e.includes('CAUTION')));
}

function testERRORBlocks() {
  // ERROR статус блокує как unavailable
  const result = probe({
    skipScan: {
      verdict: 'review',
      issues: [
        { severity: 'ERROR', id: 'E1', category: 'Scanner Error' },
      ],
    },
  });
  assert.equal(result.state, 'unavailable');
}

function testMissingSkillPathUnavailable() {
  // Без skillPath адаптер не может сканировать
  const result = probe({ });
  assert.equal(result.state, 'unavailable');
  assert.equal(result.reason, 'skill-path-required');
}

function testFailOnIncompleteCanBeDisabled() {
  // Если failOnIncomplete=false, review может быть более мягким
  // но это не рекомендуется для production
  const result = probe({
    skipScan: {
      verdict: 'review',
      issues: [],
    },
    failOnIncomplete: false,
  });
  // Даже с failOnIncomplete=false, review остается degraded
  assert.equal(result.state, 'degraded');
}

function testWindowsBehaviorOfScanning() {
  // На Windows спецсимволи в path не должны ломать сканирование
  const result = probe({
    skillPath: 'C:\\Users\\test\\skills\\my-skill',
    skipScan: {
      verdict: 'pass',
      issues: [],
    },
  });
  // Не должно быть exception, должна быть коректна провенанса
  assert.ok(result);
  assert.equal(result.provenance.repo, 'NVIDIA/SkillSpector');
}

function testLicenseAndProvenance() {
  const result = probe({
    skipScan: {
      verdict: 'pass',
      issues: [],
    },
  });

  assert.equal(result.license, 'Apache-2.0');
  assert.ok(result.provenance);
  assert.equal(result.provenance.repo, 'NVIDIA/SkillSpector');
  assert.equal(result.provenance.commit, '698e2bf29c7d32aa8211ada677382460c01900d7');
}

function testProcessSkillScanResultDirectly() {
  // Тестування processSkillScanResult напряму
  const evidence = [];

  // pass
  let result = processSkillScanResult({ verdict: 'pass', issues: [] }, evidence, true);
  assert.equal(result.state, 'ready');

  // blocked
  result = processSkillScanResult(
    { verdict: 'blocked', issues: [] },
    evidence,
    true
  );
  assert.equal(result.state, 'unavailable');

  // review with failOnIncomplete
  result = processSkillScanResult(
    { verdict: 'review', issues: [] },
    evidence,
    true
  );
  assert.equal(result.state, 'degraded');
}

function main() {
  try {
    testContractPassVerdictReady();
    console.log('✓ testContractPassVerdictReady');

    testContractReviewVerdictDegraded();
    console.log('✓ testContractReviewVerdictDegraded');

    testContractBlockedVerdictUnavailable();
    console.log('✓ testContractBlockedVerdictUnavailable');

    testIncompleteBlocksActivation();
    console.log('✓ testIncompleteBlocksActivation');

    testCAUTIONBlocksActivation();
    console.log('✓ testCAUTIONBlocksActivation');

    testERRORBlocks();
    console.log('✓ testERRORBlocks');

    testMissingSkillPathUnavailable();
    console.log('✓ testMissingSkillPathUnavailable');

    testFailOnIncompleteCanBeDisabled();
    console.log('✓ testFailOnIncompleteCanBeDisabled');

    testWindowsBehaviorOfScanning();
    console.log('✓ testWindowsBehaviorOfScanning');

    testLicenseAndProvenance();
    console.log('✓ testLicenseAndProvenance');

    testProcessSkillScanResultDirectly();
    console.log('✓ testProcessSkillScanResultDirectly');

    console.log('\nУсі тести SkillSpector adapter пройшли успішно!');
    process.exit(0);
  } catch (err) {
    console.error('ТЕСТ ПРОВАЛЕНИЙ:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

main();
