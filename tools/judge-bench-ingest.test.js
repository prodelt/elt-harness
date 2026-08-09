'use strict';
// 014 T013 (AC9) — дозапись бенча из ретро-разметки: добавление, идемпотентность, игнор
// `unknown`/`correct`. Фикстура настоящая (git + run-log): кейс строится из реального диффа,
// и мок доказывал бы только то, что мок работает.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { ingest, readStore } = require('./judge-bench-ingest');
const roots = [];
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-ingest-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  return root;
}
function commit(root, file, body, msg) {
  fs.writeFileSync(path.join(root, file), body);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', msg], { cwd: root });
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
function runLog(root, entries) {
  const file = path.join(root, 'run-log.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

// Сценарий: T001 — ложный блок (закрылся без единой красной попытки), T002 — чистый pass.
function scenario() {
  const root = repo();
  const sha1 = commit(root, 'a.js', lines(6), 'feat: T001 слайс');
  const sha2 = commit(root, 'b.js', lines(6), 'feat: T002 слайс');
  const log = runLog(root, [
    { ts: '2026-08-01T10:00:00Z', task: 'T001', verdict: 'block', reasons: ['scope creep'] },
    { ts: '2026-08-01T10:30:00Z', task: 'T001', commit: sha1, verdict: 'pass' },
    { ts: '2026-08-01T11:00:00Z', task: 'T002', commit: sha2, verdict: 'pass' },
  ]);
  return { root, log, store: path.join(root, 'cases-ingested.json') };
}

test('ingest: false-block добавляется как кейс с ожидаемым pass и реальным диффом', () => {
  const { root, log, store } = scenario();
  const r = ingest(root, { runLog: log, store });
  assert.equal(r.added, 1, 'ровно ложный блок; correct-вердикты бенчу нечего проверять');
  const [c] = readStore(store);
  assert.equal(c.expect, 'pass', 'судья заблокировал зря — бенч ждёт от него pass');
  assert.match(c.why, /false-block/);
  assert.match(c.diff, /^diff --git/m, 'дифф настоящий, из коммита');
  assert.match(c.status, / M a\.js/);
});

test('ingest: идемпотентно — повторный прогон не плодит дублей', () => {
  const { root, log, store } = scenario();
  ingest(root, { runLog: log, store });
  const second = ingest(root, { runLog: log, store });
  assert.equal(second.added, 0, 'та же разметка — тот же verdictId — ничего нового');
  assert.equal(readStore(store).length, 1);
});

test('ingest: correct и unknown не попадают в бенч', () => {
  const { root, log, store } = scenario();
  ingest(root, { runLog: log, store });
  const ids = readStore(store).map((c) => c.id);
  assert.deepEqual(ids, ['T001:2026-08-01T10:00:00Z'], 'только ошибка судьи, ничего больше');

  // Отдельно: блок без последующего коммита размечается unknown и тоже не берётся.
  const only = runLog(root, [{ ts: '2026-08-02T10:00:00Z', task: 'T009', verdict: 'block' }]);
  const store2 = path.join(root, 'store2.json');
  assert.equal(ingest(root, { runLog: only, store: store2 }).added, 0);
  assert.equal(fs.existsSync(store2), false, 'пустая дозапись не создаёт файл-пустышку');
});

test('cases.js подмешивает машинные кейсы к рукописным', () => {
  const { cases, handwritten, ingestedCases } = require('./judge-bench/cases');
  assert.ok(handwritten.length > 0);
  assert.equal(cases.length, handwritten.length + ingestedCases().length,
    'набор = рукописные + машинные, без потери и без дублирования');
});
