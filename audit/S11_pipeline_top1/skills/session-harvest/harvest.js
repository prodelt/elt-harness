#!/usr/bin/env node
'use strict';
// S11 Task 07 — session-harvest: собирает cross-session briefing из JSONL Claude Code.
// Usage: node harvest.js [days=7]
// Output: ~/.claude/session-harvest/latest.md (<2000 байт)

const fs = require('fs');
const path = require('path');
const os = require('os');

const DAYS = Math.max(1, Math.min(60, Number(process.argv[2] || 7)));
const ROOT = path.join(os.homedir(), '.claude', 'projects');
const OUT_DIR = path.join(os.homedir(), '.claude', 'session-harvest');
const ERRORS_LOG = path.join(os.homedir(), '.claude', 'hooks', 'errors.log');
const CUTOFF = Date.now() - DAYS * 86_400_000;

function safe(fn, dflt) { try { return fn(); } catch { return dflt; } }

function walkJsonl(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    const items = safe(() => fs.readdirSync(d, { withFileTypes: true }), []);
    for (const it of items) {
      const p = path.join(d, it.name);
      if (it.isDirectory()) {
        stack.push(p);
      } else if (it.name.endsWith('.jsonl')) {
        const st = safe(() => fs.statSync(p), null);
        if (st && st.mtimeMs > CUTOFF) out.push({ p, st });
      }
    }
  }
  return out;
}

function projectNameFromPath(p) {
  const rel = path.relative(ROOT, p);
  return rel.split(path.sep)[0] || 'unknown';
}

function parseSession(file) {
  const text = safe(() => fs.readFileSync(file.p, 'utf8'), '');
  const lines = text.split('\n');
  let hadCheckpoint = false;
  let userMsgs = 0;
  let toolCalls = 0;
  let lastFocus = null;
  const editedFiles = new Set();
  for (const line of lines) {
    if (!line) continue;
    const ev = safe(() => JSON.parse(line), null);
    if (!ev) continue;
    if (ev.type === 'user') userMsgs++;
    if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
      for (const c of ev.message.content) {
        if (c.type === 'tool_use') {
          toolCalls++;
          if (c.name === 'Skill' && c.input && c.input.skill === 'checkpoint') hadCheckpoint = true;
          if ((c.name === 'Edit' || c.name === 'Write') && c.input && c.input.file_path) {
            editedFiles.add(c.input.file_path);
          }
        }
      }
    }
    if (ev.type === 'user' && ev.message) {
      const parts = Array.isArray(ev.message.content)
        ? ev.message.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
        : (typeof ev.message.content === 'string' ? ev.message.content : '');
      const m = parts.match(/Focus:\s*(.+?)(?:\n|$)/i);
      if (m) lastFocus = m[1].slice(0, 80).trim();
    }
  }
  return {
    project: projectNameFromPath(file.p),
    sizeKB: file.st.size / 1024,
    mtime: file.st.mtime,
    userMsgs, toolCalls, hadCheckpoint,
    lastFocus, editedCount: editedFiles.size
  };
}

function topErrors(n) {
  const text = safe(() => fs.readFileSync(ERRORS_LOG, 'utf8'), '');
  if (!text) return [];
  const counts = new Map();
  const lines = text.split('\n');
  for (const line of lines) {
    const m = line.match(/\[([a-z0-9-]+)\]\s+(.+)/i);
    if (!m) continue;
    const key = `${m[1]}: ${m[2].slice(0, 80)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function render(sessions) {
  const lines = [];
  lines.push(`# Session Harvest — ${new Date().toISOString().slice(0, 10)} (${DAYS}d window)`);
  lines.push('');

  if (sessions.length === 0) {
    lines.push(`Нет сессий за последние ${DAYS} дней.`);
    return lines.join('\n');
  }

  const byProject = new Map();
  for (const s of sessions) {
    const arr = byProject.get(s.project) || [];
    arr.push(s);
    byProject.set(s.project, arr);
  }

  const projectRows = [...byProject.entries()]
    .map(([name, arr]) => {
      const sorted = arr.slice().sort((a, b) => b.mtime - a.mtime);
      return {
        name,
        count: arr.length,
        lastMtime: sorted[0].mtime.getTime(),
        avgKB: arr.reduce((a, s) => a + s.sizeKB, 0) / arr.length,
        maxKB: Math.max(...arr.map(s => s.sizeKB)),
        lastFocus: sorted[0].lastFocus || '—',
        orphans: arr.filter(s => !s.hadCheckpoint && s.toolCalls > 10).length
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  lines.push('## Активные проекты (top-5)');
  for (const p of projectRows) {
    const agoH = Math.round((Date.now() - p.lastMtime) / 3_600_000);
    lines.push(`- **${p.name}** — ${p.count} сессий, avg ${p.avgKB.toFixed(0)}KB (max ${p.maxKB.toFixed(0)}KB), ${agoH}h ago`);
    lines.push(`  - Focus: ${p.lastFocus}`);
    if (p.orphans > 0) lines.push(`  - ⚠ ${p.orphans} сессий без /checkpoint`);
  }
  lines.push('');

  const bloat = sessions.filter(s => s.sizeKB > 1024).length;
  const totalAvgKB = sessions.reduce((a, s) => a + s.sizeKB, 0) / sessions.length;
  lines.push('## Компакт риск');
  lines.push(`- ${bloat} сессий > 1MB (compaction loss вероятен)`);
  lines.push(`- Общий avg размер: ${totalAvgKB.toFixed(0)}KB (цель ≤400KB)`);
  lines.push('');

  lines.push('## Top errors');
  const errs = topErrors(3);
  if (errs.length === 0) {
    lines.push('- нет ошибок в errors.log');
  } else {
    for (const [msg, n] of errs) lines.push(`- ${n}× ${msg}`);
  }
  lines.push('');

  lines.push('## Handoff hint');
  if (projectRows[0]) {
    const p = projectRows[0];
    const agoH = Math.round((Date.now() - p.lastMtime) / 3_600_000);
    lines.push(`Последняя активность в **${p.name}** ${agoH}h назад.`);
    lines.push(`Focus: ${p.lastFocus}`);
  }

  return lines.join('\n');
}

function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const files = walkJsonl(ROOT);
  const sessions = files.map(parseSession);
  const md = render(sessions);
  const outPath = path.join(OUT_DIR, 'latest.md');
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`[harvest] ${sessions.length} сессий → ${outPath} (${md.length} байт, window ${DAYS}d)`);
}

main();
