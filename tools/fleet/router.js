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

module.exports = { loadPolicy, chainFor, makeState, inCooldown, cool, pick, ledgerEntry, DEFAULT_POLICY };
