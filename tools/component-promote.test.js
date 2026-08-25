'use strict';
// 020 T020 — Tests for component-promote.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const componentPromote = require('./component-promote');

let tmpRoot = null;
function tmpDir() {
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-promote-'));
  return fs.mkdtempSync(path.join(tmpRoot, 'p-'));
}
function cleanup() {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
}

function testValidateUpdaterNotCandidate() {
  // Different IDs: OK
  const ok = componentPromote.validateUpdaterNotCandidate('core/updater', 'skill/foo');
  assert.equal(ok.ok, true);

  // Same ID: BLOCK (self-promotion)
  const blocked = componentPromote.validateUpdaterNotCandidate('skill/foo', 'skill/foo');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'updater-is-candidate');
}

function testPromoteCandidateBasic() {
  const stagingPath = tmpDir();
  fs.writeFileSync(path.join(stagingPath, 'skill.md'), '# Skill Doc\n');

  const lock = {
    packs: {},
    generation: 1,
  };

  const descriptor = {
    id: 'skill/test',
    version: '1.0.0',
    commit: 'abc123',
    contentHash: 'hash-v1',
  };

  const coreDir = tmpDir();

  const result = componentPromote.promoteCandidate(lock, stagingPath, descriptor, {
    coreDir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.packId, 'skill/test');
  assert.equal(result.generation, 1); // First generation
  assert.ok(result.installPath);
  assert.equal(lock.packs['skill/test'].installed, true);
  assert.equal(lock.packs['skill/test'].installedGeneration, 1);
  assert.equal(lock.generation, 2); // Lock generation incremented
}

function testPromoteCandidateNoOp() {
  const stagingPath = tmpDir();
  fs.writeFileSync(path.join(stagingPath, 'test.txt'), 'data');

  // Already installed with same digest
  const lock = {
    packs: {
      'skill/foo': {
        id: 'skill/foo',
        version: '1.0.0',
        commit: 'abc123',
        contentHash: 'hash-v1',
        installed: true,
        installedGeneration: 1,
      },
    },
    generation: 1,
  };

  const descriptor = {
    id: 'skill/foo',
    version: '1.0.0',
    commit: 'abc123',
    contentHash: 'hash-v1', // Same hash
  };

  const result = componentPromote.promoteCandidate(lock, stagingPath, descriptor, {
    coreDir: tmpDir(),
  });

  // Should return no-op, not re-install
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-op-install');
  assert.equal(result.existingGeneration, 1);
}

function testPromoteCandidateUpgrade() {
  const stagingPath = tmpDir();
  fs.writeFileSync(path.join(stagingPath, 'new.txt'), 'new content');

  // Previous version installed
  const lock = {
    packs: {
      'skill/foo': {
        id: 'skill/foo',
        version: '1.0.0',
        commit: 'abc123',
        contentHash: 'hash-v1',
        installed: true,
        installedGeneration: 1,
      },
    },
    generation: 1,
  };

  const newDescriptor = {
    id: 'skill/foo',
    version: '2.0.0',
    commit: 'def456',
    contentHash: 'hash-v2', // Different hash
  };

  const coreDir = tmpDir();

  const result = componentPromote.promoteCandidate(lock, stagingPath, newDescriptor, {
    coreDir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.generation, 2); // Incremented from 1 to 2
  assert.equal(lock.packs['skill/foo'].installedGeneration, 2);
  assert.equal(lock.generation, 2);
}

function testWritePromotionReceipt() {
  const receiptLog = path.join(tmpDir(), 'receipts.jsonl');

  const result = componentPromote.writePromotionReceipt(
    receiptLog,
    'skill/test',
    1,
    2,
    'hash-v2',
    { updaterId: 'core', graphVersion: '5.0.0' },
  );

  assert.equal(result.ok, true);
  assert.ok(fs.existsSync(receiptLog));

  const lines = fs.readFileSync(receiptLog, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);

  const receipt = JSON.parse(lines[0]);
  assert.equal(receipt.type, 'promotion');
  assert.equal(receipt.packId, 'skill/test');
  assert.equal(receipt.oldGeneration, 1);
  assert.equal(receipt.newGeneration, 2);
  assert.equal(receipt.contentHash, 'hash-v2');
}

function testRollbackToGeneration() {
  const receiptLog = path.join(tmpDir(), 'receipts.jsonl');

  const lock = {
    packs: {
      'skill/bad': {
        id: 'skill/bad',
        version: '2.0.0',
        commit: 'bad123',
        contentHash: 'hash-v2',
        installed: true,
        installedGeneration: 2,
      },
    },
    generation: 5,
  };

  // Rollback from generation 2 to 1
  const result = componentPromote.rollbackToGeneration(lock, 'skill/bad', 1, {
    receiptLog,
    updaterId: 'core',
    reason: 'runtime-regression',
  });

  assert.equal(result.ok, true);
  assert.equal(result.fromGeneration, 2);
  assert.equal(result.toGeneration, 1);
  assert.equal(lock.packs['skill/bad'].installedGeneration, 1);
  assert.equal(lock.generation, 6); // Generation incremented (forward-only)

  // Verify receipt was written
  assert.ok(fs.existsSync(receiptLog));
  const lines = fs.readFileSync(receiptLog, 'utf8').trim().split('\n');
  const receipt = JSON.parse(lines[0]);
  assert.equal(receipt.type, 'rollback');
  assert.equal(receipt.fromGeneration, 2);
  assert.equal(receipt.toGeneration, 1);
}

function testRollbackInvalidTarget() {
  const lock = {
    packs: {
      'skill/test': {
        id: 'skill/test',
        installed: true,
        installedGeneration: 1,
      },
    },
  };

  // Cannot roll back from 1 to 1 (invalid target)
  const result1 = componentPromote.rollbackToGeneration(lock, 'skill/test', 1);
  assert.equal(result1.ok, false);
  assert.equal(result1.reason, 'invalid-rollback-target');

  // Cannot roll back from 1 to 2 (generation does not exist)
  const result2 = componentPromote.rollbackToGeneration(lock, 'skill/test', 2);
  assert.equal(result2.ok, false);
}

function testRollbackMissingPack() {
  const lock = { packs: {} };

  const result = componentPromote.rollbackToGeneration(lock, 'nonexistent', 1);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'pack-not-found');
}

function runTests() {
  try {
    console.log('Running component-promote tests...\n');

    testValidateUpdaterNotCandidate();
    console.log('✓ testValidateUpdaterNotCandidate');

    testPromoteCandidateBasic();
    console.log('✓ testPromoteCandidateBasic');

    testPromoteCandidateNoOp();
    console.log('✓ testPromoteCandidateNoOp');

    testPromoteCandidateUpgrade();
    console.log('✓ testPromoteCandidateUpgrade');

    testWritePromotionReceipt();
    console.log('✓ testWritePromotionReceipt');

    testRollbackToGeneration();
    console.log('✓ testRollbackToGeneration');

    testRollbackInvalidTarget();
    console.log('✓ testRollbackInvalidTarget');

    testRollbackMissingPack();
    console.log('✓ testRollbackMissingPack');

    console.log('\nAll component-promote tests passed!');
    process.exit(0);
  } catch (err) {
    console.error('Test failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    cleanup();
  }
}

runTests();
