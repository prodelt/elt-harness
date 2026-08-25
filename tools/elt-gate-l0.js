#!/usr/bin/env node
'use strict';
// 011 T002 — L0: риск-триггеры механикой, без LLM и без сети (AC2).
//
// Зачем: судья звался на КАЖДОМ слайсе и стоил 16-18 c + block-rate, который на чистых
// правках был чистым шумом. L0 отвечает на один вопрос — «есть ли в этом диффе хоть что-то,
// ради чего стоит будить LLM». Нет триггеров → судья не зовётся вовсе (проводка — T003).
//
// Функция чистая: только (дифф, git status, конфиг) на входе. Ни fs, ни spawn, ни сети —
// поэтому её тест не требует ни репозитория, ни судьи, и она не может подвиснуть в гейте.

// Горячие пути по умолчанию: гейт (то, чем проверяется всё остальное), авторизация, секреты.
// ponytail: подстрочный матч заведомо перекрывает лишнее (`author.js` попадёт под `*auth*`).
// Это осознанно: ложный триггер стоит одного вызова судьи, пропуск — дыры в гейте.
const DEFAULT_HOT_PATHS = [
  '**/gate*', '**/*-gate.js', '**/judge*',
  '**/auth/**', '**/*auth*',
  '**/.env*', '**/*secret*', '**/*credential*',
];
const { isHarnessOwned, isIgnoredForReview } = require('./harness-files');
const DEFAULT_DIFF_SIZE = 400;
// 011 T025 — риск из связности, не из имени файла: «узел с высокой входящей степенью = дорогая
// ошибка» (артефакт). `hot-path` ловит по подстроке (`*auth*` цепляет `author.js`), а реально
// центральный модуль без «горячего» слова не ловит никак. Порог — константа-дефолт, читается
// из harness.json.l0.fanInThreshold как и остальные пороги L0.
const DEFAULT_FANIN_THRESHOLD = 10;

const TEST_PATH = /(^|\/)[^/]*\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(tests?|__tests__)\//i;
const CODE_PATH = /\.(js|cjs|mjs|jsx|ts|tsx|py|go|rs|rb|java|cs|php|sh|ps1)$/i;

// 014 T002 — `existing-test-modified` сработал на 30 из 39 слайсов (замер 011): любая правка
// теста, включая чистое добавление нового кейса, будила судью — `l0-clean` был всего 12,8%.
// Новый триггер смотрит НЕ «тест правили», а «утверждение стало слабее»: удалена строка с
// assert/expect/throws; вырезан блок test(/it(; файл переписан больше чем наполовину. Чистое
// добавление строк (removed=0) не матчит НИ ОДНО условие ниже — специального case не нужно.
// Эвристика по diff-строкам, без AST (решение 5 спеки 014: парсер — только после промаха вживую).
const ASSERT_REMOVE_RE = /\b(?:assert|expect)\s*\(|\.(?:equal|strictEqual|deepEqual|deepStrictEqual|notEqual|notStrictEqual|ok|throws|rejects|match|doesNotThrow|doesNotReject)\s*\(/;
const TEST_BLOCK_RE = /\b(?:test|it|describe)\s*\(\s*['"`]/;
const REWRITE_RATIO = 0.5;

// Существующий (не новый) тест-файл считается «ослабленным», если среди УДАЛЁННЫХ строк есть
// сорванное утверждение/блок кейса, либо файл переписан больше REWRITE_RATIO. `originalLineCount`
// — геттер (path)=>number|null от вызывающего (git show HEAD:path, живёт в loadConfig — та же
// дисциплина, что у fanIn): недоступен → эта конкретная проверка молчит, а не падает.
function weakenedTestFiles(tests, originalLineCount) {
  const flagged = [];
  for (const file of tests) {
    if (file.isNew) continue;
    const removedLines = file.removedLines || [];
    if (!removedLines.length) continue; // чистое добавление — не триггер
    const hitsAssert = removedLines.some((l) => ASSERT_REMOVE_RE.test(l));
    const hitsBlock = removedLines.some((l) => TEST_BLOCK_RE.test(l));
    let hitsRewrite = false;
    if (typeof originalLineCount === 'function') {
      const total = originalLineCount(file.path);
      if (Number.isFinite(total) && total > 0) hitsRewrite = file.removed / total > REWRITE_RATIO;
    }
    if (hitsAssert || hitsBlock || hitsRewrite) flagged.push(file.path);
  }
  return flagged;
}

// 011 T009: новый ВНЕШНИЙ импорт в диффе. Мотив (§3.3 спеки): API чужой либы — ровно то место,
// где модель уверенно пишет несуществующий метод, а оракул этого не ловит (тест пишет тот же,
// кто выдумал API). Пруф свежего обращения к ctx7 — механическая замена «я помню эту либу».
const BUILTINS = new Set(require('node:module').builtinModules);
const IMPORT_RE = /(?:require\s*\(\s*|from\s+|import\s+)['"]([^'"]+)['"]/g;
// Строка комментария в любом из языков, которые ловит CODE_PATH: `//`, `#`, `*` (продолжение
// блочного), `/*`. Намеренно только НАЧАЛО строки: хвостовой комментарий после живого кода
// (`const x = require('y'); // почему`) обязан остаться видимым.
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#)/;
// 020 T002 (находка фона T018). `#` — комментарий НЕ везде. В JS/TS это ещё и приватное поле
// класса, и строка `#client = require('redis');` — живой внешний импорт, который старое
// правило гасило как комментарий. Языки с решёточным комментарием перечислены явно; для
// остальных `#` в начале строки считается кодом, кроме shebang.
const HASH_COMMENT_PATH = /\.(py|rb|sh|ps1)$/i;
const C_COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

function isCommentLine(line, file) {
  if (/^\s*#!/.test(line)) return true; // shebang — комментарий в любом языке
  if (HASH_COMMENT_PATH.test(file || '')) return COMMENT_LINE.test(line);
  return C_COMMENT_LINE.test(line);
}
const CTX7_FRESH_DAYS = 30;

// `IMPORT_RE` ищет ключевое слово, но не знает, находится ли оно в исполняемом коде или
// внутри строковой фикстуры/хвостового комментария. Полный parser здесь был бы новой
// зависимостью ради одного вопроса, поэтому достаточно узкого лексера до позиции match:
// кавычки, escape и оба вида JS-комментариев. Аргумент самого import/require намеренно не
// сканируется — match начинается на ключевом слове, которое обязано быть в code position.
// 020 T002: добавлена шаблонная интерполяция. `${...}` внутри бэктик-строки — это КОД, а не
// текст: `const c = `${require('axios')}`;` — настоящий внешний импорт, который старый лексер
// пропускал, потому что видел только открывающий бэктик. Состояние держится стеком, поэтому
// вложенность (`${ `${...}` }`) не путает разбор, а обычная строка по-прежнему остаётся текстом.
function isCodePosition(source, index) {
  const stack = []; // элементы: { quote } для строки, { interp: true } для ${...}
  let escaped = false;
  let blockComment = false;
  let depth = 0; // глубина фигурных скобок внутри текущей интерполяции
  for (let i = 0; i < index; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    const top = stack[stack.length - 1];
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (top && top.quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (top.quote === '`' && ch === '$' && next === '{') {
        stack.push({ interp: true, savedDepth: depth });
        depth = 0;
        i += 1;
        continue;
      }
      if (ch === top.quote) stack.pop();
      continue;
    }
    // здесь мы либо в коде верхнего уровня, либо внутри ${...} — правила одинаковые
    if (ch === '/' && next === '/') return false;
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { stack.push({ quote: ch }); continue; }
    if (top && top.interp) {
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        if (depth === 0) { depth = top.savedDepth; stack.pop(); }
        else depth -= 1;
      }
    }
  }
  const top = stack[stack.length - 1];
  return !blockComment && (!top || top.interp === true);
}

function externalImports(diff) {
  const names = new Set();
  // 017 T004: импорт считается ТОЛЬКО в кодовом файле. Заголовок ханка (`+++ b/path`)
  // объявляет файл; до первого заголовка считаем кодом — юнит-вызовы передают голый
  // фрагмент диффа без шапки. Живой блок 2026-08-22: документный коммит архива (11 `.md`,
  // 2955 строк) остановлен на слове `vitest` из ЛИСТИНГА КОДА внутри field report.
  // Документная дверь (`elt commit` без --task) сделана ровно для таких коммитов, но L0
  // стоит ПЕРЕД ней, а external-import-no-ctx7 — единственный триггер, который сам выносит
  // `block`, а не будит судью: одна строка в отчёте закрывала дверь целиком.
  let inCode = true;
  // 020 T002: имя файла нужно и ПОСЛЕ заголовка ханка — от него зависит, комментарий ли `#`.
  let curFile = '';
  for (const line of String(diff || '').split(/\r?\n/)) {
    if (line.startsWith('+++')) {
      const file = line.replace(/^\+\+\+\s*/, '').trim().replace(/^b\//, '');
      curFile = file;
      inCode = file !== '/dev/null' && CODE_PATH.test(file);
      continue;
    }
    // только ДОБАВЛЕННЫЕ строки кодовых файлов
    if (!inCode || !line.startsWith('+')) continue;
    // 019 T018, продолжение D20: строка КОММЕНТАРИЯ не является импортом. Поймано дважды на
    // одном слайсе — сначала фикстура регресса, потом комментарий, объясняющий эту же фикстуру:
    // оба содержали `from 'vitest'` текстом, и гейт блокировал правку собственного правила.
    // Живой импорт в комментарии не живёт никогда, поэтому потери сигнала здесь нет, а
    // закомментированный импорт и не должен требовать пруфа — он не исполняется.
    if (isCommentLine(line.slice(1), curFile)) continue;
    const source = line.slice(1);
    for (const m of source.matchAll(IMPORT_RE)) {
      if (!isCodePosition(source, m.index)) continue;
      const spec = m[1];
      // `@/…`, `~/…`, `#…` — path-алиасы (tsconfig paths, imports-поле package.json), не
      // пакеты: у npm-скоупа имя непустое (`@scope/name`), а `@/lib/x` даёт скоуп `@`.
      if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')
        || spec.startsWith('@/') || spec.startsWith('~/') || spec.startsWith('#')) continue;
      // Пакет, а не подпуть внутри него: `lodash/fp` — та же либа.
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!BUILTINS.has(pkg)) names.add(pkg);
    }
  }
  return [...names];
}
// Пруф читает ВЫЗЫВАЮЩИЙ и передаёт сюда: evaluate обязана остаться чистой (AC2) — иначе её
// тест начнёт требовать репозиторий, а сама она сможет подвиснуть в гейте на вводе-выводе.
function ctx7Covered(pkg, proofs, freshDays) {
  const cutoff = Date.now() - freshDays * 24 * 60 * 60 * 1000;
  const needle = pkg.toLowerCase();
  return proofs.some((p) => {
    const ts = Date.parse(p && p.ts);
    if (!Number.isFinite(ts) || ts < cutoff) return false;
    return [p.library, p.query, p.libraryId].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
  });
}

// ponytail: минимальный glob — `**`, `*`, `?`. Хватает на список путей в конфиге.
// Апгрейд до полноценного matcher'а — когда понадобятся `{a,b}` или классы символов.
const GLOB_TOKENS = { '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' };
function globToRe(glob) {
  const body = String(glob).split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => (part in GLOB_TOKENS ? GLOB_TOKENS[part] : part.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`, 'i');
}

function normalize(file, cwd) {
  let p = String(file).replace(/\\/g, '/').replace(/^"|"$/g, '');
  // gate.js умеет складывать в дифф файлы ВНЕ cwd (009 T014, зона `[files:]` с внешними
  // путями) — там путь абсолютный, и без среза он не совпал бы ни с одним глобом.
  const base = String(cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (base && p.toLowerCase().startsWith(`${base.toLowerCase()}/`)) p = p.slice(base.length + 1);
  return p.replace(/^\.\//, '');
}

function parseDiff(diff, cwd) {
  const files = [];
  let current = null;
  for (const line of String(diff || '').split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      current = { path: normalize(header[2], cwd), added: 0, removed: 0, isNew: false, isDeleted: false, removedLines: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('new file mode ')) current.isNew = true;
    else if (line.startsWith('deleted file mode ')) current.isDeleted = true;
    else if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    else if (line.startsWith('+')) current.added += 1;
    else if (line.startsWith('-')) { current.removed += 1; current.removedLines.push(line.slice(1)); }
  }
  return files;
}

// Untracked файлы (`??`) в `git diff` не попадают вовсе — без git status триггер
// `new-code-no-check` был бы слеп ровно на своём главном случае: новый файл без теста.
function parseStatus(status, cwd) {
  const files = [];
  for (const raw of String(status || '').split(/\r?\n/)) {
    if (raw.length < 4) continue;
    const code = raw.slice(0, 2);
    if (code.includes('D')) continue;
    const rest = raw.slice(3);
    const target = rest.includes(' -> ') ? rest.split(' -> ').pop() : rest;
    files.push({ path: normalize(target.trim(), cwd), added: 0, removed: 0, isNew: /[?A]/.test(code), isDeleted: false });
  }
  return files;
}

function mergeChanged(fromDiff, fromStatus) {
  const byPath = new Map();
  for (const file of [...fromDiff, ...fromStatus]) {
    const seen = byPath.get(file.path);
    // Дифф — источник правды по объёму; status добавляет только то, чего в диффе нет,
    // но его признак `isNew` сильнее (untracked-файл в диффе не виден вовсе).
    if (seen) seen.isNew = seen.isNew || file.isNew;
    else byPath.set(file.path, { ...file });
  }
  return [...byPath.values()].filter((file) => !file.isDeleted);
}

// 011 T024 — Scope: файл в диффе вне [files:] И вне харнесс-владений → судья зовётся с явной
// причиной, а не молчаливо (артефакт: «выход ловится механически — это те самые 15% настоящих
// блоков судьи»). Форма ФАЙЛОВАЯ, не символьная НАМЕРЕННО: `codegraph affected` в этом репо
// возвращает пусто (43 import-узла на 288 файлов, require() не проиндексирован) — символьный
// подграф строить не на чем, слайс на несуществующих данных был бы враньём.
// Не require() gate.js/plan.js: elt-gate-l0.js — лист замыкания судьи (sync-bin CLOSURE),
// а judge-plan.js в него не входит — тривиальные 3 строки дублируются, а не тянут новый файл
// в деплой каждого проекта.
// 019 T002 (D13): `.match()` БЕЗ флага `g` возвращал только ПЕРВОЕ вхождение — в батч-коммите
// это значило, что зона задач 2..N не видна вовсе и их файлы гарантированно объявлялись
// `out-of-scope`. Батч-режим был задекларирован в `--help` и непроходим по построению.
// 020 T023: разделители — И запятая, И пробел. Разбор принимал только запятую, а реальные планы
// (019, 020) пишут список через пробел: `[files: tools/a.js tools/b.js]`. Такой список
// схлопывался в ОДИН глоб «tools/a.js tools/b.js», которому не равен ни один путь, и триггер
// либо молчал, либо объявлял вне зоны вообще всё, включая объявленные файлы. Перевод строки
// тоже разделитель: длинный список в tasks.md переносится.
function taskScopeFiles(taskText) {
  const out = [];
  for (const m of String(taskText || '').matchAll(/\[files:([^\]]+)\]/g)) {
    for (const part of m[1].split(/[\s,]+/)) {
      const g = part.trim();
      if (g && !out.includes(g)) out.push(g);
    }
  }
  return out;
}
// 019 T002 (D14): порог diff-size — на ЗАДАЧУ, а не на коммит. Батч из N задач законно даёт
// больше строк. `elt judge run --task T001,T002` склеивает тексты через перевод строки, и
// каждый начинается с идентификатора задачи — поэтому число задач считается по маркерам в
// начале строк того же текста, без новой проводки judge-desc.json → judge-invoke → gate.js.
//
// 020 T023: маркер приходит в ДВУХ формах. Раньше `elt.js` строил текст сам (`T001 …`), теперь
// отдаёт блок задачи как он записан в плане (`- [ ] **T001** …`) — и якорь `^T\d+` перестал
// находить хоть что-то. Судья поймал это живьём: батч из двух задач считался одной, порог
// diff-size не удваивался, и L0 ложно поднимал бы `diff-size` на каждом легитимном батче.
// Обе формы поддерживаются намеренно: старую всё ещё пишут `judge-desc.json` прошлых прогонов
// и фикстуры, и терять их разбор ради новой не за что.
const TASK_MARKER_RE = /^(?:\s*(?:[-*]\s*)?\[[ Xx]\]\s*)?(?:\*\*)?T\d+\b/gm;
function taskCountOf(taskText) {
  const ids = String(taskText || '').match(TASK_MARKER_RE);
  return ids && ids.length ? ids.length : 1;
}
function globPrefix(g) {
  const i = g.search(/[*?[]/);
  return (i === -1 ? g : g.slice(0, i)).replace(/\\/g, '/');
}
function inTaskScope(rel, files) {
  return files.some((g) => { const pre = globPrefix(g); return rel === g || (pre && rel.startsWith(pre)); });
}
// 019 T001: граница владения переехала в `harness-files.js` — один список на гейт, мерку
// объёма и промпт судьи. Локальная копия здесь и копия в `judge-core.js` разошлись, и это
// расхождение и было корнем D9/D15/D19.

function evaluate({ diff = '', status = '', config = {}, cwd = '', taskText = '' } = {}) {
  const changed = mergeChanged(parseDiff(diff, cwd), parseStatus(status, cwd));
  const tests = changed.filter((file) => TEST_PATH.test(file.path));
  const prod = changed.filter((file) => !TEST_PATH.test(file.path) && CODE_PATH.test(file.path));
  const triggers = [];

  const weakened = weakenedTestFiles(tests, config.originalLineCount);
  if (weakened.length) {
    triggers.push({
      name: 'weakened-assertion',
      files: weakened,
      reason: 'дифф теста удаляет утверждение/блок кейса или переписывает файл больше чем наполовину',
    });
  }

  const newProd = prod.filter((file) => file.isNew).map((file) => file.path);
  if (newProd.length && tests.length === 0) {
    triggers.push({
      name: 'new-code-no-check',
      files: newProd,
      reason: 'новый прод-код без единого нового или изменённого runnable-чека',
    });
  }

  const hotPaths = Array.isArray(config.hotPaths) && config.hotPaths.length ? config.hotPaths : DEFAULT_HOT_PATHS;
  const hotRes = hotPaths.map(globToRe);
  const hot = changed.filter((file) => hotRes.some((re) => re.test(file.path))).map((file) => file.path);
  if (hot.length) {
    triggers.push({ name: 'hot-path', files: hot, reason: 'тронут горячий путь (гейт/авторизация/секреты)' });
  }

  // 011 T025: config.fanIn — геттер (file)=>count|null, построенный loadConfig() (fs-доступ
  // живёт ТАМ, не здесь — evaluate остаётся чистой, AC2). Недоступен (нет соседа
  // elt-oracle-select.js в деплое, или скан не разобрался) → триггера нет вовсе, не ложный
  // block — та же дисциплина, что у codegraph в impact-выборке.
  if (typeof config.fanIn === 'function') {
    const fanInThreshold = Number.isFinite(config.fanInThreshold) && config.fanInThreshold > 0
      ? config.fanInThreshold : DEFAULT_FANIN_THRESHOLD;
    const highFanin = prod
      .map((file) => ({ path: file.path, count: config.fanIn(file.path) }))
      .filter((f) => Number.isFinite(f.count) && f.count > fanInThreshold);
    if (highFanin.length) {
      triggers.push({
        name: 'high-fanin',
        files: highFanin.map((f) => f.path),
        reason: `тронут узел с высокой входящей степенью (${highFanin.map((f) => `${f.path}:${f.count}`).join(', ')}, порог ${fanInThreshold})`,
      });
    }
  }

  // Задача без [files:] не объявила зону — нарушить нечего, триггер молчит вовсе (не «всё
  // подозрительно»), тот же принцип, что у ctx7 при нуле импортов.
  const scopeFiles = taskScopeFiles(taskText);
  if (scopeFiles.length) {
    const outOfScope = changed.map((file) => file.path)
      .filter((p) => !inTaskScope(p, scopeFiles) && !isIgnoredForReview(p));
    if (outOfScope.length) {
      triggers.push({
        name: 'out-of-scope',
        files: outOfScope,
        reason: `файл вне объявленной зоны [files:]: ${outOfScope.join(', ')} — барьерный слайс легитимен, судья решает`,
      });
    }
  }

  const perTask = Number.isFinite(config.diffSizeThreshold) && config.diffSizeThreshold > 0
    ? config.diffSizeThreshold
    : DEFAULT_DIFF_SIZE;
  const tasks = taskCountOf(taskText);
  const threshold = perTask * tasks;
  // 019 T001 (D9): сгенерированное в объём не входит. `package-lock.json` давал 694 строки при
  // пороге 400, а объявить его в `[files:]` невозможно — он появляется сам.
  const lines = changed
    .filter((file) => !isIgnoredForReview(file.path))
    .reduce((sum, file) => sum + file.added + file.removed, 0);
  if (lines > threshold) {
    triggers.push({
      name: 'diff-size',
      files: [],
      reason: `дифф ${lines} строк при пороге ${threshold}` + (tasks > 1 ? ` (${perTask} × ${tasks} задачи)` : ''),
    });
  }

  // 011 T009: единственный триггер, который сам выносит вердикт, а не будит судью. Новый
  // внешний импорт без свежего обращения к ctx7 — это не «подозрительно», это неподтверждённый
  // API, и спорить тут не о чем. R5: если мёртв САМ ctx7 (а не пруф отсутствует) — это
  // `inconclusive` с причиной: внешний сервис не должен останавливать работу.
  //
  // 019 T018 (D10): «новый внешний импорт» — это пакет, которого НЕ БЫЛО в манифесте до
  // слайса, а не любое первое упоминание пакета в диффе. Четыре воспроизведения подряд:
  // слайс добавляет тест-файл с `import { test } from 'vitest'`, vitest стоит в
  // `package.json` с первого коммита и в 48 файлах, — и гейт выносил `block` за
  // «неподтверждённый API». Флаг срабатывал автоматически на каждом слайсе с новым тестом,
  // не нёс информации и учил игнорировать вердикт целиком.
  // Список берётся с БАЗЫ (`git show HEAD:package.json`), а не из рабочего дерева: пакет,
  // добавленный этим же слайсом, обязан остаться поводом сходить в ctx7.
  const ctx7 = (config.ctx7 && typeof config.ctx7 === 'object') ? config.ctx7 : {};
  const known = config.knownPackages instanceof Set ? config.knownPackages : new Set();
  const imports = externalImports(diff).filter((pkg) => !known.has(pkg));
  if (imports.length) {
    const proofs = Array.isArray(ctx7.proofs) ? ctx7.proofs : [];
    const freshDays = Number.isFinite(ctx7.freshDays) && ctx7.freshDays > 0 ? ctx7.freshDays : CTX7_FRESH_DAYS;
    const uncovered = imports.filter((pkg) => !ctx7Covered(pkg, proofs, freshDays));
    if (uncovered.length) {
      const available = ctx7.available !== false; // не заявили обратного — считаем живым
      triggers.push({
        name: 'external-import-no-ctx7',
        files: uncovered,
        reason: available
          ? `новый внешний импорт без свежего пруфа ctx7 (${freshDays} дн.): ${uncovered.join(', ')}`
          : `ctx7 недоступен (${ctx7.reason || 'причина не названа'}) — API импортов ${uncovered.join(', ')} нечем подтвердить`,
      });
      return { triggers, judgeNeeded: true, verdict: available ? 'block' : 'inconclusive' };
    }
  }

  return { triggers, judgeNeeded: triggers.length > 0 };
}

// 011 T025 — фан-ин: НЕ чистая функция (fs), поэтому живёт рядом с loadConfig, а не внутри
// evaluate(). Источник — уже существующие `walkJs`+`dependents` из elt-oracle-select.js, тот же
// обратный скан, что кормит impact-выборку («не заводить нового источника данных»). Возвращает
// ГЕТТЕР (замыкание, кэш внутри), а не сырую карту всего репо: скан директорий (дёшево) идёт
// сразу, но чтение содержимого файлов (`dependents`) — лениво, только для реально изменённых
// файлов слайса (обычно 1-5), а не для всех ~288 при каждом гейте.
// Сосед недоступен (устаревшая deploy-копия без elt-oracle-select.js в замыкании — тот же
// класс отказа, что T017) → null, а не исключение: вызывающий evaluate() уже трактует
// non-function fanIn как «сигнала нет», не как ошибку.
function computeFanIn(cwd, scanDirs = ['tools']) {
  const fs = require('fs');
  const path = require('path');
  let oracleSelect;
  try { oracleSelect = require('./elt-oracle-select'); } catch { return null; }
  const pool = [...new Set(scanDirs.flatMap((d) => oracleSelect.walkJs(path.join(cwd, d), cwd)))];
  const readFile = (rel) => { try { return fs.readFileSync(path.join(cwd, rel), 'utf8'); } catch { return ''; } };
  const cache = new Map();
  return (file) => {
    if (cache.has(file)) return cache.get(file);
    // Файл вне скан-пула (тест-файл, внешний путь, конфиг) — фан-ин неизвестен, не ноль:
    // triggers.filter уже требует Number.isFinite, так что null тут же и отсеется.
    if (!pool.includes(file)) { cache.set(file, null); return null; }
    const affected = oracleSelect.dependents([file], pool, readFile);
    const count = affected.size - 1; // минус сам файл
    cache.set(file, count);
    return count;
  };
}

// 014 T002 — «переписка > 50% строк файла» (REWRITE_RATIO) нужна ОРИГИНАЛЬНАЯ длина файла на
// baseHead; unified diff с ограниченным контекстом её не несёт. Гетter, а не аргумент evaluate()
// напрямую — та же дисциплина, что у computeFanIn: git-доступ живёт тут, evaluate() чистая.
// Файл не читается (новый файл, git недоступен) → null, вызывающий уже трактует не-число как
// «сигнала нет» (Number.isFinite в weakenedTestFiles).
function originalLineCounter(cwd) {
  const { spawnSync } = require('child_process');
  const cache = new Map();
  return (relPath) => {
    if (cache.has(relPath)) return cache.get(relPath);
    const r = spawnSync('git', ['show', `HEAD:${relPath}`], { cwd, encoding: 'utf8', timeout: 5000 });
    const n = (!r.error && r.status === 0) ? r.stdout.split(/\r?\n/).length : null;
    cache.set(relPath, n);
    return n;
  };
}

// 011 T017 (в): конфиг L0 читают ДВА вызывающих — `judge-core.js` перед судьёй и `elt.js` перед
// оракулом. Живёт он здесь, а не в gate.js, потому что elt.js не может тянуть fleet-путь
// (providers/router/замыкание sync-bin) ради чтения одного json'а. `evaluate` остаётся ЧИСТОЙ
// (AC2) — ввод-вывод в отдельной функции, её и зовут снаружи.
function loadConfig(cwd) {
  const fs = require('fs');
  const path = require('path');
  let cfg = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'harness.json'), 'utf8')).l0;
    if (j && typeof j === 'object' && !Array.isArray(j)) cfg = { ...j };
  } catch { /* нет конфига — дефолты evaluate */ }
  let proofs = [];
  try {
    proofs = fs.readFileSync(path.join(cwd, '.harness', 'ctx7-proof.jsonl'), 'utf8')
      .split(/\r?\n/).filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { /* файла нет — пруфов нет, и это значимо: новый внешний импорт даст block */ }
  return {
    ...cfg,
    ctx7: { ...(cfg.ctx7 || {}), proofs },
    fanIn: computeFanIn(cwd),
    originalLineCount: originalLineCounter(cwd),
    knownPackages: knownPackagesAtBase(cwd),
  };
}

// 019 T018 (D10): пакеты, объявленные в манифесте НА БАЗЕ слайса. Читается через git, а не с
// диска: рабочее дерево уже содержит пакет, который слайс только что добавил, и по нему
// «новый импорт» стал бы неотличим от «импорт того, что стояло всегда».
// Манифеста нет, git недоступен, json битый → пустое множество: тогда поведение ровно такое,
// каким было до этой правки, — не тише, чем раньше.
function knownPackagesAtBase(cwd) {
  const { spawnSync } = require('child_process');
  const out = new Set();
  const r = spawnSync('git', ['show', 'HEAD:package.json'], { cwd, encoding: 'utf8', timeout: 5000 });
  if (r.error || r.status !== 0) return out;
  let pkg = null;
  try { pkg = JSON.parse(r.stdout); } catch { return out; }
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const section = pkg && pkg[field];
    if (section && typeof section === 'object') for (const name of Object.keys(section)) out.add(name);
  }
  return out;
}

module.exports = {
  evaluate, loadConfig, externalImports, ctx7Covered, isCodePosition, isCommentLine, DEFAULT_HOT_PATHS, DEFAULT_DIFF_SIZE, CTX7_FRESH_DAYS,
  taskScopeFiles, inTaskScope, isHarnessOwned, isIgnoredForReview, taskCountOf,
  computeFanIn, DEFAULT_FANIN_THRESHOLD, knownPackagesAtBase,
  weakenedTestFiles, originalLineCounter, ASSERT_REMOVE_RE, TEST_BLOCK_RE, REWRITE_RATIO, isCodePosition,
};
