'use strict';
// gate.js — гейт слайса ВНУТРИ worktree (T007). Неизменный харнесс-контур:
//   elt oracle → судья (claude -p --model sonnet, REJECT-default) → elt commit.
// Коммит БЕЗ [X]-марка (no --task): пометку в tasks.md ставит оркестратор на
// интеграционной ветке ПОСЛЕ merge (T008), иначе tasks.md конфликтует при merge.
// Судья гоняется через providers.run (claude), парсер вердикта портирован из elt-loop.ps1.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const providers = require('./providers');
const exec = require('./exec');
const plan = require('./plan');
const { verifySettings } = require('../elt-config');

const ELT_CLI = path.join(os.homedir(), '.claude', 'bin', 'elt.js');
const JUDGE_TIMEOUT_MS = 5 * 60 * 1000;

// Схема для --json-schema: судья зовётся через structured output (T016 live-fire —
// prose-парсер регулярно мимо: модель пишет "принято"/"зачёт" вместо литерального pass/block,
// REJECT-default тогда блокирует легитимные слайсы). claude -p --output-format json оборачивает
// весь транскрипт в JSON-массив; последний элемент (type:"result") несёт structured_output.
// filesReviewed (008 T001): граундинг-чек сверяет его с реальным списком файлов диффа —
// назвал файл не из диффа → галлюцинация, пропустил файл диффа → судил не весь слайс.
const VERDICT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'block'] },
    reasons: { type: 'array', items: { type: 'string' } },
    filesReviewed: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'reasons', 'filesReviewed'],
});

// Структурированный путь: последний элемент JSON-массива --output-format json → structured_output.
// filesReviewed: null, если поле в ответе вообще отсутствует (старый провайдер/стаб без
// схемы) — отличаем от намеренно пустого массива, чтобы граундинг-чек мог не сработать
// вместо ложного block на проводке, которая ещё не знает про поле.
function parseStructuredOutput(text) {
  try {
    const arr = JSON.parse(text);
    const last = Array.isArray(arr) ? arr[arr.length - 1] : arr;
    const so = last && last.structured_output;
    const v = so && so.verdict;
    if (v !== 'pass' && v !== 'block') return null;
    return {
      verdict: v,
      reasons: Array.isArray(so.reasons) ? so.reasons.map(String) : [],
      filesReviewed: Array.isArray(so.filesReviewed) ? so.filesReviewed.map(String) : null,
    };
  } catch { return null; }
}
function parseStructuredVerdict(text) {
  const so = parseStructuredOutput(text);
  return so ? so.verdict : null;
}
// ПОСЛЕДНЕЕ совпадение, не первое (баг 2026-07-22, judge-bench): `codex exec` эхает весь
// промпт в свой stdout/лог, а промпт содержит и строку-инструкцию {"verdict":"pass",…}, и
// сам дифф (где легко встречается `return 'pass'`). Парсер брал ПЕРВОЕ вхождение → читал
// эхо инструкции вместо ответа модели → codex-судья давал recall 0/7: правильный `block`
// с точным обоснованием превращался в `pass`. Тихая дыра в гейте, а не «плохая модель».
// Ответ модели всегда в КОНЦЕ вывода — значит и читать надо последнее совпадение.
function lastMatch(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m, last = null;
  while ((m = g.exec(text)) !== null) last = m;
  return last;
}

// Ответ судьи без --json-schema приходит одной JSON-строкой в хвосте прозы. Читаем её целиком
// (последняя строка вида {...} с "verdict"), а не регексом по полю: regex `\[[^\]]*\]` обрывался
// на ПЕРВОЙ `]` внутри строки reason — судья, обосновавший вердикт текстом со скобками
// («[L]->max, [S]/[M]->high»), отдавал reasons:[] и получал безусловный `grounding:no-reasons`.
// Живой ложный block, дважды подряд, 2026-07-27, слайс 009 T006.
function parseJsonTail(text) {
  if (!text) return null;
  const lines = String(text).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i].trim();
    if (!s.startsWith('{') || !s.endsWith('}') || !s.includes('"verdict"')) continue;
    try {
      const o = JSON.parse(s);
      if (o && typeof o === 'object') return o;
    } catch { /* не JSON — идём дальше вверх */ }
  }
  return null;
}

// T022: причина block читается для проброса в prompt следующей попытки этого же слайса.
function parseReasons(text) {
  const so = parseStructuredOutput(text);
  if (so) return so.reasons;
  const tail = parseJsonTail(text);
  if (tail && Array.isArray(tail.reasons)) return tail.reasons.map(String);
  try {
    const m = lastMatch(text, /"reasons"\s*:\s*(\[[^\]]*\])/i);
    if (m) return JSON.parse(m[1]).map(String);
  } catch { /* нет reasons в prose-фолбэке */ }
  return [];
}
// filesReviewed: null = поле в ответе отсутствует вовсе (провайдер не поддерживает граундинг —
// граундинг-чек по файлам тогда пропускается), [] = судья явно заявил «не разобрал ни файла».
function parseFilesReviewed(text) {
  const so = parseStructuredOutput(text);
  if (so) return so.filesReviewed;
  const tail = parseJsonTail(text);
  if (tail && Array.isArray(tail.filesReviewed)) return tail.filesReviewed.map(String);
  try {
    const m = lastMatch(text, /"filesReviewed"\s*:\s*(\[[^\]]*\])/i);
    if (m) return JSON.parse(m[1]).map(String);
  } catch { /* нет filesReviewed в prose-фолбэке */ }
  return null;
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
  const mJson = lastMatch(text, /"verdict"\s*:\s*"(pass|block)"/i);
  if (mJson) return mJson[1].toLowerCase();
  const mProse = lastMatch(text, /(?:verdict|вердикт)\W{0,5}(pass|block)/i);
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

// 008 T001: полный список файлов диффа из `git status --porcelain` — НЕ зависит от cap
// диффа (риск спеки: обрезанный дифф не даёт судье физически перечислить хвост). Разбор
// porcelain-строки: 2-символьный код + пробел + путь; переименование "R  old -> new" берём
// как новый путь (это и есть файл диффа после переименования).
function diffFileList(status) {
  const files = [];
  for (const line of (status || '').split(/\r?\n/)) {
    if (line.length < 4) continue;
    let rel = line.slice(3).replace(/^"|"$/g, '').trim();
    if (!rel) continue;
    const arrow = rel.indexOf(' -> ');
    if (arrow !== -1) rel = rel.slice(arrow + 4).trim();
    files.push(rel.replace(/\\/g, '/'));
  }
  return files;
}
// Grounding-чек (008 T001): filesReviewed===null → провайдер вообще не знает про поле
// (старый стаб/провайдер без схемы, напр. существующие тесты gate.test.js/fleet.test.js,
// где стаб — литерал `{"verdict":"pass"}` без reasons) — весь чек молчит целиком, и
// file-проверки, и no-reasons: нет сигнала о новом контракте вообще, значит нечего сверять.
// filesReviewed присутствует (даже пустым массивом) — судья ЗНАЕТ о контракте, тогда
// действуют все три отказа: назвал файл не из диффа → phantom-file; пропустил файл диффа →
// unreviewed-file; пустой reasons → no-reasons.
// 009 T001: omitted — файлы диффа, которые в промпт судьи НЕ попали (бюджет исчерпан).
// Спрашивать за них filesReviewed нельзя: судья физически их не видел, и старое правило
// «пропустил файл диффа → unreviewed-file» превращало обрезку в ложный block (аудит 24.07:
// диффы 67K/66K/44K при cap 12K — судья мог только соврать или быть заблокирован).
function checkGrounding(status, filesReviewed, reasons, cwd = process.cwd(), omitted = []) {
  // no-reasons — БЕЗУСЛОВНО, до и независимо от filesReviewed. Прятать его за наличием
  // поля значило бы оставить открытым ровно мотивирующий баг спеки (7f8183b: `pass` с
  // reasons:[] прошёл гейт): провайдер без structured output (codex/agy отвечают
  // JSON-хвостом и инструкции следуют не всегда) просто не вернул бы filesReviewed — и
  // весь чек замолчал бы целиком. Вердикт без причины не проводится никогда.
  if (!reasons || !reasons.length) return 'grounding:no-reasons';
  // Файловые проверки — только когда судья сообщил filesReviewed. null = провайдер не
  // знает про контракт (легаси-стаб/старая схема), сверять нечего.
  if (filesReviewed === null) return null;
  const diffSet = new Set(diffFileList(status));
  const reviewed = filesReviewed.map((f) => String(f).replace(/\\/g, '/'));
  // Фантом = путь, которого НЕ существует: только это галлюцинация. «Не в диффе» — не
  // критерий: судье целиком показывают рубрику (spec.md/constitution.md), он читает
  // tasks.md, и честное упоминание этих файлов в filesReviewed — не выдумка. Живой блок
  // T001 2026-07-22: судья дал pass, перечислил 3 файла диффа + spec.md/tasks.md рубрики
  // и получил phantom-file — ложное срабатывание на добросовестном ответе.
  for (const f of reviewed) if (!diffSet.has(f) && !fs.existsSync(path.resolve(cwd, f))) return 'grounding:phantom-file';
  const reviewedSet = new Set(reviewed);
  const notShown = new Set(omitted.map((f) => String(f).replace(/\\/g, '/')));
  for (const f of diffSet) if (!reviewedSet.has(f) && !notShown.has(f)) return 'grounding:unreviewed-file';
  return null;
}

function judgePrompt(tid, taskText, diff, status, prevBlockReason = '', rubric = null, externalDiffs = [], omitted = []) {
  const files = diffFileList(status);
  const filesSection = files.length ? files.join('\n') : '(нет изменённых файлов)';
  // 009 T001: честная пометка «не показано» вместо молчаливой обрезки. Судья бежит в cwd
  // слайса — он МОЖЕТ дочитать такой файл с диска, но обязан не выдумывать за него.
  const omittedSection = omitted.length
    ? `\n--- НЕ ПОКАЗАНЫ (файлы диффа, не вместившиеся в бюджет промпта) ---\n${omitted.join('\n')}\n` +
      `Эти файлы в дифф выше НЕ вошли. filesReviewed за них не спрашивается; если они важны\n` +
      `для вердикта — прочитай их с диска сам, иначе прямо скажи в reasons, что судил без них.\n`
    : '';
  const prevBlock = prevBlockReason
    ? `\nПРЕДЫДУЩАЯ попытка этого слайса уже была ЗАБЛОКИРОВАНА по причине: ${prevBlockReason}\nПроверь, устранена ли именно она в текущем диффе — не повторяй тот же вердикт вслепую.\n`
    : '';
  const rubricSection = rubric && (rubric.spec || rubric.constitution)
    ? `\n--- РУБРИКА scope (меряй scope creep против неё, не только против однострочной ЗАДАЧИ ниже) ---\n` +
      (rubric.spec ? `spec.md (${rubric.spec.path}):\n${rubric.spec.text}\n` : '') +
      (rubric.constitution ? `constitution.md (${rubric.constitution.path}):\n${rubric.constitution.text}\n` : '')
    : '';
  const externalSection = externalDiffs.length
    ? externalDiffs.map((e) =>
        `\n--- ВНЕШНИЙ РЕПО ${e.root} (вне worktree слайса, но в зоне [files:]) — git status --porcelain ---\n${e.status}\n` +
        `--- ВНЕШНИЙ РЕПО ${e.root} — git diff HEAD ---\n${e.diff}\n` +
        (e.omitted && e.omitted.length ? `--- ВНЕШНИЙ РЕПО ${e.root} — НЕ ПОКАЗАНЫ ---\n${e.omitted.join('\n')}\n` : '')).join('') +
      `\nЗона [files:] может указывать на путь ВНЕ этого репо (отдельный git, напр. \`~/.claude\`) — секции\n` +
      `«ВНЕШНИЙ РЕПО» выше — реальная работа слайса, суди по НИМ ТОЖЕ, не только по диффу текущего репо;\n` +
      `пустой дифф текущего репо при непустом внешнем — это НЕ повод для block.\n`
    : '';
  return `Ты — судья слайса в харнесс-петле. Стойка REJECT-default: одобряй ТОЛЬКО если слайс строго в границах задачи. Ищи scope creep, ослабленные/удалённые тесты, side-effects вне задачи, скрытые зависимости.

Отдельно проверь ДОКАЗАТЕЛЬНОСТЬ тестов слайса (2026-07-22: оракул зелёный ровно настолько,
насколько честны его тесты). Тест не считается доказательством, если он мокает/подменяет
ровно ту логику, которую должен проверять, или ассертит на сам мок — такой тест не упадёт
при поломке кода. Если задача требовала теста, а появился только такой — это block с
указанием, какой отказ остался непокрытым. Судить по диффу, а не по названиям тестов.

Дифф может закрывать НЕСКОЛЬКО задач (батч: "ID задачи" ниже — список через запятую).
Тогда суди каждую отдельно и дай pass ТОЛЬКО если в границах КАЖДОЙ; всё, что не относится
ни к одной из них, — scope creep.

ID задачи (${tid}) — порядковый номер ВНУТРИ одной spec-папки и МОЖЕТ повторяться в других
spec-папках того же проекта. НЕ ищи историю/другие коммиты/другие ветки по этому ID (git log,
gh run view и т.п.) — суди ИСКЛЮЧИТЕЛЬНО дифф текущего рабочего дерева ниже. Пустой или
нерелевантный дифф — повод для block, а не повод искать подтверждение где-то ещё.

ЗАДАЧА (${tid}): ${taskText}${prevBlock}${rubricSection}
--- git status --porcelain ---
${status}

--- ФАЙЛЫ ДИФФА (полный список, не зависит от обрезки диффа ниже) ---
${filesSection}

--- git diff HEAD (пофайлово; обрезанные файлы помечены явно) ---
${diff}
${omittedSection}${externalSection}
Верни filesReviewed — список ВСЕХ ${omitted.length ? 'ПОКАЗАННЫХ' : ''} путей из секции «ФАЙЛЫ ДИФФА» выше${omitted.length ? ' (кроме перечисленных в «НЕ ПОКАЗАНЫ»)' : ''}, которые ты
реально разобрал (тем же написанием пути); не называй файл, которого там нет, и не пропускай
ни одного — это сверяется кодом, не читается на веру. reasons не может быть пустым ни при
каком вердикте.

Дай вердикт pass или block с обоснованием — формат ответа проверяется автоматически (structured output).`;
}

// 009 T001: слепая обрезка `diff.slice(0, cap)` рубила хвост файлов целиком и молча —
// судья не знал ни что обрезано, ни что вообще существовало. Режем ПОФАЙЛОВО: каждый файл
// получает свою долю бюджета с явной пометкой обрезки, невместившиеся уходят в отдельный
// список «НЕ ПОКАЗАНЫ» (и не спрашиваются грандингом, см. checkGrounding).
function splitDiffSections(diff) {
  if (!diff || !diff.trim()) return [];
  return diff.split(/(?=^diff --git )/m).filter((s) => s.trim()).map((text) => {
    const m = text.match(/^diff --git a\/(.*?) b\/(.*)$/m);
    return { file: (m ? m[2] : '(файл не распознан)').trim().replace(/\\/g, '/'), text };
  });
}
const TEST_FILE_RE = /(^|\/)(tests?|spec)\/|\.(test|spec)\.[a-z]+$|_test\.[a-z]+$/i;
// Приоритет бюджета: тесты (главный носитель доказательства слайса) → файлы объявленной
// зоны [files:] → остальное. Внутри группы — по возрастанию размера: маленькие файлы
// вмещаются целиком и дёшево, огромный не съедает бюджет соседей.
function prioritize(sections, zoneFiles = []) {
  const zone = new Set(zoneFiles.map((f) => String(f).replace(/\\/g, '/')));
  const rank = (s) => (TEST_FILE_RE.test(s.file) ? 0 : zone.has(s.file) ? 1 : 2);
  return [...sections].sort((a, b) => rank(a) - rank(b) || a.text.length - b.text.length);
}
const MIN_FILE_BUDGET = 400; // меньше — показывать бессмысленно, честнее объявить «не показан»
function budgetDiff(sections, cap = 12000, zoneFiles = []) {
  const ordered = prioritize(sections, zoneFiles);
  const perFile = Math.max(MIN_FILE_BUDGET, Math.floor(cap / Math.max(1, ordered.length)));
  const shown = [];
  const omitted = [];
  let left = cap;
  for (const s of ordered) {
    const allow = Math.min(perFile, left);
    if (allow < MIN_FILE_BUDGET && s.text.length > allow) { omitted.push(s.file); continue; }
    if (s.text.length > allow) {
      shown.push(`${s.text.slice(0, allow)}\n…(файл обрезан: показано ${allow} из ${s.text.length} символов)…`);
      left -= allow;
    } else {
      shown.push(s.text);
      left -= s.text.length;
    }
  }
  return { diff: shown.join('\n'), omitted };
}
// pathspec (009 T014): ограничить дифф перечисленными путями. Нужен для ВНЕШНЕГО репо:
// `~/.claude` — общий репо пользователя, и показывать судье его целиком значит вменять слайсу
// чужие правки (живой ложный block T003 2026-07-24: settings.json/plans/**/projects-registry).
function slurpDiff(cwd, cap = 12000, zoneFiles = [], pathspec = null) {
  const scope = pathspec && pathspec.length ? ['--', ...pathspec] : [];
  const tracked = execFileSync('git', ['diff', 'HEAD', ...scope], { cwd, encoding: 'utf8' });
  const sections = splitDiffSections(tracked);
  try {
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z', ...scope], { cwd, encoding: 'utf8' })
      .split('\0').filter(Boolean).sort();
    for (const file of untracked) {
      const full = path.join(cwd, file);
      if (fs.statSync(full).isFile()) {
        sections.push({ file: file.replace(/\\/g, '/'), text: `diff --git a/${file} b/${file}\n--- /dev/null\n+++ b/${file}\n${fs.readFileSync(full, 'utf8')}` });
      }
    }
  } catch { /* unreadable untracked files remain visible in status */ }
  const status = execFileSync('git', ['status', '--porcelain', ...scope], { cwd, encoding: 'utf8' });
  return { ...budgetDiff(sections, cap, zoneFiles), status };
}

// Межрепо-слепота (006 T007 blocker): `[files:]` слайса может указывать на путь ВНЕ репо
// worktree'а (напр. `~/.claude/skills/x/SKILL.md`, отдельный git от Pipeline Setupper) — тогда
// `slurpDiff(cwd)` видит пустой/нерелевантный дифф и судья REJECT-default бьёт по реальной
// работе. Находим git-корень каждого файла зоны; если он не совпадает с корнем cwd — это
// внешний репо, чей дифф нужно тоже показать судье.
function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1).replace(/^[\\/]/, '')) : p;
}
function gitRoot(dir) {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' }).trim().replace(/\//g, path.sep); }
  catch { return null; }
}
// 009 T014: возвращаем не только корни, но и ЗОНУ внутри каждого — внешний репо
// показывается судье только по объявленным файлам, а не целиком.
function externalRepoScopes(cwd, files) {
  const cwdRoot = gitRoot(cwd);
  const byRoot = new Map();
  for (const f of files) {
    const abs = expandHome(f);
    if (!path.isAbsolute(abs)) continue; // относительный путь = зона внутри cwd-репо
    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) continue;
    const root = gitRoot(dir);
    if (!root || root === cwdRoot) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(rel);
  }
  return [...byRoot].map(([root, paths]) => ({ root, paths }));
}
function externalRepoRoots(cwd, files) {
  return externalRepoScopes(cwd, files).map((s) => s.root);
}
function slurpExternalDiffs(cwd, files) {
  return externalRepoScopes(cwd, files).map(({ root, paths }) => ({ root, ...slurpDiff(root, 12000, paths, paths) }));
}

// Судья по ГОТОВОМУ диффу (без git-чтения) — общий путь для runJudge и judge-bench:
// бенч обязан мерить ТУ ЖЕ функцию, что работает в проде, иначе меряет фикцию.
// provider: только claude умеет --json-schema (структурированный вывод, T016). codex/agy
// эквивалента не имеют → требуем JSON последней строкой и читаем prose-парсером; стойка
// REJECT-default та же (нет явного pass → block), так что кривой ответ безопасен.
const JSON_TAIL_INSTRUCTION = '\n\nОТВЕТ: последней строкой выведи РОВНО один JSON без обрамления:\n{"verdict":"pass","reasons":["…"],"filesReviewed":["path/a.js"]}  или  {"verdict":"block","reasons":["…"],"filesReviewed":["path/a.js"]}';
async function judgeDiff({ cwd = process.cwd(), tid, taskText, diff, status, provider = 'claude', model = 'sonnet', timeoutMs = JUDGE_TIMEOUT_MS, prevBlockReason = '', rubric = null, externalDiffs = [], omitted = [] }) {
  const structured = provider === 'claude';
  const prompt = judgePrompt(tid, taskText, diff, status, prevBlockReason, rubric, externalDiffs, omitted)
    + (structured ? '' : JSON_TAIL_INSTRUCTION);
  const started = Date.now();
  const r = await providers.run({ provider, prompt, cwd, model, timeoutMs, jsonSchema: structured ? VERDICT_SCHEMA : null });
  const durationSec = (Date.now() - started) / 1000;
  if (!r.ok) return { verdict: null, reasons: [], judgeLog: r.logPath, runOk: false, durationSec, reason: r.reason };
  // Чистый stdout (без stderr-примеси) — нужен для строгого JSON.parse структурированного
  // ответа. Лог-файл (stdout+stderr вперемешку) — только фолбэк для старого prose-парсера.
  let output = r.stdout || r.lastMsg || '';
  if (!parseStructuredVerdict(output)) {
    try { if (r.logPath && fs.existsSync(r.logPath)) output = fs.readFileSync(r.logPath, 'utf8'); } catch { /* лог не читается */ }
  }
  const verdict = parseVerdict(output) === 'pass' ? 'pass' : 'block';
  const reasons = parseReasons(output);
  const filesReviewed = parseFilesReviewed(output);
  // 008 T001: grounding — механическая сверка filesReviewed с реальным списком файлов диффа.
  // Любой отказ граундинга форсирует block независимо от того, что сказала модель, — это и
  // есть смысл проверки («судья сказал pass» ≠ «судья реально смотрел дифф»).
  const groundingReason = checkGrounding(status, filesReviewed, reasons, cwd, omitted);
  return {
    verdict: groundingReason ? 'block' : verdict,
    reasons: groundingReason ? [...reasons, groundingReason] : reasons,
    filesReviewed: filesReviewed || [],
    judgeLog: r.logPath, runOk: true, durationSec,
  };
}

// Прогнать судью. runOk=false = судья НЕ смог отработать (timeout/spawn-error/nonzero-exit/
// пустой вывод) — инфраструктурный сбой, НЕ вердикт. T021: caller паркует слайс на
// judge_pending вместо REJECT — сама реализация не виновата, передел не нужен.
// runOk=true → verdict читается из вывода, REJECT-default (нет явного pass → block).
//
// 008 T002: двойной судья (verify-on-pass). `harness.json.judge.verify = {provider, model}`
// (elt-config.verifySettings) — второй судья, подтверждающий `pass` первого тем же диффом
// (чистый контекст: свежий judgeDiff-вызов, не разговор с первым). Не задан — старое
// однопроходное поведение (крит. 7, обратная совместимость). block первого второго НЕ зовёт
// (крит. 4 — цена платится только на pass). Итог: block, если любой block; если второй
// runOk=false — итоговый runOk=false тоже (переиспользуем существующий judge-dead/парковка
// путь для мёртвого первичного, T021 — downstream (gate/judge-invoke) уже умеет его парковать
// без изменений). judges[] — оба вердикта/модели/время, для будущей proof-проводки (T004).
async function runJudge({ cwd, tid, taskText, provider = 'claude', model = 'sonnet', timeoutMs = JUDGE_TIMEOUT_MS, prevBlockReason = '', specFile = null }) {
  const zoneFiles = scopeFilesFromTask(taskText);
  const { diff, status, omitted } = slurpDiff(cwd, undefined, zoneFiles);
  const rubric = loadRubric(cwd, tid, specFile);
  const externalDiffs = slurpExternalDiffs(cwd, zoneFiles);
  const commonArgs = { cwd, tid, taskText, diff, status, timeoutMs, prevBlockReason, rubric, externalDiffs, omitted };

  const primary = await judgeDiff({ ...commonArgs, provider, model });
  const verify = verifySettings(cwd);
  if (!verify) return primary;

  const primaryEntry = { provider, model, verdict: primary.verdict, reasons: primary.reasons, durationSec: primary.durationSec, runOk: primary.runOk };
  if (!primary.runOk || primary.verdict !== 'pass') return { ...primary, judges: [primaryEntry] };

  const secondary = await judgeDiff({ ...commonArgs, provider: verify.provider, model: verify.model });
  const secondaryEntry = { provider: verify.provider, model: verify.model, verdict: secondary.verdict, reasons: secondary.reasons, durationSec: secondary.durationSec, runOk: secondary.runOk };
  const judges = [primaryEntry, secondaryEntry];
  if (!secondary.runOk) return { verdict: null, reasons: [], filesReviewed: primary.filesReviewed, judgeLog: secondary.judgeLog, runOk: false, judges };

  const verdict = secondary.verdict === 'pass' ? 'pass' : 'block';
  return {
    verdict,
    reasons: verdict === 'pass' ? primary.reasons : [...primary.reasons, ...secondary.reasons],
    filesReviewed: primary.filesReviewed,
    judgeLog: primary.judgeLog,
    runOk: true,
    durationSec: primary.durationSec + secondary.durationSec,
    judges,
  };
}

// --- T028: нормализация worktree ПЕРЕД гейтом ------------------------------------
// Воркер (agy доказанно живьём, но и claude/codex — агентные LLM статистически «доводят
// до конца» коммитом, T016/T028 live-fire) может САМ `git add`+`git commit` работу и/или
// тронуть файлы вне [files:] (tasks.md/harness.json/.harness/**). Тогда
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
// ставит оркестратор ПОСЛЕ merge (gate.js:4); .harness/** — config/loop logs/CLI-состояние.
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
async function gate({ tid, taskText = '', cwd = process.cwd(), elt = ELT_CLI, judgeProvider = 'claude', judgeModel = 'sonnet', prevBlockReason = '', integration = null }) {
  // 0. окружение: без elt CLI гейт не может ни оракул, ни commit — быстрый явный отказ
  if (!fs.existsSync(elt)) return { ok: false, stage: 'env', tid, err: `elt CLI не найден: ${elt}` };

  // 0.5. нормализация (T028): снять self-commit воркера + вернуть вне-зонные правки к base,
  //      иначе судья видит пустой/шумный дифф и REJECT-default бьёт по чистой работе.
  normalizeWorktree(cwd, mergeBase(cwd, integration), scopeFilesFromTask(taskText));

  // 1. оракул (неизменный, из harness.json worktree). exec.run, НЕ spawnSync: оракул —
  // самый долгий шаг гейта (~96с), и синхронный вызов вешал event loop всего оркестратора
  // (таймеры воркеров, поллинг STOP, close-события соседних слайсов) — см. exec.js.
  const o = await exec.run('node', [elt, 'oracle'], { cwd });
  if (o.status !== 0) return { ok: false, stage: 'oracle', tid, oracleExit: o.status };

  // 2. судья (обязателен, REJECT-default). T022: prevBlockReason — причина прошлого block
  // этого же слайса (caller хранит между попытками) прокидывается в prompt.
  const j = await runJudge({ cwd, tid, taskText, provider: judgeProvider, model: judgeModel, prevBlockReason });
  if (!j.runOk) return { ok: false, stage: 'judge-unavailable', tid, judgeLog: j.judgeLog };
  if (j.verdict !== 'pass') return { ok: false, stage: 'judge', verdict: j.verdict, reasons: j.reasons, tid, judgeLog: j.judgeLog };

  // 3. Persist the same proof schema as solo, then commit without changing tasks.md.
  const proof = await exec.run('node', [elt, 'judge-proof', 'write', '--task', tid, '--verdict', 'pass', '--model', judgeModel, '--reasons-json', JSON.stringify(j.reasons)], { cwd });
  if (proof.status !== 0) return { ok: false, stage: 'judge-proof', tid, err: (proof.stderr || proof.stdout || '').trim() };
  const msg = `feat: ${tid} ${taskText}`.slice(0, 90);
  const c = await exec.run('node', [elt, 'commit', '--task', tid, '--keep-task-open', '--skip-oracle', '-m', msg], { cwd });
  if (c.status !== 0) return { ok: false, stage: 'commit', tid, err: (c.stderr || c.stdout || '').trim() };
  return { ok: true, tid, verdict: 'pass', judgeLog: j.judgeLog };
}

module.exports = { gate, runJudge, judgeDiff, parseVerdict, parseReasons, parseFilesReviewed, diffFileList, checkGrounding, judgePrompt, loadRubric, findSpecDir, normalizeWorktree, scopeFilesFromTask, inScope, mergeBase, externalRepoRoots, slurpExternalDiffs, slurpDiff, splitDiffSections, budgetDiff };
