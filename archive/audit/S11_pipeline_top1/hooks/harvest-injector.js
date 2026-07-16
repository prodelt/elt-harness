#!/usr/bin/env node
'use strict';
// S11 Task 08 — SessionStart injector for cross-session handoff briefing.
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_AGE_H = 24;
const MAX_BYTES = 2000; // ~500 токенов max injected

const p = path.join(os.homedir(), '.claude', 'session-harvest', 'latest.md');
if (!fs.existsSync(p)) process.exit(0);

let md, ageH;
try {
  ageH = (Date.now() - fs.statSync(p).mtimeMs) / 3_600_000;
  if (ageH > MAX_AGE_H) process.exit(0);
  md = fs.readFileSync(p, 'utf8').slice(0, MAX_BYTES);
} catch { process.exit(0); }

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: `## HARVEST (${ageH.toFixed(1)}h ago)\n${md}`
  }
}));
process.exit(0);
