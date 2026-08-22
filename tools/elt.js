#!/usr/bin/env node
'use strict';
// elt — machine-readable core of the ELT v3 harness. No deps, Node 18+.
// Commands: init | status | slice next | oracle | commit
// Config:   .harness/harness.json   State log: .git/elt/run-log.jsonl
// Design: ELT v3 — протокол замера и три схемы харнесса.html (Pipeline setupper repo).
// Invariants live HERE (exit codes), not in skill prose — that is the whole point.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { readHarnessConfig } = require('./elt-config');
const runLog = require('./run-log');
const eltStats = require('./elt-stats');

const cwd = process.cwd();
const HARNESS_DIR = path.join(cwd, '.harness');
const CONFIG = path.join(HARNESS_DIR, 'harness.json');

function die(msg, code = 1) { console.error('elt: ' + msg); process.exit(code); }
function loadConfig() {
  const loaded = readHarnessConfig(cwd);
  if (!loaded.ok) die(`некорректный ${path.relative(cwd, CONFIG)}: ${loaded.errors.join('; ')}`);
  // ELT v3 не исполняет старый verify-on-pass. Не показываем неактивное поле и в status,
  // иначе пользователь видит конфиг, который runtime сознательно не применяет.
  const config = { ...loaded.config };
  if (config.judge && typeof config.judge === 'object' && !Array.isArray(config.judge)) {
    config.judge = { ...config.judge };
    delete config.judge.verify;
  }
  return config;
}
// 009 T005: вывод оракула ЗАХВАТЫВАЕТСЯ (pipe), а не только льётся в консоль — self-heal
// раньше получал в промпт хвост impl-лога (что делал имплементатор), но НЕ текст ошибки,
// на которую должен реагировать. Цена: вывод печатается по завершении, а не построчно.
// maxBuffer обязателен: дефолт spawnSync — 1 МБ, а при его превышении процесс УБИВАЕТСЯ
// (ENOBUFS) — то есть болтливый оракул не просто терял бы хвост, а получал ложный
// провал. Cap на 8K применяется к сохраняемому хвосту, а не к самому оракулу.
const ORACLE_MAX_BUFFER = 256 * 1024 * 1024;
function sh(cmd, shell) {
  const opts = { encoding: 'utf8', maxBuffer: ORACLE_MAX_BUFFER };
  const r = shell === 'powershell'
    ? spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], opts)
    : spawnSync('bash', ['-c', cmd], opts);
  const out = (r.stdout || '') + (r.stderr || '');
  process.stderr.write(out);
  return { code: r.status === null ? 1 : r.status, out };
}
function git(args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

// ── tasks.md (spec-kit): newest plan is the active plan ───────────────────────
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
// explicitSpecDir targets one plan exactly. Without it, the newest plan wins even when it is
// already closed. That is deliberate: an old unfinished backlog must never silently resurrect
// after a newer plan has shipped. Work on an older plan requires an explicit `--spec`.
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
  for (const f of files) {
    const plan = parseTasksFile(f);
    plans.push(plan);
  }
  const selected = [...plans].reverse().find((plan) => plan.open.length || plan.done.length) || null;
  // Task ids are unique only inside one plan. Default lookup is therefore scoped to the active
  // newest plan; callers that need history must say `--spec` instead of relying on scan order.
  return selected ? { ...selected, all: [selected] } : null;
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

// 009 T004 — парковка. Слайс, не прошедший гейт, раньше убивал ВЕСЬ прогон (`break`):
// одна упрямая задача съедала бюджет автономки, остальной план оставался нетронутым.
// Теперь такой слайс записывается сюда, дерево откатывается, петля берёт следующий.
const PARKED = path.join(HARNESS_DIR, 'parked.json');
function readParked() {
  try { const p = JSON.parse(fs.readFileSync(PARKED, 'utf8')); return Array.isArray(p) ? p : []; } catch { return []; }
}
function writeParked(list) {
  if (!list.length) { fs.rmSync(PARKED, { force: true }); return; }
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(PARKED, JSON.stringify(list, null, 2) + '\n');
  gitExclude('.harness/parked.json');
}
// Сверка по ОТДЕЛЬНЫМ id, а не по строке батча: припаркованный батч "T001,T002" обязан
// сниматься и когда позже коммитится один T001 — иначе status врёт про живую задачу.
function parkedIds() {
  const ids = new Set();
  for (const e of readParked()) for (const id of parseTaskIds(e.tid)) ids.add(id);
  return ids;
}
function unpark(taskId) {
  const ids = new Set(parseTaskIds(taskId));
  const list = readParked();
  const rest = list.filter((e) => !parseTaskIds(e.tid).some((id) => ids.has(id)));
  if (rest.length !== list.length) writeParked(rest);
  return list.length - rest.length;
}

// `--spec` уважают ВСЕ команды, работающие с задачей (judge run, commit, park), а не только
// `slice next`: id уникальны внутри спеки, но не между спеками — открытый T005 есть и в 008,
// и в 009, и без выбора спеки побеждала первая по алфавиту. Живьём это значило судью с чужой
// рубрикой (гарантированный block) и, хуже, `[X]` в ЧУЖОМ плане после успешного слайса.
function findTaskItem(taskId, openOnly = false) {
  const selected = findTasks(opt('--spec') ? resolveSpecDir() : undefined);
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
// Состояние прогона (парковка, хвост оракула) — не артефакт репо: без игнора `elt commit`
// (git add -A) утащил бы его в коммит следующего слайса. Игнор пишем в .git/info/exclude,
// а НЕ файлом в дереве: любой новый файл в дереве сам ломает драйвер — ветка «имплементатор
// ничего не изменил» смотрит на `git status --porcelain`, и он перестал бы быть пустым.
function gitExclude(rel) {
  const gitDirOut = git(['rev-parse', '--git-dir']);
  if (gitDirOut.code !== 0 || !gitDirOut.out) return;
  const gd = path.isAbsolute(gitDirOut.out) ? gitDirOut.out : path.join(cwd, gitDirOut.out);
  const exclude = path.join(gd, 'info', 'exclude');
  const body = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  if (body.split(/\r?\n/).includes(rel)) return;
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  fs.writeFileSync(exclude, body + (body && !body.endsWith('\n') ? '\n' : '') + rel + '\n');
}

function treeHash() {
  // No `git add -N`: intent-to-add MUTATES the index permanently (until reset/commit) —
  // tried that first, it left leftover staged garbage in the integration checkout after
  // merge.js's post-merge oracle run, which then broke the NEXT slice's merge. Read
  // untracked file content straight off disk instead — zero side effects on the index.
  const runtimeLog = (file) => {
    const normalized = file.replace(/\\/g, '/');
    // .harness/fleet/prompts/ — T028: agy-провайдер пишет промпт сюда (снимает ENAMETOOLONG
    // на argv). В репо-разработчике каталог гитигнорен, но в ЛЮБОМ ДРУГОМ проекте (эта строка
    // деплоится в ~/.claude/bin/elt.js) его никто не игнорит — живой дефект T014: судья реально
    // отвечал, но treeHash() между `oracle` и записью proof сдвигался на файл, который создал
    // САМ гейт, а не имплементатор, и honest прогон получал ложный `stale oracle proof`.
    return normalized.startsWith('.harness/loop-logs/') || normalized.startsWith('.harness/fleet/logs/')
      || normalized.startsWith('.harness/fleet/prompts/');
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
  // Хеш от НОРМАЛИЗОВАННОГО текста, не от байтов. Живой прогон 011/T019 (01.08): при
  // core.autocrlf=true git отдаёт CRLF на checkout, поэтому тот же самый файл в fleet-worktree
  // имеет другие байты, чем в основном дереве, — approval там всегда `stale`, и fleet на
  // Windows не мог закоммитить НИ ОДИН слайс любой спеки с specApproval:true. Подпись обязана
  // держаться за содержание спеки, а не за перевод строк, которым её записал чекаут.
  const text = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  return { specHash: sha256(text(specMd)), tasksHash: sha256(normalizeTasks(text(tasksMd))) };
}
// 018 T001: хеш плана держится за СОСТАВ задач, а не за их состояние. `elt commit` правит в
// tasks.md ровно один символ — галочку закрытой задачи (см. `.replace('[ ]', '[X]')` выше) — и
// этого хватало, чтобы подпись протухла для СЛЕДУЮЩЕГО слайса: на спеке из 9 задач 8 лишних
// переутверждений (D11), а внутри одного прогона fleet — гарантированная смерть всех слайсов
// после первого merge (D7). Нормализация снимает ровно это и ничего больше: текст задачи, её
// зона и появление новой задачи по-прежнему ломают подпись, и это правильно.
function normalizeTasks(text) {
  return text.replace(/^(\s*[-*]\s*\[)[xX](\])/gm, '$1 $2');
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

// Хвост оракула для self-heal (009 T005). Cap — с КОНЦА: сообщения об ошибках и стек
// у тест-раннеров идут последними, обрезать надо голову.
const ORACLE_TAIL = path.join(HARNESS_DIR, 'oracle-tail.log');
const ORACLE_TAIL_CAP = 8000;
function writeOracleTail(out) {
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  fs.writeFileSync(ORACLE_TAIL, out.length > ORACLE_TAIL_CAP ? out.slice(-ORACLE_TAIL_CAP) : out);
  gitExclude('.harness/oracle-tail.log');
}

// 009 T008: длительность прогона измерялась и печаталась, но не сохранялась — детектор
// `oracle-slow` (harness-watch) был слеп. Модульная переменная, а не новый тип возврата:
// runOracle зовут из четырёх мест, и менять контракт ради одного числа дороже, чем читать
// его рядом с appendRunLog. ponytail: одно значение на процесс, процесс гоняет оракул раз.
let lastOracleSec = null;
// 011 T020: было ли это полный прогон (--full, ИЛИ проект вообще не сузил выборку до impact —
// тогда каждый прогон и так полон). Пишется в run-log рядом с durationSec, чтобы
// elt-oracle-runner.slicesSinceFull могла посчитать хвост без повторного вызова оракула.
let lastOracleFull = null;
// 011 T010 (L2, D0) — smoke: запустить ТО, ЧЕМ ПОЛЬЗУЕТСЯ ЧЕЛОВЕК. Мотив из аудита 2026-07-29:
// три уехавших регресса были в рантайме собранного приложения, и юнит-оракул не ловит их в
// принципе — он проверяет функции, а не то, что продукт вообще стартует.
// Поля нет / пусто → слоя нет (старое поведение, обратная совместимость).
let lastSmoke = null;
function runSmoke(cfg) {
  const cmd = typeof cfg.smoke === 'string' ? cfg.smoke.trim() : '';
  if (!cmd) return { ran: false, code: 0, out: '' };
  console.error(`elt smoke: ${cmd}`);
  const { code, out } = sh(cmd, cfg.shell);
  console.error(`elt smoke: exit ${code}`);
  return { ran: true, code, out, cmd };
}
// 011 T017 (в) — L0 ПЕРЕД оракулом. Схема гейта (spec.md 011) — `S → L0 → L1`, но evaluate
// звалась только внутри runJudge, т.е. ПОСЛЕ оракула: триггер, выносящий вердикт сам
// (`external-import-no-ctx7` — «API не подтверждён», судья тут ничего не добавит), успевал
// стоить полного прогона в 150 c ровно перед тем, как его отменить.
// Здесь ловим ТОЛЬКО вердикт-несущие триггеры. `judgeNeeded` (риск-развилка) остаётся в
// runJudge: он решает, звать ли судью ПОСЛЕ зелёного оракула, и оракул не отменяет — L1
// гоняется всегда, чистый слайс тоже.
// Резолв как у моста судьи (T003): `elt.js` живёт не только в репо, но и деплоем в
// `~/.claude/bin/`, где соседей-модулей всего два (elt-config, run-log). Замыкание L0 уже
// разложено рядом — в `~/.claude/bin/judge/` (sync-bin), оттуда и берём. Поймано оракулом:
// прямой `require('./elt-gate-l0')` убивал `elt oracle` MODULE_NOT_FOUND во ВСЕХ проектах.
function requireL0() {
  try { return require('./elt-gate-l0'); } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    return require(path.join(os.homedir(), '.claude', 'bin', 'judge', 'elt-gate-l0.js'));
  }
}
// Тот же деплой-фолбэк, что у L0 (T017): `elt.js` живёт и деплоем в `~/.claude/bin/`, где
// harness-watch.js — ещё один ручной сосед (как elt-stats.js/elt-config.js/run-log.js).
function requireHarnessWatch() {
  try { return require('./harness-watch'); } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    return require(path.join(os.homedir(), '.claude', 'bin', 'harness-watch.js'));
  }
}
function preOracleL0(cfg) {
  const { evaluate, loadConfig } = requireL0();
  const l0 = evaluate({
    diff: git(['diff', 'HEAD']).out,
    status: git(['status', '--porcelain']).out,
    config: loadConfig(cwd),
    cwd,
  });
  // Только `block`. `inconclusive` (ctx7 недоступен, R5) — НЕблокирующий исход: его маршрут в
  // очередь ревью живёт на судейском пути, и остановка цепочки здесь превратила бы «не смогли
  // проверить» в «запрещено», ровно против R5.
  if (l0.verdict !== 'block') return null;
  for (const t of l0.triggers) console.error(`elt L0 block: ${t.name} — ${t.reason}`);
  return l0;
}
function runOracle(cfg, { full = false } = {}) {
  console.error(`elt oracle: ${cfg.oracle}`);
  const started = Date.now();
  // ELT_ORACLE_FULL — единственный канал донести --full через границу процесса: cfg.oracle —
  // shell-СТРОКА из harness.json (обычно `node tools/elt-oracle-runner.js`), а не argv, которые
  // можно было бы дописать. sh() наследует process.env без изменений, поэтому переменная
  // долетает и до fleet-воркеров (merge.js спавнит `node elt oracle` тем же процессным деревом,
  // fleet.js выставляет её ДО спавна — унаследованный env читаем здесь же, а не только argv,
  // иначе явный `full=false` этого вызова стёр бы унаследованный сигнал перед sh()).
  const wantFull = full || process.env.ELT_ORACLE_FULL === '1';
  const prevEnv = process.env.ELT_ORACLE_FULL;
  if (wantFull) process.env.ELT_ORACLE_FULL = '1'; else delete process.env.ELT_ORACLE_FULL;
  const { code, out } = sh(cfg.oracle, cfg.shell);
  if (prevEnv === undefined) delete process.env.ELT_ORACLE_FULL; else process.env.ELT_ORACLE_FULL = prevEnv; // восстановить как было
  lastOracleFull = wantFull || cfg.oracleSelect !== 'impact';
  lastOracleSec = Math.round((Date.now() - started) / 1000);
  console.error(`elt oracle: exit ${code} (${lastOracleSec}s)`);
  // Smoke идёт ПОСЛЕ оракула и только по зелёному: гонять приложение, чьи юнит-тесты уже
  // красные, — тратить минуты на второй способ узнать то же самое.
  const smoke = code === 0 ? runSmoke(cfg) : { ran: false, code: 0, out: '' };
  lastSmoke = smoke.ran ? { cmd: smoke.cmd, exit: smoke.code } : null;
  const exit = code !== 0 ? code : smoke.code;
  // Хвост smoke — В ТОТ ЖЕ отчёт: красный smoke без вывода это «что-то сломалось», а с ним —
  // готовая причина. Один файл, потому что читатель у них один.
  writeOracleTail(out + (smoke.ran ? `\n--- smoke: ${smoke.cmd} (exit ${smoke.code}) ---\n${smoke.out}` : ''));
  writeOracleProof(exit, cfg);
  return exit;
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
// 011 T004: `inconclusive` — судья не нашёл нарушения, но не может ручаться. Слайс проходит
// с меткой, причина уходит в очередь ревью человеку. `dead` здесь не исход судьи, а отметка
// «судья не отработал» (009 T002) — она гейт не проводит, как и раньше.
const PROOF_VERDICTS = ['pass', 'block', 'dead', 'inconclusive'];
// Очередь ревью — рантайм-состояние проекта, как run-log: в .gitignore, чтобы строка не
// попадала в дифф следующего слайса и не двигала treeHash под оракул-пруфом.
const REVIEW_QUEUE = path.join('.harness', 'review-queue.jsonl');
// 016 T010: что считается документным коммитом. Умышленно узко — текст и планы, ничего
// исполняемого: любой файл вне этого списка возвращает требование `--task`.
const DOC_COMMIT_RE = /(\.md|\.txt|\.rst)$|^\.planning\/|^specs\//i;
// В ELT v3 усиленный proof включается только живым redProof. Legacy judge.verify игнорируется:
// второй LLM-судья был главным источником ложных блокировок и больше не является частью схемы.
function redProofMode() {
  const loaded = readHarnessConfig(cwd);
  return loaded.ok && typeof loaded.config.redProof === 'string' ? loaded.config.redProof.trim() : '';
}
function circuitEnabled() {
  return redProofMode() !== '' && redProofMode() !== 'off';
}
// 009 T002: attest — вердикт проводится ТОЛЬКО машинным вызовом судьи (`elt judge run`).
// Мотив (аудит 24.07): в интерактиве вердикт был самозаверением — тот же агент, что писал
// код, печатал `judge-proof write --verdict pass`, и механического судьи в проде не было
// вообще. attest:false — старое поведение (обратная совместимость проектов без контура).
function attestEnabled() {
  const loaded = readHarnessConfig(cwd);
  return !!(loaded.ok && loaded.config.judge && loaded.config.judge.attest === true);
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
      !PROOF_VERDICTS.includes(p.verdict) || Number.isNaN(Date.parse(p.createdAt))) {
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
    // 009 T010: `runOk:false` — судья, который НЕ ответил (завис/таймаут) и был перевыдан
    // следующему CLI. Такая запись остаётся в judges[] намеренно — это след перевыдачи, и
    // вердикта у неё нет по определению. Требовать pass/block от неё значило бы, что гейт с
    // перевыдачей физически не может закоммититься. Вердикт спрашиваем с ОТВЕТИВШИХ, и хотя
    // бы один ответивший обязан быть — иначе proof из одних смертей проехал бы как pass.
    const answered = Array.isArray(p.judges) ? p.judges.filter((j) => j && typeof j === 'object' && j.runOk !== false) : [];
    if (!Array.isArray(p.judges) || !p.judges.length || !answered.length ||
        p.judges.some((j) => !j || typeof j !== 'object' || !j.provider || !j.model) ||
        answered.some((j) => !['pass', 'block', 'inconclusive'].includes(j.verdict))) {
      return invalidJudgeProof('missing-judges');
    }
    if (!p.grounding || typeof p.grounding !== 'object' || Array.isArray(p.grounding) || !Array.isArray(p.grounding.filesReviewed)) {
      return invalidJudgeProof('missing-grounding');
    }
    if (!p.redProof || typeof p.redProof !== 'object' || Array.isArray(p.redProof) || !['red', 'green', 'skipped'].includes(p.redProof.status)) {
      return invalidJudgeProof('missing-redProof');
    }
    // Зелёный red-proof = тест ничего не ловит на baseHead — слайс НЕ доказан (спека 008,
    // критерий 5). 011 T019(а): это больше не block, а `inconclusive` — вердикт с меткой и
    // строкой в очередь ревью. Пруф с verdict:'pass' И green по-прежнему отвергаем: такой
    // сочетание может прийти только от пути, который не прогнал T019-логику (старый/ручной).
    if (p.redProof.status === 'green' && p.verdict !== 'inconclusive') return invalidJudgeProof('red-proof-green');
  }
  // 011 T011: пометки происхождения в proof больше нет и не нужно — при attest:true записать
  // его иначе как через `elt judge run` физически нельзя (ручной `judge-proof write` отвергнут
  // безусловно). Раньше здесь проверялся флаг, который сам же и ставился по флагу из argv.
  return { ok: true, proof: p };
}
function writeJudgeProof({ taskId, verdict, reasons, model, judges, grounding, redProof }) {
  const binding = findTaskBinding(taskId);
  if (!binding) die(`judge proof: task ${taskId} not found`);
  if (!PROOF_VERDICTS.includes(verdict) || !Array.isArray(reasons) || !reasons.every((reason) => typeof reason === 'string') || !model) {
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

// 011 T012: маркер «идёт гейт». Авто-чекпоинт (hook checkpoint-writer.js) пишет
// `.planning/CHECKPOINT-*-auto.md` по расходу токенов — и если он попадает между оракулом и
// коммитом, то (а) двигает treeHash, из-за чего `--skip-oracle` отказывает stale-пруфом, и
// (б) появляется в диффе слайса, где судья законно ловит его как scope creep. Оба случая
// живые. Маркер лежит в git-dir (не в дереве — сам бы двигал treeHash) и живёт TTL: оборванная
// цепочка не должна глушить чекпоинты навсегда. Читатель — checkpoint-writer.js.
const GATE_MARKER_TTL_MS = 30 * 60 * 1000;
function gateMarkerPath() {
  const gd = git(['rev-parse', '--git-dir']).out || '.git';
  return path.join(path.isAbsolute(gd) ? gd : path.join(cwd, gd), 'elt', 'gate-active.json');
}
function markGateActive(task) {
  try {
    const file = gateMarkerPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, task: task || null, ts: new Date().toISOString(), ttlMs: GATE_MARKER_TTL_MS }));
  } catch { /* маркер — удобство, а не инвариант: не записался, значит гейт просто шумнее */ }
}
function clearGateMarker() {
  try { fs.rmSync(gateMarkerPath(), { force: true }); } catch { /* уже нет */ }
}

function appendRunLog(entry) {
  runLog.appendRunLog(cwd, entry);
}
function changedFiles() {
  // `core.quotepath=false` обязателен: иначе git отдаёт путь с не-ASCII байтами в C-кавычках
  // (`"\320\234\320\265..."`), и всё, что матчит имя строкой, промахивается — путь больше не
  // начинается с `.planning/` и не оканчивается на `.md`. Живьём 2026-08-22: документная дверь
  // (DOC_COMMIT_RE ниже) объявила кодом файл `Методология Agent Harness.md` и потребовала
  // `--task`, то есть закрылась на единственном файле с кириллицей в имени.
  const raw = ["-c", "core.quotepath=false"];
  return [...new Set([
    ...git([...raw, 'diff', '--name-only', 'HEAD']).out.split('\n'),
    ...git([...raw, 'ls-files', '--others', '--exclude-standard']).out.split('\n'),
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

// T003 010: явный --invoke > локальный (репо-разработчик) > глобальный (~/.claude/bin/judge/,
// доставлен tools/sync-bin.js, T002). Явный --invoke возвращается как есть (даже если файла
// нет) — вызывающий код различает «указан явно, но не существует» от «резолв исчерпан».
function resolveJudgeInvoke(baseCwd) {
  const explicit = opt('--invoke');
  if (explicit) return { invoke: explicit, explicit: true };
  const local = path.join(baseCwd, 'tools', 'judge-invoke.js');
  if (fs.existsSync(local)) return { invoke: local, explicit: false };
  const global = path.join(os.homedir(), '.claude', 'bin', 'judge', 'judge-invoke.js');
  return { invoke: global, explicit: false, exhausted: !fs.existsSync(global) };
}

if (cmd === 'init') {
  const oracle = opt('--oracle');
  if (!oracle) die('elt init --oracle "<cmd>" [--shell powershell] [--push] [--force]');
  if (fs.existsSync(CONFIG) && !flag('--force')) die('harness.json уже есть (перезапись: --force)');
  fs.mkdirSync(HARNESS_DIR, { recursive: true });
  if (flag('--verify-provider') || flag('--verify-model')) {
    die('elt init: --verify-provider/--verify-model удалены в ELT v3; используется один независимый judge', 4);
  }
  const JUDGE_MODELS = { claude: 'sonnet', codex: 'gpt-5.6-sol', agy: 'gemini-3.7-flash-high' };
  const judgeProvider = opt('--judge-provider', 'claude');
  const cfg = {
    kind: 'code',
    oracle,
    shell: opt('--shell', 'bash'),
    branchPolicy: opt('--branch-policy', 'feature'),
    push: flag('--push'),
    // ELT v3: один независимый judge + grounding/red-proof. Повторный verify-on-pass снят.
    judge: {
      enabled: true,
      provider: judgeProvider,
      model: opt('--judge-model', JUDGE_MODELS[judgeProvider] || 'sonnet'),
      attest: true,
    },
    redProof: 'on',
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
  const specArg = opt('--spec');
  const explicitSpecDir = specArg ? (path.isAbsolute(specArg) ? specArg : path.join(cwd, specArg)) : null;
  const t = findTasks(explicitSpecDir);
  const cfgExists = fs.existsSync(CONFIG);
  const lastRun = runLog.lastRun(cwd);
  const out = {
    git: branch.code === 0 ? { branch: branch.out || '(detached)', dirty: dirtyN } : 'NOT A REPO',
    harness: cfgExists ? loadConfig() : 'NO harness.json — elt init',
    plan: t ? { file: path.relative(cwd, t.file), open: t.open.length, done: t.done.length, next: t.open[0] ? `${t.open[0].id} ${t.open[0].text}` : null } : 'no specs/*/tasks.md',
    parked: readParked(),
    lastRun,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// 011 T005: очередь ревью — разбор `inconclusive` пачкой, раз в сессию. Неблокирующая
// (решение 2 спеки, R4): накопление видно, работу не стопорит.
function readReviewQueue() {
  let raw;
  try { raw = fs.readFileSync(path.join(cwd, REVIEW_QUEUE), 'utf8'); } catch { return []; }
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; } // битая строка не хоронит очередь
  }).filter(Boolean);
}
// 011 T022: одна команда вместо ручного разбора run-log.jsonl под каждый замер.
if (cmd === 'stats') {
  const file = runLog.runtimeRunLog(cwd);
  const entries = file && fs.existsSync(file) ? eltStats.parseRunLog(fs.readFileSync(file, 'utf8')) : [];
  const since = opt('--since') ? new Date(opt('--since')).toISOString() : undefined;
  const s = eltStats.computeStats(entries, { since });
  if (flag('--json')) { console.log(JSON.stringify(s, null, 2)); process.exit(0); }
  const pct = (v) => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
  console.log(`elt stats${s.since ? ` (с ${s.since})` : ''}: ${s.gateRuns} прогонов гейта, ${s.commits} коммитов`);
  console.log(`  block-rate: ${pct(s.blockRate)}  l0-clean: ${pct(s.l0CleanShare)}  inconclusive: ${pct(s.inconclusiveShare)}`);
  console.log(`  судья/коммит: ${s.judgeRunsPerCommit === null ? 'n/a' : s.judgeRunsPerCommit.toFixed(2)}  через гейт: ${pct(s.gateCoverage)}`);
  console.log(`  оракул p50/p90: ${s.oracleP50 ?? 'n/a'}s / ${s.oracleP90 ?? 'n/a'}s`);
  console.log(`  block по источнику: ${JSON.stringify(s.blockBreakdown)}`);
  process.exit(0);
}

// 014 T011 (AC11): единственный слой, который снижает число ошибок, а не ловит их — читается
// ПЕРЕД правкой. Без сети и без LLM: та же история run-log, только повёрнутая к файлам.
if (cmd === 'brief') {
  const files = argv.slice(1).filter((a) => !a.startsWith('-'));
  if (!files.length) die('elt brief <файл> [файл...] [--json]', 4);
  const b = require('./elt-brief').brief(cwd, files);
  console.log(flag('--json') ? JSON.stringify(b, null, 2) : require('./elt-brief').format(b));
  process.exit(0);
}

if (cmd === 'review') {
  const rows = readReviewQueue();
  if (sub === 'close') {
    const taskId = normalizeTaskArg(opt('--task'));
    if (!taskId) die('elt review close --task Txxx[,Tyyy]', 4);
    const ids = new Set(parseTaskIds(taskId));
    const now = new Date().toISOString();
    let closed = 0;
    const next = rows.map((row) => {
      // Батч-запись несёт "T001,T002" — закрываем её, если названа ЛЮБАЯ из её задач.
      const hit = !row.closedAt && parseTaskIds(row.task).some((id) => ids.has(id));
      if (!hit) return row;
      closed += 1;
      return { ...row, closedAt: now };
    });
    // Закрытая запись остаётся в файле с меткой, а не удаляется: история разбора — тоже пруф.
    if (closed) fs.writeFileSync(path.join(cwd, REVIEW_QUEUE), next.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`elt review close: закрыто ${closed} (${taskId})`);
    process.exit(0); // идемпотентно: повторный вызов закрывает 0 и это не ошибка
  }
  const open = rows.filter((row) => !row.closedAt);
  if (flag('--json')) { console.log(JSON.stringify(open)); process.exit(0); }
  if (!open.length) { console.log('elt review: очередь пуста'); process.exit(0); }
  console.log(`elt review: ${open.length} на разборе`);
  // 014 T007: у записей `bg-red` есть слой и лог — без них строка «фон покраснел» неразбираема.
  for (const row of open) {
    const kind = row.kind ? `[${row.kind}${row.layer ? `/${row.layer}` : ''}] ` : '';
    console.log(`  ${kind}${row.task}  ${row.commit}  ${row.ts}\n    ${row.reason}`
      + (row.logPath ? `\n    лог: ${row.logPath}` : ''));
  }
  process.exit(0);
}

// 009 T004: парковка слайса (вызывает драйвер вместо `break`). Формат записи —
// {tid, reason, ts, logPath, attempts}; повторная парковка той же задачи растит attempts.
if (cmd === 'park') {
  const taskId = normalizeTaskArg(opt('--task'));
  if (!taskId) die('elt park --task Txxx[,Tyyy] --reason <reason> [--log <path>] | elt park --clear --task Txxx', 4);
  if (flag('--clear')) {
    const removed = unpark(taskId);
    console.log(JSON.stringify({ cleared: removed, parked: readParked() }, null, 2));
    process.exit(0);
  }
  const reason = opt('--reason');
  if (!reason) die('elt park: --reason обязателен (red-stop|judge-block|judge-dead|empty-diff)', 4);
  const list = readParked();
  const prev = list.find((e) => e.tid === taskId);
  const entry = { tid: taskId, reason, ts: new Date().toISOString(), logPath: opt('--log', null), attempts: (prev ? prev.attempts : 0) + 1 };
  writeParked(list.filter((e) => e.tid !== taskId).concat([entry]));
  appendRunLog({ task: taskId, status: 'parked', reason, attempts: entry.attempts });
  console.log(JSON.stringify(entry, null, 2));
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
  // 009 T004: припаркованные задачи пропускаются — иначе петля «продолжает» тем же
  // упавшим слайсом по кругу. Они остаются `[ ]` в плане и видны в `elt status`.
  const parkedSkip = parkedIds();
  const open = t ? t.open.filter((x) => !parkedSkip.has(x.id)) : [];
  const picks = open.slice(0, count);
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
  markGateActive(null); // с оракула начинается цепочка гейта — с него и молчание чекпоинта
  const l0Block = preOracleL0(cfg);
  if (l0Block) {
    appendRunLog({ task: null, status: 'l0-block', verdict: 'block', l0: { triggers: l0Block.triggers, judgeNeeded: true, verdict: 'block' } });
    die('L0 заблокировал ДО оракула — чинить причину выше, прогон не нужен', 1);
  }
  const exit = runOracle(cfg, { full: flag('--full') });
  // Зелёный прогон тоже пишется: без него у `oracle-slow` нет ряда для медианы —
  // красные прогоны редки и систематически медленнее (падение после self-heal).
  appendRunLog({
    task: null, status: exit === 0 ? 'oracle-green' : 'red-stop',
    oracle: { cmd: cfg.oracle, exit, durationSec: lastOracleSec, full: lastOracleFull },
    ...(lastSmoke ? { smoke: lastSmoke } : {}), // 011 T010: слой был — видно в журнале, чем именно красный
  });
  process.exit(exit);
}

// 009 T002: судья как ШАГ КОДА в интерактиве. Тот же путь, что у драйвера
// (tools/judge-invoke.js → fleet/gate.runJudge: рубрика, один judge, red-proof) —
// один источник истины, а не второй промпт в прозе скилла.
if (cmd === 'judge' && sub === 'run') {
  const taskId = normalizeTaskArg(opt('--task'));
  if (!taskId) die('elt judge run --task Txxx[,Tyyy] [--provider p] [--model m]', 4);
  const binding = findTaskBinding(taskId);
  if (!binding) die(`elt judge run: задача ${taskId} не найдена среди открытых [ ]`, 4);
  const texts = taskId.split(',').map((id) => {
    const found = findTaskItem(id, true);
    return found ? `${id} ${found.item.text}` : id;
  });
  // T003 010: мост резолвится локально (репо-разработчик) → глобально (проекты после
  // `node tools/sync-bin.js`, T002) → явный --invoke сильнее обоих.
  const resolved = resolveJudgeInvoke(cwd);
  const invoke = resolved.invoke;
  if (!fs.existsSync(invoke)) {
    if (resolved.explicit) die(`elt judge run: не найден ${invoke} — судья-мост не существует по указанному --invoke`, 4);
    die('elt judge run: судья-мост не найден ни локально (tools/judge-invoke.js), ни глобально (~/.claude/bin/judge/judge-invoke.js) — прогони `node tools/sync-bin.js` в репо-разработчике или укажи --invoke <path>', 4);
  }
  // Дескриптор — в .git/elt/, НЕ в рабочее дерево: любой файл в дереве меняет treeHash и
  // мгновенно делает оракул-пруф stale (proof привязан к дереву — тем и ценен).
  // 011 T011: путь берём у git, а не литералом `.git`. В worktree (fleet) `.git` — ФАЙЛ-указатель,
  // и `mkdirSync` по нему падал ENOTDIR. Раньше это не всплывало: fleet в `judge run` не заходил.
  const gitDir = git(['rev-parse', '--git-dir']).out || '.git';
  const descPath = path.join(path.isAbsolute(gitDir) ? gitDir : path.join(cwd, gitDir), 'elt', 'judge-desc.json');
  fs.mkdirSync(path.dirname(descPath), { recursive: true });
  fs.writeFileSync(descPath, JSON.stringify({
    cwd, tid: taskId, taskText: texts.join('\n'), specFile: binding.specPath,
    ...(opt('--provider') ? { provider: opt('--provider') } : {}),
    ...(opt('--model') ? { model: opt('--model') } : {}),
  }));
  const r = spawnSync(process.execPath, [invoke, descPath], { cwd, encoding: 'utf8' });
  let out;
  try { out = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { out = null; }
  if (!out) die(`elt judge run: судья не вернул JSON (exit ${r.status})\n${(r.stderr || '').slice(-2000)}`, 4);
  // runOk:false — судья НЕ отработал (timeout/spawn/limit). Это не вердикт: пишем `dead`,
  // чтобы гейт отказал явной причиной judge-dead, а не молчаливым отсутствием proof.
  // 011 T004: `inconclusive` доезжает до proof как самостоятельный исход. Всё, что не pass и
  // не inconclusive, по-прежнему block — REJECT-default не размывается третьим значением.
  const verdict = out.runOk ? (['pass', 'inconclusive'].includes(out.verdict) ? out.verdict : 'block') : 'dead';
  const model = (out.judges && out.judges[0] && out.judges[0].model) || opt('--model', 'unknown');
  const reasons = (out.reasons && out.reasons.length ? out.reasons : [`judge ${verdict}`]).map(String);
  const proof = writeJudgeProof({
    taskId, verdict, reasons, model,
    judges: out.judges, grounding: out.grounding, redProof: out.redProof || undefined,
  });
  // 011 T003 (AC3): чистый слайс закрывается БЕЗ судьи — и это обязано быть видно в run-log
  // отдельным статусом, а не неотличимым `judge-pass`. Триггеры пишем всегда: на `l0-clean`
  // пустой список и есть доказательство «проверено и чисто», а не «проверка не запускалась».
  const l0 = out.l0 && typeof out.l0 === 'object' ? out.l0 : null;
  appendRunLog({
    task: taskId, status: l0 && l0.judgeNeeded === false ? 'l0-clean' : `judge-${verdict}`, verdict,
    ...(l0 ? { l0: { triggers: l0.triggers || [], judgeNeeded: !!l0.judgeNeeded } } : {}),
    judges: out.judges, judgeLog: out.judgeLog || null,
    // 011 T022: маркеры red-proof/grounding живут в reasons, не в judges — без них
    // `elt stats` не может разложить block по источнику задним числом.
    reasons,
  });
  console.log(JSON.stringify(proof, null, 2));
  // inconclusive = exit 0: слайс коммитится (с меткой), и это ЕДИНСТВЕННЫЙ прогон судьи по
  // нему — драйвер/человек не должны запускать второй раунд по коду возврата.
  const ok = ['pass', 'inconclusive'].includes(verdict);
  // Дальше либо коммит (он маркер и снимет), либо конец попытки — тогда снимаем здесь, чтобы
  // блок судьи не оставлял чекпоинты выключенными до истечения TTL.
  if (ok) markGateActive(taskId); else clearGateMarker();
  process.exit(ok ? 0 : 4);
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
    if (!taskId || !verdict || !model) die(`elt judge-proof write --task Txxx --verdict ${PROOF_VERDICTS.join('|')} --model <model> [--reasons-json "[]"] [--extra-file <path>]`);
    // 011 T011: люк самозаверения удалён ЦЕЛИКОМ. Были два: `--skip-attest` («аварийно») и
    // `--attested-by fleet-gate` («машинный источник») — оба сводились к строке, которую агент
    // с доступом к шеллу набирает сам, то есть к разрешению заверить свой код собственной
    // подписью. При attest:true ручная запись отвергается БЕЗУСЛОВНО, исключений нет;
    // fleet идёт тем же путём, что интерактив (`elt judge run`, мост judge-replay.js).
    if (attestEnabled()) {
      die('judge proof: judge.attest=true — вердикт пишет только `elt judge run --task Txxx`', 4);
    }
    // --extra-file (008 T004): judges[]/grounding/redProof приходят файлом, не argv — JSON
    // с embedded-кавычками бьётся о PS5.1 native-marshalling баг (см. elt-loop.ps1 comment).
    let extra = {};
    const extraFile = opt('--extra-file');
    if (extraFile) {
      let raw;
      try { raw = fs.readFileSync(extraFile, 'utf8').replace(/^﻿/, ''); } catch { die('judge proof: --extra-file not readable'); }
      try { extra = JSON.parse(raw) || {}; } catch { die('judge proof: --extra-file must be JSON'); }
    }
    // reasons тоже принимаем файлом: обоснования живого судьи — свободный текст с кавычками
    // и переводами строк, в argv PS5.1 они не доезжают (ровно поэтому драйвер годами слал
    // литерал `[]` и пруф был содержательно пуст). argv-форма остаётся для ручных вызовов.
    if (Array.isArray(extra.reasons) && extra.reasons.length) reasons = extra.reasons.map(String);
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
    const exit = runOracle(cfg, { full: flag('--full') });
    if (exit !== 0) {
      appendRunLog({ task: null, status: 'red-stop', oracle: { cmd: cfg.oracle, exit, durationSec: lastOracleSec, full: lastOracleFull } });
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
  // 014 T005 (AC3): 'sync' — умолчание, поведение 011 побайтово; ветка ниже её не касается.
  const bgVerify = cfg.verify === 'background';
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
    // 011 T017: тот же L0 перед прогоном — commit без `--skip-oracle` это вторая дверь к оракулу.
    const l0Block = preOracleL0(cfg);
    if (l0Block) {
      appendRunLog({ task: taskId || null, status: 'l0-block', verdict: 'block', l0: { triggers: l0Block.triggers, judgeNeeded: true, verdict: 'block' } });
      die('L0 заблокировал ДО оракула — НЕ коммичу', 1);
    }
    oracleExit = runOracle(cfg, { full: flag('--full') });
    if (oracleExit !== 0) {
      appendRunLog({ task: taskId || null, status: 'red-stop', oracle: { cmd: cfg.oracle, exit: oracleExit, durationSec: lastOracleSec, full: lastOracleFull } });
      die(`оракул красный (exit ${oracleExit}) — НЕ коммичу`, oracleExit);
    }
  }

  // 016 T010: у чисто документного коммита задачи в плане нет и быть не должно — раньше это
  // выгоняло из харнеса в ручной `git commit`, то есть мимо run-log. Дверь узкая: только
  // документные файлы, без судьи и без approval (кода нет — судить нечего), запись в run-log
  // обязательна, иначе смысл двери теряется.
  if (!taskId) {
    const nonDocs = changedFiles().filter((f) => !DOC_COMMIT_RE.test(f.replace(/\\/g, '/')));
    if (nonDocs.length) {
      die(`elt commit: --task Txxx обязателен для коммита с кодом (не документные файлы: ${nonDocs.slice(0, 5).join(', ')}${nonDocs.length > 5 ? ` +${nonDocs.length - 5}` : ''})`, 4);
    }
    const msgDocs = opt('-m', 'docs: обновление документации');
    if (git(['add', '-A']).code !== 0) die('git add failed');
    const cd = spawnSync('git', ['commit', '-m', msgDocs], { cwd, encoding: 'utf8' });
    if (cd.status !== 0) die('git commit failed: ' + (cd.stderr || cd.stdout));
    const shaDocs = git(['rev-parse', '--short', 'HEAD']).out;
    appendRunLog({ task: null, status: 'docs-commit', commit: shaDocs, branch: git(['branch', '--show-current']).out, msg: msgDocs });
    console.error(`elt commit: ${shaDocs} — документный коммит без задачи`);
    return;
  }

  // 006 T002: approval gate, evaluated against the TASK'S OWN spec dir (not
  // whatever findTasks() would auto-select) — otherwise a task from a later
  // spec while an earlier one still has open boxes could never be gated (or
  // never be committable at all).
  let approvalSkipped = false;
  // 014 T022: binding снимается ЗДЕСЬ, до markDone() — findTaskBinding ищет только открытые
  // `[ ]`, и после простановки `[X]` вернул бы null. Фоновому судье он нужен ниже.
  const binding = findTaskBinding(taskId);
  {
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

  // 014 T005 (AC3): в background-режиме тяжёлые слои (полный сьют/мутатор/smoke/судья) не
  // синхронны — судейский пруф здесь не требуется, дифф проверяется фоном ПОСЛЕ коммита
  // (spawnBackgroundVerify ниже). sync-ветка не тронута — судья остаётся обязательным.
  const judge = bgVerify ? null : validateJudgeProof({ taskId });
  if (!bgVerify && !judge.ok) die(`elt commit: judge proof invalid (${judge.reason}) — НЕ коммичу`, 4);
  // Captured now, BEFORE markDone() edits tasks.md and shifts treeHash — the
  // pre-commit hook (triggered by `git commit` below) re-checks the SAME
  // already-validated proof bytes via this hash rather than re-deriving
  // treeHash against the post-markDone tree (see `gate` command comment).
  const gateTrust = bgVerify ? null : sha256(readJudgeProof().raw);

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

  // 011 T004: метка ставится ПОСЛЕ обрезки до 90 — иначе длинный заголовок съедал бы её
  // ровно на тех слайсах, где она и нужна.
  const inconclusive = !bgVerify && judge.proof.verdict === 'inconclusive';
  const msg = opt('-m', taskId ? `feat: ${taskId} ${taskText}`.slice(0, 90) : 'chore: elt slice')
    + (inconclusive ? ' [inconclusive]' : '');
  if (git(['add', '-A']).code !== 0) die('git add failed');
  const commitEnv = bgVerify ? process.env : { ...process.env, ELT_GATE_TRUST: gateTrust };
  const c = spawnSync('git', ['commit', '-m', msg], { cwd, encoding: 'utf8', env: commitEnv });
  if (c.status !== 0) die('git commit failed: ' + (c.stderr || c.stdout));
  const sha = git(['rev-parse', '--short', 'HEAD']).out;

  // Задача закрылась — снимаем её с парковки (009 T004), иначе status/slice next
  // продолжали бы считать её припаркованной после успешной перезакрытия.
  unpark(taskId);

  // Очередь ревью пишется ПОСЛЕ коммита: в строке обязан быть его sha, иначе разбирать нечего.
  // Неблокирующая по решению 2 спеки (R4): накопление видно в doctor, работу не стопорит.
  if (inconclusive) {
    const queue = path.join(cwd, REVIEW_QUEUE);
    fs.mkdirSync(path.dirname(queue), { recursive: true });
    fs.appendFileSync(queue, JSON.stringify({
      task: taskId, commit: sha, reason: (judge.proof.reasons || []).join('; '), ts: new Date().toISOString(),
    }) + '\n');
    console.error(`elt commit: вердикт inconclusive — строка в ${REVIEW_QUEUE} (разбор: elt review)`);
  }

  appendRunLog({
    task: taskId,
    oracle: {
      cmd: cfg.oracle, exit: oracleExit, skipped: flag('--skip-oracle'), skipTrusted, durationSec: lastOracleSec,
      // skipTrusted: оракул в ЭТОМ процессе не бегал — full неизвестен, поле не пишем (T020
      // счётчик пропускает записи без него, а не считает их impact-прогоном).
      ...(skipTrusted ? {} : { full: lastOracleFull }),
    },
    commit: sha, branch, msg,
    // 014 T005 (AC3): bg — вердикта ещё нет (тяжёлые слои не запускались), только заявка на
    // проверку; sync — вердикт судьи, как и раньше (поведение 011 не тронуто).
    ...(bgVerify ? { status: 'committed-speculative' } : { verdict: judge.proof.verdict }),
    ...(approvalSkipped ? { approvalSkipped: true } : {}),
  });

  // 011 T026: watchdog зовётся сам между слайсами, СРАЗУ после записи run-log (там его
  // сырьё). Не гейт — тихий сбой (в т.ч. деплой без ~/.claude/bin/harness-watch.js) не
  // валит коммит, только теряет это одно наблюдение.
  try { requireHarnessWatch().runOnce(cwd); } catch { /* watchdog не гейт */ }

  // 014 T005 (AC3): тяжёлые слои — отдельным отсоединённым процессом, ПОСЛЕ того как всё
  // синхронное (run-log, watchdog) уже записано; commit не ждёт его результата.
  if (bgVerify) {
    const { spawnBackgroundVerify } = require('./elt-verify-bg');
    // 014 T022: фоновому судье нужны ТЕ ЖЕ два входа, что и синхронному, — путь к tasks.md
    // слайса (иначе findSpecDir берёт первый попавшийся `**Txxx**` по всем specs/ и подсовывает
    // чужую рубрику, gate.js:166) и текст задачи (в нём `[files:]`, зона scope-триггера L0).
    // texts[0] — полный текст задачи; msg-переменная выше обрезана до 90 символов и не годится.
    const bg = spawnBackgroundVerify({
      cwd, commitHash: sha, taskId,
      specFile: binding ? binding.specPath : null,
      taskText: texts.join('\n'),
    });
    console.error(`elt commit: фон запущен (pid ${bg.pid}, лог ${bg.logPath})`);
  }

  // 4. push strictly by flag (config or CLI)
  if (cfg.push || flag('--push')) {
    const p = git(['push', '-u', 'origin', branch]);
    console.error(p.code === 0 ? 'elt commit: pushed' : 'elt commit: push FAILED — ' + p.err);
  }
  clearGateMarker(); // цепочка гейта закончилась — авто-чекпоинту снова можно писать
  console.log(`elt commit: ${sha} на ${branch}${taskId ? ' — ' + taskId + ' [X]' : ''}`);
  process.exit(0);
}

// 011 T027 — правило 4 схемы C: правка харнесса (gate.js/промпт/пороги) обязана нести
// evidence+root-cause+predicted-impact и пройти judge-bench против baseline ДО коммита,
// иначе эволюция контура — самообман (пороги правились вручную, ни разу не проверены).
// НАМЕРЕННО последний блок файла: единственная async-ветка в плоском синхронном скрипте —
// раньше по порядку она проиграла бы гонку с безусловным `process.exit()` в самом низу.
if (cmd === 'harness' && sub === 'sync-all') {
  // 016 T008: раскатка схемы v4 по реестру. Дефолт — dry-run; запись только с --apply.
  const { spawnSync: sp } = require('child_process');
  const r = sp(process.execPath, [path.join(__dirname, 'elt-harness-sync-all.js'), ...argv.slice(2)], { cwd, stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
} else if (cmd === 'harness' && sub === 'propose') {
  let harnessPropose;
  try { harnessPropose = require('./elt-harness-propose'); }
  catch { die('elt harness propose: доступно только в репо-разработчике (tools/elt-harness-propose.js не найден)', 4); }
  const evidence = opt('--evidence');
  const rootCause = opt('--root-cause');
  const predictedImpact = opt('--predicted-impact');
  const baselinePath = opt('--baseline');
  const baseline = baselinePath ? JSON.parse(fs.readFileSync(path.isAbsolute(baselinePath) ? baselinePath : path.join(cwd, baselinePath), 'utf8')) : undefined;
  const provider = opt('--provider', 'claude');
  const model = opt('--model', null);
  const runBench = async () => {
    const { cases } = require('./judge-bench/cases');
    const { runAll, score } = require('./judge-bench');
    const results = await runAll(cases, { cwd, provider, model, concurrency: 2, timeoutMs: 5 * 60 * 1000 });
    return score(results);
  };
  harnessPropose.propose({ root: cwd, evidence, rootCause, predictedImpact, baseline, runBench }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 4);
  });
} else {
console.log(`elt — ядро ELT v3 харнесса
  elt init --oracle "<cmd>" [--shell powershell] [--push]   создать .harness/harness.json
  elt status [--spec specs/NNN-slug]                        git + план + последний прогон
  elt slice next [--json] [--count N] [--spec specs/NNN-slug]  следующая [ ] задача (--count N → N первых; exit 3 = план закрыт)
  elt spec approve [--spec specs/NNN-slug]                  подписать spec.md+tasks.md (approval.json, идемпотентно)
  elt spec status [--spec specs/NNN-slug]                   approved | stale | unapproved | error
  elt spec lint [--spec specs/NNN-slug]                     проверка обязательных секций spec.md (approve гоняет его сам)
  elt park --task Txxx --reason <r> [--log <path>]          припарковать слайс (петля берёт следующий); --clear снимает
  elt harness propose --evidence <e> --root-cause <r> --predicted-impact <i> [--baseline <path>] [--provider p] [--model m]
      правка судьи/гейта против baseline judge-bench (T023): не улучшила — отказ в learnings.jsonl
  elt review [--json] | elt review close --task Txxx        очередь вердиктов inconclusive (неблокирующая); close — снять с разбора
  elt stats [--since <ISO-дата>] [--json]                   block-rate/coverage/p50-p90 из run-log.jsonl (одна команда вместо ручного разбора)
  elt oracle [--full]                                       прогнать оракул, exit-код = истина; --full игнорирует oracleSelect:impact
  elt judge run --task Txxx[,Tyyy] [--provider p] [--model m]  запустить судью КОДОМ и записать proof (exit 0 = pass)
  elt gate [--ci]                                           managed git gate: pre-commit (proof) | CI (--ci, mechanical oracle re-run)
  elt commit --task Txxx[,Tyyy,...] [--keep-task-open] [-m msg] [--skip-oracle] [--push]
      зелёный oracle + актуальный judge proof → авто-ветка с main → [X] → add+commit → run-log.jsonl → push
      БАТЧ: --task T001,T002,T003 — один оракул + один судья + один коммит на N задач
            (judge-proof write --task тем же списком; все задачи должны быть открыты и в одном tasks.md)`);
process.exit(cmd ? 1 : 0);
}
