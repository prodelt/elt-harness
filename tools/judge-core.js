'use strict';
// gate.js — гейт слайса ВНУТРИ worktree (T007). Неизменный харнесс-контур:
//   elt oracle → судья (claude -p --model sonnet, REJECT-default) → elt commit.
// Коммит БЕЗ [X]-марка (no --task): пометку в tasks.md ставит оркестратор на
// интеграционной ветке ПОСЛЕ merge (T008), иначе tasks.md конфликтует при merge.
// Судья гоняется через providers.run (claude), парсер вердикта портирован из PowerShell-драйвер (снят 019/T007).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const providers = require('./providers');
const exec = require('./exec');
const plan = require('./judge-plan');
const router = require('./judge-router');
const { redProof, applyRedProof } = require('./red-proof');
const { evaluate: evaluateL0, loadConfig: loadL0Config } = require('./elt-gate-l0');
const { isHarnessOwned, isIgnoredForReview, isHarnessManaged } = require('./harness-files');

// 019 T015: CLI берётся из каталога плагина, а не из deploy-копии `~/.claude/bin`.
// Копия отставала от исходника молча (D16, D18); каталог плагина отстать не может.
const ELT_CLI = path.join(__dirname, 'elt.js');
// 009 T010 (четыре замера на живом слайсе, причины у CLI РАЗНЫЕ — одной формулой не лечатся):
// codex/gpt-5.6 на крупном промпте (~60K дифф) висит — 301/301/540/300с, временем не лечится
// (для него ответ — перевыдача ниже, а не лимит). claude/sonnet на том же диффе отвечает за
// 265с: в 5 минут упирается ВПРИТЫК и на чуть большем диффе уже не успевает (302с → таймаут).
// 8 минут: живому судье хватает с запасом, зависший всё равно упрётся и уйдёт в перевыдачу.
const JUDGE_TIMEOUT_MS = 8 * 60 * 1000;

// Схема для --json-schema: судья зовётся через structured output (T016 live-fire —
// prose-парсер регулярно мимо: модель пишет "принято"/"зачёт" вместо литерального pass/block,
// REJECT-default тогда блокирует легитимные слайсы). claude -p --output-format json оборачивает
// весь транскрипт в JSON-массив; последний элемент (type:"result") несёт structured_output.
// filesReviewed (008 T001): граундинг-чек сверяет его с реальным списком файлов диффа —
// назвал файл не из диффа → галлюцинация, пропустил файл диффа → судил не весь слайс.
const VERDICT_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    // 011 T004: третий исход. Раньше судья, не уверенный в слайсе, был вынужден выбрать между
    // block (и осцилляцией: имплементатор переделывает то, что не сломано) и pass (и молчанием).
    verdict: { type: 'string', enum: ['pass', 'block', 'inconclusive'] },
    reasons: { type: 'array', items: { type: 'string' } },
    filesReviewed: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'reasons', 'filesReviewed'],
});

// 011 T004: список исходов — один источник для схемы, парсеров и проводки.
const VERDICTS = ['pass', 'block', 'inconclusive'];
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
    if (!VERDICTS.includes(v)) return null;
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

// Парсер вердикта, REJECT-default (портирован из PowerShell-драйвер (снят 019/T007)):
//  (0) структурированный output (--json-schema, надёжный путь — T016);
//  (1) JSON-ключ "verdict":"pass|block"; (2) проза «verdict/вердикт ... pass|block» (фолбэк,
//  на случай если структурированный вызов почему-то не сработал).
//  Не нашли явного вердикта → block (НЕ ловим любой {...}: в прозе бывают литералы кода).
function parseVerdict(text) {
  if (!text) return 'block';
  const structured = parseStructuredVerdict(text);
  if (structured) return structured;
  const mJson = lastMatch(text, /"verdict"\s*:\s*"(pass|block|inconclusive)"/i);
  if (mJson) return mJson[1].toLowerCase();
  const mProse = lastMatch(text, /(?:verdict|вердикт)\W{0,5}(pass|block|inconclusive)/i);
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
  // 009 T014: файлы ВНЕШНЕГО репо судья видит отдельной секцией промпта, а diffSet — только
  // текущий репо. Живой block 2026-07-29: судья честно назвал `~/.claude/bin/elt.js (external
  // repo)` и получил безусловный phantom-file. Срезаем пояснительный суффикс в скобках и
  // разворачиваем `~` перед проверкой существования. Фантом остаётся фантомом.
  const reviewed = filesReviewed.map((f) => String(f).replace(/\\/g, '/').replace(/\s*\([^)]*\)\s*$/, ''));
  // Фантом = путь, которого НЕ существует: только это галлюцинация. «Не в диффе» — не
  // критерий: судье целиком показывают рубрику (spec.md/constitution.md), он читает
  // tasks.md, и честное упоминание этих файлов в filesReviewed — не выдумка. Живой блок
  // T001 2026-07-22: судья дал pass, перечислил 3 файла диффа + spec.md/tasks.md рубрики
  // и получил phantom-file — ложное срабатывание на добросовестном ответе.
  const resolveHome = (f) => (f.startsWith('~/') ? path.join(os.homedir(), f.slice(2)) : path.resolve(cwd, f));
  for (const f of reviewed) if (!diffSet.has(f) && !fs.existsSync(resolveHome(f))) return 'grounding:phantom-file';
  const reviewedSet = new Set(reviewed);
  const notShown = new Set(omitted.map((f) => String(f).replace(/\\/g, '/')));
  for (const f of diffSet) if (!reviewedSet.has(f) && !notShown.has(f)) return 'grounding:unreviewed-file';
  return null;
}

function judgePrompt(tid, taskText, diff, status, prevBlockReason = '', rubric = null, externalDiffs = [], omitted = [], l0Triggers = []) {
  const files = diffFileList(status);
  const filesSection = files.length ? files.join('\n') : '(нет изменённых файлов)';
  // 009 T001: честная пометка «не показано» вместо молчаливой обрезки. Судья бежит в cwd
  // слайса — он МОЖЕТ дочитать такой файл с диска, но обязан не выдумывать за него.
  const omittedSection = omitted.length
    ? `\n--- НЕ ПОКАЗАНЫ (файлы диффа, не вместившиеся в бюджет промпта) ---\n${omitted.join('\n')}\n` +
      `Эти файлы в дифф выше НЕ вошли. filesReviewed за них не спрашивается; если они важны\n` +
      `для вердикта — прочитай их с диска сам, иначе прямо скажи в reasons, что судил без них.\n`
    : '';
  // 019 T001 (D19): до этой правки знание «файл принадлежит харнесу» было закодировано в
  // гейте и НЕ передавалось судье — и судья честно называл scope creep'ом `review-queue.jsonl`,
  // который пишет сам харнес после каждого слайса. Список считается из того же модуля, что
  // и зона гейта, поэтому разойтись они больше не могут.
  const ownedInDiff = String(status || '').split(/\r?\n/)
    .map((line) => line.slice(3).replace(/^"|"$/g, '').trim())
    .filter((rel) => rel && isIgnoredForReview(rel));
  const ownedSection = ownedInDiff.length
    ? `\n--- ПРИНАДЛЕЖИТ ХАРНЕСУ / СГЕНЕРИРОВАНО (не scope creep) ---\n${[...new Set(ownedInDiff)].join(', ')}\n`
      + 'Эти файлы пишет сам харнес (марка задачи, состояние прогонов, очередь разбора) или генератор\n'
      + '(lock-файлы, кеши). Слайс их не выбирал. НЕ выноси по ним вердикт и не считай их выходом\n'
      + 'за границы задачи; суди только остальное.\n'
    : '';
  const prevBlock = prevBlockReason
    ? `\nПРЕДЫДУЩАЯ попытка этого слайса уже была ЗАБЛОКИРОВАНА по причине: ${prevBlockReason}\nПроверь, устранена ли именно она в текущем диффе — не повторяй тот же вердикт вслепую.\n`
    : '';
  const rubricSection = rubric && (rubric.spec || rubric.constitution)
    ? `\n--- РУБРИКА scope (меряй scope creep против неё, не только против однострочной ЗАДАЧИ ниже) ---\n` +
      (rubric.spec ? `spec.md (${rubric.spec.path}):\n${rubric.spec.text}\n` : '') +
      (rubric.constitution ? `constitution.md (${rubric.constitution.path}):\n${rubric.constitution.text}\n` : '')
    : '';
  // 011 T003: механика L0 уже посмотрела дифф и назвала места, где риск структурно возможен —
  // именно поэтому судья и позван. Это КОНТЕКСТ, не обвинение и не половина вердикта: список
  // без формулировки «суди дифф целиком» превращает судью в подтверждателя чужой гипотезы.
  const l0Section = l0Triggers.length
    ? `\n--- ПОЧЕМУ ТЕБЯ ПОЗВАЛИ (риск-триггеры L0, механические) ---\n` +
      l0Triggers.map((t) => `- ${t.name}: ${t.reason}${t.files && t.files.length ? ` [${t.files.join(', ')}]` : ''}`).join('\n') +
      `\nЭто не вердикт: механика лишь отметила места, где риск ВОЗМОЖЕН, и не проверяла, есть ли он.\n` +
      `Суди дифф целиком как обычно; по перечисленным местам — внимательнее. Отсутствие проблемы\n` +
      `в них — законный pass, а не повод искать, к чему придраться.\n`
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
  return `Ты — судья слайса в харнесс-петле. НЕ запускай тесты, оракул и любые команды: оракул уже
зелёный (это предусловие гейта), а твоя работа — прочитать дифф ниже и вынести вердикт. Прогон
тестов судьёй — не усердие, а провал: он не укладывается в таймаут, и слайс уходит в judge-dead.

Стойка REJECT-default: одобряй ТОЛЬКО если слайс строго в границах задачи. Ищи scope creep, ослабленные/удалённые тесты, side-effects вне задачи, скрытые зависимости.

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

ЗАДАЧА (${tid}): ${taskText}${prevBlock}${rubricSection}${ownedSection}${l0Section}
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

Есть ТРЕТИЙ исход — inconclusive. Он для одного случая: слайс не нарушает границ, но чего-то
не хватает ИМЕННО ТЕБЕ, чтобы ручаться (внешний сервис недоступен, дифф обрезан по сути,
поведение проверяемо только рантаймом, которого у тебя нет). Слайс тогда коммитится с меткой,
а причина уходит в очередь ревью человеку — второго раунда судейства НЕ будет.
inconclusive — НЕ «мягкий block» и НЕ способ не выбирать: нашёл нарушение — block, не нашёл —
pass. Каждый лишний inconclusive превращает гейт в лог, который никто не читает.

Дай вердикт pass, block или inconclusive с обоснованием — формат ответа проверяется
автоматически (structured output).`;
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
// 12000 на 15 файлов = 800 симв/файл: живой гейт T010 2026-07-29 получил block от судьи
// с формулировкой «диффы обрезаны, проверить нечего» — бюджет резал не хвосты, а суть слайса.
// 60K символов (~15-20K токенов) современный судья читает целиком.
const DIFF_CAP = Number(process.env.JUDGE_DIFF_CAP) || 60000;
function budgetDiff(sections, cap = DIFF_CAP, zoneFiles = []) {
  const ordered = prioritize(sections, zoneFiles);
  // Доля считается по ОСТАВШИМСЯ файлам, а не по всем сразу: мелкие файлы, влезающие целиком,
  // не тратят свою долю впустую — неиспользованный остаток достаётся крупным. Раньше `cap/N`
  // делил поровну, и крупный production-дифф резался, даже когда бюджет в целом не выбран
  // (живой block 2026-07-29: «диффы fleet.js/gate.js обрезаны, проверить нечего»).
  const shown = [];
  const omitted = [];
  let left = cap;
  let rest = ordered.length;
  for (const s of ordered) {
    const perFile = Math.max(MIN_FILE_BUDGET, Math.floor(left / Math.max(1, rest)));
    rest -= 1;
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
function slurpDiff(cwd, cap = DIFF_CAP, zoneFiles = [], pathspec = null) {
  const scope = pathspec && pathspec.length ? ['--', ...pathspec] : [];
  const tracked = execFileSync('git', ['diff', 'HEAD', ...scope], { cwd, encoding: 'utf8' });
  const sections = splitDiffSections(tracked);
  try {
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z', ...scope], { cwd, encoding: 'utf8' })
      .split('\0').filter(Boolean).sort();
    for (const file of untracked) {
      const full = path.join(cwd, file);
      if (fs.statSync(full).isFile()) {
        // `new file mode` (011 T003): untracked-файл — это НОВЫЙ файл, и синтетическая секция
        // обязана говорить это тем же признаком, что настоящий `git diff`. Без него L0 читает
        // новый прод-код как правку существующего и слепнет на триггере `new-code-no-check`.
        sections.push({ file: file.replace(/\\/g, '/'), text: `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n${fs.readFileSync(full, 'utf8')}` });
      }
    }
  } catch { /* unreadable untracked files remain visible in status */ }
  // -uall не дає Git згорнути нові `src/`/`test/` до каталогів: grounding має перелічувати
  // фактичні файли, а red-proof — бачити вкладений *.test.js.
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', ...scope], { cwd, encoding: 'utf8' });
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
// Пути сравниваются КАНОНИЧЕСКИ, а не строками. Там, где временный каталог — symlink или
// короткое 8.3-имя (оба случая живут на CI-раннерах), `gitRoot()` возвращает разрешённый
// путь, а `cwd` остаётся исходным: тогда СВОЙ же репозиторий выглядит чужим, и судье уезжает
// «внешний дифф», которого нет. Поймано красным CI на windows-latest.
function canonicalPath(p) {
  try { return fs.realpathSync.native ? fs.realpathSync.native(p) : fs.realpathSync(p); }
  catch { return p; }
}

function externalRepoScopes(cwd, files) {
  const cwdRoot = canonicalPath(gitRoot(cwd) || cwd);
  const byRoot = new Map();
  for (const f of files) {
    const abs = expandHome(f);
    if (!path.isAbsolute(abs)) continue; // относительный путь = зона внутри cwd-репо
    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) continue;
    const root = gitRoot(dir);
    if (!root || canonicalPath(root) === cwdRoot) continue;
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
  return externalRepoScopes(cwd, files).map(({ root, paths }) => ({ root, ...slurpDiff(root, DIFF_CAP, paths, paths) }));
}

// 019 T001: причины вердикта — свободный текст, поэтому файлы из них достаются регуляркой
// по расширению/разделителю. Требование «хотя бы один путь найден» намеренно строгое:
// причина без единого файла (например «тест мокает проверяемую логику») шумом не считается
// и блок не теряет.
const PATH_IN_TEXT = /[\w.\-/\\]+\.[A-Za-z0-9]{1,8}|\.harness[\w.\-/\\]*|\.git\/elt[\w.\-/\\]*/g;
function reasonsAreNoiseOnly(reasons) {
  const paths = [];
  for (const r of reasons || []) {
    for (const m of String(r).match(PATH_IN_TEXT) || []) paths.push(m.replace(/^[`"\x27(]+|[`"\x27),.;]+$/g, ''));
  }
  if (!paths.length) return false;
  return paths.every((rel) => isIgnoredForReview(rel));
}

// Судья по ГОТОВОМУ диффу (без git-чтения) — общий путь для runJudge и judge-bench:
// бенч обязан мерить ТУ ЖЕ функцию, что работает в проде, иначе меряет фикцию.
// provider: только claude умеет --json-schema (структурированный вывод, T016). codex/agy
// эквивалента не имеют → требуем JSON последней строкой и читаем prose-парсером; стойка
// REJECT-default та же (нет явного pass → block), так что кривой ответ безопасен.
const JSON_TAIL_INSTRUCTION = '\n\nОТВЕТ: последней строкой выведи РОВНО один JSON без обрамления:\n{"verdict":"pass","reasons":["…"],"filesReviewed":["path/a.js"]}  или  {"verdict":"block",…}  или  {"verdict":"inconclusive",…}';
async function judgeDiff({ cwd = process.cwd(), tid, taskText, diff, status, provider = 'claude', model = 'sonnet', timeoutMs = JUDGE_TIMEOUT_MS, prevBlockReason = '', rubric = null, externalDiffs = [], omitted = [], l0Triggers = [] }) {
  const structured = provider === 'claude';
  const prompt = judgePrompt(tid, taskText, diff, status, prevBlockReason, rubric, externalDiffs, omitted, l0Triggers)
    + (structured ? '' : JSON_TAIL_INSTRUCTION);
  const started = Date.now();
  // readOnly: судья читает дифф и выносит вердикт — прогонять тесты ему нечего (оракул зелёный
  // ДО судьи, это предусловие гейта), а право записи превращает агентный CLI в исполнителя.
  const r = await providers.run({ provider, prompt, cwd, model, timeoutMs, jsonSchema: structured ? VERDICT_SCHEMA : null, readOnly: true });
  const durationSec = (Date.now() - started) / 1000;
  if (!r.ok) return { verdict: null, reasons: [], judgeLog: r.logPath, runOk: false, durationSec, reason: r.reason };
  // Чистый stdout (без stderr-примеси) — нужен для строгого JSON.parse структурированного
  // ответа. Лог-файл (stdout+stderr вперемешку) — только фолбэк для старого prose-парсера.
  let output = r.stdout || r.lastMsg || '';
  if (!parseStructuredVerdict(output)) {
    try { if (r.logPath && fs.existsSync(r.logPath)) output = fs.readFileSync(r.logPath, 'utf8'); } catch { /* лог не читается */ }
  }
  // 011 T004: pass/inconclusive проходят как есть, всё прочее — block (REJECT-default цел:
  // неразобранный ответ по-прежнему блок, а не «ну не знаю»).
  const parsed = parseVerdict(output);
  const verdict = parsed === 'pass' || parsed === 'inconclusive' ? parsed : 'block';
  const reasons = parseReasons(output);
  const filesReviewed = parseFilesReviewed(output);
  // 008 T001: grounding — механическая сверка filesReviewed с реальным списком файлов диффа.
  // Любой отказ граундинга форсирует block независимо от того, что сказала модель, — это и
  // есть смысл проверки («судья сказал pass» ≠ «судья реально смотрел дифф»).
  const groundingReason = checkGrounding(status, filesReviewed, reasons, cwd, omitted);
  // 019 T001 (D19): блок, который целиком держится на файлах, принадлежащих харнесу или
  // сгенерированных, — это шум по построению: слайс их не выбирал. Такой вердикт не
  // отбрасывается молча (тогда бы исчезла и причина), а понижается до `inconclusive` —
  // строка уезжает в очередь разбора, коммит не встаёт. Правка работает ТОЛЬКО в сторону
  // ослабления: превратить pass в block она не может по построению.
  const noiseOnly = !groundingReason && verdict === 'block' && reasonsAreNoiseOnly(reasons);
  const finalVerdict = groundingReason ? 'block' : (noiseOnly ? 'inconclusive' : verdict);
  const finalReasons = groundingReason ? [...reasons, groundingReason]
    : (noiseOnly ? [...reasons, '019 T001: блок снят до inconclusive — все названные файлы принадлежат харнесу или сгенерированы'] : reasons);
  return {
    verdict: finalVerdict,
    reasons: finalReasons,
    filesReviewed: filesReviewed || [],
    judgeLog: r.logPath, runOk: true, durationSec,
  };
}

// 011 T019(б): `grounding:no-reasons` — транспорт, а не качество. Провайдер без structured
// output (codex/agy отвечают JSON-хвостом) регулярно теряет `reasons`, и по замеру артефакта
// это 10% ВСЕХ блоков — блокировалась не работа, а формат ответа. Одна перевыдача тому же
// судье (тот же дифф, чистый контекст), и если reasons не появились снова — `inconclusive`,
// а не block: коммит с меткой + строка в очередь ревью. Остальные отказы граундинга
// (`phantom-file`/`unreviewed-file`) не ретраятся и остаются block — это враньё о прочитанном.
const NO_REASONS = 'grounding:no-reasons';
async function judgeDiffRetryNoReasons(args) {
  const first = await judgeDiff(args);
  if (!first.runOk || !(first.reasons || []).includes(NO_REASONS)) return first;
  const second = await judgeDiff(args);
  if (!second.runOk || !(second.reasons || []).includes(NO_REASONS)) return second;
  return { ...second, verdict: 'inconclusive' };
}

// Прогнать судью. runOk=false = судья НЕ смог отработать (timeout/spawn-error/nonzero-exit/
// пустой вывод) — инфраструктурный сбой, НЕ вердикт. T021: caller паркует слайс на
// judge_pending вместо REJECT — сама реализация не виновата, передел не нужен.
// runOk=true → verdict читается из вывода, REJECT-default (нет явного pass → block).
// ELT v3: один содержательный судья. JUDGE_ALTS нужны только для failover, если выбранный CLI
// не смог запуститься; мёртвые попытки остаются в judges[] как инфраструктурный evidence.
const JUDGE_ALTS = ['claude', 'codex', 'agy'];
function judgeEntry({ provider, model }, r) {
  return { provider, model, verdict: r.verdict, reasons: r.reasons, durationSec: r.durationSec, runOk: r.runOk };
}

// 011 T003: конфиг L0 (`harness.json.l0` — hotPaths/diffSizeThreshold). Отсутствует/битый →
// пустой объект: у evaluate свои дефолты, и проект без конфига обязан получить L0 как есть
// (AC12 — живой блок в чужом репо БЕЗ правок в нём). Пруфы ctx7 читает ГЕЙТ и передаёт в
// evaluate данными — сама evaluate обязана остаться чистой (AC2).
// 011 T017: тело переехало в `elt-gate-l0.js` — его же зовёт `elt.js` перед оракулом, и два
// чтения одного конфига разными кусками кода уже однажды разъехались бы.
const l0Config = loadL0Config;

// ── 020 T010: канонический рантайм ревью подключается ЗДЕСЬ ──────────────────────────────
// `runJudge` — единственная точка, через которую идут ОБА пути: синхронный (`elt judge run` →
// judge-invoke → сюда) и фоновой (`elt-verify-bg.js:runJudgeLayer` → сюда же). Поэтому «тот же
// код вызывают sync и background» выполняется структурно, а не обещанием в документе.
//
// Транспорт линз — `tools/providers.js`, тот же, которым ходит судья. Оценщик ходит своей
// моделью (`SCORER_MODEL`): рецепт называет haiku именно потому, что классификация дешевле
// анализа, и платить за неё как за анализ незачем.
const REVIEW_LENS_TIMEOUT_MS = 4 * 60 * 1000;
function reviewTransport({ cwd, provider, timeoutMs = REVIEW_LENS_TIMEOUT_MS }) {
  // `lastMsg` провайдера — ПОСЛЕДНЯЯ НЕПУСТАЯ СТРОКА вывода (providers.js:270), а не последнее
  // сообщение модели. Живой прогон 25.08: линза ответила однострочным JSON и разобралась, а
  // оценщик ответил многострочным массивом — `lastMsg` оказался literal `]`, классификация
  // стала пустой, и рантайм честно объявил `review-dead`. То есть при этой проводке оценщик
  // был бы мёртв ВСЕГДА, когда отвечает в несколько строк. Берём однострочный ответ, если он
  // сам по себе валиден, иначе весь stdout — толерантный разборщик достаёт из него хвостовой
  // массив (эхо промпта у codex идёт РАНЬШЕ ответа, поэтому последний массив — это ответ).
  const call = async (prompt, model) => {
    const r = await providers.run({ provider, prompt, cwd, model, timeoutMs, readOnly: true });
    if (!r || r.ok === false) return { ok: false, reason: `${provider}: ${(r && r.reason) || 'не ответил'}` };
    const { parseJsonArray } = require('./review-confidence');
    const oneLine = r.lastMsg || '';
    const arr = parseJsonArray(oneLine);
    return { ok: true, text: Array.isArray(arr) && arr.length ? oneLine : (r.stdout || oneLine) };
  };
  // Модель из frontmatter линзы (`model: sonnet`) — имя из семейства Claude, и передавать его
  // ЧУЖОМУ провайдеру нельзя: живой прогон через `codex` с `--model sonnet` вернул пустой
  // ответ за 12 c, то есть линза выглядела бы «мёртвой» из-за имени модели, а не из-за
  // транспорта. Чужому провайдеру модель выбирает его же router (`judge-router`).
  const claudeFamily = provider === 'claude';
  return {
    runLens: ({ lens, prompt }) => call(prompt, claudeFamily ? (lens.model || null) : null),
    runScorer: ({ prompt }) => call(prompt, claudeFamily ? require('./review-confidence').SCORER_MODEL : null),
  };
}
// Конфиг ревью: `review: { enabled: true, provider: "codex" }` в .harness/harness.json.
// Выключено по умолчанию НАМЕРЕННО и это записано, а не забыто: включение добавляет к каждому
// вызову судьи пять модельных вызовов, и решение платить за них — проектное, а не моё.
function reviewConfigOf(cwd, explicit) {
  if (explicit) return explicit;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'harness.json'), 'utf8'));
    return cfg && typeof cfg.review === 'object' && cfg.review ? cfg.review : null;
  } catch { return null; }
}

async function runJudge({ cwd, tid, taskText, provider = 'claude', model = 'sonnet', timeoutMs = JUDGE_TIMEOUT_MS, prevBlockReason = '', specFile = null, judgeExclude = [], review = null, reviewImpl = null }) {
  const zoneFiles = scopeFilesFromTask(taskText);
  const { diff, status, omitted } = slurpDiff(cwd, undefined, zoneFiles);
  const rubric = loadRubric(cwd, tid, specFile);
  const externalDiffs = slurpExternalDiffs(cwd, zoneFiles);

  // 011 T003: L0 — механический фильтр ПЕРЕД судьёй. Нет ни одного риск-триггера → LLM не
  // будится вовсе, вердикт выносит код. Есть триггеры → путь прежний, но судья получает их
  // как контекст «почему тебя позвали». Внешние репо считаются вместе с текущим: слайс,
  // вся работа которого лежит вне cwd (009 T014), иначе выглядел бы для L0 пустым.
  // ponytail: дифф здесь уже обрезан бюджетом, поэтому `diff-size` считает ПОКАЗАННЫЕ строки.
  // Файловые триггеры это не задевает — полный список файлов приходит из status, не из диффа.
  const l0Diff = [diff, ...externalDiffs.map((e) => e.diff)].join('\n');
  const l0Status = [status, ...externalDiffs.map((e) => e.status)].join('\n');
  // 011 T024: taskText несёт [files:] — без него scope-триггер молчит (задача не объявила зону).
  const l0 = evaluateL0({ diff: l0Diff, status: l0Status, config: l0Config(cwd), cwd, taskText });
  // Пустой дифф — не «чистый слайс», а слайс, в котором ничего не сделано: триггеров в нём нет
  // по определению, и молчаливый `l0-clean` пропустил бы пустышку как выполненную работу.
  // Такое отдаём судье, как раньше: REJECT-default по пустому диффу — его штатная работа.
  if (!l0.judgeNeeded && (l0Diff.trim() || l0Status.trim())) {
    return {
      verdict: 'pass',
      reasons: ['l0-clean: риск-триггеров нет, судья не звался'],
      filesReviewed: [],
      judgeLog: null,
      runOk: true,
      durationSec: 0,
      l0: { triggers: [], judgeNeeded: false },
      // judges[] — контракт proof (elt.js validateJudgeProof). Пишем честно, КТО вынес вердикт:
      // механика L0, а не LLM. Подставить сюда имя судьи значило бы соврать в пруфе.
      judges: [{ provider: 'l0', model: 'triggers', verdict: 'pass', reasons: ['l0-clean'], durationSec: 0, runOk: true }],
    };
  }
  // 011 T009: L0 умеет вынести вердикт САМ — новый внешний импорт без пруфа ctx7 это не повод
  // спрашивать модель, а механический факт. Судью не зовём: он ничего не добавит к «API не
  // подтверждён», а стоит 190 c.
  if (l0.verdict) {
    return {
      verdict: l0.verdict,
      reasons: l0.triggers.map((t) => `${t.name}: ${t.reason}`),
      filesReviewed: [],
      judgeLog: null,
      runOk: true,
      durationSec: 0,
      l0: { triggers: l0.triggers, judgeNeeded: true, verdict: l0.verdict },
      judges: [{ provider: 'l0', model: 'triggers', verdict: l0.verdict, reasons: l0.triggers.map((t) => t.reason), durationSec: 0, runOk: true }],
    };
  }
  const withL0 = (result) => ({ ...result, l0: { triggers: l0.triggers, judgeNeeded: true } });

  // 020 T010: если ревью включено, финальную классификацию даёт ОНО — пять линз и один
  // оценщик. Второго вердикта поверх не ставим: 011 T019 закрыл ровно эту болезнь («вето не
  // перемножаются») — два REJECT-default судьи давали block в 77% и покрытие 29%.
  const reviewCfg = reviewConfigOf(cwd, review);
  if (reviewCfg && reviewCfg.enabled) {
    const started = Date.now();
    const transport = reviewImpl || reviewTransport({ cwd, provider: reviewCfg.provider || provider });
    const rr = await require('./review-runtime').runReview({
      cwd, task: tid, taskText, diff: l0Diff,
      lensesDir: reviewCfg.lensesDir || path.join(__dirname, '..', 'agents'),
      runLens: transport.runLens, runScorer: transport.runScorer,
      ledger: (() => { try { return require('../bin/ledger'); } catch { return null; } })(),
    });
    const durationSec = (Date.now() - started) / 1000;
    // `dead` рантайма — не «почти pass»: он попадает в тот же контракт, что мёртвый судья.
    const runOk = rr.verdict !== 'dead';
    return withL0({
      verdict: runOk ? rr.verdict : 'dead',
      reasons: rr.reasons && rr.reasons.length ? rr.reasons : [`review: ${rr.status}`],
      filesReviewed: [...new Set((rr.findings || []).map((f) => f.file))],
      judgeLog: null, runOk, durationSec,
      review: {
        status: rr.status, blocking: (rr.blocking || []).length, weak: (rr.weak || []).length, scorer: rr.scorer,
        // 020 T017: терминальное состояние КАЖДОЙ линзы поимённо и все находки с их
        // уверенностью. Сертификат обязан считаться по фактам, а не по счётчикам: из числа
        // «2 блокирующих» нельзя восстановить, все ли требуемые линзы вообще отработали.
        lensResults: Object.fromEntries((rr.lenses || []).map((l) => [l.name, {
          status: l.ok ? 'review-pass' : 'review-dead',
          reason: l.reason || null,
          findings: (l.findings || []).length,
        }])),
        scorerTerminal: rr.scorer && rr.scorer.ok ? 'review-pass' : 'review-dead',
        findings: (rr.findings || []).map((f) => ({
          lens: f.lens || null, file: f.file, line: f.line, confidence: f.confidence,
        })),
      },
      judges: [{
        provider: reviewCfg.provider || provider, model: 'five-lens+scorer',
        verdict: runOk ? rr.verdict : 'dead', reasons: rr.reasons || [], durationSec, runOk,
      }],
    });
  }
  const commonArgs = { cwd, tid, taskText, diff, status, timeoutMs, prevBlockReason, rubric, externalDiffs, omitted, l0Triggers: l0.triggers };

  // 011 T017 (б): перевыдача МЁРТВОГО судьи следующему живому CLI. После перехода на одного
  // судью его инфраструктурная смерть (agy → ENAMETOOLONG за
  // 0.006 c, run-log T003) валит весь гейт, хотя на машине есть другой живой CLI.
  // Мёртвая попытка ОСТАЁТСЯ в judges[]: в proof виден и отказ, и кем он перевыдан, а не тихая
  // подмена. Ниже judges[] пересобирается — поэтому и провайдер, и история едут явно.
  let primaryPair = { provider, model };
  let primary = await judgeDiffRetryNoReasons({ ...commonArgs, ...primaryPair });
  const deadAttempts = [];
  if (!primary.runOk) {
    deadAttempts.push(judgeEntry(primaryPair, primary));
    const alt = JUDGE_ALTS.find((p) => p !== provider && !judgeExclude.includes(p) && providers.available(p));
    if (alt) {
      primaryPair = { provider: alt, model: router.modelFor(alt, router.loadPolicy(cwd)) };
      primary = await judgeDiffRetryNoReasons({ ...commonArgs, ...primaryPair });
    }
    // Перевыдача не помогла (или заменить некем) — вердикта нет, слайс уходит в парковку как
    // раньше. Помогла — дальше идём с ЖИВЫМ вердиктом от ДРУГОГО судьи.
    if (!primary.runOk) {
      return withL0({ ...primary, judges: alt ? [...deadAttempts, judgeEntry(primaryPair, primary)] : deadAttempts });
    }
  }

  const primaryEntry = judgeEntry(primaryPair, primary);
  return withL0({ ...primary, judges: [...deadAttempts, primaryEntry] });
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
// 019 T001: сам список переехал в `harness-files.js` — здесь была вторая копия, и она
// разошлась с копией в `elt-gate-l0.js`. Расхождение копий и есть корень D9/D15/D19.
// reset --soft <base> некоммитит правки воркера (содержимое НЕ теряется — остаётся в дереве);
// git-guardrails блокирует только --hard, и этот вызов идёт из child-процесса, не через тул.
function normalizeWorktree(cwd, base, files) {
  if (base) gitSilent(['reset', '--soft', base], cwd); // un-commit self-commit воркера (HEAD→base)
  if (!base) return;                                   // без base откатывать нечем — только un-commit невозможен тоже
  let status = '';
  try { status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd, encoding: 'utf8' }); } catch { return; }
  for (const line of status.split(/\r?\n/)) {
    if (line.length < 4) continue;                     // "XY path" — минимум 4 символа
    const rel = line.slice(3).replace(/^"|"$/g, '').trim();
    if (!rel || inScope(rel, files)) continue;         // явная зона слайса неприкосновенна
    const untracked = line.startsWith('??');
    // 019 T006: у отката ДВА режима, и путать их нельзя. Неотслеживаемый файл откатить
    // нечем — его можно только снести, поэтому сносим лишь СОСТОЯНИЕ прогона. Конфиг гейта
    // в этом случае не трогаем вовсе: снести его значит оставить следующий шаг (оракул) без
    // конфига, что и случилось живьём — шесть тестов упали на `stage: oracle` с пустым выводом.
    const target = untracked ? isHarnessOwned(rel) : isHarnessManaged(rel);
    if (!target) continue;
    // ponytail: rename в porcelain ("R old -> new") checkout не разберёт — редко; gitSilent молча мимо.
    if (untracked) { try { fs.rmSync(path.join(cwd, rel), { force: true, recursive: true }); } catch { /* уже нет */ } }
    else gitSilent(['checkout', base, '--', rel], cwd); // вернуть харнесс-файл (включая конфиг) к base
  }
}

// Полный гейт слайса. Возвращает {ok, stage?, verdict?, tid, ...}.
// stage: 'oracle' (красный оракул) | 'judge-unavailable' (судья не отработал, парковка,
// НЕ reject) | 'judge' (легитимный block) | 'commit' (git-фейл).
// integration — интеграционная ветка (база слайса): включает T028-нормализацию. Без неё
// (тесты/ручной вызов) нормализация = no-op, поведение как раньше.
// Контур усиленного proof включён только когда harness.json.redProof не "off"/пуст.
// Включён → red-proof обязателен и здесь, и
// proof обязан нести judges[]/grounding/redProof, иначе `elt commit` его законно отвергнет.
function circuitEnabled(cwd) {
  let mode = '';
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'harness.json'), 'utf8'));
    mode = typeof j.redProof === 'string' ? j.redProof.trim() : '';
  } catch { /* нет harness.json / битый — контур выключен */ }
  return mode !== '' && mode !== 'off';
}

// Живой прогон 011/T019 (01.08): fleet ЗНАЕТ tasksPath, но звал `elt` без `--spec` — автодетект
// по tid ушёл в specs/003 (T019 существует в ПЯТИ спеках, в четырёх закрыт) и уронил стадию
// commit. Тот же tasksPath, что кормит plan.js, обязан ехать и в elt: id уникальны внутри
// спеки, не между. Отсюда: файл → рубрика судьи (findSpecDir ждёт файл), папка → флаг `--spec`.
function specArgsFor(specFile) {
  return specFile ? ['--spec', path.dirname(specFile)] : [];
}

async function gate({ tid, taskText = '', cwd = process.cwd(), elt = ELT_CLI, judgeProvider = 'claude', judgeModel = 'sonnet', prevBlockReason = '', integration = null, judgeExclude = [], specFile = null }) {
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
  const j = await runJudge({ cwd, tid, taskText, provider: judgeProvider, model: judgeModel, prevBlockReason, judgeExclude, specFile });
  if (!j.runOk) return { ok: false, stage: 'judge-unavailable', tid, judgeLog: j.judgeLog };
  // 011 T004: inconclusive идёт дальше как pass — коммит с меткой + строка в очередь ревью
  // (её пишет `elt commit`, там есть sha). Второго раунда судейства нет: caller видит ok:true.
  if (j.verdict !== 'pass' && j.verdict !== 'inconclusive') {
    return { ok: false, stage: 'judge', verdict: j.verdict, reasons: j.reasons, tid, judgeLog: j.judgeLog };
  }

  // 2.5. red-proof (009 T010): в solo-пути он идёт через judge-invoke.js, а fleet-гейт его не
  //      знал вовсе — новый тест, зелёный на базе слайса, проезжал на одном pass судей. HEAD в
  //      worktree = база слайса (normalizeWorktree выше сделал reset --soft), правки не закоммичены.
  let redProofResult;
  let verdict = j.verdict;
  let reasons = j.reasons || [];
  if (circuitEnabled(cwd)) {
    redProofResult = redProof({ cwd, baseHead: 'HEAD' });
    // 011 T019(а): green → `inconclusive`, не block. Правило — общее с solo-путём
    // (`red-proof.js applyRedProof`), чтобы два пути не разъехались снова.
    ({ verdict, reasons } = applyRedProof(verdict, reasons, redProofResult));
  }

  // 3. Proof пишет ТОТ ЖЕ путь, что у интерактива — `elt judge run` (011 T011). Раньше здесь
  //    была своя команда с флагом `--attested-by fleet-gate`, то есть в CLI жил способ провести
  //    вердикт мимо судьи; агент с шеллом набирал его сам. Флага больше нет.
  //    Судью повторно не спавним: он уже отработал выше (runJudge), и второй прогон стоил бы
  //    190 c и дал бы ДРУГОЙ вердикт. Готовый результат отдаёт мост-повтор judge-replay.js —
  //    для `elt judge run` он неотличим от judge-invoke.js, поэтому и proof, и запись в run-log
  //    делает одна и та же функция на обоих путях.
  const judges = Array.isArray(j.judges) && j.judges.length
    ? j.judges
    : [{ provider: judgeProvider, model: judgeModel, verdict: j.verdict, reasons: j.reasons || [], durationSec: j.durationSec, runOk: j.runOk }];
  // Файл — в tmp, НЕ в worktree: любой файл в дереве меняет treeHash и делает оракул-пруф
  // stale ровно в тот момент, когда мы на него ссылаемся.
  const replayDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-proof-'));
  const replayPath = path.join(replayDir, 'judge-result.json');
  fs.writeFileSync(replayPath, JSON.stringify({
    runOk: true, verdict, reasons,
    judgeLog: j.judgeLog || null, judges, grounding: { filesReviewed: j.filesReviewed || [] },
    ...(redProofResult ? { redProof: redProofResult } : {}),
    ...(j.l0 ? { l0: j.l0 } : {}),
  }));
  const replayBridge = path.join(__dirname, 'judge-replay.js');
  const proof = await exec.run('node', [elt, 'judge', 'run', '--task', tid, ...specArgsFor(specFile), '--invoke', replayBridge], {
    cwd, env: { ...process.env, ELT_JUDGE_REPLAY: replayPath },
  });
  try { fs.rmSync(replayDir, { recursive: true, force: true }); } catch { /* tmp, не критично */ }
  if (proof.status !== 0) return { ok: false, stage: 'judge-proof', tid, err: (proof.stderr || proof.stdout || '').trim() };
  const msg = `feat: ${tid} ${taskText}`.slice(0, 90);
  const c = await exec.run('node', [elt, 'commit', '--task', tid, ...specArgsFor(specFile), '--keep-task-open', '--skip-oracle', '-m', msg], { cwd });
  if (c.status !== 0) return { ok: false, stage: 'commit', tid, err: (c.stderr || c.stdout || '').trim() };
  return { ok: true, tid, verdict, judgeLog: j.judgeLog };
}

// judgeDiffRetryNoReasons экспортируется наравне с judgeDiff: это и есть путь, которым
// судью зовёт сам гейт (runJudge), поэтому любой внешний замер гейта обязан звать ЕГО, а
// не голый judgeDiff — иначе меряется не тот контур, что работает в проде (021 T003).
module.exports = { gate, runJudge, reviewTransport, reviewConfigOf, judgeDiff, judgeDiffRetryNoReasons, JUDGE_ALTS, parseVerdict, parseReasons, parseFilesReviewed, diffFileList, checkGrounding, judgePrompt, loadRubric, findSpecDir, specArgsFor, normalizeWorktree, scopeFilesFromTask, inScope, mergeBase, externalRepoRoots, slurpExternalDiffs, slurpDiff, splitDiffSections, budgetDiff, reasonsAreNoiseOnly };
