#!/usr/bin/env node
// elt-code-audit.js — повторяемый кросс-проектный аудит elt-code/харнесса по
// JSONL-логам Claude Code. Воспроизводит ручной разбор 2026-06-25 одной командой.
//
//   node tools/elt-code-audit.js [--days 7] [--all]
//
// Метрики: adoption elt-code (% кодовых сессий), здоровье судьи (вердиктов,
// pass/block, inline-self-judge vs изолированный), охват «зубов» харнесса,
// % route-line у elt-code вызовов, слайсы/красные elt-loop (loop-run-log.md),
// вызовы+подтверждения elt-work (шаг D апгрейда 2026-07-02).
// Sanity: блок self-check внизу падает, если парсер сломался на формате JSONL.

const fs = require('fs');
const path = require('path');

const BASE = path.join(require('os').homedir(), '.claude', 'projects');
const DAYS = (() => { const i = process.argv.indexOf('--days'); return i >= 0 ? +process.argv[i + 1] : 7; })();
const ALL = process.argv.includes('--all');
const WINDOW = Date.now() - DAYS * 864e5;

function jsonl(file, fn) {
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split('\n')) { if (!line.trim()) continue; let o; try { o = JSON.parse(line); } catch { continue; } fn(o); }
}
const contentBlocks = (m) => (m && m.message && Array.isArray(m.message.content)) ? m.message.content : [];

// --- per-session scan of one project's *.jsonl ---
function scanProject(dir) {
  let files; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { return null; }
  if (!files.length) return null;
  let newest = 0, codeSess = 0, eltSess = 0, judgeSess = 0, routeSess = 0, workSess = 0, workConfirmSess = 0;
  for (const f of files) {
    const fp = path.join(dir, f);
    let mt = 0; try { mt = fs.statSync(fp).mtimeMs; } catch {}
    newest = Math.max(newest, mt);
    let code = false, elt = false, judge = false, route = false, work = false, workConfirm = false, workPending = false;
    jsonl(fp, (m) => {
      if (m.type === 'user') {
        const c = m.message && m.message.content;
        const s = typeof c === 'string' ? c : JSON.stringify(c || '');
        if (/<command-name>\/?elt-code|^\/elt-code|«elt-code/.test(s)) elt = true;
        if (/<command-name>\/?elt-work|^\/elt-work|«elt-work/.test(s)) work = true;
        if (workPending && typeof c === 'string' && /^(да|yes|подтверждаю|ок\b|ok\b)/i.test(c.trim())) { workConfirm = true; workPending = false; }
      }
      for (const b of contentBlocks(m)) {
        if (b.type === 'text' && /^elt-code\s*→\s*маршрут/mu.test(b.text || '')) route = true;
        if (b.type === 'text' && /^elt-work\s*→/mu.test(b.text || '')) work = true;
        if (b.type === 'text' && work && /(да\/подтверд|дожд[аи]ться.{0,5}«?да»?)/i.test(b.text || '')) workPending = true;
        if (b.type !== 'tool_use') continue;
        if (b.name === 'Skill' && b.input && b.input.skill === 'elt-code') elt = true;
        if (b.name === 'Skill' && b.input && b.input.skill === 'elt-work') work = true;
        if (['Edit', 'Write', 'NotebookEdit'].includes(b.name)) code = true;
        if (b.name === 'Task') { const p = (b.input && (b.input.prompt || '') || '') + (b.input && b.input.description || ''); if (/судья качества|вынеси.{0,5}вердикт/i.test(p)) judge = true; }
      }
      // inline self-judge: verdict JSON в тексте ассистента
      for (const b of contentBlocks(m)) if (b.type === 'text' && /"verdict":"(pass|block)"/.test(b.text || '')) judge = true;
    });
    if (code) codeSess++; if (elt) eltSess++; if (judge) judgeSess++;
    if (elt && route) routeSess++;
    if (work) workSess++; if (work && workConfirm) workConfirmSess++;
  }
  return { nsess: files.length, codeSess, eltSess, judgeSess, routeSess, workSess, workConfirmSess, newest };
}

// --- judge verdicts из всех ledger ---
function scanLedgers() {
  let total = 0, pass = 0, block = 0; const rows = [];
  let keys; try { keys = fs.readdirSync(BASE); } catch { return { total, pass, block, rows }; }
  for (const k of keys) {
    const f = path.join(BASE, k, 'session-ledger.jsonl');
    if (!fs.existsSync(f)) continue;
    jsonl(f, (e) => { if (e && e.type === 'judge_verdict') { total++; e.verdict === 'block' ? block++ : pass++; rows.push({ k, v: e.verdict, c: e.complexity, ts: (e.ts || '').slice(0, 10) }); } });
  }
  return { total, pass, block, rows };
}

// --- реальные репо (cwd из pipeline-state.json), общий источник для teeth+loop-run-log ---
function listProjectCwds() {
  const seen = new Set(), out = [];
  let keys; try { keys = fs.readdirSync(BASE); } catch { return out; }
  for (const k of keys) {
    let st; try { st = JSON.parse(fs.readFileSync(path.join(BASE, k, 'pipeline-state.json'), 'utf8')); } catch { continue; }
    const cwd = st.cwd; if (!cwd || seen.has(cwd)) continue; seen.add(cwd);
    if (!fs.existsSync(cwd)) continue;
    out.push({ cwd, ts: (st.ts || '').slice(0, 10) });
  }
  return out.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
}

// --- teeth coverage по реальным репо ---
function scanTeeth(cwds) {
  return cwds.map(({ cwd, ts }) => {
    const ex = (p) => { try { return fs.existsSync(path.join(cwd, p)); } catch { return false; } };
    return { name: path.basename(cwd), ts,
      gate: ex('.claude/hooks/judge-closeout-gate.js'), guard: ex('.claude/hooks/block-dangerous-git.js'),
      spec: ex('.specify'), cx: ex('.codegraph/codegraph.db') };
  });
}

// --- elt-loop run-log (.planning/loop-run-log.md) по реальным репо ---
function scanLoopRunLogs(cwds) {
  let slices = 0, reds = 0; const perProject = [];
  for (const { cwd } of cwds) {
    const f = path.join(cwd, '.planning', 'loop-run-log.md');
    let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const rows = txt.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-+/.test(l) && !/дата\s*\|\s*slice/.test(l));
    if (!rows.length) continue;
    let projRed = 0;
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim());
      const attempts = +cells[3] || 1; // | дата | slice | attempts | oracle... |
      if (attempts > 1) projRed++;
    }
    slices += rows.length; reds += projRed;
    perProject.push({ name: path.basename(cwd), slices: rows.length, reds: projRed });
  }
  return { slices, reds, perProject };
}

// --- run ---
let keys; try { keys = fs.readdirSync(BASE); } catch { console.error('нет ~/.claude/projects'); process.exit(1); }
const projects = [];
for (const k of keys) {
  if (!k.startsWith('C--') && !k.startsWith('D--')) continue; // full-path ключи = живые логи
  const r = scanProject(path.join(BASE, k));
  if (r && (ALL || r.newest >= WINDOW)) projects.push({ name: k.replace(/^[CD]--/, '').replace(/-/g, ' ').slice(0, 30), ...r });
}
projects.sort((a, b) => b.newest - a.newest);

let totCode = 0, totElt = 0, totRoute = 0, totWork = 0, totWorkConfirm = 0;
console.log(`\n=== elt-code AUDIT (окно ${DAYS}д, ${projects.length} активных проектов) ===\n`);
console.log('ADOPTION                           codeSess  eltSess   %    judgeSess');
for (const p of projects) {
  totCode += p.codeSess; totElt += p.eltSess; totRoute += p.routeSess; totWork += p.workSess; totWorkConfirm += p.workConfirmSess;
  const pct = p.codeSess ? Math.round((p.eltSess / p.codeSess) * 100) : 0;
  console.log(p.name.padEnd(33) + String(p.codeSess).padStart(7) + String(p.eltSess).padStart(9) + String(pct + '%').padStart(6) + String(p.judgeSess).padStart(9));
}
const adopt = totCode ? Math.round((totElt / totCode) * 100) : 0;
console.log('-'.repeat(64));
console.log(`Σ adoption: ${totElt}/${totCode} кодовых сессий = ${adopt}%`);

const routePct = totElt ? Math.round((totRoute / totElt) * 100) : 0;
console.log(`\nМЕТРИКА 1 — elt-code route-line: ${totRoute}/${totElt} вызовов с маршрут-строкой = ${routePct}%`);

const workConfirmPct = totWork ? Math.round((totWorkConfirm / totWork) * 100) : 0;
console.log(`МЕТРИКА 3 — elt-work вызовы+подтверждения: ${totWorkConfirm}/${totWork} вызовов с явным «да» = ${workConfirmPct}%`);

const J = scanLedgers();
console.log(`\nСУДЬЯ (все ledger, всё время): вердиктов=${J.total}  pass=${J.pass}  block=${J.block}`);
console.log(`  block-ratio=${J.total ? Math.round((J.block / J.total) * 100) : 0}%  ${J.block === 0 && J.total > 0 ? '⚠ НИ ОДНОГО block — судья-театр' : ''}`);

const cwds = listProjectCwds();
const T = scanTeeth(cwds);
console.log('\nЗУБЫ ХАРНЕССА (реальные репо)      gate  guard  specify  codegraph');
for (const t of T) console.log(t.name.padEnd(33) + (t.gate ? 'Y' : '-').padStart(5) + (t.guard ? 'Y' : '-').padStart(6) + (t.spec ? 'Y' : '-').padStart(9) + (t.cx ? 'Y' : '-').padStart(10));
const gated = T.filter((t) => t.gate).length;

const L = scanLoopRunLogs(cwds);
console.log(`\nМЕТРИКА 2 — elt-loop run-log (.planning/loop-run-log.md): слайсов=${L.slices}  красных(attempts>1)=${L.reds}`);
for (const p of L.perProject) console.log(`  ${p.name}: ${p.slices} слайсов, ${p.reds} красных`);
if (!L.perProject.length) console.log('  (нет ни одного loop-run-log.md — elt-loop v0.2 ещё не прогонялся с 2026-07-02)');

console.log(`\nВЕРДИКТ: adoption ${adopt}% | route-line ${routePct}% | block-ratio ${J.total ? Math.round((J.block / J.total) * 100) : 0}% | зубы в ${gated}/${T.length} репо`);

// sanity self-check: парсер должен был увидеть хоть одну кодовую сессию
if (totCode === 0) { console.error('\nSELF-CHECK FAIL: 0 кодовых сессий — парсер/формат JSONL сломан'); process.exit(1); }
console.log('self-check: ok\n');
