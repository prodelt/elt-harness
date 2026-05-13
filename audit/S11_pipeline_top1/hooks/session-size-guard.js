#!/usr/bin/env node
'use strict';
// S11 Task 03 — UserPromptSubmit guard for oversized sessions (>500 KB)
// Register in ~/.claude/settings.json AND ~/.codex/hooks.json as UserPromptSubmit hook.
const fs = require('fs');

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const tp = input.transcript_path;
if (!tp || !fs.existsSync(tp)) process.exit(0);

let sizeKB;
try { sizeKB = fs.statSync(tp).size / 1024; } catch { process.exit(0); }

const WARN = 500;   // KB — early warning
const CRIT = 1000;  // KB — strong recommendation

if (sizeKB < WARN) process.exit(0);

const msg = sizeKB >= CRIT
  ? `⚠ Сессия ${sizeKB.toFixed(0)}KB (>1MB). Compaction неизбежен. Выполни /checkpoint и /clear ПРЯМО СЕЙЧАС.`
  : `⚠ Сессия ${sizeKB.toFixed(0)}KB (>500KB). Скоро compaction. Подготовь /checkpoint.`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: msg
  }
}));
process.exit(0);
