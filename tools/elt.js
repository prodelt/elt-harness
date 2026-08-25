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
// 020 T009: дефолтный `maxBuffer` spawnSync — 1 МиБ, и при переполнении процесс УБИВАЕТСЯ:
// `status` приходит null, а stdout — ОБРЕЗАННЫМ. Для `git diff HEAD` это не теоретический
// край: слайс на пару тысяч строк уже подходит к порогу, а слайс с новым словарём/фикстурой
// переваливает. Обрезанный дифф в `treeHash` означает, что ДВА РАЗНЫХ дерева дают один хеш —
// то есть оракул-пруф перестаёт быть привязанным к дереву, ради чего он и существует.
// Число то же, что в фоне (elt-verify-bg.js:BG_MAX_BUFFER) — одна полоса, один лимит.
const GIT_MAX_BUFFER = 256 * 1024 * 1024;
function git(args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });
  // `status === null` — процесс не завершился сам (убит сигналом или ENOBUFS). Это НЕ «код 0»
  // и не «код 1»: возвращаем 1, но отдельно отдаём `killed`, чтобы вызывающий, которому важна
  // полнота вывода (treeHash), мог отличить «git сказал нет» от «git не договорил».
  const killed = r.status === null;
  return {
    code: killed ? 1 : r.status,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim() || (r.error ? String(r.error.code || r.error.message) : ''),
    killed,
  };
}

// ── tasks.md (spec-kit): newest plan is the active plan ───────────────────────
const TASK_LINE_RE = /^(\s*(?:[-*]\s*)?)\[( |X|x)\]\s*(?:\*\*)?(T\d+)?(?:\*\*)?[:.]?\s*(.*)$/;
// 020 T023: у задачи ДВА текста, и путать их нельзя.
//   `text`  — строка с маркером: заголовок для показа человеку (`slice next`, `status`);
//   `block` — весь блок задачи вместе со строками-продолжения, то есть с `[files: …]`.
// До этой правки существовал только первый, и всё, что читает задачу МАШИНОЙ, получало одну
// строку. Дороже всего это стоило scope-триггеру L0: `taskScopeFiles` не находил `[files:]`
// в заголовке и молчал на КАЖДОЙ задаче планов 019/020 — они все многострочные. Слайс T012 из
// 12 файлов, шесть из которых вне объявленной зоны, получил `l0-clean` и судью не звал.
function blockAt(lines, lineNo) {
  const out = [lines[lineNo]];
  for (let i = lineNo + 1; i < lines.length; i += 1) {
    const ln = lines[i];
    if (TASK_LINE_RE.test(ln)) break;      // следующая задача
    if (/^\s*$/.test(ln) && out.length > 1) break; // пустая строка закрывает блок
    out.push(ln);
  }
  return out.join('\n');
}
function parseTasksFile(f) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const open = [], done = [];
  lines.forEach((ln, i) => {
    const m = ln.match(TASK_LINE_RE);
    if (!m) return;
    (m[2] === ' ' ? open : done).push({
      file: f, lineNo: i, id: m[3] || `L${i + 1}`, text: m[4].trim(), block: blockAt(lines, i),
    });
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
// ── 020 T008 — spec-bound runtime identity ────────────────────────────────────────────
// `T020` — не идентификатор. Id уникален ТОЛЬКО внутри одного плана, а рантайм-состояние
// (парковка, очередь ревью) хранило голый id и молча склеивало задачи разных спек: открытый
// 019/T020 не выдавался петлёй, потому что «T020» когда-то припарковала другая спека, а
// `review close --task T018` закрывал первую попавшуюся строку — или НИ ОДНОЙ, отвечая при
// этом exit 0. Идентичность = (specPath, taskId), где specPath — repo-relative POSIX путь до
// tasks.md, ровно как в judge-proof (`findTaskBinding`), чтобы двух схем не было.
function relPosix(abs) { return path.relative(cwd, abs).split(path.sep).join('/'); }
function allPlanFiles() {
  const out = [];
  const rootTasks = path.join(cwd, 'tasks.md');
  if (fs.existsSync(rootTasks)) out.push(rootTasks);
  const specsDir = path.join(cwd, 'specs');
  if (fs.existsSync(specsDir)) {
    const specRootTasks = path.join(specsDir, 'tasks.md');
    if (fs.existsSync(specRootTasks)) out.push(specRootTasks);
    for (const d of fs.readdirSync(specsDir).sort()) {
      const f = path.join(specsDir, d, 'tasks.md');
      if (fs.existsSync(f)) out.push(f);
    }
  }
  return out;
}
// Миграция legacy-строки (без specPath) — fail-closed: спека выводится, только если id есть
// РОВНО в одном плане. Ноль кандидатов или два — строка остаётся `legacy` и не выдаёт себя
// ни за одну спеку; выбор в такой ситуации делает человек (`--spec` + `--adopt-legacy`), а не
// порядок сканирования каталога. Молчаливая догадка здесь стоила бы `[X]` в чужом плане.
function resolveLegacySpec(taskField) {
  const ids = parseTaskIds(taskField);
  if (!ids.length) return { specPath: null, candidates: [] };
  const candidates = [];
  for (const f of allPlanFiles()) {
    const plan = parseTasksFile(f);
    if (ids.some((id) => plan.open.concat(plan.done).some((x) => x.id === id))) candidates.push(relPosix(f));
  }
  return { specPath: candidates.length === 1 ? candidates[0] : null, candidates };
}
// Строка рантайма, приведённая к идентичности: {row, specPath, legacy, candidates}.
function resolveIdentity(taskField, storedSpecPath) {
  if (typeof storedSpecPath === 'string' && storedSpecPath) {
    return { specPath: storedSpecPath, legacy: false, candidates: [storedSpecPath] };
  }
  const r = resolveLegacySpec(taskField);
  return { specPath: r.specPath, legacy: !r.specPath, candidates: r.candidates };
}
function readParkedResolved() {
  return readParked().map((entry) => ({ entry, ...resolveIdentity(entry.tid, entry.specPath) }));
}
// Сверка по ОТДЕЛЬНЫМ id, а не по строке батча: припаркованный батч "T001,T002" обязан
// сниматься и когда позже коммитится один T001 — иначе status врёт про живую задачу.
// `specPath` задан → берутся ТОЛЬКО записи этой спеки: неразрешимая legacy-строка не смеет
// глушить чужой открытый слайс (AC T008). Без него — весь список, как в `elt status`.
function parkedIds(specPath = null) {
  const ids = new Set();
  for (const r of readParkedResolved()) {
    if (specPath && r.specPath !== specPath) continue;
    for (const id of parseTaskIds(r.entry.tid)) ids.add(id);
  }
  return ids;
}
// Записи, которые пропущены из-за неразрешимой идентичности: их обязано быть ВИДНО, иначе
// fail-closed превращается в тихое игнорирование парковки.
function parkedLegacyIgnored(specPath) {
  return specPath ? readParkedResolved().filter((r) => r.legacy).map((r) => r.entry.tid) : [];
}
function unpark(taskId, specPath = null) {
  const ids = new Set(parseTaskIds(taskId));
  const list = readParked();
  const rest = list.filter((e) => {
    if (!parseTaskIds(e.tid).some((id) => ids.has(id))) return true;
    if (!specPath) return false; // без спеки — прежнее поведение: снимаем по id
    const r = resolveIdentity(e.tid, e.specPath);
    return !(r.specPath === specPath || r.legacy); // legacy-строку снимает закрытие любой спеки
  });
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
  // 020 T009: оба вызова обязаны ОТРАБОТАТЬ ПОЛНОСТЬЮ. Молчаливый провал здесь — худший из
  // возможных: хеш посчитается от пустого/обрезанного вывода, два разных дерева совпадут, и
  // `--skip-oracle` проведёт коммит по пруфу от ЧУЖОГО дерева. Отказ громкий, без фолбека.
  const statusRun = git(['status', '--porcelain', '-uall']);
  if (statusRun.code !== 0) {
    die(`treeHash: git status не отработал (${statusRun.killed ? 'вывод обрезан/процесс убит' : `exit ${statusRun.code}`})`
      + `${statusRun.err ? `: ${statusRun.err}` : ''} — пруф о дереве был бы враньём`, 1);
  }
  // Репо без единого коммита — законный случай (`elt init` до первого слайса): там `HEAD` не
  // резолвится, и это не отказ git, а отсутствие базы. Всё содержимое такого дерева и так
  // попадает в хеш через `??`-строки status.
  const hasHead = git(['rev-parse', '--verify', 'HEAD']).code === 0;
  const diffRun = hasHead ? git(['diff', 'HEAD']) : { code: 0, out: '', killed: false, err: '' };
  if (diffRun.code !== 0) {
    die(`treeHash: git diff не отработал (${diffRun.killed ? 'вывод обрезан/процесс убит' : `exit ${diffRun.code}`})`
      + `${diffRun.err ? `: ${diffRun.err}` : ''} — пруф о дереве был бы враньём`, 1);
  }
  const status = statusRun.out.split('\n')
    .filter((line) => !runtimeLog(line.slice(3).trim())).join('\n');
  const h = crypto.createHash('sha256');
  h.update(status + '\n' + diffRun.out);
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
// 018 T002: подпись спеки живёт в ИСТОРИИ, а не в рабочем дереве. D4 (9 отказов за один
// полевой прогон 15.08): страж подписи спеки (снят 019/T007) читал файл основного дерева, а срез внутри
// fleet-worktree читал своё — подпись расходилась, и отказ прилетал уже ПОСЛЕ воркера,
// оракула и судьи, то есть после того, как LLM-бюджет раунда сожжён. `git log` отдаёт одну
// и ту же историю обоим деревьям, поэтому расхождение исчезает архитектурно, а не смягчается.
// Отбор коммитов-кандидатов делает сам git (`-F --grep`), чтобы цена чтения не росла с
// длиной истории: node разбирает единицы коммитов, а не весь `%B` репозитория.
const TRAILERS = { spec: 'Spec-Approved', specHash: 'Spec-Hash', tasksHash: 'Tasks-Hash', approvalDigest: 'Approval-Digest' };
const REC_SEP = '\u001e';
const FIELD_SEP = '\u001f';
function specDirKey(specDir) {
  return path.relative(cwd, specDir).split(path.sep).join('/');
}
// Что считать трейлером, решает САМ git (`%(trailers:key=...)`), а не наш разбор строк.
// Разница не косметическая: свой построчный парсер признал бы подписью строку вида
// `Spec-Approved: specs/...`, стоящую где угодно в теле сообщения, — и тогда подпись спеки
// подделывается обычным текстом коммита. Git засчитывает только завершающий блок трейлеров,
// поэтому «честный» коммит и коммит с теми же строками посреди тела различаются механически.
function trailerValues(raw) {
  return String(raw || '').split('\n').map((v) => v.trim()).filter(Boolean);
}
// Все подписи этой спеки, новейшая первой.
function readApprovalTrailers(specDir) {
  const key = specDirKey(specDir);
  // `-F --grep` — дешёвый предфильтр, чтобы цена не росла с длиной истории; авторитет
  // не в нём, а в разборе трейлеров ниже.
  const fmt = [
    '%H', '%cI',
    `%(trailers:key=${TRAILERS.spec},valueonly)`,
    `%(trailers:key=${TRAILERS.specHash},valueonly)`,
    `%(trailers:key=${TRAILERS.tasksHash},valueonly)`,
    `%(trailers:key=${TRAILERS.approvalDigest},valueonly)`,
  ].join(FIELD_SEP);
  const r = git(['log', '-F', '--grep', `${TRAILERS.spec}: ${key}`, `--format=${fmt}${REC_SEP}`]);
  if (r.code !== 0 || !r.out) return [];
  const found = [];
  for (const rec of r.out.split(REC_SEP)) {
    if (!rec.trim()) continue;
    const [sha, ts, specKeys, specHashes, tasksHashes, approvalDigests] = rec.split(FIELD_SEP);
    if (!sha || !sha.trim()) continue;
    const keys = trailerValues(specKeys);
    const specHash = trailerValues(specHashes);
    const tasksHash = trailerValues(tasksHashes);
    // Ровно один трейлер каждого вида: коммит с двумя разными `Spec-Hash` неоднозначен,
    // и «выберем первый» здесь было бы решением за пользователя в пользу подписи.
    if (keys.length !== 1 || specHash.length !== 1 || tasksHash.length !== 1) continue;
    if (keys[0] !== key) continue;
    // 020 T015: канонический digest `elt-approval/v1` — ОТДЕЛЬНЫЙ трейлер и намеренно
    // необязательный: подписи, поставленные до появления схемы, не обязаны исчезнуть, но
    // и за подпись новой схемы не выдаются (cutover требует именно её).
    const canonicalDigests = trailerValues(approvalDigests);
    found.push({
      sha: sha.trim(), approvedAt: (ts || '').trim(),
      specHash: specHash[0], tasksHash: tasksHash[0],
      approvalDigest: canonicalDigests.length === 1 ? canonicalDigests[0] : null,
    });
  }
  return found;
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
  // 018 T004: единственный источник подписи — история. Рабочее дерево спрашивать не о чем:
  // именно расхождение «файл основного дерева против файла worktree» и было D4.
  const trailers = readApprovalTrailers(specDir);
  const hit = trailers.find((t) => t.specHash === hashes.specHash && t.tasksHash === hashes.tasksHash);
  if (hit) return { status: 'approved', approvedAt: hit.approvedAt, approvedIn: hit.sha, source: 'trailer', ...hashes };
  // Трейлер есть, но под другие хеши — это протухшая подпись, а не её отсутствие.
  if (trailers.length) return { status: 'stale', approvedAt: trailers[0].approvedAt, approvedIn: trailers[0].sha, source: 'trailer', ...hashes };
  return { status: 'unapproved', ...hashes };
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
// 019 T015: фолбэк на `~/.claude/bin/judge/` снят вместе с deploy-копией. Он существовал
// потому, что `elt.js` разъезжался по проектам ОДИН, без соседей, и прямой
// `require('./elt-gate-l0')` падал MODULE_NOT_FOUND во всех них. У плагина соседи на месте
// всегда: установленный каталог — это и есть репозиторий, а не срез из 22 файлов.
function requireL0() {
  return require('./elt-gate-l0');
}
function requireHarnessWatch() {
  return require('./harness-watch');
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

// ── 020 T016 — батч и repair-поколения ────────────────────────────────────────────────
// Состояние поколений живёт в `.git/elt/`, а НЕ в рабочем дереве: любой файл в дереве двигает
// treeHash и мгновенно делает оракул-пруф stale (тот же довод, что у judge-proof выше).
const { planBatch, DEFAULT_BATCH } = require('./batch-planner');
function batchStatePath() {
  const gd = git(['rev-parse', '--git-dir']).out || '.git';
  return path.join(path.isAbsolute(gd) ? gd : path.join(cwd, gd), 'elt', 'batch-state.json');
}
function readBatchState() {
  try { const s = JSON.parse(fs.readFileSync(batchStatePath(), 'utf8')); return s && typeof s === 'object' ? s : { batches: {} }; }
  catch { return { batches: {} }; }
}
function writeBatchState(state) {
  const f = batchStatePath();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(state, null, 2) + '\n');
}
// 020 T016 завёл эту функцию для планировщика батча — он единственный тогда читал `[files:]`.
// 020 T023 перенёс сборку блока в `parseTasksFile`: одного потребителя оказалось мало, полный
// текст нужен и судье, и фоновой верификации. Здесь остался тонкий доступ к тому же полю,
// чтобы вызывающие не начали собирать блок каждый по-своему — расхождение двух копий одного
// разбора уже стоило нам дефектов D9/D15/D19.
function taskBlockText(plan, item) {
  return item.block !== undefined ? item.block : blockAt(plan.lines, item.lineNo);
}
// Состав батча снимается из ПЛАНА, а не из argv: `--task T001,T002` остаётся фасадом.
function batchItems(taskId) {
  const ids = parseTaskIds(taskId);
  if (!ids.length) return { error: 'пустой --task' };
  const items = [];
  for (const id of ids) {
    const found = findTaskItem(id, false);
    if (!found) return { error: `задача ${id} не найдена ни среди [ ], ни среди [X]` };
    items.push({
      id, text: taskBlockText(found.plan, found.item),
      done: found.plan.done.some((x) => x.id === id),
      specPath: relPosix(found.plan.file),
    });
  }
  // 020 T016 (поколение 2): `isDone` отдаётся планировщику отдельно — закрытость зависимости
  // знает только план целиком, а планировщик обязан остаться без git и без fs.
  const isDone = (id) => {
    const f = findTaskItem(id, false);
    return !!(f && f.plan.done.some((x) => x.id === id));
  };
  return { items, isDone };
}
// Карантин ВЫВОДИТСЯ, а не хранится: батч красный ровно тогда, когда на его `batchHead` висит
// открытая строка очереди от фона. Второго источника правды не заводим — иначе «красный» и
// «есть находка» могли бы разойтись, и разошлись бы молча.
// Карантин ставит ТОЛЬКО фон (`bg-*`). Строка `inconclusive` от синхронного судьи в карантин
// не уводит: решение R4 спеки 011 сделало её неблокирующей намеренно — «судья не может
// ручаться» это не «Mirror покраснел», и приравнять их значило бы остановить работу на самом
// мягком из исходов. Пойман живьём: judge-core.test.js после inconclusive-коммита переставал
// коммитить следующий слайс.
const BG_KINDS = new Set(['bg-red', 'bg-dead', 'bg-inconclusive']);
function openQueueFor(commitSha) {
  return readReviewQueue().filter((r) => !r.closedAt && BG_KINDS.has(r.kind) && r.commit && commitSha
    && (r.commit === commitSha || commitSha.startsWith(r.commit) || r.commit.startsWith(commitSha)));
}
// Идентичность батча в состоянии — (спека, упорядоченные id). Ключ записи (`batchId`) несёт
// ещё и базу, поэтому по нему repair своё же поколение не нашёл бы.
function findBatchKey(plan) {
  const state = readBatchState();
  const want = plan.taskIds.join(',');
  for (const [key, b] of Object.entries(state.batches || {})) {
    if (b.specPath === plan.specPath && (b.taskIds || []).join(',') === want) return key;
  }
  return null;
}
function quarantinedBatches() {
  const state = readBatchState();
  return Object.entries(state.batches || {})
    .filter(([, b]) => openQueueFor(b.batchHead).length)
    .map(([batchId, b]) => ({ batchId, ...b }));
}
// Repair посаженного батча, у которого записи ещё нет (legacy-v1 epoch: до T016 батчи не
// регистрировались). Восстанавливаем поколение 1 из САМОЙ находки: в строке очереди есть и
// коммит, и identity. Нет открытой находки — чинить нечего, и это отказ, а не тихий коммит.
function reconstructGeneration(plan) {
  const ids = new Set(plan.taskIds);
  const row = readReviewQueue().find((r) => !r.closedAt && r.commit
    && parseTaskIds(r.task).some((id) => ids.has(id))
    && (!r.specPath || r.specPath === plan.specPath));
  return row ? { generation: 1, batchHead: row.commit, history: [{ generation: 1, commit: row.commit, ts: row.ts }] } : null;
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
// 020 T016: `includeDone` — для repair-поколения. Задачи батча уже `[X]`, но чинить его без
// судьи было бы ровно тем self-attestation, который запрещён: судья обязан уметь высказаться
// о второй генерации так же, как о первой.
function findTaskBinding(taskId, { includeDone = false } = {}) {
  const ids = parseTaskIds(taskId);
  if (!ids.length) return null;
  let specPath = null;
  for (const id of ids) {
    const found = findTaskItem(id, !includeDone);
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
function validateJudgeProof({ taskId, repair = false } = {}) {
  if (!taskId) return invalidJudgeProof('task-required');
  const binding = findTaskBinding(taskId, { includeDone: repair });
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
  const binding = findTaskBinding(taskId, { includeDone: flag('--repair') });
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

// ── 020 T015: одна runtime-дверь ──────────────────────────────────────────────
// До этой задачи маршрут жил в голове: `oracle → judge → commit`. Отсюда два системных
// отказа, видных в run-log: шаг забывали (гейт покрывал 55,8% коммитов) и порядок нарушали
// (`stale-oracle` от собственного фона). T013 дал чистый reducer, T014 — журнал; здесь они
// становятся продуктом: `elt run` СЧИТАЕТ следующий законный шаг из журнала, а не напоминает
// его человеку.
//
// Низкоуровневые команды не удалены и остались диагностическим фасадом — но теперь они пишут
// ТЕ ЖЕ события в журнал. Иначе восстановление после compact/restart врало бы: половина
// прогона прошла бы мимо истории.
//
// Эпоха переключается ровно один раз и только целиком (`elt cutover`): пока в журнале нет
// события `legacy-epoch-end`, авторитетом остаются checkbox/approval/run-log (`legacy-v1`).
const { compile: compileGraph, loadCanonicalGraph } = require('./graph-compiler');
const graphJournal = require('./graph-journal');
const graphCore = require('./graph-core');
const { deriveState, migrationSnapshot } = require('./graph-state');
const { approvalDigest } = require('./task-identity');

const EPOCH_END_EVENT = 'legacy-epoch-end';
const JOURNAL_EPOCH = 'journal-v1';

// Маршрут узла → конкретный следующий шаг. Таблица — единственное место, где знание «что
// делать дальше» вообще существует; в голове человека и в прозе SKILL.md его больше нет.
const NEXT_STEP = {
  recon: { event: 'known-zone', cmd: ['slice', 'next', '--json'], hint: 'разведка зоны: elt slice next' },
  plan: { event: 'approved', cmd: null, hint: 'план не подписан: elt spec approve --spec specs/NNN-slug' },
  build: { event: 'ready', cmd: null, hint: 'написать слайс и прогнать focused-тесты (красный тест оставляет задачу открытой)' },
  landing: { event: 'landed', cmd: null, hint: 'посадка: elt commit --task Txxx --skip-oracle' },
  mirror: { event: 'mirror-terminal', cmd: null, hint: 'зеркало: elt oracle --full, затем elt judge run --task Txxx' },
  debrief: { event: 'ledger-only', cmd: ['review'], hint: 'разбор находок: elt review' },
  certified: { event: 'publish-requested', cmd: null, hint: 'публикация: elt commit --push (только с сертификатом)' },
  publish: { event: null, cmd: null, hint: 'прогон завершён' },
};

function compiledGraph() {
  const r = compileGraph(loadCanonicalGraph());
  if (!r.ok) throw new Error('канонический граф не компилируется — ' + r.errors.join('; '));
  return r.graph;
}
function journalFile() { return graphJournal.defaultJournalPath(cwd); }
// Digest lock компонентов входит в КАЖДЫЙ конверт: смена состава packs обязана делать старый
// proof stale (спека 020). Файла ещё нет — это тоже факт, а не повод писать пустую строку.
function componentLockDigest() {
  try { return sha256(fs.readFileSync(path.join(cwd, '.elt', 'components.lock.json'), 'utf8')); }
  catch { return 'no-component-lock'; }
}
function readJournal() { return graphJournal.readEvents(journalFile()); }
function epochRecord(events) {
  const hits = events.filter((e) => e.event === EPOCH_END_EVENT);
  return hits.length ? hits[hits.length - 1] : null;
}
function currentEpoch(events) { return epochRecord(events) ? JOURNAL_EPOCH : graphJournal.LEGACY_EPOCH; }
function transitionsOnly(events) { return events.filter((e) => e.event !== EPOCH_END_EVENT); }
// Прогон восстанавливается ИЗ ЖУРНАЛА. Своего состояния у процесса нет намеренно: после
// compact, перезапуска сессии или падения фона восстанавливать было бы нечего.
function activeRunId(events) {
  const t = transitionsOnly(events);
  return t.length ? t[t.length - 1].runId : null;
}
function newRunId() { return 'run-' + (headSha() || 'nohead').slice(0, 7) + '-' + Date.now().toString(36); }

function currentSpecIdentity() {
  const specDir = resolveSpecDir();
  return specDir ? relPosix(path.join(specDir, 'tasks.md')) : 'no-spec';
}

function graphSnapshot({ runId = null } = {}) {
  const graph = compiledGraph();
  const { events, truncatedTail, corrupt } = readJournal();
  const run = runId || activeRunId(events);
  const derived = deriveState({ graph, events: transitionsOnly(events), runId: run });
  const epochAt = epochRecord(events);
  return {
    graphVersion: graph.graphVersion,
    epoch: currentEpoch(events),
    epochEndCommit: epochAt ? (epochAt.commit || null) : null,
    runId: run,
    node: derived.state.node,
    generation: derived.state.generation,
    terminal: derived.state.terminal,
    legal: graphCore.legalEvents(derived.state),
    statuses: derived.statuses,
    // Отвергнутые события НЕ сглаживаются: расхождение журнала с графом обязано быть видно,
    // иначе «состояние восстановилось» означало бы только «мы промолчали».
    rejected: derived.rejected,
    journal: { events: events.length, truncatedTail, corrupt: corrupt.length },
    graph,
    state: derived.state,
  };
}

/**
 * recordTransition — один переход в журнале. Fail-closed по построению: событие сначала
 * проверяется reducer-ом на текущем состоянии, и только законное попадает на диск.
 * Возвращает { ok, reason, detail, node } и НИКОГДА не бросает: в эпоху `legacy-v1` журнал
 * ещё не авторитетен, и его отказ не имеет права уронить коммит.
 */
function recordTransition(event, opts) {
  const o = opts || {};
  let snap;
  try { snap = graphSnapshot({ runId: o.runId || null }); } catch (e) { return { ok: false, reason: 'snapshot-failed', detail: e.message }; }
  const run = snap.runId || o.runId || newRunId();
  const specIdentity = currentSpecIdentity();
  const envelope = {
    runId: run,
    graphVersion: snap.graphVersion,
    componentLockDigest: componentLockDigest(),
    specIdentity,
    taskIdentities: (o.taskIdentities && o.taskIdentities.length) ? o.taskIdentities : [{ specPath: specIdentity, id: 'T000', index: 0 }],
    batchId: o.batchId || 'no-batch',
    generation: o.generation || snap.generation || 1,
    baseHead: o.baseHead || null,
    batchHead: o.batchHead || o.commit || null,
    treeHash: treeHash(),
    nodeId: snap.node,
    seq: (snap.state.seq || 0) + 1,
    guards: o.guards || {},
  };
  const moved = graphCore.advance(snap.state, event, envelope);
  if (!moved.ok) return { ok: false, reason: moved.reason, detail: moved.detail, node: snap.node };
  const write = graphJournal.appendEvent(journalFile(), {
    v: 'elt-journal/v1',
    runId: envelope.runId,
    graphVersion: envelope.graphVersion,
    lockDigest: envelope.componentLockDigest,
    specPath: envelope.specIdentity,
    taskIdentities: envelope.taskIdentities,
    batchId: envelope.batchId,
    generation: envelope.generation,
    node: envelope.nodeId,
    event,
    seq: envelope.seq,
    ts: new Date().toISOString(),
    baseHead: envelope.baseHead,
    batchHead: envelope.batchHead,
    treeHash: envelope.treeHash,
    guards: envelope.guards,
    ...(o.commit ? { commit: o.commit } : {}),
    ...(moved.state.terminal ? { terminal: true } : {}),
  });
  if (!write.ok) return { ok: false, reason: write.reason, detail: write.detail, node: snap.node };
  return { ok: true, node: moved.state.node, seq: envelope.seq, runId: envelope.runId, duplicate: write.appended === false };
}

// Фасад пишет ЦЕПОЧКУ реально доказанных шагов, а не один «главный». Каждый шаг всё равно
// проходит guard: если доказательства нет, цепочка обрывается на нём и это видно в отчёте.
// Ничего не выдумывается — событие без доказанного guard просто не пишется.
function recordFacadeChain(steps, context) {
  const done = [];
  for (const step of steps) {
    const r = recordTransition(step.event, { ...context, guards: step.guards || {} });
    done.push({ event: step.event, ok: r.ok, reason: r.reason || null, node: r.node || null });
    if (!r.ok) break;
  }
  return done;
}

// В эпоху журнала отказ записи фатален: авторитет уже там, и «коммит есть, события нет»
// означало бы потерю истории. До cutover — только предупреждение в stderr.
function reportFacade(chain) {
  const failed = chain.find((c) => !c.ok);
  if (!failed) return;
  const msg = 'elt: событие графа ' + failed.event + ' не записано (' + failed.reason + ')';
  if (currentEpoch(readJournal().events) === JOURNAL_EPOCH) die(msg, 4);
  console.error(msg + ' — эпоха legacy-v1, шаг не отменяется');
}

// Легаси-строка run-log без `batch.specPath` — это запись, сделанная до spec-bound identity
// (020 T008). Приписать ей спеку по догадке нельзя, но у неё есть собственное доказательство:
// коммит, который она называет, физически правил ровно один `specs/*/tasks.md`. Это тот же
// вид доказательства, что и трейлер подписи, — читается у git, а не восстанавливается по
// памяти. Коммит, тронувший ноль или два плана, остаётся неоднозначным и блокирует cutover.
function reconcileLegacyRunLog(entries) {
  const cache = new Map();
  const plansOfCommit = (sha) => {
    if (cache.has(sha)) return cache.get(sha);
    const r = git(['show', '--name-only', '--format=', sha]);
    const plans = r.code === 0
      ? [...new Set((r.out || '').split('\n').map((l) => l.trim())
        .filter((l) => /^specs\/[^/]+\/tasks\.md$/.test(l)))]
      : [];
    cache.set(sha, plans);
    return plans;
  };
  // Второй источник доказательства — история поколений батчей: ремонтный коммит НЕ правит
  // `tasks.md` (задача уже закрыта), поэтому по diff он не привязывается ни к одному плану,
  // но в batch-state его sha записан вместе со спекой своего батча.
  const byCommit = new Map();
  {
    const batches = (readBatchState().batches) || {};
    for (const b of Object.values(batches)) {
      for (const h of (b.history || [])) if (h.commit) byCommit.set(h.commit, b.specPath);
      if (b.batchHead) byCommit.set(b.batchHead, b.specPath);
    }
  }
  // Кроме спеки, легаси-строке возвращается и identity задач: снимок сверяет каждую задачу
  // по `taskIdentities`, а старая строка несёт только слипшуюся строку батча "T001,T007".
  // Индекс берётся из самого плана — порядок задач часть identity (020 T014).
  const indexOfTask = (specPath, id) => {
    const abs = path.join(cwd, specPath);
    if (!fs.existsSync(abs)) return 0;
    const all = parseTasksFile(abs);
    const ordered = all.open.concat(all.done).sort((a, b) => a.lineNo - b.lineNo);
    const at = ordered.findIndex((t) => t.id === id);
    return at < 0 ? 0 : at;
  };
  const attach = (e, specPath, from) => ({
    ...e,
    batch: {
      ...(e.batch || {}),
      specPath,
      reconciledFrom: from,
      taskIdentities: (e.batch && e.batch.taskIdentities) || parseTaskIds(e.task)
        .map((id) => ({ specPath, id, index: indexOfTask(specPath, id) })),
    },
  });
  return entries.map((e) => {
    if (!e || !e.task || (e.batch && e.batch.specPath)) return e;
    if (e.commit) {
      const plans = plansOfCommit(e.commit);
      // Восстановленная identity помечена: она выведена из истории, а не записана тогда.
      if (plans.length === 1) return attach(e, plans[0], 'commit-touches-plan');
      if (byCommit.has(e.commit)) return attach(e, byCommit.get(e.commit), 'batch-state-history');
      return e;
    }
    // Строка без коммита (прогон судьи, блок L0) состояния не утверждает, но identity у неё
    // всё равно обязана быть однозначной — иначе завтра она приклеится к чужой спеке с тем
    // же T-номером. Разрешаем ТЕМ ЖЕ механизмом, что и парковку (020 T008): только если
    // задача с такими id живёт ровно в одном плане репозитория.
    const legacy = resolveLegacySpec(e.task);
    if (legacy.specPath) return attach(e, legacy.specPath, 'unique-task-id');
    return e;
  }).map((e, i, all) => {
    if (!e || !e.task || (e.batch && e.batch.specPath) || e.commit) return e;
    // Третий источник — соседство в самом run-log. Он append-only и хронологичен, поэтому
    // `judge run --task T013` и следующий за ним `commit --task T013` с sha — один и тот же
    // слайс. Берётся БЛИЖАЙШАЯ строка того же батча с уже разрешённой спекой; если таких
    // строк нет ни после, ни до, строка остаётся неоднозначной и блокирует cutover.
    const sameBatch = (o) => o && o.task === e.task && o.batch && o.batch.specPath;
    for (let j = i + 1; j < all.length; j += 1) if (sameBatch(all[j])) return attach(e, all[j].batch.specPath, 'adjacent-run-log-row');
    for (let j = i - 1; j >= 0; j -= 1) if (sameBatch(all[j])) return attach(e, all[j].batch.specPath, 'adjacent-run-log-row');
    return e;
  });
}

// Снимок миграции из ЖИВЫХ источников этого репозитория. Читать их внутри `graph-state`
// нельзя: там чистая функция, которая обязана считаться одинаково в основном дереве и в
// фоновом worktree, где часть источников физически другая.
function liveMigrationSnapshot() {
  const specDir = resolveSpecDir();
  if (!specDir) return { error: 'no-spec' };
  const specPath = relPosix(path.join(specDir, 'tasks.md'));
  const tasksText = fs.readFileSync(path.join(specDir, 'tasks.md'), 'utf8');
  const logFile = runLog.runtimeRunLog(cwd);
  const runLogEntries = (logFile && fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '')
    .split(/\r?\n/).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  const reconciled = reconcileLegacyRunLog(runLogEntries);
  const digest = approvalDigest({ repoDir: cwd, specDir });
  const signed = readApprovalTrailers(specDir).map((t) => t.approvalDigest).filter(Boolean);
  return {
    specPath,
    snapshot: migrationSnapshot({
      specPath,
      tasksText,
      runLogEntries: reconciled,
      reviewRows: readReviewQueue(),
      approval: digest.ok ? { digest: digest.digest, signedDigests: signed } : null,
    }),
  };
}

// ── commands ──────────────────────────────────────────────────────────────────
const [cmd, sub] = process.argv.slice(2);
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(name); }
function opt(name, dflt) { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt; }

// T003 010: явный --invoke > локальный (репо-разработчик) > мост плагина. Явный --invoke
// возвращается как есть (даже если файла нет) — вызывающий код различает «указан явно, но не
// существует» от «резолв исчерпан».
// 019 T015: третья ступень больше не `~/.claude/bin/judge/`, а `tools/` самого плагина.
// Разница не косметическая: копия в домашнем каталоге отставала от исходника молча (D16, D18),
// а каталог плагина отстать не может — он и есть исходник.
function resolveJudgeInvoke(baseCwd) {
  const explicit = opt('--invoke');
  if (explicit) return { invoke: explicit, explicit: true };
  const local = path.join(baseCwd, 'tools', 'judge-invoke.js');
  if (fs.existsSync(local)) return { invoke: local, explicit: false };
  const shipped = path.join(__dirname, 'judge-invoke.js');
  return { invoke: shipped, explicit: false, exhausted: !fs.existsSync(shipped) };
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
    // 020 T008: у каждой записи видна её identity; `legacy:true` — строка, чью спеку резолв
    // отказался угадывать, и именно она не участвует в фильтрации spec-bound планов.
    parked: readParkedResolved().map((r) => ({ ...r.entry, specPath: r.specPath, ...(r.legacy ? { legacy: true, candidates: r.candidates } : {}) })),
    lastRun,
    // 020 T015: проекция состояния графа. После cutover именно журнал авторитетен, а
    // checkbox и этот вывод — производные; до cutover поле показывает, что уже записано.
    graph: (() => {
      try {
        const g = graphSnapshot();
        return {
          epoch: g.epoch, epochEndCommit: g.epochEndCommit, graphVersion: g.graphVersion,
          runId: g.runId, node: g.node, generation: g.generation, legal: g.legal,
          journal: g.journal, rejected: g.rejected,
        };
      } catch (e) { return { error: e.message }; }
    })(),
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

// 020 T015: `elt run` — канонический вход. Он не «ещё одна команда», а замена памяти:
// состояние берётся из журнала, следующий законный шаг — из графа, и человеку остаётся
// выполнить ровно его. `--exec` выполняет шаг сам там, где шаг машинный.
if (cmd === 'run') {
  // Хук SessionStart зовёт эту же команду в ЛЮБОМ проекте. Там, где ELT не поднят, дверь
  // обязана молчать: подсказка про граф в чужом репозитории — шум, который учит человека
  // пролистывать вывод хука не глядя.
  if (!fs.existsSync(CONFIG) && !fs.existsSync(path.join(cwd, 'specs'))) process.exit(0);
  let snap;
  try { snap = graphSnapshot({ runId: opt('--run') || null }); }
  catch (e) { die('elt run: ' + e.message, 4); }
  const step = NEXT_STEP[snap.node] || { event: null, cmd: null, hint: 'узел вне таблицы маршрутов' };
  const ledgerOpen = (() => {
    try {
      const pending = ((require('../bin/ledger.js').summary(cwd) || {}).rules || []).filter((g) => !g.escalated);
      return { groups: pending.length, records: pending.reduce((n, g) => n + (g.count || 0), 0) };
    } catch { return null; }
  })();
  const out = {
    epoch: snap.epoch,
    epochEndCommit: snap.epochEndCommit,
    graphVersion: snap.graphVersion,
    runId: snap.runId,
    node: snap.node,
    generation: snap.generation,
    terminal: snap.terminal,
    legal: snap.legal,
    next: { event: step.event, command: step.cmd ? ['elt'].concat(step.cmd).join(' ') : null, hint: step.hint },
    journal: snap.journal,
    rejected: snap.rejected,
    statuses: snap.statuses,
    unresolvedReview: readReviewQueue().filter((r) => !r.resolved).length,
    ledger: ledgerOpen,
  };
  if (flag('--exec')) {
    if (!step.cmd) {
      if (flag('--json')) console.log(JSON.stringify({ ...out, exec: { ran: false, reason: 'шаг не машинный' } }, null, 2));
      else console.error('elt run --exec: ' + step.hint + ' — шаг выполняет человек или агент, сам себя он не делает');
      process.exit(3);
    }
    const r = spawnSync(process.execPath, [__filename].concat(step.cmd), { cwd, encoding: 'utf8', stdio: 'inherit' });
    process.exit(r.status === null ? 1 : r.status);
  }
  if (flag('--json')) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
  console.log('elt run: эпоха ' + out.epoch + ', узел ' + out.node + ' (поколение ' + out.generation + ')');
  console.log('  журнал: ' + out.journal.events + ' событий, прогон ' + (out.runId || 'ещё не начат'));
  console.log('  законные события: ' + (out.legal.join(', ') || 'нет (терминал)'));
  console.log('  дальше: ' + out.next.hint);
  if (out.unresolvedReview) console.log('  очередь разбора: ' + out.unresolvedReview + ' записей (elt review)');
  if (out.ledger && out.ledger.records) console.log('  журнал расхождений: ' + out.ledger.records + ' записей в ' + out.ledger.groups + ' группах');
  if (out.rejected.length) console.log('  ОТВЕРГНУТО журналом: ' + out.rejected.map((r) => r.event + ' (' + r.reason + ')').join(', '));
  process.exit(0);
}

// `elt advance` — явный переход. Единственный способ записать событие руками, и он такой же
// fail-closed, как и фасад: недоказанный guard не пишется, незаконное событие даёт exit 4 и
// НИЧЕГО не пишет на диск.
if (cmd === 'advance') {
  try { compiledGraph(); } catch (e) { die('elt advance: ' + e.message, 4); }
  const event = opt('--event');
  if (!event) die('elt advance --event <событие> [--guard имя[,имя]] [--commit sha] [--json]', 4);
  const guards = {};
  for (const g of String(opt('--guard', '')).split(',').map((s) => s.trim()).filter(Boolean)) guards[g] = true;
  const r = recordTransition(event, {
    guards,
    commit: opt('--commit') || null,
    batchId: opt('--batch') || null,
    runId: opt('--run') || null,
  });
  if (!r.ok) {
    if (flag('--json')) console.log(JSON.stringify({ ok: false, ...r }, null, 2));
    else console.error('elt advance: ' + event + ' отвергнут — ' + r.reason + ' (' + (r.detail || '') + ')');
    process.exit(4);
  }
  const after = graphSnapshot();
  if (flag('--json')) console.log(JSON.stringify({ ok: true, ...r, node: after.node, legal: after.legal }, null, 2));
  else console.log('elt advance: ' + event + ' → ' + after.node + ' (seq ' + r.seq + ')');
  process.exit(0);
}

// `elt cutover` — единственный переключатель эпохи. Он ничего не чинит и ничего не удаляет:
// либо снимок миграции чист и авторитет переходит журналу одним событием, либо он блокирован
// и на диск не ложится НИ ОДНОГО байта (это и есть rollback провалившегося cutover —
// откатывать нечего по построению).
if (cmd === 'cutover') {
  try { compiledGraph(); } catch (e) { die('elt cutover: ' + e.message, 4); }
  const live = liveMigrationSnapshot();
  if (live.error) die('elt cutover: ' + live.error, 4);
  const events = readJournal().events;
  if (currentEpoch(events) === JOURNAL_EPOCH) {
    const at = epochRecord(events);
    console.log(JSON.stringify({ ok: true, already: true, epoch: JOURNAL_EPOCH, commit: at.commit || null }, null, 2));
    process.exit(0);
  }
  const snap = live.snapshot;
  if (snap.cutoverBlocked) {
    console.log(JSON.stringify({ ok: false, epoch: graphJournal.LEGACY_EPOCH, blocked: true, ambiguities: snap.ambiguities }, null, 2));
    console.error('elt cutover: БЛОКИРОВАН — ' + snap.ambiguities.length + ' неоднозначностей легаси-эпохи; журнал не тронут');
    process.exit(5);
  }
  const commit = headSha();
  const write = graphJournal.appendEvent(journalFile(), {
    v: 'elt-journal/v1',
    runId: activeRunId(events) || newRunId(),
    graphVersion: compiledGraph().graphVersion,
    lockDigest: componentLockDigest(),
    specPath: live.specPath,
    taskIdentities: snap.rows.map((r) => ({ specPath: r.specPath, id: r.id, index: r.index })),
    batchId: 'legacy-cutover',
    generation: 1,
    node: 'certified',
    event: EPOCH_END_EVENT,
    seq: (graphSnapshot().state.seq || 0) + 1,
    ts: new Date().toISOString(),
    commit,
    guards: { 'migration-snapshot-clean': true },
  });
  if (!write.ok) die('elt cutover: журнал отверг запись — ' + write.reason, 4);
  console.log(JSON.stringify({ ok: true, epoch: JOURNAL_EPOCH, commit, rows: snap.rows.length }, null, 2));
  console.error('elt cutover: авторитет у журнала; tasks.md с этого коммита — неизменное намерение, а checkbox — проекция');
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

// 020 T016: батч перестал быть строкой в argv — значит у него должно быть видимое состояние.
// Без этой команды «почему коммит отвергнут» отвечалось бы чтением JSON в .git руками.
if (cmd === 'batch') {
  const state = readBatchState();
  const quarantined = new Set(quarantinedBatches().map((b) => b.batchId));
  const rows = Object.entries(state.batches || {}).map(([batchId, b]) => ({
    batchId, specPath: b.specPath, taskIds: b.taskIds, generation: b.generation,
    batchHead: b.batchHead, quarantined: quarantined.has(batchId),
  }));
  if (sub === 'plan') {
    const built = batchItems(normalizeTaskArg(opt('--task')));
    if (built.error) die(`elt batch plan: ${built.error}`, 4);
    const cfgB = fs.existsSync(CONFIG) ? loadConfig() : {};
    const p = planBatch({ items: built.items, isDone: built.isDone, baseHead: headSha(), max: Number(cfgB.batch) || DEFAULT_BATCH, repair: flag('--repair') });
    console.log(JSON.stringify(p, null, 2));
    process.exit(p.ok ? 0 : 4);
  }
  if (flag('--json')) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
  if (!rows.length) { console.log('elt batch: посаженных батчей нет'); process.exit(0); }
  for (const r of rows) {
    console.log(`  ${r.taskIds.join(',')} @ ${r.specPath}  gen ${r.generation}  ${r.batchHead}${r.quarantined ? '  КАРАНТИН' : ''}`);
  }
  process.exit(rows.some((r) => r.quarantined) ? 1 : 0);
}

if (cmd === 'review') {
  const rows = readReviewQueue();
  const queueFile = path.join(cwd, REVIEW_QUEUE);
  if (sub === 'close') {
    const taskId = normalizeTaskArg(opt('--task'));
    if (!taskId) die('elt review close --task Txxx[,Tyyy] [--spec specs/NNN-slug] [--adopt-legacy] [--allow-empty]', 4);
    const ids = new Set(parseTaskIds(taskId));
    const wantSpec = opt('--spec') ? relPosix(path.join(resolveSpecDir(), 'tasks.md')) : null;
    const now = new Date().toISOString();
    // Батч-запись несёт "T001,T002" — она кандидат, если названа ЛЮБАЯ из её задач.
    const candidates = rows.map((row, i) => ({ row, i, ...resolveIdentity(row.task, row.specPath) }))
      .filter((c) => !c.row.closedAt && parseTaskIds(c.row.task).some((id) => ids.has(id)));
    // 020 T008: закрывается РОВНО названная identity. Без `--spec` неоднозначность (строки
    // разных спек под одним id) — отказ, а не «закроем всё, что похоже».
    const distinct = [...new Set(candidates.map((c) => (c.legacy ? 'legacy' : c.specPath)))];
    if (!wantSpec && distinct.length > 1) {
      die(`elt review close: ${taskId} есть в разных спеках (${distinct.join(', ')}) — уточните --spec`, 5);
    }
    // Неоднозначная legacy-строка (её id живёт в ДВУХ и более планах) — отдельный отказ, и
    // проверка выше его не ловила: одна такая строка даёт distinct = ['legacy'], длина 1.
    // Найдено судьёй на самой T008: `elt review close --task T020` закрывал её с
    // `specPath: null`, то есть закрывал НЕИЗВЕСТНО ЧЬЮ находку — ровно тот fail-open,
    // который задача и снимает. Ноль кандидатов не ambiguity: перепутать не с чем.
    const ambiguous = candidates.filter((c) => c.legacy && c.candidates.length > 1);
    if (ambiguous.length && !(wantSpec && flag('--adopt-legacy'))) {
      die(`elt review close: строка ${taskId} без specPath, а id есть в ${ambiguous[0].candidates.join(', ')}`
        + ` — назовите спеку явно: --spec <dir> --adopt-legacy`, 5);
    }
    const hit = candidates.filter((c) => {
      if (!wantSpec) return true;
      if (c.specPath === wantSpec) return true;
      // Legacy-строка без спеки прилипает к названной только по ЯВНОМУ решению человека.
      return c.legacy && flag('--adopt-legacy');
    });
    const next = rows.slice();
    for (const c of hit) next[c.i] = { ...c.row, specPath: wantSpec || c.specPath || null, closedAt: now };
    // Закрытая запись остаётся в файле с меткой, а не удаляется: история разбора — тоже пруф.
    if (hit.length) fs.writeFileSync(queueFile, next.map((r) => JSON.stringify(r)).join('\n') + '\n');
    // 020 T008 — блокер 1 живьём: `elt review close --task T018` из worktree возвращал exit 0,
    // закрыв НОЛЬ строк (очередь лежала в другом чекауте), и молчал об этом. Ноль закрытых —
    // отказ с именем файла очереди; идемпотентный повтор объявляется явно (`--allow-empty`).
    if (!hit.length && !flag('--allow-empty')) {
      const legacyHint = candidates.length ? ' (кандидаты есть, но их identity не совпала — см. --adopt-legacy)' : '';
      die(`elt review close: ${taskId}${wantSpec ? ` @ ${wantSpec}` : ''} — закрыто 0 строк в ${relPosix(queueFile)}`
        + `${legacyHint}; открытых записей: ${rows.filter((r) => !r.closedAt).length}`, 5);
    }
    console.log(`elt review close: закрыто ${hit.length} (${taskId}${wantSpec ? ` @ ${wantSpec}` : ''})`);
    process.exit(0);
  }
  const open = rows.filter((row) => !row.closedAt)
    .map((row) => { const r = resolveIdentity(row.task, row.specPath); return { ...row, specPath: r.specPath, ...(r.legacy ? { legacy: true } : {}) }; });
  if (flag('--json')) { console.log(JSON.stringify(open)); process.exit(0); }
  if (!open.length) { console.log('elt review: очередь пуста'); process.exit(0); }
  console.log(`elt review: ${open.length} на разборе`);
  // 014 T007: у записей `bg-red` есть слой и лог — без них строка «фон покраснел» неразбираема.
  for (const row of open) {
    const kind = row.kind ? `[${row.kind}${row.layer ? `/${row.layer}` : ''}] ` : '';
    // 020 T008: identity строки печатается рядом с id — без неё «T018» неразбираемо.
    const who = row.legacy ? 'legacy (спека не резолвится)' : (row.specPath || 'legacy');
    console.log(`  ${kind}${row.task} @ ${who}  ${row.commit}  ${row.ts}\n    ${row.reason}`
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
    const clearBinding = findTaskBinding(taskId);
    const removed = unpark(taskId, opt('--spec') ? (clearBinding ? clearBinding.specPath : resolveLegacySpec(taskId).specPath) : null);
    console.log(JSON.stringify({ cleared: removed, parked: readParked() }, null, 2));
    process.exit(0);
  }
  const reason = opt('--reason');
  if (!reason) die('elt park: --reason обязателен (red-stop|judge-block|judge-dead|empty-diff)', 4);
  const list = readParked();
  // 020 T008: в записи едет спека задачи. Открытая задача даёт её через binding (он уважает
  // `--spec`); закрытая/чужая — через fail-closed резолв, и если он не смог, поле остаётся
  // null: соврать про спеку хуже, чем признать legacy-строку.
  const parkBinding = findTaskBinding(taskId);
  const parkSpec = parkBinding ? parkBinding.specPath : resolveLegacySpec(taskId).specPath;
  const sameParked = (e) => e.tid === taskId && (e.specPath || null) === parkSpec;
  const prev = list.find(sameParked);
  const entry = { tid: taskId, specPath: parkSpec, reason, ts: new Date().toISOString(), logPath: opt('--log', null), attempts: (prev ? prev.attempts : 0) + 1 };
  writeParked(list.filter((e) => !sameParked(e)).concat([entry]));
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
        die(`спека не подписана: elt spec approve --spec ${path.relative(cwd, gate.specDir).split(path.sep).join('/')} (статус: ${gate.status})`, 4);
      }
    }
  }
  // --count N: N первых открытых задач ОДНОГО плана — вход для батч-режима драйвера.
  // Форма вывода при --count 1 (дефолт) не изменилась (объект, не массив), иначе
  // сломались бы существующие парсеры драйверов (PowerShell-драйвер (снят 019/T007) / fleet).
  const count = Math.max(1, parseInt(opt('--count', '1'), 10) || 1);
  // 009 T004: припаркованные задачи пропускаются — иначе петля «продолжает» тем же
  // упавшим слайсом по кругу. Они остаются `[ ]` в плане и видны в `elt status`.
  // 020 T008: парковка сверяется в границах ТОГО ЖЕ плана, который выдаёт задачи. Иначе
  // «T020», припаркованный когда-то другой спекой, навсегда прятал открытый 019/T020, и
  // петля молча считала план закрытым.
  const activeSpecPath = t ? relPosix(t.file) : null;
  const parkedSkip = parkedIds(activeSpecPath);
  for (const tid of parkedLegacyIgnored(activeSpecPath)) {
    console.error(`elt slice next: припаркованная запись ${tid} без спеки пропущена (identity не резолвится) — снять: elt park --clear --task ${tid}`);
  }
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
  // 020 T016: `--repair` — судья второй генерации уже посаженного (и закрытого) батча.
  const judgeRepair = flag('--repair');
  const binding = findTaskBinding(taskId, { includeDone: judgeRepair });
  if (!binding) die(`elt judge run: задача ${taskId} не найдена среди ${judgeRepair ? 'задач плана' : 'открытых [ ]'}`, 4);
  // 020 T023: судье уходит ВЕСЬ блок задачи, а не заголовок. В блоке живёт `[files: …]` —
  // зона scope-триггера L0 и критерии, по которым судья вообще может судить.
  const texts = taskId.split(',').map((id) => {
    const found = findTaskItem(id, !judgeRepair);
    return found ? taskBlockText(found.plan, found.item) : id;
  });
  // T003 010: мост резолвится локально (репо-разработчик) → из каталога плагина → явный
  // --invoke сильнее обоих.
  const resolved = resolveJudgeInvoke(cwd);
  const invoke = resolved.invoke;
  if (!fs.existsSync(invoke)) {
    if (resolved.explicit) die(`elt judge run: не найден ${invoke} — судья-мост не существует по указанному --invoke`, 4);
    die('elt judge run: судья-мост не найден ни в проекте (tools/judge-invoke.js), ни в каталоге плагина — переустанови плагин (`claude plugin install elt@elt`) или укажи --invoke <path>', 4);
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
  // 020 T015: вердикт судьи — это переход зеркала, а не только строка в run-log. `block`
  // возвращает тот же батч в `build` следующим поколением (ремонт), а не открывает новый.
  {
    const chain = recordFacadeChain([
      ok
        ? { event: 'mirror-terminal', guards: { 'batch-head-immutable': true } }
        : { event: 'mirror-red', guards: {} },
    ], { commit: headSha() });
    reportFacade(chain);
  }
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
    // с embedded-кавычками бьётся о PS5.1 native-marshalling баг (см. PowerShell-драйвер (снят 019/T007) comment).
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
    if (git(['rev-parse', '--is-inside-work-tree']).code !== 0) die('elt spec approve: не git-репозиторий', 4);
    const lint = specLint(specDir);
    if (!lint.ok) die(`elt spec approve: lint не прошёл — не хватает секций: ${lint.missing.join(', ')}`, 4);
    const hashes = readSpecHashes(specDir);
    if (hashes.error) die(`elt spec approve: ${hashes.error} в ${path.relative(cwd, specDir)}`, 4);
    const key = specDirKey(specDir);
    // 018 T003: идемпотентность считается по ТРЕЙЛЕРУ, а не по общему статусу спеки. Спека,
    // подписанная ещё файлом, по статусу выглядит approved — и трейлера не получила бы
    // никогда, то есть миграция встала бы на первой же спеке, которую сама и переводит.
    // 020 T015: подпись обязана нести и канонический digest схемы `elt-approval/v1` —
    // именно его требует cutover. Старая подпись без него по этому критерию не проходит
    // и переподписывается, а не объявляется достаточной задним числом.
    const canonical = approvalDigest({ repoDir: cwd, specDir });
    if (!canonical.ok) die('elt spec approve: канонический digest не посчитан — ' + canonical.reason, 4);
    const signed = readApprovalTrailers(specDir)
      .find((t) => t.specHash === hashes.specHash && t.tasksHash === hashes.tasksHash
        && t.approvalDigest === canonical.digest);
    if (signed) {
      console.error(`elt spec approve: уже подписана в ${signed.sha.slice(0, 7)} (${signed.approvedAt}) — без изменений`);
      console.log(JSON.stringify({ spec: key, approvedAt: signed.approvedAt, approvedIn: signed.sha, ...hashes }, null, 2));
      process.exit(0);
    }
    // Подпись плана — не код, поэтому здесь нет ни оракула, ни L0, ни судьи. Коммит СВОЙ и
    // узкий: pathspec держит его в границах директории спеки, так что грязное дерево вокруг
    // не заметается — стена `git add -A` из `elt commit` сюда не тянется.
    const msg = [
      `chore: approve spec ${path.basename(specDir)}`, '',
      `${TRAILERS.spec}: ${key}`,
      `${TRAILERS.specHash}: ${hashes.specHash}`,
      `${TRAILERS.tasksHash}: ${hashes.tasksHash}`,
      `${TRAILERS.approvalDigest}: ${canonical.digest}`,
    ].join('\n');
    // Новая спека git-у ещё неизвестна, а `commit -- <path>` знает только отслеживаемые пути
    // и упал бы на `pathspec did not match any file(s) known to git` (проверено живьём). add
    // тоже узкий — тем же pathspec, поэтому в индекс не втягивается ничего лишнего.
    if (git(['add', '--', key]).code !== 0) die('elt spec approve: git add не прошёл', 4);
    // `--allow-empty` покрывает случай «спека уже в истории без изменений»: подпись обязана
    // появиться и тогда, когда коммитить в самой директории нечего.
    const rc = spawnSync('git', ['-c', 'core.quotepath=false', 'commit', '--allow-empty', '-m', msg, '--', key], { cwd, encoding: 'utf8' });
    if (rc.status !== 0) die('elt spec approve: git commit не прошёл — ' + ((rc.stderr || rc.stdout || '').trim()), 4);
    const sha = git(['rev-parse', 'HEAD']).out;
    const approvedAt = git(['log', '-1', '--format=%cI']).out;
    appendRunLog({
      task: null, status: 'spec-approve', spec: key,
      commit: git(['rev-parse', '--short', 'HEAD']).out,
      branch: git(['branch', '--show-current']).out,
      msg: msg.split('\n')[0],
    });
    console.error(`elt spec approve: ${key} подписана в ${sha.slice(0, 7)}`);
    console.log(JSON.stringify({ spec: key, approvedAt, approvedIn: sha, ...hashes }, null, 2));
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

  // 020 T009: при `verify:"background"` судейского пруфа на момент коммита НЕТ по построению —
  // тяжёлые слои идут после (014 T005). Пока хук требовал его безусловно, включить
  // `core.hooksPath` в таком проекте было физически невозможно: гейт блокировал КАЖДЫЙ
  // легальный слайс. Поэтому в фоновом режиме дверь стережёт оракул-пруф: `elt commit`
  // передаёт хеш тех самых байтов пруфа, которые он уже проверил ДО markDone.
  {
    const cfgRaw = readHarnessConfig(cwd);
    const bgMode = cfgRaw.ok && cfgRaw.config.verify === 'background';
    if (bgMode) {
      let oracleRaw = null;
      try { oracleRaw = fs.readFileSync(oracleProofPath(), 'utf8'); } catch { /* нет пруфа — ниже отказ */ }
      if (!oracleRaw) die('elt gate: нет оракул-пруфа (verify:"background") — коммить через elt commit', 4);
      let parsed = null;
      try { parsed = JSON.parse(oracleRaw); } catch { /* битый — отказ ниже */ }
      // Доверие к байтам пруфа снимает ТОЛЬКО проверку дерева (она заведомо не сойдётся: между
      // валидацией в `elt commit` и этим хуком успел смениться `[X]` в tasks.md), но НЕ
      // проверку самого вердикта. Красный оракул не проходит ни по какому пути — иначе
      // «доверенный коммит» стал бы дырой шире той, что закрывает T009.
      if (process.env.ELT_GATE_TRUST_ORACLE && parsed && parsed.exit === 0
          && process.env.ELT_GATE_TRUST_ORACLE === sha256(oracleRaw)) {
        console.log('elt gate: trusted elt commit (оракул-пруф проверен до markDone)');
        process.exit(0);
      }
      if (!parsed || parsed.exit !== 0 || parsed.hash !== treeHash()) {
        die('elt gate: оракул-пруф отсутствует, красный или не про это дерево — коммить через elt commit', 4);
      }
      console.log('elt gate: оракул-пруф зелёный и привязан к этому дереву');
      process.exit(0);
    }
  }

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
  // 020 T016: состав батча узаконивается планировщиком ДО любой записи. `--repair` — второе
  // поколение уже посаженного батча: задачи закрыты, красная находка открыта, и другого
  // легального способа починить квартинованный батч у харнеса нет.
  const repair = flag('--repair');
  const built = batchItems(taskId);
  if (built.error) die(`elt commit: ${built.error}`, 4);
  const batchPlan = planBatch({
    items: built.items, isDone: built.isDone, baseHead: headSha(),
    max: Number(cfg.batch) || DEFAULT_BATCH, repair,
  });
  if (!batchPlan.ok) die(`elt commit: батч отвергнут (${batchPlan.reason}) — ${batchPlan.detail}`, 4);
  // 020 T016: посадка меряется от принятого состава до локального коммита — это и есть
  // `ready → local commit`, число для p95. Оракул в него не входит: он до `ready`.
  const readyAt = Date.now();
  // Red Mirror не открывает второй батч. Проверка намеренно ограничена ЗАРЕГИСТРИРОВАННЫМИ
  // батчами: до T016 записи не велись (legacy-v1 epoch), и требовать её задним числом значило
  // бы, что харнес не может посадить сам T016.
  {
    const quarantined = quarantinedBatches().filter((b) => b.taskIds.join(',') !== batchPlan.taskIds.join(','));
    if (quarantined.length) {
      const q = quarantined[0];
      die(`elt commit: батч ${q.taskIds.join(',')} (${q.batchHead}) в карантине — сначала почини его:`
        + ` elt commit --task ${q.taskIds.join(',')} --repair --spec ${q.specPath.replace(/\/tasks\.md$/, '')}`, 4);
    }
  }
  // 014 T022: binding снимается ЗДЕСЬ, до markDone() — findTaskBinding ищет только открытые
  // `[ ]`, и после простановки `[X]` вернул бы null. Фоновому судье он нужен ниже.
  // При repair задачи уже `[X]`, поэтому identity берётся у планировщика.
  const binding = repair ? { taskId: batchPlan.taskIds.join(','), specPath: batchPlan.specPath } : findTaskBinding(taskId);
  {
    const specDir = binding ? path.dirname(path.join(cwd, binding.specPath)) : null;
    const gate = specApprovalGateFor(cfg, specDir);
    if (gate.blocked) {
      if (flag('--skip-approval')) {
        approvalSkipped = true;
        console.error(`elt commit: --skip-approval (спека не утверждена: ${gate.status}, ${path.relative(cwd, gate.specDir)})`);
      } else {
        die(`спека не подписана: elt spec approve --spec ${path.relative(cwd, gate.specDir).split(path.sep).join('/')} (статус: ${gate.status})`, 4);
      }
    }
  }

  // 014 T005 (AC3): в background-режиме тяжёлые слои (полный сьют/мутатор/smoke/судья) не
  // синхронны — судейский пруф здесь не требуется, дифф проверяется фоном ПОСЛЕ коммита
  // (spawnBackgroundVerify ниже). sync-ветка не тронута — судья остаётся обязательным.
  const judge = bgVerify ? null : validateJudgeProof({ taskId, repair });
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
  // 020 T016: repair НЕ трогает план — задача уже закрыта, и «переоткрыть, чтобы закрыть
  // снова» было бы подделкой состояния. Поколение растёт в batch-state, план неизменен.
  // 020 T023: два разных текста, и раньше здесь был только один. Заголовок идёт в сообщение
  // коммита (там он ещё и обрезается до 90 символов), блок — фоновой верификации: её L0 и её
  // судья читают `[files: …]` оттуда же, откуда синхронные. Пока оба брались из `item.text`,
  // фон судил слайс по одной строке задачи.
  const picked = ids.map((id) => {
    if (repair || flag('--keep-task-open')) {
      const found = findTaskItem(id, !repair);
      if (!found) die(`задача ${id} не найдена среди ${repair ? 'задач плана' : 'открытых [ ]'}`);
      return { title: found.item.text, block: taskBlockText(found.plan, found.item) };
    }
    const item = markDone(id);
    return { title: item.text, block: item.block };
  });
  const texts = picked.map((p) => p.block);
  const taskText = picked[0].title + (picked.length > 1 ? ` (+${picked.length - 1})` : '');

  // 011 T004: метка ставится ПОСЛЕ обрезки до 90 — иначе длинный заголовок съедал бы её
  // ровно на тех слайсах, где она и нужна.
  const inconclusive = !bgVerify && judge.proof.verdict === 'inconclusive';
  // 020 T016: поколение считается ДО коммита — оно едет и в сообщение, и в batch-state, и в
  // run-log одним числом. Записи нет → legacy-батч, поколение восстанавливается из находки.
  // Ключ ищется по IDENTITY (спека + упорядоченные id), а не по `batchId`: у repair другой
  // baseHead, значит и другой batchId — а batch обязан остаться ТЕМ ЖЕ, иначе «второе
  // поколение» превратилось бы в новый батч под новым именем, то есть в обход карантина.
  const prevKey = findBatchKey(batchPlan);
  const batchKey = prevKey || batchPlan.batchId;
  const prevBatch = (prevKey && readBatchState().batches[prevKey]) || (repair ? reconstructGeneration(batchPlan) : null);
  if (repair && !prevBatch) {
    die(`elt commit --repair: у ${batchPlan.taskIds.join(',')} нет ни записи поколения, ни открытой находки — чинить нечего`, 4);
  }
  const generation = (prevBatch ? prevBatch.generation : 0) + 1;
  const msg = opt('-m', taskId ? `feat: ${taskId} ${taskText}`.slice(0, 90) : 'chore: elt slice')
    + (inconclusive ? ' [inconclusive]' : '')
    + (repair ? ` [repair gen ${generation}]` : '');
  if (git(['add', '-A']).code !== 0) die('git add failed');
  // 020 T009: в фоновом режиме хук стережёт ОРАКУЛ-пруф, и `elt commit` передаёт хеш тех
  // самых байтов, которые он уже проверил выше (до markDone — та правка двигает treeHash).
  let oracleTrust = null;
  if (bgVerify) { try { oracleTrust = sha256(fs.readFileSync(oracleProofPath(), 'utf8')); } catch { oracleTrust = null; } }
  const commitEnv = bgVerify
    ? { ...process.env, ...(oracleTrust ? { ELT_GATE_TRUST_ORACLE: oracleTrust } : {}) }
    : { ...process.env, ELT_GATE_TRUST: gateTrust };
  const c = spawnSync('git', ['commit', '-m', msg], { cwd, encoding: 'utf8', env: commitEnv });
  if (c.status !== 0) die('git commit failed: ' + (c.stderr || c.stdout));
  const sha = git(['rev-parse', '--short', 'HEAD']).out;

  // Задача закрылась — снимаем её с парковки (009 T004), иначе status/slice next
  // продолжали бы считать её припаркованной после успешной перезакрытия.
  unpark(taskId, binding ? binding.specPath : null);

  // 020 T016: батч зарегистрирован под своей identity. Proof предыдущего поколения после
  // этой записи протухает по построению: он привязан к прежним baseHead/treeHash, а
  // `batchHead` батча теперь другой — история поколений остаётся в `history`, не стирается.
  {
    const state = readBatchState();
    state.batches = state.batches || {};
    const history = (prevBatch && prevBatch.history ? prevBatch.history : []).concat([{ generation, commit: sha, ts: new Date().toISOString() }]);
    state.batches[batchKey] = {
      specPath: batchPlan.specPath, taskIds: batchPlan.taskIds,
      taskIdentities: batchPlan.taskIdentities,
      generation, batchHead: sha, repair, history,
    };
    writeBatchState(state);
  }

  // 020 T015: низкоуровневый `commit` остался, но перестал быть немым. Он пишет ровно те
  // события, которые реально доказал: разведку зоны (задача из подписанного плана и её
  // `[files:]`), готовность батча (dependency closure планировщика) и посадку (зелёный L0).
  // Без этого восстановление после compact видело бы commit, которого нет в истории
  // прогона, — и `elt run` предлагал бы шаг, уже сделанный руками.
  {
    const chain = recordFacadeChain([
      { event: 'known-zone', guards: { 'familiar-zone': true, 'scope-within-limit': true } },
      { event: 'ready', guards: { 'task-dependencies-closed': true } },
      { event: 'landed', guards: { 'l0-green': true } },
    ], {
      commit: sha,
      batchId: batchKey,
      generation,
      batchHead: sha,
      taskIdentities: batchPlan.taskIdentities,
    });
    reportFacade(chain);
  }

  // Очередь ревью пишется ПОСЛЕ коммита: в строке обязан быть его sha, иначе разбирать нечего.
  // Неблокирующая по решению 2 спеки (R4): накопление видно в doctor, работу не стопорит.
  if (inconclusive) {
    const queue = path.join(cwd, REVIEW_QUEUE);
    fs.mkdirSync(path.dirname(queue), { recursive: true });
    fs.appendFileSync(queue, JSON.stringify({
      // 020 T008: identity строки — (specPath, task), а не голый id.
      task: taskId, specPath: binding ? binding.specPath : null,
      commit: sha, reason: (judge.proof.reasons || []).join('; '), ts: new Date().toISOString(),
    }) + '\n');
    console.error(`elt commit: вердикт inconclusive — строка в ${REVIEW_QUEUE} (разбор: elt review)`);
  }

  appendRunLog({
    task: taskId,
    batch: {
      batchId: batchKey, generation, repair,
      specPath: batchPlan.specPath, taskIdentities: batchPlan.taskIdentities,
      readyToLocalCommitSec: (Date.now() - readyAt) / 1000,
    },
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
  // 020 T009: провал push — НЕНУЛЕВОЙ выход. Раньше он печатался в stderr и терялся: команда
  // возвращала 0, драйвер считал слайс доехавшим, а коммита на remote не было. Для релизной
  // цепочки (tag/push receipts в T006) это прямой источник false-green. Коммит уже создан и
  // остаётся — «локально есть, на remote нет» и есть тот факт, который обязан быть виден.
  let pushFailed = null;
  if (cfg.push || flag('--push')) {
    const p = git(['push', '-u', 'origin', branch]);
    if (p.code === 0) console.error('elt commit: pushed');
    else {
      pushFailed = p.err || `exit ${p.code}`;
      console.error('elt commit: push FAILED — ' + pushFailed);
    }
  }
  clearGateMarker(); // цепочка гейта закончилась — авто-чекпоинту снова можно писать
  console.log(`elt commit: ${sha} на ${branch}${taskId ? ' — ' + taskId + ' [X]' : ''}`
    + (pushFailed ? ' — НО push не прошёл, на remote коммита нет' : ''));
  process.exit(pushFailed ? 5 : 0);
}
// 019 T008: команды `elt harness sync-all` и `elt harness propose` сняты вместе со своими
// модулями. sync-all раскатывал схему v4 по реестру чужих проектов — сценарий записан
// снятым в PLAYBOOK.md, а не потерян молча. propose держал judge-bench-гейт на правку
// самого судьи, но был НЕДОСТИЖИМ (D16): единственный вход требовал модуль, которого нет в
// deploy-копии. Дальше эволюцию контура доказывает ledger из T019, а не мёртвая команда.
// Справка — теперь безусловный хвост: ветки, ради которой стоял else, больше нет.
console.log(`elt — ядро ELT v3 харнесса
  elt init --oracle "<cmd>" [--shell powershell] [--push]   создать .harness/harness.json
  elt run [--json] [--exec]                                 ОДНА ДВЕРЬ: узел графа из журнала + следующий законный шаг
  elt advance --event <e> [--guard a,b] [--json]             явный переход графа (незаконный = exit 4 и ни байта на диск)
  elt cutover [--json]                                      переключить авторитет с checkbox на журнал (fail-closed)
  elt status [--spec specs/NNN-slug]                        git + план + последний прогон + узел графа
  elt slice next [--json] [--count N] [--spec specs/NNN-slug]  следующая [ ] задача (--count N → N первых; exit 3 = план закрыт)
  elt spec approve [--spec specs/NNN-slug]                  подписать spec.md+tasks.md коммитом-трейлером (идемпотентно)
  elt spec status [--spec specs/NNN-slug]                   approved | stale | unapproved | error
  elt spec lint [--spec specs/NNN-slug]                     проверка обязательных секций spec.md (approve гоняет его сам)
  elt park --task Txxx --reason <r> [--log <path>]          припарковать слайс (петля берёт следующий); --clear снимает
  elt batch [--json] | elt batch plan --task Txxx[,Tyyy] [--repair]
                                                            состояние посаженных батчей и поколений; plan — проверить состав ДО посадки
  elt commit --task Txxx[,Tyyy] --repair                    второе поколение уже посаженного батча (задачи остаются [X])
  elt review [--json] | elt review close --task Txxx [--spec specs/NNN-slug] [--adopt-legacy] [--allow-empty]
                                                            очередь вердиктов (неблокирующая); close — снять с разбора РОВНО названную identity (0 закрытых = exit 5)
  elt stats [--since <ISO-дата>] [--json]                   block-rate/coverage/p50-p90 из run-log.jsonl (одна команда вместо ручного разбора)
  elt oracle [--full]                                       прогнать оракул, exit-код = истина; --full игнорирует oracleSelect:impact
  elt judge run --task Txxx[,Tyyy] [--provider p] [--model m]  запустить судью КОДОМ и записать proof (exit 0 = pass)
  elt gate [--ci]                                           managed git gate: pre-commit (proof) | CI (--ci, mechanical oracle re-run)
  elt commit --task Txxx[,Tyyy,...] [--keep-task-open] [-m msg] [--skip-oracle] [--push]
      зелёный oracle + актуальный judge proof → авто-ветка с main → [X] → add+commit → run-log.jsonl → push
      БАТЧ: --task T001,T002,T003 — один оракул + один судья + один коммит на N задач
            (judge-proof write --task тем же списком; все задачи должны быть открыты и в одном tasks.md)`);
process.exit(cmd ? 1 : 0);
