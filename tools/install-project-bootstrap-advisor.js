#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK_NAME = 'project-bootstrap-advisor.js';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function ensureSessionStartHook(config, command, statusMessage) {
  if (!config.hooks) config.hooks = {};
  if (!Array.isArray(config.hooks.SessionStart)) config.hooks.SessionStart = [{ hooks: [] }];
  if (!config.hooks.SessionStart[0]) config.hooks.SessionStart[0] = { hooks: [] };
  if (!Array.isArray(config.hooks.SessionStart[0].hooks)) config.hooks.SessionStart[0].hooks = [];
  const hooks = config.hooks.SessionStart[0].hooks;
  if (hooks.some((hook) => String(hook.command || '').includes(HOOK_NAME))) return false;
  hooks.push({ type: 'command', command, statusMessage });
  return true;
}

function install(options = {}) {
  const home = options.home || os.homedir();
  const repoRoot = path.resolve(__dirname, '..');
  const source = path.join(repoRoot, 'tools', HOOK_NAME);
  const target = path.join(home, '.claude', 'hooks', HOOK_NAME);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);

  const claudeSettings = path.join(home, '.claude', 'settings.json');
  const codexHooks = path.join(home, '.codex', 'hooks.json');
  const claude = readJson(claudeSettings);
  const codex = readJson(codexHooks);
  const claudeChanged = ensureSessionStartHook(
    claude,
    `node "${target.replace(/\\/g, '/')}"`,
    'Checking project bootstrap strategy...',
  );
  const codexChanged = ensureSessionStartHook(
    codex,
    `node ${target.replace(/\\/g, '/')}`,
    'Checking project bootstrap strategy...',
  );
  if (claudeChanged) writeJson(claudeSettings, claude);
  if (codexChanged) writeJson(codexHooks, codex);
  return { target, claudeChanged, codexChanged };
}

function main() {
  const result = install();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  install,
};
