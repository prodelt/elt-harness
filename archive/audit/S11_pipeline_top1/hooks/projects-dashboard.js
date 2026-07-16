#!/usr/bin/env node
'use strict';
// S11 Task 09 — Projects dashboard: top-7 active projects with last session, focus, status.
// Usage: node projects-dashboard.js
// Output: ~/.claude/projects-dashboard.md
// Perf: stat-only first pass; reads content only for the single newest file per top project.

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const OUT  = path.join(os.homedir(), '.claude', 'projects-dashboard.md');
const TOP_N = 7;

function safe(fn, dflt) { try { return fn(); } catch { return dflt; } }

// Pass 1: stat only — build per-project summary without reading file content.
function statWalk(dir) {
  const byProject = new Map(); // name → { lastMtime, lastPath, sessionCount }
  if (!fs.existsSync(dir)) return byProject;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    const items = safe(() => fs.readdirSync(d, { withFileTypes: true }), []);
    for (const it of items) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) { stack.push(p); continue; }
      if (!it.name.endsWith('.jsonl')) continue;
      const st = safe(() => fs.statSync(p), null);
      if (!st) continue;
      const name = path.relative(dir, p).split(path.sep)[0];
      const cur = byProject.get(name);
      if (!cur) {
        byProject.set(name, { lastMtime: st.mtimeMs, lastPath: p, sessionCount: 1 });
      } else {
        cur.sessionCount++;
        if (st.mtimeMs > cur.lastMtime) { cur.lastMtime = st.mtimeMs; cur.lastPath = p; }
      }
    }
  }
  return byProject;
}

// Pass 2: read content of a single file to extract lastFocus.
function readFocus(filePath) {
  const lines = safe(() => fs.readFileSync(filePath, 'utf8'), '').split('\n');
  let lastFocus = null;
  for (const line of lines) {
    if (!line) continue;
    const ev = safe(() => JSON.parse(line), null);
    if (!ev || ev.type !== 'user' || !ev.message) continue;
    const parts = Array.isArray(ev.message.content)
      ? ev.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
      : (typeof ev.message.content === 'string' ? ev.message.content : '');
    const m = parts.match(/Focus:\s*(.+?)(?:\n|$)/i);
    if (m) lastFocus = m[1].slice(0, 80).trim();
  }
  return lastFocus;
}

function fmtAge(ms) {
  const h = (Date.now() - ms) / 3_600_000;
  if (h < 1) return '<1h ago';
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function main() {
  const byProject = statWalk(ROOT);

  const sorted = [...byProject.entries()]
    .sort((a, b) => b[1].lastMtime - a[1].lastMtime)
    .slice(0, TOP_N);

  const date = new Date().toISOString().slice(0, 10);
  const lines = [`# Projects Dashboard — ${date}`, ''];

  for (const [name, info] of sorted) {
    const focus = readFocus(info.lastPath) || '—';
    lines.push(`- **${name}** — ${fmtAge(info.lastMtime)} | Focus: ${focus} | ${info.sessionCount} sessions`);
  }
  lines.push('');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
}

main();
