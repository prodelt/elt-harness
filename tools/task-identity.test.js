'use strict';
// 020 T014 — регресс канонической identity и подписи `elt-approval/v1`.
//
// Golden-фикстура держится в КОДЕ, а не в файле на диске: файл проходит через
// .gitattributes и чекаут, и его байты на Windows и Linux не гарантированы. Строки с явными
// \n дают один и тот же вход обеим ОС, поэтому зафиксированный ниже digest — настоящая
// кросс-платформенная проверка, а не описание того, что случайно лежит в дереве.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  APPROVAL_SCHEMA, approvalDigest, approvalDigestFromTexts, canonicalText,
  identityKey, repoRelativePosix, sameIdentity, taskIdentities,
} = require('./task-identity');

const GOLDEN_SPEC = [
  '# Спека 999',
  '',
  '## Проблема',
  'Тестова проблема з кирилицею: підпис, їжак, майдан, ідентичність.',
  '',
].join('\n');

const GOLDEN_TASKS = [
  '# Завдання',
  '',
  '- [ ] **T001** Перше завдання',
  '  [files: tools/a.js]',
  '',
  '- [ ] **T002** Друге завдання',
  '  [files: tools/b.js tools/b.test.js]',
  '',
].join('\n');

// Зафиксированный digest. Если он изменится — изменилась СХЕМА, и по спеке это делает все
// прежние подписи stale; такой коммит обязан быть осознанным, а не побочным.
const GOLDEN_DIGEST = 'f7a7e0260adf2189a4279ed3ec019aa855e7ad20d6b2048ee6f7c08085d844d0';

function goldenEntries() {
  return [
    { role: 'spec', path: 'specs/999-golden/spec.md', text: GOLDEN_SPEC },
    { role: 'tasks', path: 'specs/999-golden/tasks.md', text: GOLDEN_TASKS },
  ];
}

function testGoldenDigestIsStable() {
  const result = approvalDigestFromTexts(goldenEntries());
  assert.equal(result.schema, APPROVAL_SCHEMA);
  assert.equal(result.digest, GOLDEN_DIGEST, 'схема подписи изменилась — все прежние approval становятся stale');
}

// CRLF, BOM и NFD дают те же байты подписи: ровно три источника расхождения
// Windows ↔ Linux, из-за которых fleet на Windows не мог закоммитить ни один слайс (D4).
function testLineEndingsBomAndUnicodeFormDoNotChangeDigest() {
  const crlf = goldenEntries().map((e) => ({ ...e, text: e.text.replace(/\n/g, '\r\n') }));
  assert.equal(approvalDigestFromTexts(crlf).digest, GOLDEN_DIGEST, 'CRLF не должен менять подпись');

  const bom = goldenEntries().map((e, i) => (i === 0 ? { ...e, text: `﻿${e.text}` } : e));
  assert.equal(approvalDigestFromTexts(bom).digest, GOLDEN_DIGEST, 'BOM от PowerShell не должен менять подпись');

  const nfd = goldenEntries().map((e) => ({ ...e, text: e.text.normalize('NFD') }));
  assert.equal(approvalDigestFromTexts(nfd).digest, GOLDEN_DIGEST, 'NFD-форма той же кириллицы не должна менять подпись');
}

// Статус выполнения не входит в намерение: закрытие задачи не должно протухать подпись —
// именно это стоило 8 лишних переутверждений на спеке из 9 задач (D11).
function testCheckboxStateDoesNotChangeDigest() {
  const done = goldenEntries().map((e) => (e.role === 'tasks' ? { ...e, text: e.text.replace('- [ ] **T001**', '- [X] **T001**') } : e));
  assert.equal(approvalDigestFromTexts(done).digest, GOLDEN_DIGEST);
}

// А вот смысл менять подпись обязан: текст задачи, её зона и появление новой задачи.
function testMeaningfulChangesBreakDigest() {
  const retitled = goldenEntries().map((e) => (e.role === 'tasks' ? { ...e, text: e.text.replace('Перше завдання', 'Перше завдання (інше)') } : e));
  assert.notEqual(approvalDigestFromTexts(retitled).digest, GOLDEN_DIGEST);

  const rezoned = goldenEntries().map((e) => (e.role === 'tasks' ? { ...e, text: e.text.replace('tools/a.js', 'tools/z.js') } : e));
  assert.notEqual(approvalDigestFromTexts(rezoned).digest, GOLDEN_DIGEST);

  const added = goldenEntries().map((e) => (e.role === 'tasks' ? { ...e, text: `${e.text}\n- [ ] **T003** Третє завдання\n` } : e));
  assert.notEqual(approvalDigestFromTexts(added).digest, GOLDEN_DIGEST);
}

// Length-prefix: перенос текста через границу файлов даёт ДРУГУЮ подпись. Без длины оба
// варианта склеивались бы в один поток байтов и были бы неразличимы.
function testRecordBoundariesAreUnambiguous() {
  const moved = [
    { role: 'spec', path: 'specs/999-golden/spec.md', text: `${GOLDEN_SPEC}# Завдання\n` },
    { role: 'tasks', path: 'specs/999-golden/tasks.md', text: GOLDEN_TASKS.replace('# Завдання\n', '') },
  ];
  assert.notEqual(approvalDigestFromTexts(moved).digest, GOLDEN_DIGEST, 'границы записей обязаны быть однозначны');
}

// Путь входит в подпись: тот же текст под другой спекой — другая подпись.
function testPathIsPartOfDigest() {
  const renamed = goldenEntries().map((e) => ({ ...e, path: e.path.replace('999-golden', '998-other') }));
  assert.notEqual(approvalDigestFromTexts(renamed).digest, GOLDEN_DIGEST);
}

// Порядок ролей фиксирован: перестановка spec и tasks не должна давать ту же подпись.
function testRoleOrderMatters() {
  const swapped = [goldenEntries()[1], goldenEntries()[0]];
  assert.notEqual(approvalDigestFromTexts(swapped).digest, GOLDEN_DIGEST);
}

// Чтение с диска обязано совпасть с фикстурой байт в байт — иначе golden проверяет только
// сам себя, а не рабочий путь функции.
function testDigestFromDiskMatchesFixture() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-approval-'));
  try {
    const specDir = path.join(repoDir, 'specs', '999-golden');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), GOLDEN_SPEC.replace(/\n/g, '\r\n'), 'utf8');
    fs.writeFileSync(path.join(specDir, 'tasks.md'), GOLDEN_TASKS, 'utf8');
    const result = approvalDigest({ repoDir, specDir });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.digest, GOLDEN_DIGEST);
    assert.deepEqual(result.records.map((r) => r.path), ['specs/999-golden/spec.md', 'specs/999-golden/tasks.md']);
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

function testMissingFileIsRefusedNotGuessed() {
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-approval-'));
  try {
    const specDir = path.join(repoDir, 'specs', '999-golden');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), GOLDEN_SPEC, 'utf8');
    const result = approvalDigest({ repoDir, specDir });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing-tasks');
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

function testRepoRelativePathIsPosix() {
  const repoDir = path.join('C:', 'repo');
  assert.equal(repoRelativePosix(repoDir, path.join(repoDir, 'specs', '020-x', 'tasks.md')), 'specs/020-x/tasks.md');
}

// Identity задачи = (спека, id, позиция). Голый `T013` живёт в каждой спеке репозитория, и
// именно поэтому легаси-строки run-log без specPath неразрешимы (см. graph-state).
function testTaskIdentitiesKeepFileOrderAndSpec() {
  const identities = taskIdentities(GOLDEN_TASKS, 'specs/999-golden/tasks.md');
  assert.deepEqual(identities.map((t) => t.id), ['T001', 'T002']);
  assert.deepEqual(identities.map((t) => t.index), [0, 1]);
  assert.equal(identities[0].specPath, 'specs/999-golden/tasks.md');
  assert.equal(identities[1].title, 'Друге завдання');
  assert.equal(identityKey(identities[0]), 'specs/999-golden/tasks.md#T001');
}

function testClosedTasksKeepIdentity() {
  const identities = taskIdentities(GOLDEN_TASKS.replace('- [ ] **T001**', '- [X] **T001**'), 'specs/999-golden/tasks.md');
  assert.deepEqual(identities.map((t) => t.id), ['T001', 'T002'], 'закрытая задача остаётся в идентичности плана');
}

function testSameIdentityIsStrict() {
  const a = { specPath: 's/tasks.md', id: 'T001', index: 0 };
  assert.equal(sameIdentity(a, { ...a }), true);
  assert.equal(sameIdentity(a, { ...a, index: 1 }), false, 'сдвиг задачи в плане — другая identity');
  assert.equal(sameIdentity(a, { ...a, specPath: 'other/tasks.md' }), false);
  assert.equal(sameIdentity(a, null), false);
}

function testCanonicalTextIsIdempotent() {
  const once = canonicalText(`﻿- [X] **T001** тест\r\n`);
  assert.equal(canonicalText(once), once, 'канонизация обязана быть идемпотентной');
  assert.equal(once, '- [ ] **T001** тест\n');
}

function main() {
  testGoldenDigestIsStable();
  testLineEndingsBomAndUnicodeFormDoNotChangeDigest();
  testCheckboxStateDoesNotChangeDigest();
  testMeaningfulChangesBreakDigest();
  testRecordBoundariesAreUnambiguous();
  testPathIsPartOfDigest();
  testRoleOrderMatters();
  testDigestFromDiskMatchesFixture();
  testMissingFileIsRefusedNotGuessed();
  testRepoRelativePathIsPosix();
  testTaskIdentitiesKeepFileOrderAndSpec();
  testClosedTasksKeepIdentity();
  testSameIdentityIsStrict();
  testCanonicalTextIsIdempotent();
  process.stdout.write('task identity tests: PASS\n');
}

main();
