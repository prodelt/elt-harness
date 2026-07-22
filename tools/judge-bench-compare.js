#!/usr/bin/env node
'use strict';
// judge-bench-compare — читает все отчёты tools/judge-bench.js из .harness/judge-bench/*.json
// и печатает сводную таблицу провайдер/модель × recall/false-positive/accuracy/время/цена.
// Один прогон бенча — одна цифра; эта команда сводит все прогоны в историю, чтобы было видно
// прогресс/регресс кандидата в судьи без ручного открытия JSON-ов.
//
//   node tools/judge-bench-compare.js                # таблица из .harness/judge-bench/
//   node tools/judge-bench-compare.js --json          # тот же набор строк как JSON-массив
//   node tools/judge-bench-compare.js --dir <path>     # другая папка с отчётами
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const a = { json: false, dir: path.join(process.cwd(), '.harness', 'judge-bench') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') a.json = true;
    else if (argv[i] === '--dir') { a.dir = argv[i + 1]; i++; }
  }
  return a;
}

// Сортировка по ts ASC — новее ниже, чтобы прогресс читался сверху вниз как в терминальном логе.
function readReports(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const reports = [];
  for (const f of files) {
    try { reports.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* битый отчёт — пропускаем */ }
  }
  reports.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  return reports;
}

function toRow(report) {
  const s = report.score || {};
  return {
    provider: report.provider || null,
    model: report.model || null,
    recall: s.recall ?? null,
    falsePositiveRate: s.falsePositiveRate ?? null,
    accuracy: s.accuracy ?? null,
    medianSec: s.medianSec ?? null,
    totalCostUsd: s.totalCostUsd ?? null,
    ts: report.ts || null,
  };
}

function render(rows) {
  if (!rows.length) return 'judge-bench-compare: нет отчётов в .harness/judge-bench/';
  const pct = (x) => (x === null || x === undefined ? '—' : (x * 100).toFixed(0) + '%');
  const num = (x) => (x === null || x === undefined ? '—' : String(x));
  const price = (x) => (x === null || x === undefined ? '—' : '$' + x);
  const who = (r) => `${r.provider}/${r.model || '(дефолт)'}`;
  const widest = Math.max(20, ...rows.map((r) => who(r).length));
  const lines = [
    `${'провайдер/модель'.padEnd(widest)}  recall  false-pos  accuracy  медиана  цена     дата`,
    '─'.repeat(widest + 62),
  ];
  for (const r of rows) {
    lines.push(
      `${who(r).padEnd(widest)}  ${pct(r.recall).padEnd(6)}  ${pct(r.falsePositiveRate).padEnd(9)}  ${pct(r.accuracy).padEnd(8)}  ${num(r.medianSec).padEnd(7)}  ${price(r.totalCostUsd).padEnd(7)}  ${r.ts || '—'}`
    );
  }
  return lines.join('\n');
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  const rows = readReports(a.dir).map(toRow);
  if (a.json) console.log(JSON.stringify(rows, null, 2));
  else console.log(render(rows));
}

if (require.main === module) main();

module.exports = { parseArgs, readReports, toRow, render };
