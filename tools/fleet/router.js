'use strict';
// router.js — политика выбора провайдера по размеру слайса + cooldown + ledger (T010).
// fleet.json: { policy: {S|M|L: [провайдеры по приоритету]}, default: [...], cooldownSec }.
// Цель дизайна (см. ELT-FLEET-DESIGN §7): роутить мелочь (S/M) на agy/codex/haiku,
// разгружая Claude-бюджет; при лимите провайдер уходит в cooldown, слайс — к следующему.
const fs = require('node:fs');
const path = require('node:path');

// T019: явная модель на каждый spawn — аудит 2026-07-10 нашёл ≥86 claude-вызовов БЕЗ
// --model, упавших на ambient-дефолт аккаунта (opus/high). Значения — текущие дефолты
// каждого CLI на этой машине (~/.codex/config.toml model=, ~/.gemini/antigravity/settings.json
// model=), НЕ произвольные догадки; claude — 'sonnet' (конвенция всей системы: судья/ладдер).
// agy: 'gemini-3.1-pro-preview' протух — live-fire 2026-07-22 (прогон 007) показал, что CLI
// его больше не знает («invalid model selection»), и КАЖДЫЙ agy-воркер умирал за секунду.
// Актуальное имя сверено с `agy models`.
const DEFAULT_MODELS = { claude: 'sonnet', codex: 'gpt-5.6-sol', agy: 'gemini-3.6-flash-high' };

// T020: hard caps до spawn — Infinity = выключено (дефолт не ломает существующие прогоны,
// caps включаются явно через fleet.json). maxMinutes считается от старта fleet.run().
const DEFAULT_CAPS = { maxCalls: Infinity, maxClaudeCalls: Infinity, maxMinutes: Infinity, concurrencyPerProvider: Infinity };

const DEFAULT_POLICY = {
  policy: { S: ['agy', 'codex', 'claude'], M: ['codex', 'claude'], L: ['claude'] },
  default: ['claude'],
  cooldownSec: 300,
  models: DEFAULT_MODELS,
  caps: DEFAULT_CAPS,
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
      models: { ...DEFAULT_POLICY.models, ...(j.models || {}) },
      caps: { ...DEFAULT_CAPS, ...(j.caps || {}) },
    };
  } catch { return { ...DEFAULT_POLICY }; }
}

// Явная модель провайдера: policy.models (fleet.json-override) → DEFAULT_MODELS → null.
// providers.js зовёт это, когда caller не передал model явно — так КАЖДЫЙ spawn несёт
// --model, а не молчаливый ambient-дефолт аккаунта/CLI.
function modelFor(provider, policy = DEFAULT_POLICY) {
  return (policy.models && policy.models[provider]) || DEFAULT_MODELS[provider] || null;
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

// Запись в ledger (run-log.jsonl) — одна строка на КАЖДЫЙ spawn (T026, дефект 7: раньше
// heal/judge не считались отдельно, длительности фаз были не разделены). phase различает
// implement/heal/judge; tokens/costUsd — null-плейсхолдеры (providers.js пока не парсит
// usage из CLI-вывода, вне scope этого слайса) — форма готова, значения появятся отдельным
// слайсом, когда providers.run() начнёт их извлекать.
function ledgerEntry({ tid = null, phase = null, provider, model = null, durationSec = null, exit = null, tokens = null, costUsd = null, failoverFrom = null, limitHit = false }) {
  return { tid, phase, provider, model, durationSec, exit, tokens, costUsd, failoverFrom, limitHit };
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
  /session[\s_-]?limit/i, // T020: Claude CLI "session limit reached" — тот же класс, что 429/quota
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

// --- Фатальная конфигурация (live-fire 2026-07-22, прогон 007) ---
// Отдельный класс от лимита: лимит лечится ожиданием/failover, а протухшее имя модели или
// неизвестный флаг НЕ ЛЕЧАТСЯ НИЧЕМ — повтор даст ту же ошибку за ту же секунду. Раньше
// такой отказ выглядел как обычный nonzero-exit: fleet прогонял ПОЛНЫЙ оракул в worktree,
// звал судью на пустом диффе, получал законный block и ретраил слайс — минуты работы и
// несколько LLM-вызовов на ошибку в одну строку конфига. Ловим и валим слайс сразу, громко.
const FATAL_CONFIG_SIGNATURES = [
  /invalid model selection/i,
  /is not recognized as a known model/i,
  /unknown model/i,
  /model .* (?:not found|does not exist)/i,
  /unknown (?:flag|option|argument)/i,
  /unrecognized (?:flag|option|argument)/i,
  /not logged in|authentication (?:failed|required)|please (?:run )?login/i,
];

// Фатальная ли причина? Возвращает саму строку-улику (для лога/сообщения) или null —
// пустая улика бесполезна: юзер должен видеть, ЧТО именно сказал CLI.
function detectFatalConfig(result) {
  if (!result || result.ok) return null;
  const text = readResultText(result);
  for (const re of FATAL_CONFIG_SIGNATURES) {
    const m = text.match(re);
    if (m) {
      const line = text.split(/\r?\n/).find((l) => re.test(l)) || m[0];
      return line.trim().slice(0, 300);
    }
  }
  return null;
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

// --- T020: hard caps до spawn ---
// Общий счётчик на весь прогон fleet.run(): totalCalls/claudeCalls растут монотонно,
// active[provider] — конкурентные spawn'ы прямо сейчас (begin/end вокруг await), чтобы
// concurrencyPerProvider ловил параллельные слайсы одного провайдера, а не суммарные.
function makeCallTracker() {
  return { totalCalls: 0, claudeCalls: 0, active: {}, startedAt: Date.now() };
}

// Причина отказа spawn'у ДО того, как он случился (null = можно спавнить).
function capReason(tracker, policy, provider, now = Date.now()) {
  const caps = (policy && policy.caps) || DEFAULT_CAPS;
  if (tracker.totalCalls >= caps.maxCalls) return 'maxCalls';
  if (provider === 'claude' && tracker.claudeCalls >= caps.maxClaudeCalls) return 'maxClaudeCalls';
  if ((now - tracker.startedAt) / 60000 >= caps.maxMinutes) return 'maxMinutes';
  if ((tracker.active[provider] || 0) >= caps.concurrencyPerProvider) return 'concurrencyPerProvider';
  return null;
}

function endCall(tracker, provider) {
  tracker.active[provider] = Math.max(0, (tracker.active[provider] || 0) - 1);
}

// Проверить cap И, если разрешено, атомарно (синхронно, без await между проверкой и
// инкрементом) занять слот — вызывающий обязан endCall() в finally после spawn.
function tryBeginCall(tracker, policy, provider, now = Date.now()) {
  const reason = capReason(tracker, policy, provider, now);
  if (reason) return { ok: false, reason };
  tracker.totalCalls++;
  if (provider === 'claude') tracker.claudeCalls++;
  tracker.active[provider] = (tracker.active[provider] || 0) + 1;
  return { ok: true, reason: null };
}

module.exports = {
  loadPolicy, chainFor, makeState, inCooldown, cool, pick, ledgerEntry, DEFAULT_POLICY,
  detectLimit, failover, LIMIT_SIGNATURES, modelFor, DEFAULT_MODELS, DEFAULT_CAPS,
  detectFatalConfig, FATAL_CONFIG_SIGNATURES,
  makeCallTracker, capReason, tryBeginCall, endCall,
};
