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
const DEFAULT_DIFF_SIZE = 400;

const TEST_PATH = /(^|\/)[^/]*\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(tests?|__tests__)\//i;
const CODE_PATH = /\.(js|cjs|mjs|jsx|ts|tsx|py|go|rs|rb|java|cs|php|sh|ps1)$/i;

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
      current = { path: normalize(header[2], cwd), added: 0, removed: 0, isNew: false, isDeleted: false };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('new file mode ')) current.isNew = true;
    else if (line.startsWith('deleted file mode ')) current.isDeleted = true;
    else if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    else if (line.startsWith('+')) current.added += 1;
    else if (line.startsWith('-')) current.removed += 1;
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

function evaluate({ diff = '', status = '', config = {}, cwd = '' } = {}) {
  const changed = mergeChanged(parseDiff(diff, cwd), parseStatus(status, cwd));
  const tests = changed.filter((file) => TEST_PATH.test(file.path));
  const prod = changed.filter((file) => !TEST_PATH.test(file.path) && CODE_PATH.test(file.path));
  const triggers = [];

  const modifiedTests = tests.filter((file) => !file.isNew).map((file) => file.path);
  if (modifiedTests.length) {
    triggers.push({
      name: 'existing-test-modified',
      files: modifiedTests,
      reason: 'правится тест, существовавший на baseHead — проверка могла быть ослаблена под код',
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

  const threshold = Number.isFinite(config.diffSizeThreshold) && config.diffSizeThreshold > 0
    ? config.diffSizeThreshold
    : DEFAULT_DIFF_SIZE;
  const lines = changed.reduce((sum, file) => sum + file.added + file.removed, 0);
  if (lines > threshold) {
    triggers.push({ name: 'diff-size', files: [], reason: `дифф ${lines} строк при пороге ${threshold}` });
  }

  return { triggers, judgeNeeded: triggers.length > 0 };
}

module.exports = { evaluate, DEFAULT_HOT_PATHS, DEFAULT_DIFF_SIZE };
