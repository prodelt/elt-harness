#!/usr/bin/env node
'use strict';
// elt — machine-readable core of the ELT v2 harness. No deps, Node 18+.
// Commands: init | status | slice next | oracle | commit
// Config:   .harness/harness.json   State log: .harness/run-log.jsonl
// Design: .planning/ELT-V2-AUDIT-AND-DESIGN-2026-07-08.md (Pipeline setupper repo).
// Invariants live HERE (exit codes), not in skill prose — that is the whole point.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const cwd = process.cwd();
const HARNESS_DIR = path.join(cwd, '.harness');
const CONFIG = path.join(HARNESS_DIR, 'harness.json');
const RUNLOG = path.join(HARNESS_DIR, 'run-log.jsonl');

function die(msg, code = 1) { console.error('elt: ' + msg); process.exit(code); }
function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); }
  catch { die(`нет ${path.relative(cwd, CONFIG)} — запусти: elt init --oracle "<test cmd>"`); }
}
function sh(cmd, shell) {
  const r = shell === 'powershell'
    ? spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { stdio: 'inherit' })
    : spawnSync('bash', ['-c', cmd], { stdio: 'inherit' });
  return r.status === null ? 1 : r.status;
}
function git(args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

// ── tasks.md (spec-kit): first specs/*/tasks.md that still has open boxes ──────
function findTasks() {
  const specsDir = path.join(cwd, 'specs');
  const files = [];
  if (fs.existsSync(specsDir)) {
    for (const d of fs.readdirSync(specsDir).sort()) {
      const f = path.join(specsDir, d, 'tasks.md');
      if (fs.existsSync(f)) files.push(f);
    }
  }
  const re = /^(\s*(?:[-*]\s*)?)\[( |X|x)\]\s*(?:\*\*)?(T\d+)?(?:\*\*)?[:.]?\s*(.*)$/;
  let fallback = null;
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    const open = [], done = [];
    lines.forEach((ln, i) => {
      const m = ln.match(re);
      if (!m) return;
      (m[2] === ' ' ? open : done).push({ file: f, lineNo: i, id: m[3] || `L${i + 1}`, text: m[4].trim() });
    });
    // Приоритет — файл, где ещё остались открытые боксы (комментарий выше это и обещает).
    // Если открытых нигде нет, `status`/`commit` всё равно должны на что-то опереться —
    // fallback запоминает последний файл с любыми боксами (open или done).
    if (open.length) return { file: f, open, done, lines };
    if (open.length || done.length) fallback = { file: f, open, done, lines };
  }
  return fallback;
}

function markDone(taskId) {
  const t = findTasks();
  if (!t) die('нет specs/*/tasks.md');
  const item = t.open.find((x) => x.id === taskId);
  if (!item) die(`задача ${taskId} не найдена среди открытых [ ]`);
  t.lines[item.lineNo] = t.lines[item.lineNo].replace('[ ]', '[X]');
  fs.writeFileSync(t.file, t.lines.join('\n'));
  return item;
}

function runOracle(cfg) {
  console.error(`elt oracle: ${cfg.oracle}`);
  const started = Date.now();
  const code = sh(cfg.oracle, cfg.shell);
  console.error(`elt oracle: exit ${code} (${Math.round((Date.now() - started) / 1000)}s)`);
  return code;
}

function appendRunLog(entry) {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.appendFileSync(RUNLOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

// ── commands ──────────────────────────────────────────────────────────────────
const [cmd, sub] = process.argv.slice(2);
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(name); }
function opt(name, dflt) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt; }

if (cmd === 'init') {
  const oracle = opt('--oracle');
  if (!oracle) die('elt init --oracle "<cmd>" [--shell powershell] [--push] [--force]');
  if (fs.existsSync(CONFIG) && !flag('--force')) die('harness.json уже есть (перезапись: --force)');
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  const cfg = {
    oracle,
    shell: opt('--shell', 'bash'),
    branchPolicy: opt('--branch-policy', 'feature'),
    push: flag('--push'),
    judge: { enabled: true, model: opt('--judge-model', 'sonnet') },
  };
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n');
  console.log('elt init: ' + path.relative(cwd, CONFIG));
  console.log(JSON.stringify(cfg, null, 2));
  process.exit(0);
}

if (cmd === 'status') {
  const branch = git(['branch', '--show-current']);
  const dirty = git(['status', '--porcelain']);
  const dirtyN = dirty.out ? dirty.out.split('\n').length : 0;
  const t = findTasks();
  const cfgExists = fs.existsSync(CONFIG);
  let lastRun = null;
  try { const l = fs.readFileSync(RUNLOG, 'utf8').trim().split('\n'); lastRun = JSON.parse(l[l.length - 1]); } catch {}
  const out = {
    git: branch.code === 0 ? { branch: branch.out || '(detached)', dirty: dirtyN } : 'NOT A REPO',
    harness: cfgExists ? loadConfig() : 'NO harness.json — elt init',
    plan: t ? { file: path.relative(cwd, t.file), open: t.open.length, done: t.done.length, next: t.open[0] ? `${t.open[0].id} ${t.open[0].text}` : null } : 'no specs/*/tasks.md',
    lastRun,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

if (cmd === 'slice' && sub === 'next') {
  const t = findTasks();
  const next = t && t.open[0];
  if (flag('--json')) { console.log(JSON.stringify(next || null)); process.exit(next ? 0 : 3); }
  if (!next) { console.log('план закрыт: открытых [ ] задач нет'); process.exit(3); }
  console.log(`${next.id} ${next.text}\n(${path.relative(cwd, next.file)}:${next.lineNo + 1})`);
  process.exit(0);
}

if (cmd === 'oracle') {
  process.exit(runOracle(loadConfig()));
}

if (cmd === 'commit') {
  const cfg = loadConfig();
  const taskId = opt('--task');
  const verdict = opt('--verdict', null);
  if (git(['rev-parse', '--is-inside-work-tree']).code !== 0) die('не git-репозиторий');
  if (!git(['status', '--porcelain']).out) die('нечего коммитить: дерево чистое', 3);

  // 1. oracle is the gate (driver that just ran it passes --skip-oracle)
  let oracleExit = 0;
  if (!flag('--skip-oracle')) {
    oracleExit = runOracle(cfg);
    if (oracleExit !== 0) die(`оракул красный (exit ${oracleExit}) — НЕ коммичу`, oracleExit);
  }

  // 2. auto-branch: never commit slices straight to main (policy: feature)
  let branch = git(['branch', '--show-current']).out;
  if (cfg.branchPolicy === 'feature' && ['main', 'master'].includes(branch)) {
    const slug = (taskId || 'slice').toLowerCase() + '-' + new Date().toISOString().slice(0, 10);
    const r = git(['switch', '-c', `feature/${slug}`]);
    if (r.code !== 0) die('не смог создать ветку: ' + r.err);
    branch = `feature/${slug}`;
    console.error('elt commit: авто-ветка ' + branch);
  }

  // 3. mark [X] BEFORE add so the mark lands in the same commit
  let taskText = '';
  if (taskId) taskText = markDone(taskId).text;

  const msg = opt('-m', taskId ? `feat: ${taskId} ${taskText}`.slice(0, 90) : 'chore: elt slice');
  if (git(['add', '-A']).code !== 0) die('git add failed');
  const c = spawnSync('git', ['commit', '-m', msg], { cwd, encoding: 'utf8' });
  if (c.status !== 0) die('git commit failed: ' + (c.stderr || c.stdout));
  const sha = git(['rev-parse', '--short', 'HEAD']).out;

  appendRunLog({ task: taskId || null, oracle: { cmd: cfg.oracle, exit: oracleExit, skipped: flag('--skip-oracle') }, commit: sha, branch, verdict, msg });

  // 4. push strictly by flag (config or CLI)
  if (cfg.push || flag('--push')) {
    const p = git(['push', '-u', 'origin', branch]);
    console.error(p.code === 0 ? 'elt commit: pushed' : 'elt commit: push FAILED — ' + p.err);
  }
  console.log(`elt commit: ${sha} на ${branch}${taskId ? ' — ' + taskId + ' [X]' : ''}`);
  process.exit(0);
}

console.log(`elt — ядро ELT v2 харнесса
  elt init --oracle "<cmd>" [--shell powershell] [--push]   создать .harness/harness.json
  elt status                                                git + план + последний прогон
  elt slice next [--json]                                   следующая [ ] задача (exit 3 = план закрыт)
  elt oracle                                                прогнать оракул, exit-код = истина
  elt commit [--task Txxx] [-m msg] [--skip-oracle] [--verdict pass] [--push]
      оракул → авто-ветка с main → [X] в tasks.md → add+commit → run-log.jsonl → push по флагу`);
process.exit(cmd ? 1 : 0);
