'use strict';
// 020 T018 — Регресс для component-store.
//
// Усі перевірки йдуть на НАСТОЯЩОМУ файлі у временному каталозі:
// store управляє immutable lock, і це про atomicity, collisions та content hashing,
// чого на моках не проверяется.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  STORE_SCHEMA,
  validatePackContent,
  loadLock,
  resolvePackInLock,
  checkInstallationIdempotent,
  addPackToLock,
  listInstalledPacks,
  lockDigestChanged,
} = require('./component-store');

let tmpRoot = null;
function tmpLock() {
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-store-'));
  return path.join(fs.mkdtempSync(path.join(tmpRoot, 's-')), 'components.lock.json');
}
function cleanup() {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
}

function defaultLock() {
  return {
    schemaVersion: 1,
    createdAt: '2026-08-25T12:00:00Z',
    lockDigest: 'abc123def456',
    generation: 1,
    packs: {
      'elt/core': {
        id: 'elt/core',
        version: '5.0.0',
        commit: '0c649e7',
        contentHash: 'hash-core-1',
        installPath: '.elt/packs/elt-core',
        installed: true,
        installedGeneration: 1,
      },
    },
    capabilities: {},
  };
}

function testLoadEmptyLock() {
  const file = tmpLock();
  const result = loadLock(file);
  assert.equal(result.ok, true);
  assert.equal(result.lockDigest, null);
  assert.equal(result.generation, 0);
  assert.deepEqual(result.packs, {});
}

// No-op resolve: коли lock не має пакету, резолюція відмовляє, не silent-skip.
function testNoOpResolveReturnsMissingPack() {
  const file = tmpLock();
  fs.writeFileSync(file, JSON.stringify(defaultLock()), 'utf8');
  const lock = loadLock(file);
  const result = resolvePackInLock(lock, 'missing/pack');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing-pack');
  assert.equal(result.packId, 'missing/pack');
}

// Missing pack: поточно встановлені пакети можуть бути rezolved успішно.
function testResolveInstalledPack() {
  const file = tmpLock();
  fs.writeFileSync(file, JSON.stringify(defaultLock()), 'utf8');
  const lock = loadLock(file);
  const result = resolvePackInLock(lock, 'elt/core');
  assert.equal(result.ok, true);
  assert.equal(result.packId, 'elt/core');
  assert.equal(result.version, '5.0.0');
  assert.equal(result.generation, 1);
}

// Duplicate name: додавання пакету з існуючим ID повинно відмовити.
function testAddDuplicatePackIdFails() {
  const file = tmpLock();
  fs.writeFileSync(file, JSON.stringify(defaultLock()), 'utf8');
  const lock = loadLock(file);
  const result = addPackToLock(lock, {
    id: 'elt/core',
    version: '5.0.1',
    commit: 'newcommit',
    contentHash: 'newhash',
    installPath: '.elt/packs/elt-core-new',
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'duplicate-pack-id');
  assert.equal(result.packId, 'elt/core');
}

// Modified bytes: коли контент не збігається з expectedHash.
function testValidatePackContentMismatch() {
  const actualBytes = Buffer.from('changed content');
  const expectedHash = 'abc123def456789';
  const result = validatePackContent('elt/core', expectedHash, actualBytes);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'content-mismatch');
  assert.equal(result.packId, 'elt/core');
  assert.notEqual(result.actual, result.expected);
}

// Modified bytes: коли контент збігається.
function testValidatePackContentMatch() {
  const content = 'exact content';
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const result = validatePackContent('elt/core', contentHash, Buffer.from(content));
  assert.equal(result.ok, true);
}

// Denied fs/git/network/secret/process: це обрабатывается у capability-broker.js,
// але store фіксує idempotent installation — якщо вже встановлено з тим самим хешем,
// то new install є no-op.
function testCheckInstallationIdempotent() {
  const file = tmpLock();
  fs.writeFileSync(file, JSON.stringify(defaultLock()), 'utf8');
  const lock = loadLock(file);
  const isIdempotent = checkInstallationIdempotent(
    lock,
    'elt/core',
    '5.0.0',
    '0c649e7',
    'hash-core-1'
  );
  assert.equal(isIdempotent, true);
  const notIdempotent = checkInstallationIdempotent(
    lock,
    'elt/core',
    '5.0.1', // different version
    '0c649e7',
    'hash-core-1'
  );
  assert.equal(notIdempotent, false);
}

// Rollback generation receipt: нова generation, відкат у stale version.
// Lock digest змінюється, але старий proof залишається immutable у ledger.
function testLockDigestChanged() {
  const oldDigest = 'abc123def456';
  const newLock = {
    lockDigest: 'xyz789abc123', // змінився
    generation: 2,
    packs: {},
  };
  const changed = lockDigestChanged(oldDigest, newLock);
  assert.equal(changed, true, 'lock digest должен измениться');
  const unchanged = lockDigestChanged('xyz789abc123', newLock);
  assert.equal(unchanged, false);
}

// Pack self-promotion denied: pack не може запустити процес power升級 себе.
function testPackSelfResolveProhibited() {
  const file = tmpLock();
  fs.writeFileSync(file, JSON.stringify(defaultLock()), 'utf8');
  const lock = loadLock(file);
  const result = resolvePackInLock(lock, 'elt/core', 'elt/core');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'pack-self-resolve-denied');
}

// Список встановлених пакетів
function testListInstalledPacks() {
  const file = tmpLock();
  fs.writeFileSync(file, JSON.stringify(defaultLock()), 'utf8');
  const lock = loadLock(file);
  const installed = listInstalledPacks(lock);
  assert.equal(installed.length, 1);
  assert.equal(installed[0].id, 'elt/core');
}

// Generation increment після добавления
function testAddPackIncrementsGeneration() {
  const file = tmpLock();
  fs.writeFileSync(file, JSON.stringify(defaultLock()), 'utf8');
  const lock = loadLock(file);
  const before = lock.generation;
  addPackToLock(lock, {
    id: 'test/pack',
    version: '1.0.0',
    commit: 'abc123',
    contentHash: 'hash1',
    installPath: '.elt/packs/test-pack',
  });
  assert.equal(lock.generation, before + 1);
}

function main() {
  const tests = [
    testLoadEmptyLock,
    testNoOpResolveReturnsMissingPack,
    testResolveInstalledPack,
    testAddDuplicatePackIdFails,
    testValidatePackContentMismatch,
    testValidatePackContentMatch,
    testCheckInstallationIdempotent,
    testLockDigestChanged,
    testPackSelfResolveProhibited,
    testListInstalledPacks,
    testAddPackIncrementsGeneration,
  ];
  console.log('Running component-store tests...');
  tests.forEach((test) => {
    try {
      test();
      console.log(`PASS: ${test.name}`);
    } catch (e) {
      console.error(`FAIL: ${test.name}`);
      console.error(e.message);
      process.exitCode = 1;
    }
  });
  cleanup();
  console.log('All tests completed.');
  if (process.exitCode === 1) process.exit(1);
}

if (require.main === module) main();
module.exports = {
  testLoadEmptyLock,
  testNoOpResolveReturnsMissingPack,
  testResolveInstalledPack,
  testAddDuplicatePackIdFails,
  testValidatePackContentMismatch,
  testValidatePackContentMatch,
  testCheckInstallationIdempotent,
  testLockDigestChanged,
  testPackSelfResolveProhibited,
  testListInstalledPacks,
  testAddPackIncrementsGeneration,
};
