#!/usr/bin/env node
'use strict';
// S11 Task 32 — PreToolUse[Bash] validate new branch names.
const fs = require('fs');

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cmd = (input.tool_input && input.tool_input.command) || '';

// Catch: git checkout -b NAME | git branch NAME | git switch -c NAME
let name = null;
let m = cmd.match(/\bgit\s+checkout\s+-b\s+([^\s;&|]+)/);
if (m) name = m[1];
if (!name) {
  m = cmd.match(/\bgit\s+switch\s+-c\s+([^\s;&|]+)/);
  if (m) name = m[1];
}
if (!name) {
  m = cmd.match(/\bgit\s+branch\s+([^\s-][^\s;&|]*)/);
  if (m) name = m[1];
}
if (!name) process.exit(0);

const VALID = /^(feature|fix|hotfix|chore|docs|refactor|test)\/[a-z0-9][a-z0-9-]{2,49}$/;
if (VALID.test(name)) process.exit(0);

const reason =
  `⛔ Имя ветки "${name}" не соответствует стандарту.\n` +
  `Требуемый формат: <type>/<kebab-name>\n` +
  `  type: feature | fix | hotfix | chore | docs | refactor | test\n` +
  `  kebab: a-z, 0-9, -, длина 3-50\n` +
  `Примеры: feature/session-harvest, fix/auth-token-expiry, chore/deps-bump`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason
  }
}));
process.exit(0);
