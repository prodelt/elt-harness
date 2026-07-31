#!/usr/bin/env node
'use strict';
// 011 T008 — мутатор по ИЗМЕНЁННЫМ строкам слайса.
//
// Зачем: зелёный оракул доказывает, что тесты проходят, но не что они хоть что-то ловят.
// Слепая зона (§3.2 спеки): строка, дописанная слайсом, которую не проверяет ни один тест,
// выглядит идентично строке, покрытой намертво. Мутатор ломает ровно её и смотрит, упадёт ли
// хоть один тест. Не упал — строка не покрыта, и это block с файлом и номером строки.
//
// Мутируем ТОЛЬКО изменённые строки, а не файл целиком: цена слоя = число прогонов тестов, и
// полный мутационный анализ репо в гейт не влезает ни при каком бюджете.
//
// ponytail: операторы построчные, регуляркой, без парсера AST. В stdlib парсера JS нет, а
// тянуть зависимость в репо без package.json — из пушки по воробьям. Ценой этого мутатор
// иногда не найдёт что сломать в строке (тогда её просто нет в списке); ложной «выжившей»
// мутации это не создаёт. Апгрейд до AST — когда построчного станет мало.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_BUDGET = { maxMutations: 8, timeoutMs: 5 * 60 * 1000 };
const TEST_RE = /\.test\.[cm]?jsx?$/i;
const CODE_RE = /\.(js|cjs|mjs)$/i;
const COMPARISONS = [['===', '!=='], ['!==', '==='], ['>=', '<'], ['<=', '>'], ['>', '<='], ['<', '>=']];

// Номера ДОБАВЛЕННЫХ/изменённых строк по файлам. -U0: заголовок ханка `@@ -a,b +c,d @@` даёт
// ровно диапазон новых строк, без контекста — мутировать чужой код слайс не должен.
function changedLines(cwd, file) {
  let diff;
  try { diff = execFileSync('git', ['diff', '-U0', 'HEAD', '--', file], { cwd, encoding: 'utf8' }); }
  catch { return []; }
  if (!diff.trim()) {
    // Untracked: в `git diff` его нет вовсе — слайс написал файл целиком, значит изменены все строки.
    try { return fs.readFileSync(path.join(cwd, file), 'utf8').split(/\r?\n/).map((_, i) => i + 1); }
    catch { return []; }
  }
  const lines = [];
  for (const m of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i += 1) lines.push(start + i);
  }
  return lines;
}

// Условие внутри `if (...)`/`while (...)` со сбалансированными скобками — регуляркой такое не
// взять, поэтому считаем глубину руками.
function invertCondition(line) {
  const head = line.match(/\b(if|while)\s*\(/);
  if (!head) return null;
  const open = head.index + head[0].length - 1;
  let depth = 0;
  for (let i = open; i < line.length; i += 1) {
    if (line[i] === '(') depth += 1;
    else if (line[i] === ')') {
      depth -= 1;
      if (depth === 0) {
        const cond = line.slice(open + 1, i);
        if (!cond.trim()) return null;
        return `${line.slice(0, open + 1)}!(${cond})${line.slice(i)}`;
      }
    }
  }
  return null;
}

function swapReturn(line) {
  const m = line.match(/^(\s*return\s+)(.+?)(;?\s*)$/);
  if (!m) return null;
  const value = m[2].trim();
  if (value === 'true') return `${m[1]}false${m[3]}`;
  if (value === 'false') return `${m[1]}true${m[3]}`;
  if (value === 'null') return `${m[1]}1${m[3]}`;
  return `${m[1]}null${m[3]}`;
}

function flipComparison(line) {
  for (const [from, to] of COMPARISONS) {
    const at = line.indexOf(from);
    if (at === -1) continue;
    // `>=` не должен читаться как `>`: пары идут от длинных к коротким, а стрелку функции
    // (`=>`) правкой сравнения делать нельзя — это не условие, а синтаксис.
    if (from === '>' && line[at - 1] === '=') continue;
    return line.slice(0, at) + to + line.slice(at + from.length);
  }
  return null;
}

const OPERATORS = [
  { kind: 'cond-invert', apply: invertCondition },
  { kind: 'return-swap', apply: swapReturn },
  { kind: 'compare-flip', apply: flipComparison },
];

// Что вообще можно сломать в этих строках. Комментарии и пустое пропускаем: сломать нечего,
// а прогон тестов ради них — чистая трата бюджета.
function mutationsFor(text, lineNumbers) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const n of [...new Set(lineNumbers)].sort((a, b) => a - b)) {
    const line = lines[n - 1];
    if (line === undefined) continue;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const op of OPERATORS) {
      const mutated = op.apply(line);
      if (mutated && mutated !== line) { out.push({ line: n, kind: op.kind, before: line, after: mutated }); break; }
    }
  }
  return out;
}

function applyMutation(dir, file, mutation) {
  const full = path.join(dir, file);
  const original = fs.readFileSync(full, 'utf8');
  const lines = original.split(/\r?\n/);
  lines[mutation.line - 1] = mutation.after;
  fs.writeFileSync(full, lines.join('\n'));
  return () => fs.writeFileSync(full, original);
}

// runTests(file) → true, если хоть один тест УПАЛ (мутация убита). Инъекция, а не спавн внутри:
// прогон тестов — самая дорогая и самая проектно-зависимая часть, у CLI ниже свой.
function mutate({ cwd = process.cwd(), files = [], runTests, budget = {} } = {}) {
  const { maxMutations, timeoutMs } = { ...DEFAULT_BUDGET, ...budget };
  const targets = files.filter((f) => CODE_RE.test(f) && !TEST_RE.test(f));
  if (!targets.length) return { status: 'skipped', reason: 'нет изменённых прод-файлов', survived: [], tested: 0 };

  const planned = [];
  for (const file of targets) {
    let text;
    try { text = fs.readFileSync(path.join(cwd, file), 'utf8'); } catch { continue; }
    for (const m of mutationsFor(text, changedLines(cwd, file))) planned.push({ file, ...m });
  }
  if (!planned.length) return { status: 'skipped', reason: 'в изменённых строках нечего ломать', survived: [], tested: 0 };

  const started = Date.now();
  const survived = [];
  let tested = 0;
  for (const mutation of planned) {
    // Бюджет — ПЕРЕД прогоном: превышение это «не проверили», а не «проверили и чисто» (R2).
    if (tested >= maxMutations || Date.now() - started > timeoutMs) {
      return {
        status: 'inconclusive',
        reason: `бюджет исчерпан: проверено ${tested} из ${planned.length} мутаций (${tested >= maxMutations ? `лимит ${maxMutations}` : `таймаут ${timeoutMs} мс`})`,
        survived, tested, planned: planned.length,
      };
    }
    const restore = applyMutation(cwd, mutation.file, mutation);
    let killed;
    try { killed = runTests(mutation.file); } finally { restore(); }
    tested += 1;
    if (!killed) survived.push({ file: mutation.file, line: mutation.line, kind: mutation.kind, code: mutation.before.trim() });
  }
  if (survived.length) {
    const first = survived[0];
    return {
      status: 'block',
      reason: `мутация выжила: ${first.file}:${first.line} (${first.kind}) — строку не проверяет ни один тест`,
      survived, tested, planned: planned.length,
    };
  }
  return { status: 'clean', reason: `все ${tested} мутаций убиты тестами`, survived: [], tested, planned: planned.length };
}

module.exports = { mutate, mutationsFor, changedLines, applyMutation, invertCondition, swapReturn, flipComparison, DEFAULT_BUDGET };
