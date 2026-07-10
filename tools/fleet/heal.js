'use strict';
// heal.js — эскалация при красном оракуле после работы воркера (T012).
// Красный оракул → 1 heal тем же провайдером → 1 heal claude → слайс failed
// (оркестратор продолжает остальные). ≤2 heal-попытки (инвариант elt: чинить только
// то, на что указывает ошибка; тесты не ослаблять).
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const providers = require('./providers');

const ELT_CLI = path.join(os.homedir(), '.claude', 'bin', 'elt.js');

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
async function healSlice({
  slice, wtPath, cwd = wtPath, provider, model = null, elt = ELT_CLI,
  worker = defaultHealWorker, healProviders = ['claude'], runOracle = null,
}) {
  const check = runOracle || (() => oracleResult(cwd, elt));
  let res = check();
  if (res.green) return { ok: true, attempts: 0 };

  const chain = [provider, ...healProviders]; // 1 heal тем же → 1 heal claude
  let attempts = 0;
  for (const p of chain) {
    attempts++;
    await worker(slice, wtPath, { provider: p, model, heal: true, oracleError: res.out || '' });
    res = check();
    if (res.green) return { ok: true, attempts, healedBy: p };
  }
  return { ok: false, failed: true, attempts };
}

module.exports = { healSlice, defaultHealWorker, healPrompt };
