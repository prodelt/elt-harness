'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readReports, toRow, render } = require('./judge-bench-compare');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-bench-compare-'));

function writeReport(name, ts, overrides) {
  const report = {
    ts, provider: 'agy', model: 'gemini-3.6-flash-high',
    score: { recall: 1, falsePositiveRate: 0, accuracy: 1, medianSec: 48.8, totalCostUsd: null },
    ...overrides,
  };
  fs.writeFileSync(path.join(TMP, name), JSON.stringify(report));
  return report;
}

test('пустая папка: readReports/render не падают, render говорит "нет отчётов"', () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-bench-compare-empty-'));
  assert.deepEqual(readReports(emptyDir), []);
  assert.deepEqual(readReports(path.join(emptyDir, 'нет-такой-папки')), []);
  const out = render([]);
  assert.match(out, /нет отчётов/);
});

test('readReports: сортирует по ts ASC (новее — ниже), пропускает битый JSON', () => {
  writeReport('b.json', '2026-07-22T11-00-00.000Z', { ts: '2026-07-22T11:00:00.000Z' });
  writeReport('a.json', '2026-07-22T08-00-00.000Z', { ts: '2026-07-22T08:00:00.000Z' });
  fs.writeFileSync(path.join(TMP, 'broken.json'), '{ не json');
  fs.writeFileSync(path.join(TMP, 'skip.txt'), 'не .json — тоже пропускаем');
  const reports = readReports(TMP);
  assert.equal(reports.length, 2, 'битый JSON и не-.json файл должны быть пропущены');
  assert.equal(reports[0].ts, '2026-07-22T08:00:00.000Z', 'старший отчёт первым');
  assert.equal(reports[1].ts, '2026-07-22T11:00:00.000Z', 'новый отчёт последним (ниже)');
});

test('toRow: достаёт нужные поля из score, отсутствующее score → null-поля, не throw', () => {
  const row = toRow({ provider: 'claude', model: 'sonnet', score: { recall: 0.5, falsePositiveRate: 0.25, accuracy: 0.8, medianSec: 12, totalCostUsd: 0.05 }, ts: 'X' });
  assert.deepEqual(row, { provider: 'claude', model: 'sonnet', recall: 0.5, falsePositiveRate: 0.25, accuracy: 0.8, medianSec: 12, totalCostUsd: 0.05, ts: 'X' });

  const noScore = toRow({ provider: 'codex', ts: 'Y' });
  assert.equal(noScore.recall, null);
  assert.equal(noScore.model, null);
  assert.equal(noScore.totalCostUsd, null);
});

test('render: печатает проценты/прочерки и заголовок таблицы — форматирование, не голые числа', () => {
  const rows = [
    toRow({ provider: 'agy', model: 'gemini-3.6-flash-high', score: { recall: 1, falsePositiveRate: 0, accuracy: 1, medianSec: 48.8, totalCostUsd: null }, ts: '2026-07-22T08:34:50.109Z' }),
    toRow({ provider: 'claude', model: null, score: { recall: 0.5, falsePositiveRate: 0.25, accuracy: 0.75, medianSec: 12.3, totalCostUsd: 0.12 }, ts: '2026-07-22T11:38:41.089Z' }),
  ];
  const out = render(rows);
  assert.match(out, /recall/);
  assert.match(out, /false-pos/);
  assert.match(out, /accuracy/);
  assert.match(out, /agy\/gemini-3\.6-flash-high/);
  assert.match(out, /claude\/\(дефолт\)/, 'модель null должна печататься как "(дефолт)", не "null"');
  assert.match(out, /100%/, 'recall=1 форматируется как процент, не как 1');
  assert.match(out, /\$0\.12/, 'цена печатается с $');
  assert.match(out, /—/, 'отсутствующая цена/значение — прочерк, не null/undefined');
});

test('e2e: реальные отчёты из .harness/judge-bench (если есть) парсятся без исключений', () => {
  const realDir = path.join(__dirname, '..', '.harness', 'judge-bench');
  const reports = readReports(realDir);
  const rows = reports.map(toRow);
  const out = render(rows);
  assert.equal(typeof out, 'string');
});
