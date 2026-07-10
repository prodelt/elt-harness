'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const router = require('./router');

const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-router-'));
after(() => { try { fs.rmSync(CWD, { recursive: true, force: true }); } catch { /* noop */ } });

test('chainFor: размер → цепочка, неизвестный/пустой → default', () => {
  const p = router.DEFAULT_POLICY;
  assert.deepEqual(router.chainFor('S', p), ['agy', 'codex', 'claude']);
  assert.deepEqual(router.chainFor('L', p), ['claude']);
  assert.deepEqual(router.chainFor(null, p), p.default);
  assert.deepEqual(router.chainFor('XL', p), p.default, 'неизвестный размер → default');
});

test('loadPolicy: нет fleet.json → дефолты; есть → merge поверх', () => {
  assert.deepEqual(router.loadPolicy(CWD), { ...router.DEFAULT_POLICY }, 'нет файла → дефолт');
  fs.mkdirSync(path.join(CWD, '.harness', 'fleet'), { recursive: true });
  fs.writeFileSync(path.join(CWD, '.harness', 'fleet', 'fleet.json'),
    JSON.stringify({ policy: { S: ['codex'] }, cooldownSec: 60 }));
  const p = router.loadPolicy(CWD);
  assert.deepEqual(p.policy.S, ['codex'], 'S переопределён');
  assert.deepEqual(p.policy.L, ['claude'], 'L взят из дефолта (merge)');
  assert.equal(p.cooldownSec, 60);
});

test('cooldown: остывший провайдер пропускается, pick берёт следующего', () => {
  const st = router.makeState();
  const now = 1_000_000;
  const chain = ['agy', 'codex', 'claude'];
  assert.equal(router.pick(chain, st, now), 'agy', 'свежий старт → первый');
  router.cool(st, 'agy', 300, now);
  assert.equal(router.inCooldown(st, 'agy', now), true);
  assert.equal(router.pick(chain, st, now), 'codex', 'agy остыл → codex');
  router.cool(st, 'codex', 300, now);
  assert.equal(router.pick(chain, st, now), 'claude');
});

test('pick: все в cooldown → null', () => {
  const st = router.makeState();
  const now = 5_000_000;
  ['agy', 'codex', 'claude'].forEach((p) => router.cool(st, p, 300, now));
  assert.equal(router.pick(['agy', 'codex', 'claude'], st, now), null);
});

test('inCooldown истекает по времени', () => {
  const st = router.makeState();
  const now = 2_000_000;
  router.cool(st, 'agy', 100, now); // остынет через 100с
  assert.equal(router.inCooldown(st, 'agy', now + 50_000), true, 'через 50с ещё в cooldown');
  assert.equal(router.inCooldown(st, 'agy', now + 150_000), false, 'через 150с остыл');
});

test('ledgerEntry: форма + дефолты (failoverFrom null, limitHit false)', () => {
  const e = router.ledgerEntry({ tid: 'T1', provider: 'codex', model: 'gpt', durationSec: 12 });
  assert.deepEqual(e, { tid: 'T1', provider: 'codex', model: 'gpt', durationSec: 12, failoverFrom: null, limitHit: false });
  const f = router.ledgerEntry({ provider: 'claude', failoverFrom: 'agy', limitHit: true });
  assert.equal(f.failoverFrom, 'agy');
  assert.equal(f.limitHit, true);
});
