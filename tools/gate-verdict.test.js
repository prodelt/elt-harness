'use strict';
// 011 T015 (AC13) — итоговый замер против baseline. Механический ассерт на СТРУКТУРУ отчёта
// (числа парсятся и согласованы), не на прозу — тот же принцип, что у d0-smoke-feasibility.test.js:
// решение принимается по числу, а число обязано быть parsable, иначе оно теряется в тексте.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPORT = path.join(__dirname, '..', '.planning', 'GATE-011-VERDICT.md');

function num(md, label) {
  const re = new RegExp('\\*\\*' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*([\\d.]+)');
  const m = md.match(re);
  assert.ok(m, `нет строки «**${label}: <число>**»`);
  return Number(m[1]);
}

test('отчёт существует', () => {
  assert.ok(fs.existsSync(REPORT), 'нет .planning/GATE-011-VERDICT.md');
});

test('AC13: block-rate и доля-до-L3 — оба числа против baseline, оба улучшились', () => {
  const md = fs.readFileSync(REPORT, 'utf8');
  const baseBlock = num(md, 'Baseline block-rate');
  const curBlock = num(md, 'Текущий block-rate');
  assert.equal(baseBlock, 77, 'baseline block-rate — 77% из spec.md:17');
  assert.ok(curBlock < baseBlock, `текущий block-rate (${curBlock}%) обязан быть ниже baseline (${baseBlock}%)`);

  const baseL3 = num(md, 'Baseline доля-до-L3');
  const curL3 = num(md, 'Текущая доля-до-L3');
  assert.equal(baseL3, 100, 'baseline доли-до-L3 — 100% (до L0 судья звался всегда)');
  assert.ok(curL3 <= baseL3, `текущая доля-до-L3 (${curL3}%) не может быть выше baseline (${baseL3}%)`);
});

test('T015: время гейта (оракул p50/p90) — против baseline 185c, p50 улучшился', () => {
  const md = fs.readFileSync(REPORT, 'utf8');
  const baseP50 = num(md, 'Baseline оракул-p50/p90');
  const curP50 = num(md, 'Текущий оракул-p50/p90');
  assert.equal(baseP50, 185, 'baseline p50 — 185с из spec.md:19');
  assert.ok(curP50 < baseP50, `текущий p50 (${curP50}c) обязан быть ниже baseline (${baseP50}c)`);
});

test('R3: порог inconclusive назван явно, текущая доля СТРОГО под порогом', () => {
  const md = fs.readFileSync(REPORT, 'utf8');
  const threshold = num(md, 'Порог inconclusive');
  const current = num(md, 'Текущая доля inconclusive');
  assert.ok(threshold > 0 && threshold <= 100, `порог ${threshold}% вне разумного диапазона`);
  assert.ok(current < threshold, `текущая доля inconclusive (${current}%) обязана быть под порогом (${threshold}%) — иначе R3 сработал, и это дефект контура, а не норма`);
});

test('judge-bench (T023): recall и FPR — оба числа присутствуют и в диапазоне 0..100%', () => {
  const md = fs.readFileSync(REPORT, 'utf8');
  const recall = num(md, 'judge-bench recall');
  const fpr = num(md, 'judge-bench FPR');
  for (const v of [recall, fpr]) assert.ok(v >= 0 && v <= 100, `значение ${v} вне 0..100%`);
});

test('итоговый вердикт присутствует и является одним из закрытого списка', () => {
  const md = fs.readFileSync(REPORT, 'utf8');
  const m = md.match(/\*\*Итог:\s*(УЛУЧШЕНИЕ|РЕГРЕСС|НЕ ДОКАЗАНО)\*\*/);
  assert.ok(m, 'нет строки «**Итог: УЛУЧШЕНИЕ|РЕГРЕСС|НЕ ДОКАЗАНО**»');
});
