'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const heal = require('./heal');

const slice = { id: 'T1', text: 'демо' };

// Сценарий: оракул зеленеет после greenAfter вызовов воркера. Воркер записывает провайдера.
function scenario(greenAfter) {
  const calls = [];
  const worker = async (s, wt, ctx) => { calls.push(ctx.provider); };
  const runOracle = () => ({ green: calls.length >= greenAfter, out: 'oracle red' });
  return { calls, worker, runOracle };
}
const opts = (sc) => ({ slice, wtPath: '/x', provider: 'agy', healProviders: ['claude'], worker: sc.worker, runOracle: sc.runOracle });

test('оракул зелёный сразу → 0 heal, воркер не зовётся', async () => {
  const sc = scenario(0);
  const r = await heal.healSlice(opts(sc));
  assert.deepEqual(r, { ok: true, attempts: 0 });
  assert.deepEqual(sc.calls, []);
});

test('heal #1 тем же провайдером чинит → attempts 1, healedBy=agy', async () => {
  const sc = scenario(1);
  const r = await heal.healSlice(opts(sc));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.equal(r.healedBy, 'agy');
  assert.deepEqual(sc.calls, ['agy']);
});

test('heal #2 (claude) чинит после провала своего → attempts 2, healedBy=claude', async () => {
  const sc = scenario(2);
  const r = await heal.healSlice(opts(sc));
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.equal(r.healedBy, 'claude');
  assert.deepEqual(sc.calls, ['agy', 'claude'], 'эскалация: сначала свой, потом claude');
});

test('оба heal провалились → failed, ровно 2 попытки', async () => {
  const sc = scenario(99); // никогда не зелёный
  const r = await heal.healSlice(opts(sc));
  assert.deepEqual(r, { ok: false, failed: true, attempts: 2 });
  assert.deepEqual(sc.calls, ['agy', 'claude'], 'не больше 2 heal (инвариант ≤2)');
});

// --- T022: heal-бюджет ≤2 ВСЕГО на слайс, не ×3 по batch-попыткам (дефект 1) ---
test('T022: суммарно ≤2 heal через несколько вызовов healSlice (имитация 3 batch-попыток)', async () => {
  const sc = scenario(99); // оракул никогда не зеленеет
  let used = 0;
  for (let i = 0; i < 3; i++) { // как maxAttempts=3 в fleet.js — каждая попытка зовёт healSlice заново
    const r = await heal.healSlice({ ...opts(sc), healUsedSoFar: used });
    used += r.attempts;
  }
  assert.equal(sc.calls.length, 2, `heal вызван ${sc.calls.length} раз суммарно, ожидалось ровно 2 (не 6 = 3×2)`);
  assert.deepEqual(sc.calls, ['agy', 'claude']);
});

test('T022: heal останавливается раньше бюджета, если T020 maxClaudeCalls исчерпан', async () => {
  const sc = scenario(99);
  const callTracker = { totalCalls: 0, claudeCalls: 0, active: {}, startedAt: Date.now() };
  const policy = { caps: { maxCalls: Infinity, maxClaudeCalls: 0, maxMinutes: Infinity, concurrencyPerProvider: Infinity } };
  const r = await heal.healSlice({ ...opts(sc), callTracker, policy });
  // provider='agy' не claude → разрешён; healProviders=['claude'] → maxClaudeCalls=0 блокирует его
  assert.equal(r.ok, false);
  assert.deepEqual(sc.calls, ['agy'], 'claude-heal заблокирован T020-cap, agy-heal прошёл');
});
