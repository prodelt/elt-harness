'use strict';
// 024 T008 — конфиг стал контрактом.
//
// `validateHarnessConfig` проверял ВОСЕМЬ полей из тридцати трёх, которые читает код.
// Остальные при опечатке не отвергались, а МЕНЯЛИ ПОВЕДЕНИЕ ГЕЙТА. Живой замер до фикса:
//
//     validateHarnessConfig({ shel: 'bash', oracelSelect: 'impact', batch: 'three',
//                             specApproval: 'no', redProof: 'OFF' })  →  { ok: true }
//
// Ни одна поддержка не воспроизведёт «у меня redProof выключен, а он работает».

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { checkSchema, FIELDS, SCHEMA_VERSION } = require('./harness-schema');
const { validateHarnessConfig } = require('./elt-config');

const base = { kind: 'code', oracle: 'node -e "process.exit(0)"', judge: { enabled: false } };

test('024 T008: тот самый конфиг, который раньше проходил как валидный, теперь отвергается', () => {
  const r = validateHarnessConfig({
    ...base, shel: 'bash', oracelSelect: 'impact', batch: 'three', specApproval: 'no', redProof: 'OFF',
  });
  assert.equal(r.ok, false, 'конфиг, который молча меняет поведение гейта, обязан отвергаться');
  const errors = r.errors.join(' | ');
  assert.match(errors, /batch/, errors);
  assert.match(errors, /specApproval/, errors);
  assert.match(errors, /redProof/, errors);
  // Опечатки в ИМЕНАХ — предупреждение, не отказ: у существующих проектов лежат поля от
  // снятых спек, и отказ на них сломал бы работающие установки на ровном месте.
  const warnings = (r.warnings || []).join(' | ');
  assert.match(warnings, /shel/, warnings);
  assert.match(warnings, /oracelSelect/, warnings);
});

test('024 T008: строковый «булев» назван прямо — он truthy и потому переключает гейт', () => {
  // `specApproval: "no"` включал гейт подписи, `redProof: "OFF"` включал контур red-proof.
  // Сообщение обязано объяснять ПОЧЕМУ, иначе автор конфига будет искать опечатку в значении.
  const r = validateHarnessConfig({ ...base, specApproval: 'no' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /truthy/);
});

test('024 T008: снятые поля названы снятыми, а не «неизвестными»', () => {
  const r = validateHarnessConfig({ ...base, judge: { enabled: false, verify: 'on-pass' } });
  const warnings = (r.warnings || []).join(' | ');
  assert.match(warnings, /judge\.verify/, warnings);
  assert.match(warnings, /снято/, warnings);
});

test('024 T008: рабочий конфиг репозитория проходит схему без единого предупреждения', () => {
  // Схема, написанная по догадке, отвергала бы работающие конфиги — так и случилось на
  // `branchPolicy`, где выдуманное значение `current` разошлось с реальным словарём
  // `feature | none`. Этот тест держит схему привязанной к поставке.
  const fs = require('node:fs');
  const path = require('node:path');
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.harness', 'harness.json'), 'utf8'));
  const r = checkSchema(cfg);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('024 T008: каждое поле, которое читает код, объявлено в схеме', () => {
  // Рассинхрон «поле читают, а схема о нём не знает» и есть дефект, который схема закрывает:
  // такое поле молча выпадает в предупреждение и выглядит опечаткой.
  for (const field of ['kind', 'oracle', 'shell', 'verify', 'redProof', 'oracleSelect', 'batch',
    'specApproval', 'testCmd', 'branchPolicy', 'push', 'smoke', 'background', 'l0', 'judge']) {
    assert.ok(FIELDS[field], `поле ${field} читается кодом, но не объявлено в схеме`);
  }
});

test('024 T008: у схемы есть версия — по ней видно, когда строгость усилится', () => {
  assert.equal(typeof SCHEMA_VERSION, 'number');
  assert.ok(SCHEMA_VERSION > 0);
});

test('024 T008: вложенные секции проверяются тоже', () => {
  assert.equal(validateHarnessConfig({ ...base, background: { layers: 'suite' } }).ok, false, 'layers — массив строк');
  assert.equal(validateHarnessConfig({ ...base, background: { layers: ['suite'] } }).ok, true);
  assert.equal(validateHarnessConfig({ ...base, l0: { diffSizeThreshold: '400' } }).ok, false, 'порог — число');
  assert.equal(validateHarnessConfig({ ...base, l0: { diffSizeThreshold: 400 } }).ok, true);
});
