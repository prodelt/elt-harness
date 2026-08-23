#!/usr/bin/env node
'use strict';
// judge-bench — измеритель качества судьи на «золотом наборе» диффов (tools/judge-bench/cases.js).
//
// Зачем: судья — единственная семантическая точка харнесса, но его качество никогда не
// измерялось (run-log: 97/97 pass — согласуется и с «ловит», и с «штампует»). Бенч даёт
// три числа на любой провайдер/модель: recall (доля пойманных дефектов), falsePositive
// (доля ложно зарубленных чистых слайсов), время/цена вызова. Это же — единственный
// честный способ сравнить кандидатов в судьи (sonnet vs gemini-3.6-flash vs gpt-5.6).
//
// Меряет ТУ ЖЕ функцию, что работает в проде (gate.judgeDiff), а не копию промпта.
//
//   node tools/judge-bench.js --provider claude --model sonnet
//   node tools/judge-bench.js --provider agy --model gemini-3.6-flash-high --concurrency 3
//   node tools/judge-bench.js --case weakened-test            # один кейс
//
// Стоит реальных денег/времени — поэтому НЕ часть оракула (`*.test.js` рядом проверяет
// только математику скоринга на стабе).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { judgeDiff } = require('./judge-core');
const { cases } = require('./judge-bench/cases');

function parseArgs(argv) {
  const a = { provider: 'claude', model: null, concurrency: 2, timeoutMs: 5 * 60 * 1000, case: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--provider': a.provider = v; i++; break;
      case '--model': a.model = v; i++; break;
      case '--concurrency': a.concurrency = Math.max(1, parseInt(v, 10) || 1); i++; break;
      case '--timeout-ms': a.timeoutMs = parseInt(v, 10); i++; break;
      case '--case': a.case = v; i++; break;
      case '--out': a.out = v; i++; break;
      default: break;
    }
  }
  return a;
}

// Цена вызова: claude --output-format json кладёт total_cost_usd в лог. Прочие провайдеры
// её не печатают → null (в отчёте прочерк), не выдумываем.
function costFromLog(logPath) {
  try {
    const m = fs.readFileSync(logPath, 'utf8').match(/"total_cost_usd"\s*:\s*([0-9.]+)/);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

async function runCase(c, opts) {
  const r = await judgeDiff({
    cwd: opts.cwd, tid: c.id, taskText: c.taskText, diff: c.diff, status: c.status,
    provider: opts.provider, model: opts.model, timeoutMs: opts.timeoutMs,
  });
  return {
    id: c.id, expect: c.expect, why: c.why,
    verdict: r.runOk ? r.verdict : null,
    correct: r.runOk && r.verdict === c.expect,
    runOk: r.runOk, reason: r.reason || null,
    reasons: r.reasons || [],
    durationSec: Number((r.durationSec || 0).toFixed(1)),
    costUsd: r.judgeLog ? costFromLog(r.judgeLog) : null,
    judgeLog: r.judgeLog || null,
  };
}

// Пул на opts.concurrency: судья — сетевой вызов, но каждый спавнит CLI-процесс,
// поэтому параллелим умеренно (дефолт 2).
async function runAll(list, opts) {
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      process.stderr.write(`  → ${list[i].id} (${list[i].expect})\n`);
      results[i] = await runCase(list[i], opts);
      const r = results[i];
      process.stderr.write(`  ← ${r.id}: ${r.runOk ? r.verdict : 'JUDGE-DEAD:' + r.reason} ${r.correct ? 'OK' : 'MISS'} ${r.durationSec}s\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, list.length) }, worker));
  return results;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function score(results) {
  const blocks = results.filter((r) => r.expect === 'block');
  const passes = results.filter((r) => r.expect === 'pass');
  const caught = blocks.filter((r) => r.verdict === 'block').length;
  const falsePos = passes.filter((r) => r.verdict === 'block').length;
  const costs = results.map((r) => r.costUsd).filter((c) => typeof c === 'number');
  return {
    total: results.length,
    judgeDead: results.filter((r) => !r.runOk).length,
    recall: blocks.length ? caught / blocks.length : null,          // пойманные дефекты
    caught, blockCases: blocks.length,
    falsePositiveRate: passes.length ? falsePos / passes.length : null, // зарубленные чистые
    falsePos, passCases: passes.length,
    accuracy: results.filter((r) => r.correct).length / results.length,
    medianSec: median(results.map((r) => r.durationSec)),
    totalCostUsd: costs.length ? Number(costs.reduce((a, b) => a + b, 0).toFixed(4)) : null,
  };
}

function render(report) {
  const s = report.score;
  const pct = (x) => (x === null ? '—' : (x * 100).toFixed(0) + '%');
  const lines = [
    '',
    `judge-bench: ${report.provider} / ${report.model || '(дефолт роутера)'}`,
    '─'.repeat(60),
  ];
  for (const r of report.results) {
    const mark = r.correct ? 'OK  ' : (r.runOk ? 'MISS' : 'DEAD');
    lines.push(`${mark} ${r.id.padEnd(24)} ждали=${r.expect.padEnd(5)} дал=${String(r.verdict || r.reason).padEnd(5)} ${r.durationSec}s`);
    if (!r.correct && r.runOk) lines.push(`       дефект: ${r.why}`);
  }
  lines.push('─'.repeat(60));
  lines.push(`recall (поймано дефектов):     ${r0(s.caught, s.blockCases)} = ${pct(s.recall)}`);
  lines.push(`false-positive (зарублено чистых): ${r0(s.falsePos, s.passCases)} = ${pct(s.falsePositiveRate)}`);
  lines.push(`accuracy:                      ${pct(s.accuracy)}   судья-мёртв: ${s.judgeDead}`);
  lines.push(`медиана времени:               ${s.medianSec}s      цена прогона: ${s.totalCostUsd === null ? '—' : '$' + s.totalCostUsd}`);
  return lines.join('\n');
}
function r0(a, b) { return `${a}/${b}`; }

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const list = a.case ? cases.filter((c) => c.id === a.case) : cases;
  if (!list.length) { process.stderr.write(`нет кейса «${a.case}»\n`); process.exit(2); }
  const cwd = process.cwd();
  // Судью гоняем в ПУСТОЙ песочнице, а не в репо: кейсы ссылаются на реальные файлы проекта,
  // и из настоящего cwd судья пойдёт их читать вместо того, чтобы судить дифф из промпта —
  // замер поехал бы. В проде дифф и рабочее дерево совпадают, здесь — нет.
  // git init обязателен: в проде судья всегда сидит в worktree, и `codex exec` вне git-репо
  // вообще отказывается стартовать («Not inside a trusted directory») — без init бенч мерил бы
  // не качество судьи, а отсутствие репозитория.
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-bench-'));
  try { execFileSync('git', ['init', '-q'], { cwd: sandbox }); } catch { /* нет git — не-codex провайдеры переживут */ }
  process.stderr.write(`judge-bench: ${list.length} кейсов, provider=${a.provider} model=${a.model || 'дефолт'} concurrency=${a.concurrency}\n`);
  const started = Date.now();
  const results = await runAll(list, { ...a, cwd: sandbox });
  const report = {
    ts: new Date().toISOString(), provider: a.provider, model: a.model,
    wallSec: Number(((Date.now() - started) / 1000).toFixed(1)),
    score: score(results), results,
  };
  const outDir = path.join(cwd, '.harness', 'judge-bench');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = a.out || path.join(outDir, `${a.provider}-${(a.model || 'default').replace(/[^\w.-]/g, '_')}-${report.ts.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(render(report));
  console.log(`\nотчёт: ${path.relative(cwd, outPath)}`);
}

if (require.main === module) main();

module.exports = { score, render, runAll, parseArgs, costFromLog };
