'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const claims = require('./claims');

const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-claims-'));
after(() => { try { fs.rmSync(CWD, { recursive: true, force: true }); } catch { /* noop */ } });

test('claim свободного слайса → ok, файл создан', () => {
  const r = claims.claim('T1', { cwd: CWD, worker: 'w0' });
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(claims.claimPath(CWD, 'T1')));
  assert.equal(r.claim.worker, 'w0');
});

test('живой чужой pid держит слайс → ok:false, heldBy; смерть pid → перехват', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)']);
  await once(child, 'spawn');
  // засеять claim, будто держит живой чужой воркер
  fs.writeFileSync(claims.claimPath(CWD, 'T2'), JSON.stringify({ tid: 'T2', pid: child.pid, worker: 'other' }));

  const held = claims.claim('T2', { cwd: CWD, pid: process.pid });
  assert.equal(held.ok, false);
  assert.equal(held.heldBy.pid, child.pid);

  child.kill();
  await once(child, 'exit');

  const stolen = claims.claim('T2', { cwd: CWD, pid: process.pid });
  assert.equal(stolen.ok, true, 'мёртвый pid → слайс перехвачен');
  assert.equal(stolen.stolen.worker, 'other');
});

test('stale/sweep находят и снимают claim с мёртвым pid', () => {
  fs.writeFileSync(claims.claimPath(CWD, 'T3'), JSON.stringify({ tid: 'T3', pid: 2147480000, worker: 'ghost' }));
  const st = claims.stale({ cwd: CWD });
  assert.ok(st.some((c) => c.tid === 'T3'), 'T3 помечен stale');
  const swept = claims.sweep({ cwd: CWD });
  assert.ok(swept.includes('T3'));
  assert.ok(!fs.existsSync(claims.claimPath(CWD, 'T3')), 'stale-claim снят');
});

test('release идемпотентно снимает claim', () => {
  claims.claim('T4', { cwd: CWD });
  claims.release('T4', { cwd: CWD });
  assert.ok(!fs.existsSync(claims.claimPath(CWD, 'T4')));
  claims.release('T4', { cwd: CWD }); // повторно — без ошибки
});

test('list помечает живой claim как не-stale', () => {
  claims.claim('T5', { cwd: CWD, pid: process.pid });
  const mine = claims.list({ cwd: CWD }).find((c) => c.tid === 'T5');
  assert.equal(mine.stale, false);
});
