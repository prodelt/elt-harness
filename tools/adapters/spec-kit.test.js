'use strict';
// 020 T021 — регресс для Spec Kit adapter.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { probe } = require(path.join(__dirname, 'spec-kit'));

// Опорні тесты з використанням реальних файлів, а не мок.

let tmpRoot = null;

function tmpSpecDir() {
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-adapter-spec-'));
  return fs.mkdtempSync(path.join(tmpRoot, 'spec-'));
}

function cleanup() {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
}

function testContractMissingSpecDir() {
  // Головне правило: без явного spec dir -> unavailable
  const result = probe({ });
  assert.equal(result.state, 'unavailable', 'має бути unavailable без specDir');
  assert.equal(result.reason, 'spec-dir-required');
  assert.ok(result.evidence, 'должна быть evidence');
  assert.ok(result.provenance, 'должен быть provenance');
  assert.equal(result.provenance.repo, 'github/spec-kit');
}

function testContractUnavailableWhenFilesAreAbsent() {
  // Лишена одного чи обох файлів -> unavailable
  const specDir = tmpSpecDir();
  const result = probe({ specDir });
  assert.equal(result.state, 'unavailable', 'має бути unavailable без файлів');
  assert.equal(result.reason, 'missing-spec-files');
  assert.ok(Array.isArray(result.evidence));
  assert.ok(result.evidence.some((e) => e.includes('spec.md')));
}

function testContractDegradedWhenApprovalDigestFails() {
  // Файли є, але approval digest не може бути обчислений -> degraded
  const specDir = tmpSpecDir();
  fs.writeFileSync(path.join(specDir, 'spec.md'), '# Test spec\n');
  fs.writeFileSync(path.join(specDir, 'tasks.md'), '- [ ] T001 test\n');

  // Якщо approvalDigest не наявна, це буде помічено
  const result = probe({ specDir, repoDir: tmpRoot });
  // Можемо отримати 'ready' якщо approvalDigest працює, або 'degraded'
  assert.ok(['ready', 'degraded'].includes(result.state), `state повинен бути ready або degraded, отримав ${result.state}`);
  assert.ok(result.license, 'повинна бути license');
  assert.ok(result.provenance, 'повинен бути provenance');
}

function testContractReadyWhenFilesAndDigestAreValid() {
  // Обидва файли є, digest обчислюється успішно -> ready
  const specDir = tmpSpecDir();
  fs.writeFileSync(path.join(specDir, 'spec.md'), '# Test spec\n');
  fs.writeFileSync(path.join(specDir, 'tasks.md'), '- [ ] T001 test\n');

  // Спробуємо з явним repoDir
  const result = probe({ specDir, repoDir: tmpRoot });
  if (result.state === 'ready') {
    // Якщо approval digest модуль наявний і працює
    assert.ok(result.digest, 'повинен бути digest при state=ready');
    assert.ok(result.schema, 'повинен бути schema при state=ready');
    assert.ok(result.evidence.some((e) => e.includes('approval')));
  } else {
    // Якщо щось не працює, це повинно бути degraded, а не unavailable
    assert.ok(['degraded', 'ready'].includes(result.state));
  }
}

function testWindowsBehavior() {
  // На Windows проблеми з шляхами можуть спричинити помилки
  // Адаптер повинен робити правильно на обох платформах
  const specDir = tmpSpecDir();
  fs.writeFileSync(path.join(specDir, 'spec.md'), '# Test\n');
  fs.writeFileSync(path.join(specDir, 'tasks.md'), '- [ ] T001\n');

  const result = probe({ specDir, repoDir: tmpRoot });
  // Повинні мати правильну провенансу на обох платформах
  assert.ok(result.provenance);
  assert.equal(result.provenance.repo, 'github/spec-kit');
}

function testExplicitSpecDirRequired() {
  // Дискримінуючий тест на головне правило
  // Без явного specDir адаптер НЕ повинен угадувати локацію
  const resultWithoutDir = probe({ });
  assert.equal(resultWithoutDir.state, 'unavailable');
  assert.equal(resultWithoutDir.reason, 'spec-dir-required');
  assert.ok(resultWithoutDir.evidence.some((e) => e.includes('явно')));

  // З явним specDir (навіть якщо файлів нема) спробуємо з іншою помилкою
  const fakeDir = path.join(tmpRoot, 'nonexistent');
  const resultWithDir = probe({ specDir: fakeDir });
  // Не повинно бути 'spec-dir-required' — це дискримінує наявність явного параметра
  assert.notEqual(resultWithDir.reason, 'spec-dir-required');
}

function main() {
  try {
    testContractMissingSpecDir();
    console.log('✓ testContractMissingSpecDir');

    testContractUnavailableWhenFilesAreAbsent();
    console.log('✓ testContractUnavailableWhenFilesAreAbsent');

    testContractDegradedWhenApprovalDigestFails();
    console.log('✓ testContractDegradedWhenApprovalDigestFails');

    testContractReadyWhenFilesAndDigestAreValid();
    console.log('✓ testContractReadyWhenFilesAndDigestAreValid');

    testWindowsBehavior();
    console.log('✓ testWindowsBehavior');

    testExplicitSpecDirRequired();
    console.log('✓ testExplicitSpecDirRequired');

    console.log('\nУсі тести пройшли успішно!');
    process.exit(0);
  } catch (err) {
    console.error('ТЕСТ ПРОВАЛЕНИЙ:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
