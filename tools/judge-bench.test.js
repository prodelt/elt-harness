'use strict';
// Тесты judge-bench: скоринг и e2e-раннер на СТАБЕ провайдера (реальный судья стоит денег
// и недетерминирован — в оракуле ему не место). Проверяем ровно то, что может тихо соврать:
// математику recall/false-positive и то, что раннер действительно гоняет каждый кейс через
// прод-путь gate.judgeDiff (стаб подменяется на уровне бинаря, а не функции).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { score, runAll, parseArgs, costFromLog } = require('./judge-bench');
const { cases } = require('./judge-bench/cases');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-bench-'));

// Стаб claude: печатает тот же конверт, что `claude -p --output-format json` (массив,
// последний элемент — result со structured_output), вердикт из env STUB_VERDICT.
const STUB = path.join(TMP, 'stub.js');
fs.writeFileSync(STUB, `
let inp = '';
process.stdin.on('data', (b) => { inp += b; });
process.stdin.on('end', () => {
  const v = process.env.STUB_VERDICT || 'block';
  process.stdout.write(JSON.stringify([
    { type: 'assistant', text: 'промпт получен: ' + inp.length + ' симв.' },
    { type: 'result', structured_output: { verdict: v, reasons: ['стаб'] }, total_cost_usd: 0.01 },
  ]));
});
`);

function withStub(verdict, fn) {
  const prevBin = process.env.FLEET_BIN_CLAUDE;
  const prevVerdict = process.env.STUB_VERDICT;
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', STUB]);
  process.env.STUB_VERDICT = verdict;
  return Promise.resolve(fn()).finally(() => {
    if (prevBin === undefined) delete process.env.FLEET_BIN_CLAUDE; else process.env.FLEET_BIN_CLAUDE = prevBin;
    if (prevVerdict === undefined) delete process.env.STUB_VERDICT; else process.env.STUB_VERDICT = prevVerdict;
  });
}

test('набор кейсов: непустой, у каждого ожидание и оба класса представлены', () => {
  assert.ok(cases.length >= 6, 'набор слишком мал, чтобы что-то мерить');
  for (const c of cases) {
    assert.ok(c.id && c.taskText && c.diff && c.why, `кейс ${c.id}: неполный`);
    assert.ok(c.expect === 'pass' || c.expect === 'block', `кейс ${c.id}: кривой expect`);
  }
  assert.ok(cases.some((c) => c.expect === 'block'), 'нет block-кейсов — recall не измерить');
  assert.ok(cases.some((c) => c.expect === 'pass'), 'нет pass-кейсов — false-positive не измерить');
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, 'дубли id');
});

// 011 T023: набор мерил в основном block (10 block / 3 pass) — FPR был неизмерим статистически.
// Пополнено реальными ложными блоками из run-log.jsonl; инвариант держим тестом, а не памятью.
test('011 T023: pass-кейсов не меньше, чем block-кейсов — FPR измерим', () => {
  const blockCount = cases.filter((c) => c.expect === 'block').length;
  const passCount = cases.filter((c) => c.expect === 'pass').length;
  assert.ok(passCount >= blockCount, `pass=${passCount} < block=${blockCount} — FPR статистически неизмерим`);
});

// Отчёт коммитится как артефакт задачи (T023 [files]), а не перегенерируется в оракуле —
// живой судья стоит денег/времени (см. шапку judge-bench.js). Структуру проверяем без вызова судьи.
test('011 T023: JUDGE-BENCH-011-T023.json имеет структуру отчёта judge-bench', () => {
  const reportPath = path.join(__dirname, '..', '.planning', 'JUDGE-BENCH-011-T023.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.ok(report.ts && report.provider, 'нет метаданных прогона (ts/provider)');
  assert.ok(report.score, 'нет score');
  for (const key of ['total', 'recall', 'falsePositiveRate', 'blockCases', 'passCases', 'accuracy']) {
    assert.ok(key in report.score, `score.${key} отсутствует`);
  }
  assert.ok(Array.isArray(report.results) && report.results.length === cases.length, 'results не покрывает весь набор');
  assert.equal(report.score.blockCases, cases.filter((c) => c.expect === 'block').length);
  assert.equal(report.score.passCases, cases.filter((c) => c.expect === 'pass').length);
});

test('score: идеальный судья = recall 1, FP 0', () => {
  const s = score(cases.map((c) => ({ expect: c.expect, verdict: c.expect, correct: true, runOk: true, durationSec: 10, costUsd: 0.1 })));
  assert.equal(s.recall, 1);
  assert.equal(s.falsePositiveRate, 0);
  assert.equal(s.accuracy, 1);
  assert.equal(s.judgeDead, 0);
});

test('score: судья-штамповщик (всегда pass) = recall 0, FP 0', () => {
  const s = score(cases.map((c) => ({ expect: c.expect, verdict: 'pass', correct: c.expect === 'pass', runOk: true, durationSec: 1, costUsd: null })));
  assert.equal(s.recall, 0, 'штамповщик не ловит ни одного дефекта');
  assert.equal(s.falsePositiveRate, 0);
  assert.equal(s.totalCostUsd, null, 'без цен в логах итог = null, не 0');
});

test('score: судья-параноик (всегда block) = recall 1, FP 1', () => {
  const s = score(cases.map((c) => ({ expect: c.expect, verdict: 'block', correct: c.expect === 'block', runOk: true, durationSec: 1, costUsd: 0.5 })));
  assert.equal(s.recall, 1);
  assert.equal(s.falsePositiveRate, 1, 'параноик рубит все чистые слайсы');
  assert.ok(s.accuracy < 1);
});

test('score: мёртвый судья считается отдельно и не идёт в correct', () => {
  const s = score([
    { expect: 'block', verdict: null, correct: false, runOk: false, durationSec: 300, costUsd: null },
    { expect: 'pass', verdict: 'pass', correct: true, runOk: true, durationSec: 5, costUsd: null },
  ]);
  assert.equal(s.judgeDead, 1);
  assert.equal(s.caught, 0);
  assert.equal(s.accuracy, 0.5);
});

test('costFromLog: читает total_cost_usd, битый лог → null', () => {
  const p = path.join(TMP, 'cost.log');
  fs.writeFileSync(p, '{"type":"result","total_cost_usd":0.357087}');
  assert.equal(costFromLog(p), 0.357087);
  assert.equal(costFromLog(path.join(TMP, 'нет-такого.log')), null);
});

test('parseArgs: дефолты и переопределения', () => {
  const d = parseArgs([]);
  assert.equal(d.provider, 'claude');
  assert.equal(d.concurrency, 2);
  const a = parseArgs(['--provider', 'agy', '--model', 'gemini-3.6-flash-high', '--concurrency', '4', '--case', 'scope-creep']);
  assert.deepEqual([a.provider, a.model, a.concurrency, a.case], ['agy', 'gemini-3.6-flash-high', 4, 'scope-creep']);
});

test('runAll e2e на стабе: каждый кейс реально прогнан через gate.judgeDiff', async () => {
  const results = await withStub('block', () =>
    runAll(cases, { provider: 'claude', model: 'sonnet', timeoutMs: 60000, concurrency: 3, cwd: TMP }));
  assert.equal(results.length, cases.length);
  for (const r of results) {
    assert.equal(r.runOk, true, `${r.id}: стаб-судья не отработал (${r.reason})`);
    assert.equal(r.verdict, 'block');
    assert.equal(r.costUsd, 0.01, 'цена подхвачена из лога вызова');
  }
  const s = score(results);
  assert.equal(s.recall, 1);
  assert.equal(s.falsePositiveRate, 1);
});

test('runAll e2e: стаб-pass даёт зеркальную картину (скоринг не захардкожен)', async () => {
  const results = await withStub('pass', () =>
    runAll(cases.slice(0, 3), { provider: 'claude', model: 'sonnet', timeoutMs: 60000, concurrency: 3, cwd: TMP }));
  const s = score(results);
  assert.equal(s.recall, 0);
  assert.equal(s.caught, 0);
});
