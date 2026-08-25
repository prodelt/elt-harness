'use strict';
// 020 T018 — Регресс для component-catalog.
//
// Catalog перевіряє manifest перед execution: немає node — немає edge.
// Policy constraints: external pack не може claim approve/certify/commit/publish.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CATALOG_SCHEMA,
  loadCatalog,
  resolveNode,
  checkDuplicateNodeIds,
  validateNodePolicy,
  listPacksInCatalog,
} = require('./component-catalog');

let tmpRoot = null;
function tmpCatalog() {
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-catalog-'));
  return path.join(fs.mkdtempSync(path.join(tmpRoot, 'c-')), 'components.json');
}
function cleanup() {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
}

function defaultManifest() {
  return {
    schemaVersion: 1,
    createdAt: '2026-08-25T12:00:00Z',
    packs: [
      {
        id: 'elt/core',
        name: 'ELT Core',
        version: '5.0.0',
        trust: 'core',
        nodes: [
          {
            id: 'elt/oracle',
            kind: 'gate',
            consumes: ['task-scope'],
            produces: ['oracle-verdict'],
            guards: [],
            sideEffects: ['workspace'],
            trust: 'core',
            timeoutMs: 300000,
            failure: 'block',
          },
          {
            id: 'elt/commit',
            kind: 'sink',
            consumes: ['oracle-verdict'],
            produces: ['commit-proof'],
            guards: [],
            sideEffects: ['git'],
            trust: 'core',
            timeoutMs: 60000,
            failure: 'block',
          },
        ],
      },
    ],
  };
}

function testLoadEmptyCatalog() {
  const file = tmpCatalog();
  const result = loadCatalog(file);
  assert.equal(result.ok, true);
  assert.deepEqual(result.packs, {});
  assert.deepEqual(result.nodeById, {});
}

// Duplicate name: коли дві node'и мають однаковий ID.
function testLoadCatalogDetectsDuplicateNodeIds() {
  const file = tmpCatalog();
  const manifest = defaultManifest();
  manifest.packs[0].nodes.push({
    id: 'elt/oracle', // duplicate!
    kind: 'action',
    consumes: [],
    produces: [],
    guards: [],
    sideEffects: [],
    trust: 'core',
    timeoutMs: 30000,
    failure: 'block',
  });
  fs.writeFileSync(file, JSON.stringify(manifest), 'utf8');
  const result = loadCatalog(file);
  // Коллизия — ОТКАЗ загрузки, а не «каталог с замечаниями». Прежняя версия возвращала
  // ok:true с полем errors, в которое никто не смотрел: resolveNode() проверял только
  // catalog.ok, и работа продолжалась с реестром, где один ID означает две разные вещи.
  assert.equal(result.ok, false, 'неоднозначный реестр не имеет права загрузиться');
  assert.equal(result.reason, 'duplicate-node-id');
  assert.match(result.detail, /elt\/oracle/);

  // И следствие, ради которого всё делалось: с таким каталогом ничего не резолвится.
  const resolved = resolveNode(result, 'elt/oracle');
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, 'catalog-invalid');
}

// Дубликат ищется в ИСХОДНОМ манифесте: в схлопнутом индексе его быть не может по
// определению, поэтому прежняя проверка возвращала пустой список всегда.
function testDuplicateDetectionReadsManifestNotIndex() {
  const file = tmpCatalog();
  const manifest = defaultManifest();
  manifest.packs[0].nodes.push({
    id: 'elt/oracle', kind: 'action', consumes: [], produces: [], guards: [],
    sideEffects: [], trust: 'core', timeoutMs: 30000, failure: 'block',
  });
  fs.writeFileSync(file, JSON.stringify(manifest), 'utf8');
  assert.deepEqual(checkDuplicateNodeIds(file), ['elt/oracle']);

  const clean = tmpCatalog();
  fs.writeFileSync(clean, JSON.stringify(defaultManifest()), 'utf8');
  assert.deepEqual(checkDuplicateNodeIds(clean), [], 'чистый манифест дубликатов не имеет');
}

// Missing pack: резолюція несуществующей node'и.
function testResolveNodeNotFound() {
  const file = tmpCatalog();
  fs.writeFileSync(file, JSON.stringify(defaultManifest()), 'utf8');
  const catalog = loadCatalog(file);
  const result = resolveNode(catalog, 'missing/node');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'node-not-found');
  assert.equal(result.nodeId, 'missing/node');
}

// Резолюція існуючої node'и
function testResolveNodeFound() {
  const file = tmpCatalog();
  fs.writeFileSync(file, JSON.stringify(defaultManifest()), 'utf8');
  const catalog = loadCatalog(file);
  const result = resolveNode(catalog, 'elt/oracle');
  assert.equal(result.ok, true);
  assert.equal(result.nodeId, 'elt/oracle');
  assert.equal(result.packId, 'elt/core');
  assert.equal(result.kind, 'gate');
  assert.equal(result.trust, 'core');
}

// Policy violation: external pack не може claim commit/publish.
function testPolicyViolationExternalPackWithAuthorityCapability() {
  const node = {
    id: 'external/node',
    trust: 'reviewed',
    kind: 'action',
    produces: ['commit-proof'], // VIOLATION: external pack не може produce commit
  };
  const errors = validateNodePolicy(node);
  assert.ok(errors.length > 0);
  const policyError = errors.find((e) => e.reason === 'external-pack-authority-claim');
  assert.ok(policyError, 'мав бути виявлений policy violation');
}

// Authority node мав failure:block
function testAuthorityNodeMustBeBlock() {
  const node = {
    id: 'elt/gate',
    trust: 'core',
    kind: 'gate', // authority node
    failure: 'skip', // VIOLATION: повинне бути 'block'
    produces: [],
  };
  const errors = validateNodePolicy(node);
  assert.ok(errors.length > 0);
  const blockError = errors.find((e) => e.reason === 'authority-node-not-block');
  assert.ok(blockError);
}

// Без policy violations для proper node
function testValidPolicyNoErrors() {
  const node = {
    id: 'elt/oracle',
    trust: 'core',
    kind: 'gate',
    failure: 'block',
    produces: ['oracle-verdict'],
  };
  const errors = validateNodePolicy(node);
  assert.deepEqual(errors, []);
}

// Duplicate node IDs check explicit
function testCheckDuplicateNodeIds() {
  const file = tmpCatalog();
  fs.writeFileSync(file, JSON.stringify(defaultManifest()), 'utf8');
  // Проверка читает манифест, а не собранный индекс: см. комментарий у самой функции.
  assert.deepEqual(checkDuplicateNodeIds(file), []);
}

// List packs у catalog
function testListPacksInCatalog() {
  const file = tmpCatalog();
  fs.writeFileSync(file, JSON.stringify(defaultManifest()), 'utf8');
  const catalog = loadCatalog(file);
  const packs = listPacksInCatalog(catalog);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].id, 'elt/core');
}

function main() {
  const tests = [
    testLoadEmptyCatalog,
    testLoadCatalogDetectsDuplicateNodeIds,
    testDuplicateDetectionReadsManifestNotIndex,
    testResolveNodeNotFound,
    testResolveNodeFound,
    testPolicyViolationExternalPackWithAuthorityCapability,
    testAuthorityNodeMustBeBlock,
    testValidPolicyNoErrors,
    testCheckDuplicateNodeIds,
    testListPacksInCatalog,
  ];
  console.log('Running component-catalog tests...');
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
  if (process.exitCode === 1) { console.error('component-catalog tests: FAIL'); process.exit(1); }
  console.log('component-catalog tests: PASS');
}

if (require.main === module) main();
module.exports = {
  testLoadEmptyCatalog,
  testLoadCatalogDetectsDuplicateNodeIds,
  testDuplicateDetectionReadsManifestNotIndex,
  testResolveNodeNotFound,
  testResolveNodeFound,
  testPolicyViolationExternalPackWithAuthorityCapability,
  testAuthorityNodeMustBeBlock,
  testValidPolicyNoErrors,
  testCheckDuplicateNodeIds,
  testListPacksInCatalog,
};
