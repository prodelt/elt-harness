'use strict';
// gate.js — гейт слайса ВНУТРИ worktree (T007). Неизменный харнесс-контур:
//   elt oracle → судья (claude -p --model sonnet, REJECT-default) → elt commit.
// Коммит БЕЗ [X]-марка (no --task): пометку в tasks.md ставит оркестратор на
// интеграционной ветке ПОСЛЕ merge (T008), иначе tasks.md конфликтует при merge.
// Судья гоняется через providers.run (claude), парсер вердикта портирован из elt-loop.ps1.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const providers = require('./providers');
const plan = require('./plan');

const ELT_CLI = path.join(os.homedir(), '.claude', 'bin', 'elt.js');
const JUDGE_TIMEOUT_MS = 5 * 60 * 1000;

// Схема для --json-schema: судья зовётся через structured output (T016 live-fire —
// prose-парсер регулярно мимо: модель пишет "принято"/"зачёт" вместо литерального pass/block,
// REJECT-default тогда блокирует легитимные слайсы). claude -p --output-format json оборачивает
// весь транскрипт в JSON-массив; последний элемент (type:"result") несёт structured_output.
const VERDICT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: { verdict: { type: 'string', enum: ['pass', 'block'] }, reasons: { type: 'array', items: { type: 'string' } } },
  required: ['verdict', 'reasons'],
});

// Структурированный путь: последний элемент JSON-массива --output-format json → structured_output.
function parseStructuredOutput(text) {
  try {
    const arr = JSON.parse(text);
    const last = Array.isArray(arr) ? arr[arr.length - 1] : arr;
    const so = last && last.structured_output;
    const v = so && so.verdict;
    if (v !== 'pass' && v !== 'block') return null;
    return { verdict: v, reasons: Array.isArray(so.reasons) ? so.reasons.map(String) : [] };
  } catch { return null; }
}
function parseStructuredVerdict(text) {
  const so = parseStructuredOutput(text);
  return so ? so.verdict : null;
}
// T022: причина block читается для проброса в prompt следующей попытки этого же слайса.
function parseReasons(text) {
  const so = parseStructuredOutput(text);
  if (so) return so.reasons;
  try {
    const m = text.match(/"reasons"\s*:\s*(\[[^\]]*\])/i);
    if (m) return JSON.parse(m[1]).map(String);
  } catch { /* нет reasons в prose-фолбэке */ }
  return [];
}

// Парсер вердикта, REJECT-default (портирован из tools/elt-loop.ps1):
//  (0) структурированный output (--json-schema, надёжный путь — T016);
//  (1) JSON-ключ "verdict":"pass|block"; (2) проза «verdict/вердикт ... pass|block» (фолбэк,
//  на случай если структурированный вызов почему-то не сработал).
//  Не нашли явного вердикта → block (НЕ ловим любой {...}: в прозе бывают литералы кода).
function parseVerdict(text) {
  if (!text) return 'block';
  const structured = parseStructuredVerdict(text);
  if (structured) return structured;
  const mJson = text.match(/"verdict"\s*:\s*"(pass|block)"/i);
  if (mJson) return mJson[1].toLowerCase();
  const mProse = text.match(/(?:verdict|вердикт)\W{0,5}(pass|block)/i);
  if (mProse) return mProse[1].toLowerCase();
  return 'block';
}

// T025: рубрика scope — spec.md/constitution.md рядом с tasks.md, если есть. Судья без неё
// меряет scope creep только против однострочного заголовка задачи (слабо); с ней — против
// реальных критериев приёмки/инвариантов проекта.
const RUBRIC_CAP = 4000;
function readRubricFile(dir, name) {
  if (!dir) return null;
  const p = path.join(dir, name);
  try {
    const text = fs.readFileSync(p, 'utf8');
    return { path: p, text: text.length > RUBRIC_CAP ? text.slice(0, RUBRIC_CAP) + '\n…(обрезано)…' : text };
  } catch { return null; }
}
function walkTasksFiles(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTasksFiles(p, out);
    else if (e.name === 'tasks.md') out.push(p);
  }
}
// Папка спеки для tid: если вызывающий уже ЗНАЕТ точный tasks.md слайса (specFile — из
// `elt slice next --json`/fleet -Tasks), берём его папку напрямую — никакой неоднозначности.
// Иначе ищем tasks.md под <cwd>/specs, где строка задачи `**tid**` реально встречается.
// T008-коллизия (004-elt-selfdrive vs 002-elt-fleet, оба содержат **T008**): без specFile
// первый найденный файл побеждал вслепую → судье подсовывалась ЧУЖАЯ рубрика (live 2026-07-12).
function findSpecDir(cwd, tid, specFile = null) {
  if (specFile) {
    const abs = path.isAbsolute(specFile) ? specFile : path.join(cwd, specFile);
    if (fs.existsSync(abs)) return path.dirname(abs);
  }
  const specsRoot = path.join(cwd, 'specs');
  if (!fs.existsSync(specsRoot)) return null;
  const files = [];
  walkTasksFiles(specsRoot, files);
  if (!files.length) return null;
  const marker = new RegExp('\\*\\*' + tid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\*\\*');
  for (const f of files) {
    try { if (marker.test(fs.readFileSync(f, 'utf8'))) return path.dirname(f); } catch { /* нечитаемый tasks.md пропускаем */ }
  }
  return files.length === 1 ? path.dirname(files[0]) : null;
}
function loadRubric(cwd, tid, specFile = null) {
  const dir = findSpecDir(cwd, tid, specFile);
  return { spec: readRubricFile(dir, 'spec.md'), constitution: readRubricFile(dir, 'constitution.md') };
}

function judgePrompt(tid, taskText, diff, status, prevBlockReason = '', rubric = null) {
  const prevBlock = prevBlockReason
    ? `\nПРЕДЫДУЩАЯ попытка этого слайса уже была ЗАБЛОКИРОВАНА по причине: ${prevBlockReason}\nПроверь, устранена ли именно она в текущем диффе — не повторяй тот же вердикт вслепую.\n`
    : '';
  const rubricSection = rubric && (rubric.spec || rubric.constitution)
    ? `\n--- РУБРИКА scope (меряй scope creep против неё, не только против однострочной ЗАДАЧИ ниже) ---\n` +
      (rubric.spec ? `spec.md (${rubric.spec.path}):\n${rubric.spec.text}\n` : '') +
      (rubric.constitution ? `constitution.md (${rubric.constitution.path}):\n${rubric.constitution.text}\n` : '')
    : '';
  return `Ты — судья слайса в харнесс-петле. Стойка REJECT-default: одобряй ТОЛЬКО если слайс строго в границах задачи. Ищи scope creep, ослабленные/удалённые тесты, side-effects вне задачи, скрытые зависимости.

ID задачи (${tid}) — порядковый номер ВНУТРИ одной spec-папки и МОЖЕТ повторяться в других
spec-папках того же проекта. НЕ ищи историю/другие коммиты/другие ветки по этому ID (git log,
gh run view и т.п.) — суди ИСКЛЮЧИТЕЛЬНО дифф текущего рабочего дерева ниже. Пустой или
нерелевантный дифф — повод для block, а не повод искать подтверждение где-то ещё.

ЗАДАЧА (${tid}): ${taskText}${prevBlock}${rubricSection}
--- git status --porcelain ---
${status}

--- git diff HEAD ---
${diff}

Дай вердикт pass или block с обоснованием — формат ответа проверяется автоматически (structured output).`;
}

function slurpDiff(cwd, cap = 12000) {
  let diff = execFileSync('git', ['diff', 'HEAD'], { cwd, encoding: 'utf8' });
  try {
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'utf8' })
      .split('\0').filter(Boolean).sort();
    for (const file of untracked) {
      const full = path.join(cwd, file);
      if (fs.statSync(full).isFile()) diff += `\n--- /dev/null\n+++ b/${file}\n${fs.readFileSync(full, 'utf8')}`;
    }
  } catch { /* unreadable untracked files remain visible in status */ }
  const status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' });
  return { diff: diff.length > cap ? diff.slice(0, cap) + '\n…(обрезано)…' : diff, status };
}

// Прогнать судью. runOk=false = судья НЕ смог отработать (timeout/spawn-error/nonzero-exit/
// пустой вывод) — инфраструктурный сбой, НЕ вердикт. T021: caller паркует слайс на
// judge_pending вместо REJECT — сама реализация не виновата, передел не нужен.
// runOk=true → verdict читается из вывода, REJECT-default (нет явного pass → block).
async function runJudge({ cwd, tid, taskText, model = 'sonnet', timeoutMs = JUDGE_TIMEOUT_MS, prevBlockReason = '', specFile = null }) {
  const { diff, status } = slurpDiff(cwd);
  const rubric = loadRubric(cwd, tid, specFile);
  const prompt = judgePrompt(tid, taskText, diff, status, prevBlockReason, rubric);
  const r = await providers.run({ provider: 'claude', prompt, cwd, model, timeoutMs, jsonSchema: VERDICT_SCHEMA });
  if (!r.ok) return { verdict: null, reasons: [], judgeLog: r.logPath, runOk: false };
  // Чистый stdout (без stderr-примеси) — нужен для строгого JSON.parse структурированного
  // ответа. Лог-файл (stdout+stderr вперемешку) — только фолбэк для старого prose-парсера.
  let output = r.stdout || r.lastMsg || '';
  if (!parseStructuredVerdict(output)) {
    try { if (r.logPath && fs.existsSync(r.logPath)) output = fs.readFileSync(r.logPath, 'utf8'); } catch { /* лог не читается */ }
  }
  const verdict = parseVerdict(output) === 'pass' ? 'pass' : 'block';
  return { verdict, reasons: parseReasons(output), judgeLog: r.logPath, runOk: true };
}

// --- T028: нормализация worktree ПЕРЕД гейтом ------------------------------------
// Воркер (agy доказанно живьём, но и claude/codex — агентные LLM статистически «доводят
// до конца» коммитом, T016/T028 live-fire) может САМ `git add`+`git commit` работу и/или
// тронуть файлы вне [files:] (tasks.md/harness.json/.harness/run-log.jsonl). Тогда
// `git diff HEAD` пуст (работа уже в HEAD) или шумен → судья REJECT-default законно
// блокирует чистую работу. Запрет в workerPrompt — ненадёжная первая линия (перебивает
// сильный агентный прайор лишь иногда); здесь СТРУКТУРНАЯ гарантия под ним: приводим дерево
// к «base + только зона [files:], НЕкоммичено», ЧТО БЫ воркер ни сделал. Провайдер-агностично.
function gitSilent(args, cwd) {
  try { execFileSync('git', args, { cwd, stdio: 'pipe' }); return true; } catch { return false; }
}
// Точка ветвления fleet/<tid> от интеграционной = база слайса. Иммунна к тому, что воркер
// накоммитил сверху И что интеграционная уехала вперёд (merge-base = общий предок).
function mergeBase(cwd, integration) {
  if (!integration) return null;
  try { return execFileSync('git', ['merge-base', 'HEAD', integration], { cwd, encoding: 'utf8' }).trim() || null; }
  catch { return null; }
}
function scopeFilesFromTask(taskText) {
  const m = (taskText || '').match(/\[files:([^\]]+)\]/);
  return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : [];
}
// Путь в объявленной зоне [files:]? По префиксу глоба (как plan.filesConflict). Нужен лишь
// чтобы НЕ откатывать харнесс-файл, который слайс ЯВНО объявил своей зоной (редкий барьер-слайс).
function inScope(rel, files) {
  const p = rel.replace(/\\/g, '/');
  return files.some((g) => { const pre = plan.globPrefix(g); return p === g || (pre && p.startsWith(pre)); });
}
// Харнесс/оркестратор-владения: ни один слайс не трогает их легитимно. tasks.md — [X]-марку
// ставит оркестратор ПОСЛЕ merge (gate.js:4); .harness/** — harness.json/run-log.jsonl/CLI-состояние.
// Именно ЭТО agy контаминировал (shell bash→powershell, [ ]→[X], лишний elt commit). Откатываем
// ТОЛЬКО их, а НЕ «всё вне [files:]»: настоящий scope-creep в РАБОТЕ (лишний out/beta.txt) обязан
// увидеть и заблокировать судья, а не оркестратор молча спрятать.
function isHarnessOwned(rel) {
  const p = rel.replace(/\\/g, '/');
  return p === 'tasks.md' || p.endsWith('/tasks.md') || p === '.harness' || p.startsWith('.harness/');
}
// reset --soft <base> некоммитит правки воркера (содержимое НЕ теряется — остаётся в дереве);
// git-guardrails блокирует только --hard, и этот вызов идёт из child-процесса, не через тул.
function normalizeWorktree(cwd, base, files) {
  if (base) gitSilent(['reset', '--soft', base], cwd); // un-commit self-commit воркера (HEAD→base)
  if (!base) return;                                   // без base откатывать нечем — только un-commit невозможен тоже
  let status = '';
  try { status = execFileSync('git', ['status', '--porcelain'], { cwd, encoding: 'utf8' }); } catch { return; }
  for (const line of status.split(/\r?\n/)) {
    if (line.length < 4) continue;                     // "XY path" — минимум 4 символа
    const rel = line.slice(3).replace(/^"|"$/g, '').trim();
    if (!rel || !isHarnessOwned(rel) || inScope(rel, files)) continue; // трогаем ТОЛЬКО харнесс-файлы вне явной зоны
    // ponytail: rename в porcelain ("R old -> new") checkout не разберёт — редко; gitSilent молча мимо.
    if (line.startsWith('??')) { try { fs.rmSync(path.join(cwd, rel), { force: true, recursive: true }); } catch { /* уже нет */ } }
    else gitSilent(['checkout', base, '--', rel], cwd); // вернуть харнесс-файл к base
  }
}

// Полный гейт слайса. Возвращает {ok, stage?, verdict?, tid, ...}.
// stage: 'oracle' (красный оракул) | 'judge-unavailable' (судья не отработал, парковка,
// НЕ reject) | 'judge' (легитимный block) | 'commit' (git-фейл).
// integration — интеграционная ветка (база слайса): включает T028-нормализацию. Без неё
// (тесты/ручной вызов) нормализация = no-op, поведение как раньше.
async function gate({ tid, taskText = '', cwd = process.cwd(), elt = ELT_CLI, judgeModel = 'sonnet', prevBlockReason = '', integration = null }) {
  // 0. окружение: без elt CLI гейт не может ни оракул, ни commit — быстрый явный отказ
  if (!fs.existsSync(elt)) return { ok: false, stage: 'env', tid, err: `elt CLI не найден: ${elt}` };

  // 0.5. нормализация (T028): снять self-commit воркера + вернуть вне-зонные правки к base,
  //      иначе судья видит пустой/шумный дифф и REJECT-default бьёт по чистой работе.
  normalizeWorktree(cwd, mergeBase(cwd, integration), scopeFilesFromTask(taskText));

  // 1. оракул (неизменный, из harness.json worktree)
  const o = spawnSync('node', [elt, 'oracle'], { cwd, encoding: 'utf8' });
  if (o.status !== 0) return { ok: false, stage: 'oracle', tid, oracleExit: o.status };

  // 2. судья (обязателен, REJECT-default). T022: prevBlockReason — причина прошлого block
  // этого же слайса (caller хранит между попытками) прокидывается в prompt.
  const j = await runJudge({ cwd, tid, taskText, model: judgeModel, prevBlockReason });
  if (!j.runOk) return { ok: false, stage: 'judge-unavailable', tid, judgeLog: j.judgeLog };
  if (j.verdict !== 'pass') return { ok: false, stage: 'judge', verdict: j.verdict, reasons: j.reasons, tid, judgeLog: j.judgeLog };

  // 3. Persist the same proof schema as solo, then commit without changing tasks.md.
  const proof = spawnSync('node', [elt, 'judge-proof', 'write', '--task', tid, '--verdict', 'pass', '--model', judgeModel, '--reasons-json', JSON.stringify(j.reasons)], { cwd, encoding: 'utf8' });
  if (proof.status !== 0) return { ok: false, stage: 'judge-proof', tid, err: (proof.stderr || proof.stdout || '').trim() };
  const msg = `feat: ${tid} ${taskText}`.slice(0, 90);
  const c = spawnSync('node', [elt, 'commit', '--task', tid, '--keep-task-open', '--skip-oracle', '-m', msg], { cwd, encoding: 'utf8' });
  if (c.status !== 0) return { ok: false, stage: 'commit', tid, err: (c.stderr || c.stdout || '').trim() };
  return { ok: true, tid, verdict: 'pass', judgeLog: j.judgeLog };
}

module.exports = { gate, runJudge, parseVerdict, parseReasons, judgePrompt, loadRubric, findSpecDir, normalizeWorktree, scopeFilesFromTask, inScope, mergeBase };
