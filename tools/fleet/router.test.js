'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const router = require('./router');
const providers = require('./providers');

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

test('ledgerEntry: форма + дефолты (T026: phase/exit/tokens/costUsd, failoverFrom null, limitHit false)', () => {
  const e = router.ledgerEntry({ tid: 'T1', phase: 'implement', provider: 'codex', model: 'gpt', durationSec: 12, exit: 0 });
  assert.deepEqual(e, {
    tid: 'T1', phase: 'implement', provider: 'codex', model: 'gpt', durationSec: 12, exit: 0,
    tokens: null, costUsd: null, failoverFrom: null, limitHit: false,
  });
  const f = router.ledgerEntry({ provider: 'claude', failoverFrom: 'agy', limitHit: true });
  assert.equal(f.failoverFrom, 'agy');
  assert.equal(f.limitHit, true);
  assert.equal(f.phase, null);
});

// --- T011: limit-детект + failover ---
test('detectLimit: ловит сигнатуры лимита, пропускает чистый вывод', () => {
  assert.equal(router.detectLimit({ lastMsg: 'Error: HTTP 429 Too Many Requests' }), true);
  assert.equal(router.detectLimit({ lastMsg: 'quota exceeded for this month' }), true);
  assert.equal(router.detectLimit({ reason: 'empty-stdout', lastMsg: '' }), true, 'agy-квирк');
  assert.equal(router.detectLimit({ lastMsg: 'готово, файл записан' }), false);
  assert.equal(router.detectLimit(null), false);
});

test('failover: лимит → cooldown текущего + следующий в цепочке', () => {
  const st = router.makeState();
  const now = 1_000_000;
  const chain = ['agy', 'codex', 'claude'];
  const r = router.failover({ result: { lastMsg: '429 rate limit' }, provider: 'agy', chain, state: st, now });
  assert.equal(r.limitHit, true);
  assert.equal(r.failoverFrom, 'agy');
  assert.equal(r.next, 'codex', 'слайс уезжает на следующего');
  assert.equal(router.inCooldown(st, 'agy', now), true, 'agy ушёл в cooldown');
});

test('failover: не-лимит → тот же провайдер (heal — T012), без cooldown', () => {
  const st = router.makeState();
  const r = router.failover({ result: { lastMsg: 'обычная ошибка компиляции' }, provider: 'agy', chain: ['agy', 'codex'], state: st });
  assert.equal(r.limitHit, false);
  assert.equal(r.next, 'agy');
  assert.equal(router.inCooldown(st, 'agy'), false);
});

// --- T020: hard caps до spawn ---
test('detectLimit: ловит session limit наравне с 429/quota', () => {
  assert.equal(router.detectLimit({ lastMsg: 'Claude AI usage limit reached, session limit exceeded' }), true);
});

test('capReason: maxCalls/maxClaudeCalls/concurrencyPerProvider/maxMinutes — каждый ловится отдельно', () => {
  const policy = { caps: { maxCalls: 2, maxClaudeCalls: 1, maxMinutes: Infinity, concurrencyPerProvider: 1 } };
  const t = router.makeCallTracker();
  assert.equal(router.capReason(t, policy, 'codex'), null, 'свежий трекер — можно');
  t.totalCalls = 2;
  assert.equal(router.capReason(t, policy, 'codex'), 'maxCalls');

  const t2 = router.makeCallTracker();
  t2.claudeCalls = 1;
  assert.equal(router.capReason(t2, policy, 'claude'), 'maxClaudeCalls');
  assert.equal(router.capReason(t2, policy, 'codex'), null, 'лимит claude не бьёт по codex');

  const t3 = router.makeCallTracker();
  t3.active.agy = 1;
  assert.equal(router.capReason(t3, policy, 'agy'), 'concurrencyPerProvider');
  assert.equal(router.capReason(t3, policy, 'codex'), null, 'конкурентность per-provider, не общая');

  const t4 = router.makeCallTracker();
  t4.startedAt = Date.now() - 10 * 60 * 1000; // 10 минут назад
  assert.equal(router.capReason(t4, { caps: { ...router.DEFAULT_CAPS, maxMinutes: 5 } }, 'claude'), 'maxMinutes');
});

test('tryBeginCall: разрешает под cap и атомарно занимает слот, блокирует над cap без побочного инкремента', () => {
  const policy = { caps: { ...router.DEFAULT_CAPS, maxCalls: 1 } };
  const t = router.makeCallTracker();
  const first = router.tryBeginCall(t, policy, 'claude');
  assert.equal(first.ok, true);
  assert.equal(t.totalCalls, 1);
  const second = router.tryBeginCall(t, policy, 'claude');
  assert.equal(second.ok, false, '5-й (тут 2-й) spawn заблокирован над cap');
  assert.equal(second.reason, 'maxCalls');
  assert.equal(t.totalCalls, 1, 'блокированная попытка не инкрементит счётчик');
});

test('tryBeginCall/endCall: concurrencyPerProvider освобождается после endCall', () => {
  const policy = { caps: { ...router.DEFAULT_CAPS, concurrencyPerProvider: 1 } };
  const t = router.makeCallTracker();
  assert.equal(router.tryBeginCall(t, policy, 'agy').ok, true);
  assert.equal(router.tryBeginCall(t, policy, 'agy').ok, false, 'второй конкурентный agy заблокирован');
  router.endCall(t, 'agy');
  assert.equal(router.tryBeginCall(t, policy, 'agy').ok, true, 'после освобождения снова можно');
});

test('живой стаб отдаёт 429 → detectLimit по реальному executor-результату', async () => {
  const stub = path.join(CWD, 'stub-429.js');
  fs.writeFileSync(stub, "console.log('Request failed: HTTP 429 rate_limit');process.exit(1);");
  process.env.FLEET_BIN_CODEX = JSON.stringify(['node', stub]);
  const res = await providers.run({ provider: 'codex', prompt: 'x', cwd: CWD, timeoutMs: 20000 });
  delete process.env.FLEET_BIN_CODEX;
  assert.equal(router.detectLimit(res), true, 'лимит виден в реальном результате провайдера');
});
