'use strict';
// plan.js — разбор elt-плана (tasks.md) в fleet-слайсы и выбор параллельного батча (T005).
// Поверх elt slice-формата: `- [ ] **T001** текст [P] [M] [cli:codex] [files:a*,b*]`.
//  [P]        — можно параллелить;
//  [S|M|L]    — размер (для роутера T010);
//  [cli:x]    — предпочтительный провайдер;
//  [files:..] — зона правок (глобы через запятую) — основа disjoint-проверки.
const fs = require('node:fs');

const LINE = /^\s*-\s*\[( |x|X)\]\s*\*\*(T\d+)\*\*\s*(.*)$/;

function parse(content) {
  const slices = [];
  for (const raw of content.split(/\r?\n/)) {
    const m = raw.match(LINE);
    if (!m) continue;
    const [, mark, id, text] = m;
    slices.push({
      id,
      text: text.trim(),
      done: mark.toLowerCase() === 'x',
      parallel: /\[P\]/.test(text),
      size: (text.match(/\[(S|M|L)\]/) || [])[1] || null,
      cli: (text.match(/\[cli:([^\]]+)\]/) || [])[1] || null,
      files: (text.match(/\[files:([^\]]+)\]/) || [])[1]
        ? (text.match(/\[files:([^\]]+)\]/)[1]).split(',').map((s) => s.trim()).filter(Boolean)
        : [],
      raw,
    });
  }
  return slices;
}

function parseFile(tasksPath) {
  return parse(fs.readFileSync(tasksPath, 'utf8'));
}

// Префикс глоба до первого спецсимвола — зона покрытия.
function globPrefix(g) {
  const i = g.search(/[*?[]/);
  return (i === -1 ? g : g.slice(0, i)).replace(/\\/g, '/');
}

// Пересекаются ли зоны правок двух слайсов? Пустой files = неизвестная зона →
// конфликтует со всеми (безопасный дефолт: не параллелить вслепую).
// ponytail: сравнение по префиксу (startsWith) — консервативно (plan* vs plans* даст
// ложный конфликт, лишь чуть сериализует). Апгрейд: полноценный glob-matcher, если
// понадобится тоньше.
function filesConflict(a, b) {
  if (!a.length || !b.length) return true;
  for (const x of a) for (const y of b) {
    const px = globPrefix(x), py = globPrefix(y);
    if (px === py || px.startsWith(py) || py.startsWith(px)) return true;
  }
  return false;
}

// Следующий батch слайсов из открытых (в порядке плана):
//  - первый открытый не-[P] → барьер: батч = [он] (идёт один, после всех предыдущих);
//  - первый открытый [P] → набираем подряд идущие [P] с непересекающимися files,
//    останавливаемся на первом не-[P] (барьер) ИЛИ [P] с конфликтом зон (ждёт раунда).
function nextBatch(slices) {
  const open = slices.filter((s) => !s.done);
  if (!open.length) return [];
  const head = open[0];
  if (!head.parallel) return [head];
  const batch = [head];
  for (let i = 1; i < open.length; i++) {
    const s = open[i];
    if (!s.parallel) break; // барьер
    if (batch.some((b) => filesConflict(b.files, s.files))) break; // ждёт следующего раунда
    batch.push(s);
  }
  return batch;
}

module.exports = { parse, parseFile, nextBatch, filesConflict, globPrefix };
