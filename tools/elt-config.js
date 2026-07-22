'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KINDS = new Set(['code', 'docs', 'office']);
// Кто может быть судьёй. Те же имена, что у fleet-провайдеров (tools/fleet/providers.js).
const JUDGE_PROVIDERS = new Set(['claude', 'codex', 'agy']);

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

function readHarnessConfig(root) {
  const file = path.join(root, '.harness', 'harness.json');
  let config;
  try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    return { ok: false, file, errors: [`cannot read harness.json: ${error.message}`] };
  }
  return { ...validateHarnessConfig(config), file, config };
}

module.exports = { readHarnessConfig, validateHarnessConfig, judgeSettings, JUDGE_PROVIDERS, JUDGE_DEFAULTS };
