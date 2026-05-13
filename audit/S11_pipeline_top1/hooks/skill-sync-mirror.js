#!/usr/bin/env node
'use strict';
// S11 Task 05 — PostToolUse[Edit|Write] mirror ~/.claude/skills/*/SKILL.md to Codex & Gemini.
const fs = require('fs');
const path = require('path');
const os = require('os');

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const fp = (input.tool_input && input.tool_input.file_path) || '';
const m = fp.match(/[\\/]\.claude[\\/]skills[\\/]([^\\/]+)[\\/]([^\\/]+)$/);
if (!m) process.exit(0);

const skillName = m[1];
const fileName = m[2];
const srcPath = fp;
if (!fs.existsSync(srcPath)) process.exit(0);

const content = fs.readFileSync(srcPath, 'utf8');

const targets = [
  { root: path.join(os.homedir(), '.codex', 'skills'), name: 'codex', adapt: codexAdapt },
  { root: path.join(os.homedir(), '.gemini', 'skills'), name: 'gemini', adapt: geminiAdapt }
];

function codexAdapt(txt) {
  // Codex не поддерживает FileChanged и Notification — выпиливаем упоминания из SKILL.md
  return txt
    .replace(/^.*FileChanged.*$/gm, '')
    .replace(/^.*Notification.*$/gm, '');
}

function geminiAdapt(txt) {
  // Antigravity (Gemini) ожидает category: в frontmatter
  if (!/^category:\s/m.test(txt) && /^---\s*$/m.test(txt)) {
    txt = txt.replace(/^---\s*\n/, '---\ncategory: general\n');
  }
  return txt;
}

const synced = [];
for (const t of targets) {
  const dstDir = path.join(t.root, skillName);
  const dst = path.join(dstDir, fileName);
  try {
    if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });
    const adapted = t.adapt(content);
    let write = true;
    if (fs.existsSync(dst)) {
      const cur = fs.readFileSync(dst, 'utf8');
      if (cur === adapted) write = false;
    }
    if (write) {
      fs.writeFileSync(dst, adapted, 'utf8');
      synced.push(t.name);
    }
  } catch (e) {
    // log to errors.log but do not block
    try {
      const logFile = path.join(os.homedir(), '.claude', 'hooks', 'errors.log');
      fs.appendFileSync(logFile,
        `${new Date().toISOString()} [skill-sync-mirror] ${t.name}:${dst} ${e.message}\n`);
    } catch { /* ignore */ }
  }
}

if (synced.length) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `🔄 skill-sync: ${skillName}/${fileName} → ${synced.join(', ')}`
    }
  }));
}
process.exit(0);
