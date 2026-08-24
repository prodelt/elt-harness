'use strict';
// 019 T011/T019 — контракт журнала самофиксации.
//
// Тест держит два свойства, ради которых журнал и заведён: (1) пишутся все четыре класса
// записи, а не только «блок»; (2) порог срабатывает РОВНО ОДИН РАЗ. Второе — не украшение:
// журнал, эскалирующий на каждой следующей записи, производит ровно тот шум, из-за которого
// вердикты перестают читать (сигнал/шум 1:7 в реестре дефектов).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ledger = require('./ledger');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'elt-ledger-'));
}

test('пишутся все четыре класса записи', () => {
  const cwd = tmp();
  for (const kind of ledger.KINDS) {
    ledger.record(cwd, { kind, rule: 'diff-size', note: `заметка про ${kind}` });
  }
  const rows = ledger.readLedger(cwd);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.kind).sort(), [...ledger.KINDS].sort());
  for (const r of rows) {
    assert.equal(r.rule, 'diff-size');
    assert.ok(r.ts, 'у записи есть отметка времени');
  }
});

test('неизвестный класс и пустое правило отвергаются', () => {
  const cwd = tmp();
  assert.throws(() => ledger.record(cwd, { kind: 'блок', rule: 'x' }), /неизвестный kind/);
  assert.throws(() => ledger.record(cwd, { kind: 'miss', rule: '  ' }), /rule обязателен/);
  assert.equal(ledger.readLedger(cwd).length, 0, 'отвергнутое в журнал не попадает');
});

test('порог 5 срабатывает один раз, а не на каждой следующей записи', () => {
  const cwd = tmp();

  for (let i = 0; i < 4; i += 1) ledger.record(cwd, { kind: 'false-positive', rule: 'external-import-no-ctx7' });
  let s = ledger.summary(cwd);
  assert.equal(s.rules[0].count, 4);
  assert.equal(s.rules[0].escalate, false, 'четырёх мало');

  ledger.record(cwd, { kind: 'false-positive', rule: 'external-import-no-ctx7' });
  s = ledger.summary(cwd);
  assert.equal(s.rules[0].count, 5);
  assert.equal(s.rules[0].escalate, true, 'пятая запись берёт порог');

  // Эскалацию отметили — свели в issue.
  assert.ok(ledger.markEscalated(cwd, 'external-import-no-ctx7', 'false-positive'));

  ledger.record(cwd, { kind: 'false-positive', rule: 'external-import-no-ctx7' });
  s = ledger.summary(cwd);
  assert.equal(s.rules[0].count, 6);
  assert.equal(s.rules[0].escalate, false, 'шестая запись НЕ даёт второго issue');
  assert.equal(s.rules[0].escalated, true);

  // Повторная отметка не плодит маркеры: идемпотентность держится журналом, не памятью.
  assert.equal(ledger.markEscalated(cwd, 'external-import-no-ctx7', 'false-positive'), null);
  assert.equal(ledger.readLedger(cwd).filter((r) => r.kind === ledger.ESCALATED).length, 1);
});

test('порог считается по паре правило+класс, а не по правилу целиком', () => {
  const cwd = tmp();
  for (let i = 0; i < 3; i += 1) ledger.record(cwd, { kind: 'miss', rule: 'hot-path' });
  for (let i = 0; i < 3; i += 1) ledger.record(cwd, { kind: 'weak-signal', rule: 'hot-path' });
  const s = ledger.summary(cwd);
  assert.equal(s.total, 6);
  assert.equal(s.rules.length, 2, 'два класса — две строки сводки');
  assert.ok(s.rules.every((r) => r.escalate === false), 'шесть записей вперемешку порога не берут');
});

test('битая строка в журнале не роняет сводку', () => {
  const cwd = tmp();
  ledger.record(cwd, { kind: 'miss', rule: 'hot-path' });
  fs.appendFileSync(ledger.ledgerPath(cwd), 'не json\n', 'utf8');
  ledger.record(cwd, { kind: 'miss', rule: 'hot-path' });
  const s = ledger.summary(cwd);
  assert.equal(s.rules[0].count, 2, 'мусорная строка пропущена, живые записи посчитаны');
});
