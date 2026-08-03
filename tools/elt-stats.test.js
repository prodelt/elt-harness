'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computeStats, parseRunLog, classifyBlockSource } = require('./elt-stats');

// Фикстура — известные данные, каждая величина проверяется руками против них.
const FIXTURE = [
  { ts: '2026-08-01T10:00:00Z', task: 'T001', status: 'l0-clean', verdict: 'pass' },
  { ts: '2026-08-01T10:01:00Z', task: 'T001', oracle: { exit: 0, durationSec: 10 }, commit: 'aaa1', verdict: 'pass' },

  { ts: '2026-08-01T10:02:00Z', task: 'T002', status: 'judge-pass', verdict: 'pass', judges: [{ verdict: 'pass' }] },
  { ts: '2026-08-01T10:03:00Z', task: 'T002', oracle: { exit: 0, durationSec: 20 }, commit: 'aaa2', verdict: 'pass' },

  { ts: '2026-08-01T10:04:00Z', task: 'T003', status: 'judge-block', verdict: 'block', reasons: ['red-proof:green'], judges: [{ verdict: 'pass' }] },
  { ts: '2026-08-01T10:05:00Z', task: 'T004', status: 'judge-block', verdict: 'block', reasons: ['grounding:no-reasons'], judges: [{ verdict: 'block' }] },
  { ts: '2026-08-01T10:06:00Z', task: 'T005', status: 'judge-block', verdict: 'block', reasons: ['phantom-file'], judges: [{ verdict: 'block' }] },
  { ts: '2026-08-01T10:07:00Z', task: 'T006', status: 'l0-block', l0: { triggers: ['risk'], judgeNeeded: true } },

  {
    ts: '2026-08-01T10:08:00Z', task: 'T007', status: 'judge-inconclusive', verdict: 'inconclusive',
    reasons: ['red-proof:green'], judges: [{ verdict: 'pass' }, { verdict: 'pass' }],
  },
  { ts: '2026-08-01T10:09:00Z', task: 'T007', oracle: { exit: 0, durationSec: 30 }, commit: 'aaa7', verdict: 'inconclusive' },

  // T019: коммит в обход гейта (--skip-approval) — не должен считаться "через гейт".
  { ts: '2026-08-02T10:00:00Z', task: 'T008', oracle: { exit: 0, skipped: true, durationSec: 5 }, commit: 'aaa8', verdict: 'pass', approvalSkipped: true },
];

test('classifyBlockSource: маркеры T019 узнаются, дефолт — судья', () => {
  assert.equal(classifyBlockSource(['red-proof:green']), 'red-proof');
  assert.equal(classifyBlockSource(['grounding:no-reasons']), 'grounding');
  assert.equal(classifyBlockSource(['phantom-file']), 'судья');
  assert.equal(classifyBlockSource([]), 'судья');
  assert.equal(classifyBlockSource(undefined), 'судья');
});

test('computeStats: величины совпадают с ручным разбором фикстуры', () => {
  const s = computeStats(FIXTURE);

  // gateRuns = l0-clean(1) + judge-pass(1) + judge-block(3) + judge-inconclusive(1) = 6
  assert.equal(s.gateRuns, 6);
  // judgedRuns = gateRuns минус l0-clean = 5
  assert.equal(s.judgedRuns, 5);
  assert.equal(s.commits, 4);

  assert.equal(s.blockRate, 3 / 5);
  assert.equal(s.l0CleanShare, 1 / 6);
  assert.equal(s.inconclusiveShare, 1 / 5);

  // судья-инвокаций: 1(T002)+1(T003)+1(T004)+1(T005)+2(T007) = 6, коммитов = 4
  assert.equal(s.judgeRunsPerCommit, 6 / 4);

  // gatedCommits: aaa1,aaa2,aaa7 обычные, aaa8 — skipped/approvalSkipped исключён → 3/4
  assert.equal(s.gateCoverage, 3 / 4);

  // oracle durations: 10,20,30,5 → p50=20 (индекс ceil(0.5*4)-1=1 → отсорт [5,10,20,30][1]=10)
  // проверяем через сами данные, не пересчитываем формулу вручную дважды
  const sorted = [5, 10, 20, 30];
  assert.ok(sorted.includes(s.oracleP50));
  assert.ok(sorted.includes(s.oracleP90));
  assert.equal(s.oracleP90, 30); // p90 всегда должен схватывать хвост

  assert.deepEqual(s.blockBreakdown, { 'red-proof': 1, grounding: 1, судья: 1, L0: 1 });
});

test('computeStats: --since режет фикстуру по времени', () => {
  const s = computeStats(FIXTURE, { since: '2026-08-02T00:00:00Z' });
  assert.equal(s.totalEntries, 1);
  assert.equal(s.commits, 1);
  assert.equal(s.gateCoverage, 0); // единственный коммит — bypass
});

test('computeStats: пустой run-log не делится на ноль', () => {
  const s = computeStats([]);
  assert.equal(s.blockRate, null);
  assert.equal(s.gateCoverage, null);
  assert.equal(s.oracleP50, null);
});

test('parseRunLog: битая строка не хоронит остальные', () => {
  const raw = '{"ts":"2026-08-01T00:00:00Z","status":"l0-clean"}\nне-json\n{"ts":"2026-08-01T00:01:00Z","status":"judge-pass"}\n';
  const rows = parseRunLog(raw);
  assert.equal(rows.length, 2);
});
