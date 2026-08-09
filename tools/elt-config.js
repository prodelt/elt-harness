'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KINDS = new Set(['code', 'docs', 'office']);
// Кто может быть судьёй. Те же имена, что у fleet-провайдеров (tools/fleet/providers.js).
const JUDGE_PROVIDERS = new Set(['claude', 'codex', 'agy']);
// 014 T005 (AC3) — `sync` умолчание = поведение 011 (побайтово прежнее, AC12 обратная
// совместимость). `background` — commit возвращает управление после L0+быстрого оракула,
// тяжёлые слои уходят в tools/elt-verify-bg.js.
const VERIFY_MODES = new Set(['sync', 'background']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateHarnessConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { ok: false, errors: ['config must be an object'] };
  if (!KINDS.has(config.kind)) errors.push('kind must be code, docs, or office');
  if (config.kind === 'code' && !nonEmptyString(config.oracle)) errors.push('code projects require a non-empty oracle');
  if ((config.kind === 'docs' || config.kind === 'office') && !nonEmptyString(config.artifactVerifier)) {
    errors.push('docs and office projects require a non-empty artifactVerifier');
  }
  // 011 T010: smoke опционален (нет поля → слоя нет). Но кривой тип обязан падать на конфиге,
  // а не молча выключать слой — «пусто» и «я ошибся в формате» это разные вещи.
  if (config.smoke !== undefined && typeof config.smoke !== 'string') errors.push('smoke must be a string command');
  // 014 T005: та же дисциплина — опечатка в verify обязана упасть на конфиге, не молча
  // откатиться на sync (иначе включение фона выглядело бы включённым, а слайсы шли бы sync).
  if (config.verify !== undefined && !VERIFY_MODES.has(config.verify)) {
    errors.push(`verify must be one of: ${[...VERIFY_MODES].join(', ')}`);
  }
  // 014 T008: сколько ждать фоновый вердикт, прежде чем молчание считать инцидентом. Ноль или
  // отрицательное значило бы «каждый спекулятивный коммит немедленно bg-silent» — это не
  // «выключить детектор», а сломать его, поэтому падаем на конфиге.
  if (config.backgroundTimeoutMin !== undefined
      && (typeof config.backgroundTimeoutMin !== 'number' || !(config.backgroundTimeoutMin > 0))) {
    errors.push('backgroundTimeoutMin must be a positive number of minutes');
  }
  if (!config.judge || typeof config.judge !== 'object' || Array.isArray(config.judge)) {
    errors.push('judge must be an object');
  } else {
    if (typeof config.judge.enabled !== 'boolean') errors.push('judge.enabled must be boolean');
    if (config.judge.enabled && !nonEmptyString(config.judge.model)) errors.push('enabled judge requires a non-empty model');
    // judge.provider опционален (дефолт claude). Список закрыт: опечатка в имени провайдера
    // иначе всплыла бы только в рантайме как unknown-provider → судья «мёртв» → парковка слайса.
    if (config.judge.provider !== undefined && !JUDGE_PROVIDERS.has(config.judge.provider)) {
      errors.push(`judge.provider must be one of: ${[...JUDGE_PROVIDERS].join(', ')}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

// Кто судит этот проект — ЕДИНЫЙ источник правды для обоих драйверов (fleet и solo).
// До 2026-07-22 provider был зашит литералом 'claude' в fleet.js и elt-loop.ps1, а
// harness.json про судью читали только для enabled/model — сменить судью через конфиг было
// нельзя, правка harness.json молча не действовала. Битый/отсутствующий конфиг → дефолты
// (судья обязан подняться даже на кривом проекте: его отсутствие = парковка слайсов).
const JUDGE_DEFAULTS = { provider: 'claude', model: 'sonnet' };
function judgeSettings(root) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8')).judge || {};
    return {
      provider: JUDGE_PROVIDERS.has(j.provider) ? j.provider : JUDGE_DEFAULTS.provider,
      model: nonEmptyString(j.model) ? j.model : JUDGE_DEFAULTS.model,
    };
  } catch { return { ...JUDGE_DEFAULTS }; }
}

// ELT v3: verify-on-pass удалён из живого маршрута. Старое поле принимается при чтении
// harness.json, чтобы не ломать существующие проекты, но runtime его намеренно игнорирует:
// один механический oracle + один независимый judge дают меньше ложных блокировок, чем каскад
// из двух LLM-судей. project-bootstrap apply физически удаляет legacy-поле из проекта.
function verifySettings(_root) { return null; }

// 014 T005 — отсутствие поля/битый конфиг → 'sync' (AC12: старый проект без поля работает
// по-старому). Читает файл напрямую (не readHarnessConfig): вызывающие места (elt.js commit,
// elt-verify-bg.js) не обязаны тащить уже распарсенный cfg через границу процесса — фоновый
// child получает только cwd.
function verifyMode(root) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8')).verify;
    return VERIFY_MODES.has(v) ? v : 'sync';
  } catch { return 'sync'; }
}

// 014 T008 — сколько минут молчания фона считать инцидентом. Дефолт 20: полный сьют этого
// репо в фоне ≈ 200 c, двадцатикратный запас отделяет «долго» от «умер».
const BACKGROUND_TIMEOUT_MIN_DEFAULT = 20;
function backgroundTimeoutMin(root) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8')).backgroundTimeoutMin;
    return typeof v === 'number' && v > 0 ? v : BACKGROUND_TIMEOUT_MIN_DEFAULT;
  } catch { return BACKGROUND_TIMEOUT_MIN_DEFAULT; }
}

function readHarnessConfig(root) {
  const file = path.join(root, '.harness', 'harness.json');
  let config;
  try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    return { ok: false, file, errors: [`cannot read harness.json: ${error.message}`] };
  }
  return { ...validateHarnessConfig(config), file, config };
}

module.exports = {
  readHarnessConfig, validateHarnessConfig, judgeSettings, verifySettings, JUDGE_PROVIDERS, JUDGE_DEFAULTS,
  verifyMode, VERIFY_MODES,
  backgroundTimeoutMin, BACKGROUND_TIMEOUT_MIN_DEFAULT,
};
