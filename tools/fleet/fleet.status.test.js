'use strict';
// Тест fleet.status() на фикстурах (events.jsonl + claims + tasks.md), без прогона.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fleet = require('./fleet');
const claims = require('./claims');

const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-status-'));
const tasksPath = path.join(CWD, 'tasks.md');
after(() => { try { fs.rmSync(CWD, { recursive: true, force: true }); } catch { /* noop */ } });

before(() => {
  const evDir = path.join(CWD, '.harness', 'fleet');
  fs.mkdirSync(evDir, { recursive: true });
  const ev = [
    { ts: '2026-07-10T10:00:00Z', event: 'start' },
    { ts: '2026-07-10T10:00:01Z', event: 'slice-work', tid: 'T1', provider: 'codex' },
    { ts: '2026-07-10T10:00:05Z', event: 'gate-pass', tid: 'T1' },
    { ts: '2026-07-10T10:00:06Z', event: 'merged', tid: 'T1' },
    { ts: '2026-07-10T10:00:02Z', event: 'slice-work', tid: 'T2', provider: 'agy' },
    { ts: '2026-07-10T10:00:07Z', event: 'merge-conflict', tid: 'T2' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(path.join(evDir, 'events.jsonl'), ev);
  fs.writeFileSync(tasksPath, '- [X] **T1** a\n- [ ] **T2** b\n- [ ] **T3** c [P]\n');
  // активный claim на T3 (живой воркер — наш pid)
  fs.writeFileSync(claims.claimPath(CWD, 'T3'), JSON.stringify({ tid: 'T3', pid: process.pid, worker: 'fleet', provider: 'claude' }));
});

test('status: собирает слайсы из events + активных claims', () => {
  const st = fleet.status({ cwd: CWD, tasksPath });
  const byId = Object.fromEntries(st.slices.map((s) => [s.tid, s]));
  assert.equal(byId.T1.state, 'merged');
  assert.equal(byId.T1.provider, 'codex');
  assert.equal(byId.T2.state, 'conflict');
  assert.equal(byId.T3.state, 'in-progress', 'живой claim → in-progress');
  assert.equal(byId.T3.worker, 'fleet');
});

test('status: counts и план', () => {
  const st = fleet.status({ cwd: CWD, tasksPath });
  assert.equal(st.counts.merged, 1);
  assert.equal(st.counts.conflict, 1);
  assert.equal(st.plan.total, 3);
  assert.equal(st.plan.done, 1);
  assert.equal(st.plan.open, 2);
  assert.equal(st.stopped, false);
});

test('status: STOP-файл виден', () => {
  fs.writeFileSync(path.join(CWD, '.harness', 'STOP'), '');
  assert.equal(fleet.status({ cwd: CWD, tasksPath }).stopped, true);
  fs.rmSync(path.join(CWD, '.harness', 'STOP'));
});

test('renderStatus: таблица с заголовком, строками и итогом', () => {
  const out = fleet.renderStatus(fleet.status({ cwd: CWD, tasksPath }));
  assert.match(out, /TID\s+STATE\s+PROVIDER\s+WORKER\s+UPDATED/);
  assert.match(out, /T1\s+merged\s+codex/);
  assert.match(out, /Итог: merged=1/);
  assert.match(out, /План: 1\/3 закрыто/);
});
