#!/usr/bin/env node
'use strict';
// elt — machine-readable core of the ELT v2 harness. No deps, Node 18+.
// Commands: init | status | slice next | oracle | commit
// Config:   .harness/harness.json   State log: .harness/run-log.jsonl
// Design: .planning/ELT-V2-AUDIT-AND-DESIGN-2026-07-08.md (Pipeline setupper repo).
// Invariants live HERE (exit codes), not in skill prose — that is the whole point.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { readHarnessConfig } = require('./elt-config');

const cwd = process.cwd();
const HARNESS_DIR = path.join(cwd, '.harness');
const CONFIG = path.join(HARNESS_DIR, 'harness.json');
const RUNLOG = path.join(HARNESS_DIR, 'run-log.jsonl');

function die(msg, code = 1) { console.error('elt: ' + msg); process.exit(code); }
function loadConfig() {
  const loaded = readHarnessConfig(cwd);
  if (!loaded.ok) die(`некорректный ${path.relative(cwd, CONFIG)}: ${loaded.errors.join('; ')}`);
  return loaded.config;
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
  const rootTasks = path.join(cwd, 'tasks.md');
  if (fs.existsSync(rootTasks)) files.push(rootTasks);
  if (fs.existsSync(specsDir)) {
    const specRootTasks = path.join(specsDir, 'tasks.md');
    if (fs.existsSync(specRootTasks)) files.push(specRootTasks);
    for (const d of fs.readdirSync(specsDir).sort()) {
      const f = path.join(specsDir, d, 'tasks.md');
      if (fs.existsSync(f)) files.push(f);
    }
  }
  const re = /^(\s*(?:[-*]\s*)?)\[( |X|x)\]\s*(?:\*\*)?(T\d+)?(?:\*\*)?[:.]?\s*(.*)$/;
  const plans = [];
  let fallback = null;
  let firstOpen = null;
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
    const plan = { file: f, open, done, lines };
    plans.push(plan);
    if (open.length && !firstOpen) firstOpen = plan;
    if (open.length || done.length) fallback = { file: f, open, done, lines };
  }
  const selected = firstOpen || fallback;
  return selected ? { ...selected, all: plans } : null;
}

function findTaskItem(taskId, openOnly = false) {
  const selected = findTasks();
  if (!selected) return null;
  for (const plan of selected.all || [selected]) {
    const item = (openOnly ? plan.open : plan.open.concat(plan.done)).find((x) => x.id === taskId);
    if (item) return { plan, item };
  }
  return null;
}
function markDone(taskId) {
  const found = findTaskItem(taskId, true);
  if (!found) die(`задача ${taskId} не найдена среди открытых [ ]`);
  const { plan: t, item } = found;
  t.lines[item.lineNo] = t.lines[item.lineNo].replace('[ ]', '[X]');
  fs.writeFileSync(t.file, t.lines.join('\n'));
  return item;
}

// Hash of the working tree at the moment the oracle ran, so a later
// `commit --skip-oracle` can tell "still the tree the oracle validated" apart
// from "something changed since — the claim is untrusted" (F-P1-2 trust-hole).
function treeHash() {
  // No `git add -N`: intent-to-add MUTATES the index permanently (until reset/commit) —
  // tried that first, it left leftover staged garbage in the integration checkout after
  // merge.js's post-merge oracle run, which then broke the NEXT slice's merge. Read
  // untracked file content straight off disk instead — zero side effects on the index.
  const runtimeLog = (file) => {
    const normalized = file.replace(/\\/g, '/');
    return normalized.startsWith('.harness/loop-logs/') || normalized.startsWith('.harness/fleet/logs/');
  };
  const status = git(['status', '--porcelain', '-uall']).out.split('\n')
    .filter((line) => !runtimeLog(line.slice(3).trim())).join('\n');
  const h = crypto.createHash('sha256');
  h.update(status + '\n' + git(['diff', 'HEAD']).out);
  const untracked = status.split('\n')
    .filter((l) => l.startsWith('?? '))
    .map((l) => l.slice(3).trim())
    .sort();
  for (const f of untracked) {
    try { h.update(fs.readFileSync(path.join(cwd, f))); } catch { /* gone/unreadable — status already captured it */ }
  }
  return h.digest('hex');
}
// Proof lives in .git (per-worktree via --git-dir), never in the working tree —
// a file under .harness/ would itself show up as a change and pollute every git
// status/diff (broke fleet's "clean after merge" tests when tried that way).
function oracleProofPath() {
  const gd = git(['rev-parse', '--git-dir']).out || '.git';
  return path.join(path.isAbsolute(gd) ? gd : path.join(cwd, gd), 'elt-oracle-proof.json');
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function headSha() {
  return git(['rev-parse', 'HEAD']).out;
}
function writeOracleProof(exit, cfg) {
  const currentTree = treeHash();
  fs.writeFileSync(oracleProofPath(), JSON.stringify({
    exit,
    hash: currentTree,
    treeHash: currentTree,
    baseHead: headSha(),
    command: cfg.oracle,
    ts: new Date().toISOString(),
  }));
}
function readOracleProof() {
  try { return JSON.parse(fs.readFileSync(oracleProofPath(), 'utf8')); } catch { return null; }
}

function runOracle(cfg) {
  console.error(`elt oracle: ${cfg.oracle}`);
  const started = Date.now();
  const code = sh(cfg.oracle, cfg.shell);
  console.error(`elt oracle: exit ${code} (${Math.round((Date.now() - started) / 1000)}s)`);
  writeOracleProof(code, cfg);
  return code;
}

function judgeProofPath() {
  const gd = git(['rev-parse', '--git-dir']).out || '.git';
  return path.join(path.isAbsolute(gd) ? gd : path.join(cwd, gd), 'elt', 'judge-proof.json');
}
function readJudgeProof() {
  let raw;
  try { raw = fs.readFileSync(judgeProofPath(), 'utf8'); } catch { return { error: 'missing' }; }
  try { return { raw, proof: JSON.parse(raw) }; } catch { return { error: 'malformed' }; }
}
function findTaskBinding(taskId) {
  const found = findTaskItem(taskId, true);
  if (!found) return null;
  return { taskId, specPath: path.relative(cwd, found.plan.file).split(path.sep).join('/') };
}
function invalidJudgeProof(reason, detail = '') {
  return { ok: false, reason, detail };
}
function validateJudgeProof({ taskId } = {}) {
  if (!taskId) return invalidJudgeProof('task-required');
  const binding = findTaskBinding(taskId);
  if (!binding) return invalidJudgeProof('task-not-found');
  const loaded = readJudgeProof();
  if (loaded.error) return invalidJudgeProof(loaded.error);
  const p = loaded.proof;
  const requiredStrings = ['taskId', 'specPath', 'baseHead', 'treeHash', 'oracleProofHash', 'verdict', 'model', 'createdAt'];
  if (!p || Array.isArray(p) || requiredStrings.some((key) => typeof p[key] !== 'string' || !p[key].trim()) ||
      !Array.isArray(p.reasons) || !p.reasons.every((reason) => typeof reason === 'string') ||
      !['pass', 'block', 'dead'].includes(p.verdict) || Number.isNaN(Date.parse(p.createdAt))) {
    return invalidJudgeProof('malformed');
  }
  if (taskId && p.taskId !== taskId) return invalidJudgeProof('task-mismatch');
  if (p.specPath !== binding.specPath) return invalidJudgeProof('spec-mismatch');
  if (p.baseHead !== headSha()) return invalidJudgeProof('stale-base');
  if (p.treeHash !== treeHash()) return invalidJudgeProof('stale-tree');
  let oracleRaw;
  try { oracleRaw = fs.readFileSync(oracleProofPath(), 'utf8'); } catch { return invalidJudgeProof('oracle-missing'); }
  let oracle;
  try { oracle = JSON.parse(oracleRaw); } catch { return invalidJudgeProof('oracle-malformed'); }
  if (p.oracleProofHash !== sha256(oracleRaw) || oracle.exit !== 0 || oracle.baseHead !== p.baseHead || oracle.treeHash !== p.treeHash) {
    return invalidJudgeProof('stale-oracle');
  }
  if (p.verdict === 'block') return invalidJudgeProof('judge-block');
  if (p.verdict === 'dead') return invalidJudgeProof('judge-dead');
  return { ok: true, proof: p };
}
function writeJudgeProof({ taskId, verdict, reasons, model }) {
  const binding = findTaskBinding(taskId);
  if (!binding) die(`judge proof: task ${taskId} not found`);
  if (!['pass', 'block', 'dead'].includes(verdict) || !Array.isArray(reasons) || !reasons.every((reason) => typeof reason === 'string') || !model) {
    die('judge proof: invalid verdict, reasons, or model');
  }
  let oracleRaw;
  try { oracleRaw = fs.readFileSync(oracleProofPath(), 'utf8'); } catch { die('judge proof: missing oracle proof'); }
  let oracle;
  try { oracle = JSON.parse(oracleRaw); } catch { die('judge proof: malformed oracle proof'); }
  const baseHead = headSha();
  const currentTree = treeHash();
  if (oracle.exit !== 0 || oracle.baseHead !== baseHead || oracle.treeHash !== currentTree) die('judge proof: stale oracle proof');
  const proof = { ...binding, baseHead, treeHash: currentTree, oracleProofHash: sha256(oracleRaw), verdict, reasons, model, createdAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(judgeProofPath()), { recursive: true });
  fs.writeFileSync(judgeProofPath(), JSON.stringify(proof, null, 2) + '\n');
  return proof;
}

function appendRunLog(entry) {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.appendFileSync(RUNLOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}
function changedFiles() {
  return [...new Set([
    ...git(['diff', '--name-only', 'HEAD']).out.split('\n'),
    ...git(['ls-files', '--others', '--exclude-standard']).out.split('\n'),
  ].filter(Boolean))].sort();
}
function isCheckpointFile(file) {
  return file.startsWith('.planning/') || file.startsWith('specs/');
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
    kind: 'code',
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
  const cfg = loadConfig();
  const exit = runOracle(cfg);
  if (exit !== 0) appendRunLog({ task: null, status: 'red-stop', oracle: { cmd: cfg.oracle, exit } });
  process.exit(exit);
}

if (cmd === 'judge-proof') {
  if (sub === 'read') {
    const loaded = readJudgeProof();
    if (loaded.error) die(`judge proof ${loaded.error}`, 4);
    console.log(JSON.stringify(loaded.proof, null, 2));
    process.exit(0);
  }
  if (sub === 'write') {
    const taskId = opt('--task');
    const verdict = opt('--verdict');
    const model = opt('--model');
    let reasons;
    try { reasons = JSON.parse(opt('--reasons-json', '[]')); } catch { die('judge proof: --reasons-json must be JSON array'); }
    if (!taskId || !verdict || !model) die('elt judge-proof write --task Txxx --verdict pass|block|dead --model <model> [--reasons-json "[]"]');
    console.log(JSON.stringify(writeJudgeProof({ taskId, verdict, reasons, model }), null, 2));
    process.exit(0);
  }
  if (sub === 'validate') {
    const taskId = opt('--task');
    const check = validateJudgeProof({ taskId });
    console.log(JSON.stringify(check, null, 2));
    process.exit(check.ok ? 0 : 4);
  }
  die('elt judge-proof read | write --task Txxx --verdict pass|block|dead --model <model> | validate --task Txxx');
}

if (cmd === 'checkpoint') {
  if (git(['rev-parse', '--is-inside-work-tree']).code !== 0) die('не git-репозиторий');
  const files = changedFiles();
  if (!files.length) die('нечего коммитить: дерево чистое', 3);
  const blocked = files.filter((file) => !isCheckpointFile(file));
  if (blocked.length) die(`checkpoint разрешён только для .planning/** и specs/**: ${blocked.join(', ')}`, 4);
  if (git(['add', '--', ...files]).code !== 0) die('git add failed');
  const c = spawnSync('git', ['commit', '-m', opt('-m', 'docs: checkpoint')], { cwd, encoding: 'utf8' });
  if (c.status !== 0) die('git commit failed: ' + (c.stderr || c.stdout));
  console.log(`elt checkpoint: ${git(['rev-parse', '--short', 'HEAD']).out}`);
  process.exit(0);
}

if (cmd === 'commit') {
  const cfg = loadConfig();
  const taskId = opt('--task');
  if (flag('--verdict')) die('elt commit: --verdict is not authority; write a judge proof instead', 4);
  if (git(['rev-parse', '--is-inside-work-tree']).code !== 0) die('не git-репозиторий');
  if (!git(['status', '--porcelain']).out) die('нечего коммитить: дерево чистое', 3);

  // 1. oracle is the gate (driver that just ran it passes --skip-oracle —
  // but the claim is verified, not trusted blindly: F-P1-2 trust-hole).
  let oracleExit = 0;
  let skipTrusted = false;
  if (flag('--skip-oracle')) {
    const proof = readOracleProof();
    skipTrusted = !!proof && proof.exit === 0 && proof.hash === treeHash();
    if (!skipTrusted) {
      console.error('elt commit: --skip-oracle без валидного пруфа (дерево изменилось с последнего зелёного оракула) — перепрогоняю оракул.');
    }
  }
  if (!flag('--skip-oracle') || !skipTrusted) {
    oracleExit = runOracle(cfg);
    if (oracleExit !== 0) {
      appendRunLog({ task: taskId || null, status: 'red-stop', oracle: { cmd: cfg.oracle, exit: oracleExit } });
      die(`оракул красный (exit ${oracleExit}) — НЕ коммичу`, oracleExit);
    }
  }

  if (!taskId) die('elt commit: --task Txxx is required for a code commit', 4);
  const judge = validateJudgeProof({ taskId });
  if (!judge.ok) die(`elt commit: judge proof invalid (${judge.reason}) — НЕ коммичу`, 4);

  // 2. auto-branch: never commit slices straight to main (policy: feature)
  let branch = git(['branch', '--show-current']).out;
  if (cfg.branchPolicy === 'feature' && ['main', 'master'].includes(branch)) {
    const slug = (taskId || 'slice').toLowerCase() + '-' + new Date().toISOString().slice(0, 10);
    const r = git(['switch', '-c', `feature/${slug}`]);
    if (r.code !== 0) die('не смог создать ветку: ' + r.err);
    branch = `feature/${slug}`;
    console.error('elt commit: авто-ветка ' + branch);
  }

  // 3. Fleet validates the same task/proof but leaves [X] to its merge queue.
  const taskText = flag('--keep-task-open')
    ? (() => {
        const found = findTaskItem(taskId, true);
        if (!found) die(`задача ${taskId} не найдена среди открытых [ ]`);
        return found.item.text;
      })()
    : markDone(taskId).text;

  const msg = opt('-m', taskId ? `feat: ${taskId} ${taskText}`.slice(0, 90) : 'chore: elt slice');
  if (git(['add', '-A']).code !== 0) die('git add failed');
  const c = spawnSync('git', ['commit', '-m', msg], { cwd, encoding: 'utf8' });
  if (c.status !== 0) die('git commit failed: ' + (c.stderr || c.stdout));
  const sha = git(['rev-parse', '--short', 'HEAD']).out;

  appendRunLog({ task: taskId, oracle: { cmd: cfg.oracle, exit: oracleExit, skipped: flag('--skip-oracle'), skipTrusted }, commit: sha, branch, verdict: judge.proof.verdict, msg });

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
  elt commit --task Txxx [--keep-task-open] [-m msg] [--skip-oracle] [--push]
      зелёный oracle + актуальный judge proof → авто-ветка с main → [X] → add+commit → run-log.jsonl → push`);
process.exit(cmd ? 1 : 0);
