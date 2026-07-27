'use strict';
// 009 T007 — watchdog. Тест на КАЖДЫЙ детектор поверх синтетического run-log, плюс два
// свойства, ради которых он вообще пишет файл: идемпотентность по key и exit-код `--once`.
// Синтетика здесь честная: записи ровно того формата, что пишет `appendRunLog` в elt.js
// (limitHit/provider — из fleet-роутера, status:'red-stop'/'judge-dead' — из гейта).

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const WATCH = path.join(__dirname, 'harness-watch.js');
const { detect, runOnce } = require('./harness-watch');
const roots = [];

function fixture(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-watch-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "0"', judge: { enabled: true, provider: 'agy', model: 'gemini-3.6-flash-high', verify: { provider: 'codex', model: 'gpt-5.6-sol' } },
    redProof: 'on', ...config,
  }));
  return root;
}

function runlog(root, entries) {
  const dir = path.join(root, '.git', 'elt');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-log.jsonl'),
    entries.map((e, i) => JSON.stringify({ ts: new Date(Date.UTC(2026, 6, 27, 10, i)).toISOString(), ...e })).join('\n') + '\n');
}

function kinds(root, options) { return detect(root, options).map((i) => i.kind); }

after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

test('limit-streak: два limitHit одного провайдера — инцидент, по одному на провайдера — нет', () => {
  const root = fixture();
  runlog(root, [
    { tid: 'T001', provider: 'agy', limitHit: true },
    { tid: 'T002', provider: 'codex', limitHit: false },
    { tid: 'T003', provider: 'agy', limitHit: true },
  ]);
  const hit = detect(root).filter((i) => i.kind === 'limit-streak');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].provider, 'agy');

  const single = fixture();
  runlog(single, [{ tid: 'T001', provider: 'agy', limitHit: true }, { tid: 'T002', provider: 'codex', limitHit: true }]);
  assert.deepEqual(kinds(single).filter((k) => k === 'limit-streak'), []);
});

test('red-repeat: два red-stop по одной задаче — инцидент; task:null не склеивается', () => {
  const root = fixture();
  runlog(root, [
    { task: 'T007', status: 'red-stop', oracle: { exit: 1 } },
    { task: 'T007', status: 'red-stop', oracle: { exit: 1 } },
  ]);
  const hit = detect(root).filter((i) => i.kind === 'red-repeat');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].task, 'T007');

  const anon = fixture();
  runlog(anon, [
    { task: null, status: 'red-stop', oracle: { exit: 1 } },
    { task: null, status: 'red-stop', oracle: { exit: 1 } },
  ]);
  assert.deepEqual(kinds(anon).filter((k) => k === 'red-repeat'), [],
    'красный оракул вне слайса — не «повтор по задаче»');
});

// Два продюсера пишут одно и то же событие в РАЗНЫЕ поля: elt.js — `status`, драйвер
// elt-loop.ps1 — `result` (см. Append-RunLog в tools/elt-loop.ps1). Детектор, слепой на
// формат драйвера, бесполезен ровно в автономном прогоне.
test('формат драйвера (result) распознаётся наравне с форматом elt.js (status)', () => {
  const root = fixture();
  runlog(root, [
    { task: 'T007', oracle: { exit: 1 }, result: 'red-stop' },
    { task: 'T007', oracle: { exit: 1 }, result: 'red-stop' },
    { task: 'T008', result: 'judge-dead', judgeLog: 'x.log' },
    { task: 'T009', result: 'judge-dead', judgeLog: 'y.log' },
  ]);
  const found = kinds(root);
  assert.ok(found.includes('red-repeat'), 'red-stop драйвера должен ловиться');
  assert.ok(found.includes('judge-dead-streak'), 'judge-dead драйвера должен ловиться');
});

test('judge-dead-streak: два подряд — инцидент; pass между ними рвёт стрик', () => {
  const root = fixture();
  runlog(root, [{ task: 'T001', status: 'judge-dead' }, { task: 'T002', status: 'judge-dead' }]);
  assert.equal(detect(root).filter((i) => i.kind === 'judge-dead-streak').length, 1);

  const broken = fixture();
  runlog(broken, [
    { task: 'T001', status: 'judge-dead' },
    { task: 'T002', status: 'judge-pass' },
    { task: 'T003', status: 'judge-dead' },
  ]);
  assert.deepEqual(kinds(broken).filter((k) => k === 'judge-dead-streak'), []);
});

test('oracle-slow: выброс выше медианы ×3; ровный ряд молчит', () => {
  const root = fixture();
  runlog(root, [
    ...[10, 10, 12, 10, 11].map((d) => ({ task: 'T00x', oracle: { exit: 0, durationSec: d } })),
    { task: 'T009', oracle: { exit: 0, durationSec: 90 } },
  ]);
  const hit = detect(root).filter((i) => i.kind === 'oracle-slow');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].task, 'T009');

  const flat = fixture();
  runlog(flat, [10, 10, 12, 10, 11, 14].map((d) => ({ task: 'T00x', oracle: { exit: 0, durationSec: d } })));
  assert.deepEqual(kinds(flat).filter((k) => k === 'oracle-slow'), []);
});

test('stale-park: парковка старше окна — инцидент, свежая — нет', () => {
  const root = fixture();
  const now = Date.parse('2026-07-27T12:00:00.000Z');
  fs.writeFileSync(path.join(root, '.harness', 'parked.json'), JSON.stringify([
    { tid: 'T004', reason: 'judge-block', ts: '2026-07-25T12:00:00.000Z', attempts: 1 },
    { tid: 'T005', reason: 'red-stop', ts: '2026-07-27T11:00:00.000Z', attempts: 1 },
  ]));
  const hit = detect(root, { now }).filter((i) => i.kind === 'stale-park');
  assert.deepEqual(hit.map((i) => i.task), ['T004']);
});

test('circuit-off: код без verify и с redProof:off — инцидент; включённый контур — нет', () => {
  const off = fixture({ judge: { enabled: true, provider: 'agy', model: 'gemini-3.6-flash-high' }, redProof: 'off' });
  runlog(off, [{ task: 'T001', commit: 'abc' }]);
  assert.deepEqual(kinds(off).filter((k) => k === 'circuit-off'), ['circuit-off']);

  const on = fixture();
  runlog(on, [{ task: 'T001', commit: 'abc' }]);
  assert.deepEqual(kinds(on).filter((k) => k === 'circuit-off'), []);
});

test('health.jsonl: запись на инцидент, повторный прогон на тех же данных не дублирует', () => {
  const root = fixture();
  runlog(root, [
    { tid: 'T001', provider: 'agy', limitHit: true },
    { tid: 'T002', provider: 'agy', limitHit: true },
  ]);
  const first = runOnce(root);
  assert.equal(first.fresh.length, 1);
  const second = runOnce(root);
  assert.equal(second.fresh.length, 0, 'идемпотентность по key');
  assert.equal(second.found.length, 1, 'инцидент никуда не делся — просто уже записан');
  const lines = fs.readFileSync(path.join(root, '.harness', 'health.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.kind, 'limit-streak');
  assert.ok(Date.parse(rec.ts), 'у записи есть время');
  assert.equal(spawnSync('git', ['check-ignore', '.harness/health.jsonl'], { cwd: root }).status, 0,
    'health.jsonl обязан игнорироваться git — иначе рантайм-артефакт попадёт в дифф слайса');
});

test('--once: exit 1 пока инцидент в окне (в т.ч. на повторе), exit 0 на здоровом проекте', () => {
  const root = fixture();
  runlog(root, [
    { tid: 'T001', provider: 'agy', limitHit: true },
    { tid: 'T002', provider: 'agy', limitHit: true },
  ]);
  const run = () => spawnSync(process.execPath, [WATCH, '--once'], { cwd: root, encoding: 'utf8' });
  assert.equal(run().status, 1);
  assert.equal(run().status, 1, 'уже записанный инцидент не становится здоровьем');

  const healthy = fixture();
  runlog(healthy, [{ task: 'T001', commit: 'abc' }]);
  assert.equal(spawnSync(process.execPath, [WATCH, '--once'], { cwd: healthy, encoding: 'utf8' }).status, 0);
});
