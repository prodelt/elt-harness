#!/usr/bin/env node
'use strict';
// S11 Task 33 — PreToolUse[Bash] run lint + fast tests before commit.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cmd = (input.tool_input && input.tool_input.command) || '';
if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);
if (/--amend\b/.test(cmd)) process.exit(0);
if (/--no-verify\b/.test(cmd)) {
  // advisory only — не блокируем, но предупреждаем
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: '⚠ --no-verify пропускает pre-commit-gate. Убедись что это оправдано.'
    }
  }));
  process.exit(0);
}

const cwd = input.cwd || process.cwd();

function run(label, command, timeoutMs) {
  try {
    execSync(command, {
      cwd,
      env: { ...process.env, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      encoding: 'utf8'
    });
    return null;
  } catch (e) {
    const stderr = (e.stderr || '').toString().slice(0, 400);
    const stdout = (e.stdout || '').toString().slice(0, 400);
    return `${label}: ${stderr || stdout || e.message}`;
  }
}

function hasFile(f) { return fs.existsSync(path.join(cwd, f)); }

function readPkg() {
  try {
    const p = path.join(cwd, 'package.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

const pkg = readPkg();
let errors = [];

if (pkg && pkg.scripts) {
  if (pkg.scripts.lint) {
    const err = run('lint', 'npm run lint --silent', 60_000);
    if (err) errors = [...errors, err];
  }
  if (pkg.scripts.test && !errors.length) {
    const err = run('test', 'npm test --silent', 120_000);
    if (err) errors = [...errors, err];
  }
} else if (hasFile('pyproject.toml') || hasFile('ruff.toml')) {
  const err = run('ruff', 'ruff check .', 30_000);
  if (err) errors = [...errors, err];
  if (!errors.length && hasFile('pyproject.toml')) {
    const err2 = run('pytest', 'pytest -x --tb=no -q', 120_000);
    if (err2) errors = [...errors, err2];
  }
}

if (!errors.length) process.exit(0);

const reason =
  `⛔ Pre-commit gate failed:\n` +
  errors.map((e, i) => `${i + 1}. ${e}`).join('\n') +
  `\n\nИсправь и повтори. Для обхода (НЕ рекомендуется): git commit --no-verify`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason
  }
}));
process.exit(0);
