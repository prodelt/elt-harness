'use strict';
// router.js — политика выбора провайдера по размеру слайса + cooldown + ledger (T010).
// fleet.json: { policy: {S|M|L: [провайдеры по приоритету]}, default: [...], cooldownSec }.
// Цель дизайна (см. ELT-FLEET-DESIGN §7): роутить мелочь (S/M) на agy/codex/haiku,
// разгружая Claude-бюджет; при лимите провайдер уходит в cooldown, слайс — к следующему.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_POLICY = {
  policy: { S: ['agy', 'codex', 'claude'], M: ['codex', 'claude'], L: ['claude'] },
  default: ['claude'],
  cooldownSec: 300,
};

function policyPath(cwd) { return path.join(cwd, '.harness', 'fleet', 'fleet.json'); }

// Загрузить политику: fleet.json поверх дефолтов (shallow-merge верхних ключей).
function loadPolicy(cwd = process.cwd()) {
  try {
    const j = JSON.parse(fs.readFileSync(policyPath(cwd), 'utf8'));
    return {
      policy: { ...DEFAULT_POLICY.policy, ...(j.policy || {}) },
      default: j.default || DEFAULT_POLICY.default,
      cooldownSec: j.cooldownSec || DEFAULT_POLICY.cooldownSec,
    };
  } catch { return { ...DEFAULT_POLICY }; }
}

// Цепочка провайдеров для размера слайса (нет размера/неизвестен → default).
function chainFor(size, policy = DEFAULT_POLICY) {
  return (size && policy.policy[size]) || policy.default;
}

function makeState() { return { cooldown: {} }; } // provider → эпоха-мс окончания cooldown

function inCooldown(state, provider, now = Date.now()) {
  return (state.cooldown[provider] || 0) > now;
}

function cool(state, provider, sec, now = Date.now()) {
  state.cooldown[provider] = now + sec * 1000;
  return state.cooldown[provider];
}

// Первый провайдер цепочки НЕ в cooldown; все остыли → null (оркестратор ждёт/пропускает).
function pick(chain, state = makeState(), now = Date.now()) {
  return chain.find((p) => !inCooldown(state, p, now)) || null;
}

// Запись в ledger (run-log.jsonl) о том, как отработал слайс у провайдера.
function ledgerEntry({ tid = null, provider, model = null, durationSec = null, failoverFrom = null, limitHit = false }) {
  return { tid, provider, model, durationSec, failoverFrom, limitHit };
}

// --- лимит-детект + failover (T011) ---
// Эвристический набор сигнатур лимита/недоступности — общие HTTP/провайдерные паттерны.
// T003 [live] подтвердила providers.js (stdin/argv/cwd для agy, см. providers.js), но
// реальный rate-limit живьём не воспроизведён (нужен реальный 429 от провайдера — не
// спровоцировать намеренно). Известный живой сигнал: agy при истечении своего
// --print-timeout падает exit 1 + "Error: timeout waiting for response" (это уже
// nonzero-exit → обычный retry/heal, не лимит-специфичный кейс). Пересмотреть при
// первом реальном лимите в проде (T016/T017 бенч и драки могут его словить).
const LIMIT_SIGNATURES = [
  /\b429\b/, /\b529\b/, /rate[\s_-]?limit/i, /quota/i, /usage limit/i,
  /resource_exhausted/i, /overloaded/i, /too many requests/i, /insufficient_quota/i,
  /ineligibletier/i, // agy free-tier мёртв → migrate to Antigravity (из ресерча дизайна, не live)
];

function readResultText(result, cap = 8000) {
  let t = result.lastMsg || '';
  try { if (result.logPath && fs.existsSync(result.logPath)) t = fs.readFileSync(result.logPath, 'utf8'); } catch { /* лог недоступен */ }
  return t.slice(0, cap);
}

// Похоже ли на исчерпание лимита/недоступность провайдера (повод для failover).
function detectLimit(result) {
  if (!result) return false;
  if (result.reason === 'empty-stdout') return true; // agy: пусто при exit 0 = недоступен
  return LIMIT_SIGNATURES.some((re) => re.test(readResultText(result)));
}

// Решение по результату провайдера. Лимит → cooldown текущего + следующий не-остывший
// в цепочке (failover). Не лимит → тот же провайдер (красный оракул лечит heal, T012).
function failover({ result, provider, chain, state = makeState(), policy = DEFAULT_POLICY, now = Date.now() }) {
  if (!detectLimit(result)) return { limitHit: false, next: provider, failoverFrom: null };
  cool(state, provider, policy.cooldownSec, now);
  const rest = chain.slice(chain.indexOf(provider) + 1);
  const next = pick(rest, state, now) || pick(chain, state, now);
  return { limitHit: true, next, failoverFrom: provider };
}

module.exports = {
  loadPolicy, chainFor, makeState, inCooldown, cool, pick, ledgerEntry, DEFAULT_POLICY,
  detectLimit, failover, LIMIT_SIGNATURES,
};
