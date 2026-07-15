'use strict';

const fs = require('node:fs');
const path = require('node:path');

const KINDS = new Set(['code', 'docs', 'office']);

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
  }
  return { ok: errors.length === 0, errors };
}

function readHarnessConfig(root) {
  const file = path.join(root, '.harness', 'harness.json');
  let config;
  try { config = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    return { ok: false, file, errors: [`cannot read harness.json: ${error.message}`] };
  }
  return { ...validateHarnessConfig(config), file, config };
}

module.exports = { readHarnessConfig, validateHarnessConfig };
