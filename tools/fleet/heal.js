'use strict';
// heal.js — эскалация при красном оракуле после работы воркера (T012).
// Красный оракул → 1 heal тем же провайдером → 1 heal claude → слайс failed
// (оркестратор продолжает остальные). ≤2 heal-попытки (инвариант elt: чинить только
// то, на что указывает ошибка; тесты не ослаблять).
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const providers = require('./providers');
const router = require('./router');

const ELT_CLI = path.join(os.homedir(), '.claude', 'bin', 'elt.js');
const MAX_HEAL_TOTAL = 2; // T022: потолок ВСЕГО на слайс, не за один вызов healSlice

function oracleResult(cwd, elt) {
  const r = spawnSync('node', [elt, 'oracle'], { cwd, encoding: 'utf8' });
  return { green: r.status === 0, out: ((r.stdout || '') + (r.stderr || '')).slice(-2000) };
}

function healPrompt(slice, err) {
  return `Оракул проекта КРАСНЫЙ после правки слайса ${slice.id}: ${slice.text}
Ошибка оракула:
${err}
Почини РОВНО то, на что указывает ошибка. Тесты НЕ удаляй и НЕ ослабляй. Ничего вне слайса.`;
}

async function defaultHealWorker(slice, wtPath, ctx) {
  return providers.run({ provider: ctx.provider, prompt: healPrompt(slice, ctx.oracleError || ''), cwd: wtPath, model: ctx.model });
}

// Довести слайс до зелёного оракула или признать failed.
// runOracle инжектируется в тестах; по умолчанию — реальный elt oracle в worktree.
// T022: healUsedSoFar — сколько heal УЖЕ потрачено на этот слайс раньше (caller копит
// это между повторными batch-попытками fleet.js — иначе каждая попытка implement заново
// открывала полный бюджет 2 heal, ×3 попытки = до 6 heal на застрявший слайс, дефект 1).
// callTracker/policy (router.js) — опциональны: если переданы, каждый heal-спавн тоже
// проходит T020 hard-cap (maxClaudeCalls и т.п.), не только implement/judge.
async function healSlice({
  slice, wtPath, cwd = wtPath, provider, model = null, elt = ELT_CLI,
  worker = defaultHealWorker, healProviders = ['claude'], runOracle = null,
  healUsedSoFar = 0, callTracker = null, policy = null,
}) {
  const check = runOracle || (() => oracleResult(cwd, elt));
  let res = check();
  if (res.green) return { ok: true, attempts: 0 };

  const budget = Math.max(0, MAX_HEAL_TOTAL - healUsedSoFar);
  const chain = [provider, ...healProviders].slice(0, budget); // 1 heal тем же → 1 heal claude, суммарно ≤2 на слайс

  let attempts = 0;
  for (const p of chain) {
    if (callTracker && policy) {
      const cap = router.tryBeginCall(callTracker, policy, p);
      if (!cap.ok) break; // T020-cap исчерпан — не спавнить дальше, слайс остаётся failed
    }
    attempts++;
    try {
      await worker(slice, wtPath, { provider: p, model, heal: true, oracleError: res.out || '' });
    } finally {
      if (callTracker && policy) router.endCall(callTracker, p);
    }
    res = check();
    if (res.green) return { ok: true, attempts, healedBy: p };
  }
  return { ok: false, failed: true, attempts };
}

module.exports = { healSlice, defaultHealWorker, healPrompt, MAX_HEAL_TOTAL };
