'use strict';
// 011 T027 (правило 4 схемы C) — правка харнесса обязана нести evidence+rootCause+predictedImpact
// и пройти judge-bench против baseline. runBench инъецируется (как runTests у elt-mutate.js,
// T008): реальный прогон стоит денег/времени, здесь проверяется только логика ворот.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, after } = require('node:test');

const { propose, validate, compare, findLatestBaseline } = require('./elt-harness-propose');

const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-propose-'));
  roots.push(root);
  return root;
}
function writeBaseline(root, name, score) {
  fs.mkdirSync(path.join(root, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', name), JSON.stringify({ score }));
}
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const FULL = { evidence: 'run-log: 5 ложных block по scope creep', rootCause: 'промпт не различает barrier-слайс', predictedImpact: 'FPR судьи ниже на кейсе scope-creep' };

test('validate: без predicted-impact — invalid, без сети', () => {
  assert.equal(validate({ evidence: 'e', rootCause: 'r', predictedImpact: '' }).ok, false);
  assert.equal(validate({ evidence: 'e', rootCause: '', predictedImpact: 'p' }).ok, false);
  assert.equal(validate(FULL).ok, true);
});

test('правка без predicted-impact отвергается: bench не зовётся вовсе', async () => {
  const root = fixture();
  writeBaseline(root, 'JUDGE-BENCH-x.json', { recall: 0.8, falsePositiveRate: 0.2 });
  let called = false;
  const r = await propose({ root, evidence: 'e', rootCause: 'r', predictedImpact: '', runBench: async () => { called = true; return { recall: 1, falsePositiveRate: 0 }; } });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'invalid');
  assert.equal(called, false, 'дорогой прогон не запущен на дешёвой проверке');
});

test('нет baseline в .planning — invalid, явная причина', async () => {
  const root = fixture();
  const r = await propose({ root, ...FULL, runBench: async () => ({ recall: 1, falsePositiveRate: 0 }) });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'invalid');
  assert.match(r.reason, /baseline/);
});

test('улучшила (recall выше, FPR ниже) — applied, запись accepted в learnings.jsonl', async () => {
  const root = fixture();
  writeBaseline(root, 'JUDGE-BENCH-x.json', { recall: 0.7, falsePositiveRate: 0.3 });
  const r = await propose({ root, ...FULL, runBench: async () => ({ recall: 0.9, falsePositiveRate: 0.1 }) });
  assert.equal(r.ok, true);
  assert.equal(r.verdict, 'accepted');
  const rows = fs.readFileSync(path.join(root, '.harness', 'learnings.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].verdict, 'accepted');
  assert.equal(rows[0].evidence, FULL.evidence);
});

test('ухудшила FPR на фикстуре — не применяется, запись rejected в learnings.jsonl', async () => {
  const root = fixture();
  writeBaseline(root, 'JUDGE-BENCH-x.json', { recall: 0.9, falsePositiveRate: 0.1 });
  const r = await propose({ root, ...FULL, runBench: async () => ({ recall: 0.9, falsePositiveRate: 0.4 }) });
  assert.equal(r.ok, false);
  assert.equal(r.verdict, 'rejected');
  const rows = fs.readFileSync(path.join(root, '.harness', 'learnings.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows[0].verdict, 'rejected');
});

test('ухудшила recall — тоже rejected (не только FPR — обе стороны формулы)', () => {
  assert.equal(compare({ recall: 0.9, falsePositiveRate: 0.1 }, { recall: 0.5, falsePositiveRate: 0.1 }).improved, false);
});

test('null с обеих сторон (нет кейсов этого класса) — нейтрально, не регресс', () => {
  assert.equal(compare({ recall: null, falsePositiveRate: 0.1 }, { recall: null, falsePositiveRate: 0.1 }).improved, true);
});

test('findLatestBaseline: берёт самый свежий по mtime, а не первый по имени', async () => {
  const root = fixture();
  writeBaseline(root, 'JUDGE-BENCH-old.json', { recall: 0.5, falsePositiveRate: 0.5 });
  await new Promise((r) => setTimeout(r, 15));
  writeBaseline(root, 'JUDGE-BENCH-new.json', { recall: 0.99, falsePositiveRate: 0.01 });
  const b = findLatestBaseline(root);
  assert.equal(b.score.recall, 0.99);
});

test('явный --baseline (объект) сильнее файла в .planning', async () => {
  const root = fixture();
  writeBaseline(root, 'JUDGE-BENCH-x.json', { recall: 0.99, falsePositiveRate: 0.01 });
  const r = await propose({ root, ...FULL, baseline: { score: { recall: 0.1, falsePositiveRate: 0.9 } }, runBench: async () => ({ recall: 0.5, falsePositiveRate: 0.5 }) });
  assert.equal(r.ok, true, 'сравнение шло с явным baseline (0.1/0.9), а не с файлом (0.99/0.01)');
});
