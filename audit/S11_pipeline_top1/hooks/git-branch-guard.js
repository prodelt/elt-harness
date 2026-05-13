#!/usr/bin/env node
'use strict';
// S11 Task 30 — PreToolUse[Bash] deny direct commits to main/master.
const fs = require('fs');
const { execSync } = require('child_process');

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cmd = (input.tool_input && input.tool_input.command) || '';
if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);
if (/--amend\b/.test(cmd)) process.exit(0); // amend не пушится сам

const cwd = input.cwd || process.cwd();
let branch;
try {
  branch = execSync('git rev-parse --abbrev-ref HEAD', {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
} catch {
  process.exit(0); // не git-репо — не наше дело
}

const PROTECTED = new Set(['main', 'master', 'production', 'release']);
if (!PROTECTED.has(branch)) process.exit(0);

const reason =
  `⛔ Прямой commit в защищённую ветку "${branch}" запрещён.\n` +
  `Создай ветку: git checkout -b feature/<short-kebab>\n` +
  `Conv-Commits format: <type>(<scope>): <subject>`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason
  }
}));
process.exit(0);
