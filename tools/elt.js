#!/usr/bin/env node
'use strict';
// elt — machine-readable core of the ELT v2 harness. No deps, Node 18+.
// Commands: init | status | slice next | oracle | commit
// Config:   .harness/harness.json   State log: .git/elt/run-log.jsonl
// Design: .planning/ELT-V2-AUDIT-AND-DESIGN-2026-07-08.md (Pipeline setupper repo).
// Invariants live HERE (exit codes), not in skill prose — that is the whole point.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { readHarnessConfig, verifySettings } = require('./elt-config');
const runLog = require('./run-log');

const cwd = process.cwd();
const HARNESS_DIR = path.join(cwd, '.harness');
const CONFIG = path.join(HARNESS_DIR, 'harness.json');

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
const TASK_LINE_RE = /^(\s*(?:[-*]\s*)?)\[( |X|x)\]\s*(?:\*\*)?(T\d+)?(?:\*\*)?[:.]?\s*(.*)$/;
function parseTasksFile(f) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const open = [], done = [];
  lines.forEach((ln, i) => {
    const m = ln.match(TASK_LINE_RE);
    if (!m) return;
    (m[2] === ' ' ? open : done).push({ file: f, lineNo: i, id: m[3] || `L${i + 1}`, text: m[4].trim() });
  });
  return { file: f, open, done, lines };
}
// explicitSpecDir (006 T019): bypass the alphabetical scan and target one
// spec's tasks.md directly — needed once more than one specs/*/tasks.md has
// open boxes at once (e.g. an older spec with unresolved external blockers),
// otherwise the alphabetically-first one always wins and a later spec that's
// actually being worked can never be reached by `slice next`/the driver.
function findTasks(explicitSpecDir) {
  if (explicitSpecDir) {
    const f = path.join(explicitSpecDir, 'tasks.md');
    if (!fs.existsSync(f)) return null;
    const plan = parseTasksFile(f);
    return { ...plan, all: [plan] };
  }
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
  const plans = [];
  let fallback = null;
  let firstOpen = null;
  for (const f of files) {
    // Приоритет — файл, где ещё остались открытые боксы (комментарий выше это и обещает).
    // Если открытых нигде нет, `status`/`commit` всё равно должны на что-то опереться —
    // fallback запоминает последний файл с любыми боксами (open или done).
    const plan = parseTasksFile(f);
    plans.push(plan);
    if (plan.open.length && !firstOpen) firstOpen = plan;
    if (plan.open.length || plan.done.length) fallback = plan;
  }
  const selected = firstOpen || fallback;
  return selected ? { ...selected, all: plans } : null;
}

// ── батч (2026-07-22) ─────────────────────────────────────────────────────────
// `--task T001,T002,T003`: оракул и судья — САМАЯ дорогая часть слайса (оракул ~96с +
// судья ~40-90с на КАЖДЫЙ таск), и на мелких слайсах гейт стоил больше самой работы.
// Батч платит этот налог один раз на N тасков. Инвариант не ослаблен: тот же зелёный
// оракул, тот же судья по ОБЪЕДИНЁННОМУ диффу, тот же hash-связанный proof — просто
// единица гейта = батч, а не таск. taskId остаётся СТРОКОЙ ("T001,T002") — вся
// hash/валидация proof работает без изменения схемы.
function parseTaskIds(raw) {
  return String(raw == null ? '' : raw).split(',').map((s) => s.trim()).filter(Boolean);
}
function normalizeTaskArg(raw) {
  const ids = parseTaskIds(raw);
  return ids.length ? ids.join(',') : null;
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

// ── spec approve (006 T001): mechanical signature over spec.md + tasks.md ──────
// Same shape as judge-proof above — a hash-bound file next to the plan, not a
// prose "I approved this" — so `elt spec status` can tell "signed" apart from
// "signed, then someone edited the spec" (stale) without re-asking the user.
function resolveSpecDir() {
  const specArg = opt('--spec');
  if (specArg) return path.isAbsolute(specArg) ? specArg : path.join(cwd, specArg);
  const t = findTasks();
  return t ? path.dirname(t.file) : null;
}
function specPaths(specDir) {
  return {
    specMd: path.join(specDir, 'spec.md'),
    tasksMd: path.join(specDir, 'tasks.md'),
    approvalJson: path.join(specDir, 'approval.json'),
  };
}
function readSpecHashes(specDir) {
  const { specMd, tasksMd } = specPaths(specDir);
  if (!fs.existsSync(specMd)) return { error: 'spec.md-missing' };
  if (!fs.existsSync(tasksMd)) return { error: 'tasks.md-missing' };
  return { specHash: sha256(fs.readFileSync(specMd)), tasksHash: sha256(fs.readFileSync(tasksMd)) };
}
function readApproval(specDir) {
  try { return JSON.parse(fs.readFileSync(specPaths(specDir).approvalJson, 'utf8')); } catch { return null; }
}
// 006 T003: spec.md completeness — required H2 sections present (prefix match,
// since headings carry extra context, e.g. "## Вне scope (кандидаты в 007)").
const SPEC_REQUIRED_SECTIONS = ['Проблема', 'Решения', 'User stories', 'Критерии приёмки', 'Риски', 'Вне scope'];
function specLint(specDir) {
  const { specMd } = specPaths(specDir);
  if (!fs.existsSync(specMd)) return { ok: false, missing: SPEC_REQUIRED_SECTIONS.slice(), reason: 'spec.md-missing' };
  const headings = fs.readFileSync(specMd, 'utf8').split(/\r?\n/)
    .filter((line) => /^##\s+/.test(line))
    .map((line) => line.replace(/^##\s+/, '').trim());
  const missing = SPEC_REQUIRED_SECTIONS.filter((req) => !headings.some((h) => h.startsWith(req)));
  return { ok: missing.length === 0, missing };
}
function specApprovalStatus(specDir) {
  const hashes = readSpecHashes(specDir);
  if (hashes.error) return { status: 'error', reason: hashes.error };
  const approval = readApproval(specDir);
  if (!approval) return { status: 'unapproved', ...hashes };
  if (approval.specHash !== hashes.specHash || approval.tasksHash !== hashes.tasksHash) {
    return { status: 'stale', approvedAt: approval.approvedAt, ...hashes };
  }
  return { status: 'approved', approvedAt: approval.approvedAt, ...hashes };
}
// 006 T002: entry gate. specDir here is the plan actually in play for the
// caller (slice next's auto-selected plan, or the specific task's own spec
// dir for commit) — NOT always findTasks()'s first-open plan, so a task from
// a later spec (e.g. 006 while 005 still has open boxes) is judged by ITS OWN
// approval, not an unrelated plan's.
function specApprovalGateFor(cfg, specDir) {
  if (!cfg.specApproval || !specDir) return { blocked: false };
  if (!fs.existsSync(path.join(specDir, 'spec.md'))) return { blocked: false }; // micro-plan: gate doesn't apply
  const status = specApprovalStatus(specDir);
  if (status.status === 'approved') return { blocked: false };
  return { blocked: true, status: status.status, specDir };
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
// Батч связывается ЦЕЛИКОМ: любой из тасков не открыт → binding нет (proof на
// полу-закрытый батч был бы враньём). Разные tasks.md в одном батче тоже нет —
// specPath в proof один, и судья судит по одной рубрике.
function findTaskBinding(taskId) {
  const ids = parseTaskIds(taskId);
  if (!ids.length) return null;
  let specPath = null;
  for (const id of ids) {
    const found = findTaskItem(id, true);
    if (!found) return null;
    const p = path.relative(cwd, found.plan.file).split(path.sep).join('/');
    if (specPath !== null && specPath !== p) return null;
    specPath = p;
  }
  return { taskId: ids.join(','), specPath };
}
function invalidJudgeProof(reason, detail = '') {
  return { ok: false, reason, detail };
}
// 008 T004: включённый контур усиленного судьи — judges[]/grounding/redProof обязательны в
// proof только когда хотя бы один слой сверх базового активен (judge.verify задан ИЛИ
// harness.json.redProof не "off"/пуст). Без этого — старое однопроходное поведение (крит. 7
// спеки 008, обратная совместимость). redProof — простое строковое поле, elt-config.js его
// не валидирует (нет схемы под T005 testCmd/redProof-режимы), читаем напрямую.
function redProofMode() {
  const loaded = readHarnessConfig(cwd);
  return loaded.ok && typeof loaded.config.redProof === 'string' ? loaded.config.redProof.trim() : '';
}
function circuitEnabled() {
  return !!verifySettings(cwd) || (redProofMode() !== '' && redProofMode() !== 'off');
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
  if (taskId && p.taskId !== normalizeTaskArg(taskId)) return invalidJudgeProof('task-mismatch');
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
  // Контур-полнота проверяется ТОЛЬКО для pass (block/dead уже отвергнуты выше) — урезанный
  // proof (без judges[]/grounding/redProof) при включённом контуре не проводится через гейт.
  if (circuitEnabled()) {
    if (!Array.isArray(p.judges) || !p.judges.length ||
        p.judges.some((j) => !j || typeof j !== 'object' || !j.provider || !j.model || !['pass', 'block'].includes(j.verdict))) {
      return invalidJudgeProof('missing-judges');
    }
    if (!p.grounding || typeof p.grounding !== 'object' || Array.isArray(p.grounding) || !Array.isArray(p.grounding.filesReviewed)) {
      return invalidJudgeProof('missing-grounding');
    }
    if (!p.redProof || typeof p.redProof !== 'object' || Array.isArray(p.redProof) || !['red', 'green', 'skipped'].includes(p.redProof.status)) {
      return invalidJudgeProof('missing-redProof');
    }
    // Зелёный red-proof = тест ничего не ловит на baseHead — слайс НЕ доказан (спека 008,
    // критерий 5), даже если оба судьи дали pass.
    if (p.redProof.status === 'green') return invalidJudgeProof('red-proof-green');
  }
  return { ok: true, proof: p };
}
function writeJudgeProof({ taskId, verdict, reasons, model, judges, grounding, redProof }) {
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
  const proof = {
    ...binding, baseHead, treeHash: currentTree, oracleProofHash: sha256(oracleRaw), verdict, reasons, model, createdAt: new Date().toISOString(),
    ...(judges !== undefined ? { judges } : {}),
    ...(grounding !== undefined ? { grounding } : {}),
    ...(redProof !== undefined ? { redProof } : {}),
  };
  fs.mkdirSync(path.dirname(judgeProofPath()), { recursive: true });
  fs.writeFileSync(judgeProofPath(), JSON.stringify(proof, null, 2) + '\n');
  return proof;
}

function appendRunLog(entry) {
  runLog.appendRunLog(cwd, entry);
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
  const lastRun = runLog.lastRun(cwd);
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
  const specArg = opt('--spec');
  const explicitSpecDir = specArg ? (path.isAbsolute(specArg) ? specArg : path.join(cwd, specArg)) : null;
  const t = findTasks(explicitSpecDir);
  if (t && fs.existsSync(CONFIG)) {
    // Lenient read on purpose: `slice next` never required a fully-valid
    // harness.json before (only `commit`/`oracle` do), and specApproval is an
    // opt-in extra field — a config that's otherwise minimal/invalid (e.g. the
    // self-heal watchdog's {oracle, shell} fixture, no kind/judge) must still
    // work exactly as before. Only a config that parses AND opts in can gate.
    let rawCfg;
    try { rawCfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { rawCfg = null; }
    const gate = rawCfg ? specApprovalGateFor(rawCfg, path.dirname(t.file)) : { blocked: false };
    if (gate.blocked) {
      if (flag('--skip-approval')) {
        console.error(`elt slice next: --skip-approval (спека не утверждена: ${gate.status}, ${path.relative(cwd, gate.specDir)})`);
      } else {
        die(`спека не утверждена: elt spec approve (status: ${gate.status}, ${path.relative(cwd, gate.specDir)})`, 4);
      }
    }
  }
  // --count N: N первых открытых задач ОДНОГО плана — вход для батч-режима драйвера.
  // Форма вывода при --count 1 (дефолт) не изменилась (объект, не массив), иначе
  // сломались бы существующие парсеры драйверов (elt-loop.ps1 / fleet).
  const count = Math.max(1, parseInt(opt('--count', '1'), 10) || 1);
  const picks = t ? t.open.slice(0, count) : [];
  const next = picks[0];
  if (flag('--json')) {
    console.log(JSON.stringify(count > 1 ? picks : (next || null)));
    process.exit(next ? 0 : 3);
  }
  if (!next) { console.log('план закрыт: открытых [ ] задач нет'); process.exit(3); }
  for (const p of picks) console.log(`${p.id} ${p.text}\n(${path.relative(cwd, p.file)}:${p.lineNo + 1})`);
  process.exit(0);
}

if (cmd === 'oracle') {
  const cfg = loadConfig();
  runLog.runtimeRunLog(cwd);
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
    const taskId = normalizeTaskArg(opt('--task'));
    const verdict = opt('--verdict');
    const model = opt('--model');
    let reasons;
    try { reasons = JSON.parse(opt('--reasons-json', '[]')); } catch { die('judge proof: --reasons-json must be JSON array'); }
    if (!taskId || !verdict || !model) die('elt judge-proof write --task Txxx --verdict pass|block|dead --model <model> [--reasons-json "[]"] [--extra-file <path>]');
    // --extra-file (008 T004): judges[]/grounding/redProof приходят файлом, не argv — JSON
    // с embedded-кавычками бьётся о PS5.1 native-marshalling баг (см. elt-loop.ps1 comment).
    let extra = {};
    const extraFile = opt('--extra-file');
    if (extraFile) {
      let raw;
      try { raw = fs.readFileSync(extraFile, 'utf8').replace(/^﻿/, ''); } catch { die('judge proof: --extra-file not readable'); }
      try { extra = JSON.parse(raw) || {}; } catch { die('judge proof: --extra-file must be JSON'); }
    }
    console.log(JSON.stringify(writeJudgeProof({ taskId, verdict, reasons, model, judges: extra.judges, grounding: extra.grounding, redProof: extra.redProof }), null, 2));
    process.exit(0);
  }
  if (sub === 'validate') {
    const taskId = normalizeTaskArg(opt('--task'));
    const check = validateJudgeProof({ taskId });
    console.log(JSON.stringify(check, null, 2));
    process.exit(check.ok ? 0 : 4);
  }
  die('elt judge-proof read | write --task Txxx --verdict pass|block|dead --model <model> [--extra-file <path>] | validate --task Txxx');
}

if (cmd === 'spec') {
  const specDir = resolveSpecDir();
  if (!specDir) die('elt spec: не найден specs/*/tasks.md (укажи --spec specs/NNN-slug)', 4);

  if (sub === 'lint') {
    const result = specLint(specDir);
    if (!result.ok) die(`elt spec lint: не хватает секций — ${result.missing.join(', ')}`, 4);
    console.log(`elt spec lint: ok (${path.relative(cwd, specDir)})`);
    process.exit(0);
  }

  if (sub === 'approve') {
    const lint = specLint(specDir);
    if (!lint.ok) die(`elt spec approve: lint не прошёл — не хватает секций: ${lint.missing.join(', ')}`, 4);
    const hashes = readSpecHashes(specDir);
    if (hashes.error) die(`elt spec approve: ${hashes.error} в ${path.relative(cwd, specDir)}`, 4);
    const { approvalJson } = specPaths(specDir);
    const existing = readApproval(specDir);
    if (existing && existing.specHash === hashes.specHash && existing.tasksHash === hashes.tasksHash) {
      console.error(`elt spec approve: уже утверждена (${existing.approvedAt}) — без изменений`);
      console.log(JSON.stringify(existing, null, 2));
      process.exit(0);
    }
    const approval = { approvedAt: new Date().toISOString(), specHash: hashes.specHash, tasksHash: hashes.tasksHash };
    fs.writeFileSync(approvalJson, JSON.stringify(approval, null, 2) + '\n');
    console.error(`elt spec approve: ${path.relative(cwd, approvalJson)}`);
    console.log(JSON.stringify(approval, null, 2));
    process.exit(0);
  }

  if (sub === 'status') {
    const result = specApprovalStatus(specDir);
    console.log(JSON.stringify({ spec: path.relative(cwd, specDir).split(path.sep).join('/'), ...result }, null, 2));
    process.exit(result.status === 'approved' ? 0 : (result.status === 'error' ? 4 : 1));
  }

  die('elt spec approve [--spec specs/NNN-slug] | status [--spec specs/NNN-slug] | lint [--spec specs/NNN-slug]');
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

// Managed git gate: one contract for the local pre-commit hook AND CI.
// The hook is UX (bypassable with --no-verify) — CI's `--ci` re-run of the
// mechanical oracle is the real backstop, so it deliberately never touches the
// judge proof (no LLM call, no per-turn token tax).
if (cmd === 'gate') {
  if (git(['rev-parse', '--is-inside-work-tree']).code !== 0) die('не git-репозиторий');

  if (flag('--ci')) {
    const cfg = loadConfig();
    runLog.runtimeRunLog(cwd);
    const exit = runOracle(cfg);
    if (exit !== 0) {
      appendRunLog({ task: null, status: 'red-stop', oracle: { cmd: cfg.oracle, exit } });
      die(`elt gate --ci: оракул красный (exit ${exit})`, exit);
    }
    console.log('elt gate --ci: oracle green');
    process.exit(0);
  }

  const files = changedFiles();
  if (!files.length) { console.log('elt gate: нечего проверять'); process.exit(0); }
  const blocked = files.filter((file) => !isCheckpointFile(file));
  if (!blocked.length) { console.log('elt gate: только .planning/** и specs/** — judge не нужен'); process.exit(0); }

  const loaded = readJudgeProof();
  if (loaded.error) die(`elt gate: judge proof ${loaded.error} — коммить через elt commit`, 4);

  // `elt commit` validates the judge proof BEFORE it marks the task [X] — that
  // edit changes treeHash, so by the time this hook runs (inside its `git
  // commit` call) a plain re-check against the CURRENT tree would always see
  // stale-tree, even for a legitimate commit. `elt commit` passes the hash of
  // the exact proof bytes it already validated so the hook can trust that
  // specific, unmodified proof instead of re-deriving treeHash post-edit.
  if (process.env.ELT_GATE_TRUST && process.env.ELT_GATE_TRUST === sha256(loaded.raw)) {
    console.log('elt gate: trusted elt commit (proof already validated pre-markDone)');
    process.exit(0);
  }

  const taskId = loaded.proof && loaded.proof.taskId;
  const check = validateJudgeProof({ taskId });
  if (!check.ok) die(`elt gate: judge proof invalid (${check.reason}) — коммить через elt commit`, 4);
  console.log(`elt gate: judge proof valid (${taskId}, ${check.proof.verdict})`);
  process.exit(0);
}

if (cmd === 'commit') {
  runLog.runtimeRunLog(cwd);
  const cfg = loadConfig();
  const taskId = normalizeTaskArg(opt('--task'));
  if (flag('--verdict')) die('elt commit: --verdict is not authority; write a judge proof instead', 4);
  if (git(['rev-parse', '--is-inside-work-tree']).code !== 0) die('не git-репозиторий');
  if (!git(['status', '--porcelain']).out) die('нечего коммитить: дерево чистое', 3);

  // 1. oracle is the gate (driver that just ran it passes --skip-oracle —
  // but the claim is verified, not trusted blindly: F-P1-2 trust-hole).
  // Runs (and, on failure, logs red-stop) regardless of --task — a red oracle
  // must never go silent just because --task was also missing.
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

  // 006 T002: approval gate, evaluated against the TASK'S OWN spec dir (not
  // whatever findTasks() would auto-select) — otherwise a task from a later
  // spec while an earlier one still has open boxes could never be gated (or
  // never be committable at all).
  let approvalSkipped = false;
  {
    const binding = findTaskBinding(taskId);
    const specDir = binding ? path.dirname(path.join(cwd, binding.specPath)) : null;
    const gate = specApprovalGateFor(cfg, specDir);
    if (gate.blocked) {
      if (flag('--skip-approval')) {
        approvalSkipped = true;
        console.error(`elt commit: --skip-approval (спека не утверждена: ${gate.status}, ${path.relative(cwd, gate.specDir)})`);
      } else {
        die(`спека не утверждена: elt spec approve (status: ${gate.status}, ${path.relative(cwd, gate.specDir)})`, 4);
      }
    }
  }

  const judge = validateJudgeProof({ taskId });
  if (!judge.ok) die(`elt commit: judge proof invalid (${judge.reason}) — НЕ коммичу`, 4);
  // Captured now, BEFORE markDone() edits tasks.md and shifts treeHash — the
  // pre-commit hook (triggered by `git commit` below) re-checks the SAME
  // already-validated proof bytes via this hash rather than re-deriving
  // treeHash against the post-markDone tree (see `gate` command comment).
  const gateTrust = sha256(readJudgeProof().raw);

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
  const ids = parseTaskIds(taskId);
  const texts = ids.map((id) => {
    if (flag('--keep-task-open')) {
      const found = findTaskItem(id, true);
      if (!found) die(`задача ${id} не найдена среди открытых [ ]`);
      return found.item.text;
    }
    return markDone(id).text;
  });
  const taskText = texts[0] + (texts.length > 1 ? ` (+${texts.length - 1})` : '');

  const msg = opt('-m', taskId ? `feat: ${taskId} ${taskText}`.slice(0, 90) : 'chore: elt slice');
  if (git(['add', '-A']).code !== 0) die('git add failed');
  const c = spawnSync('git', ['commit', '-m', msg], { cwd, encoding: 'utf8', env: { ...process.env, ELT_GATE_TRUST: gateTrust } });
  if (c.status !== 0) die('git commit failed: ' + (c.stderr || c.stdout));
  const sha = git(['rev-parse', '--short', 'HEAD']).out;

  appendRunLog({ task: taskId, oracle: { cmd: cfg.oracle, exit: oracleExit, skipped: flag('--skip-oracle'), skipTrusted }, commit: sha, branch, verdict: judge.proof.verdict, msg, ...(approvalSkipped ? { approvalSkipped: true } : {}) });

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
  elt slice next [--json] [--count N] [--spec specs/NNN-slug]  следующая [ ] задача (--count N → N первых; exit 3 = план закрыт)
  elt spec approve [--spec specs/NNN-slug]                  подписать spec.md+tasks.md (approval.json, идемпотентно)
  elt spec status [--spec specs/NNN-slug]                   approved | stale | unapproved | error
  elt spec lint [--spec specs/NNN-slug]                     проверка обязательных секций spec.md (approve гоняет его сам)
  elt oracle                                                прогнать оракул, exit-код = истина
  elt gate [--ci]                                           managed git gate: pre-commit (proof) | CI (--ci, mechanical oracle re-run)
  elt commit --task Txxx[,Tyyy,...] [--keep-task-open] [-m msg] [--skip-oracle] [--push]
      зелёный oracle + актуальный judge proof → авто-ветка с main → [X] → add+commit → run-log.jsonl → push
      БАТЧ: --task T001,T002,T003 — один оракул + один судья + один коммит на N задач
            (judge-proof write --task тем же списком; все задачи должны быть открыты и в одном tasks.md)`);
process.exit(cmd ? 1 : 0);
