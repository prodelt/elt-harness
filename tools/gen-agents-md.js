#!/usr/bin/env node
'use strict';
// gen-agents-md.js — 019 T013. Инструкции проекта живут в ОДНОМ файле.
//
// Было три копии одного текста: `CLAUDE.md` (Claude Code), `AGENTS.md` (Codex) и
// `.gemini/GEMINI.md` (Antigravity). Копии разошлись молча и по-разному: на момент правки
// `AGENTS.md` всё ещё указывал на `tools/fleet/providers.js`, а `.gemini/GEMINI.md` — на
// `tools/elt-loop.ps1`; оба пути удалены спекой 019 (T006, T007). Именно это и есть корень
// жалобы «agy не читает скилы»: он читает — просто читает УСТАРЕВШИЙ текст, в котором нет
// ни правильного пути к скиллу, ни правильных команд.
//
// Дрейф нельзя починить дисциплиной: три файла, которые человек обязан править синхронно,
// расходятся всегда. Поэтому источник ровно один — `CLAUDE.md`, остальные генерируются, а
// тест сверяет их байт-в-байт и краснеет на любом расхождении.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = 'CLAUDE.md';

// Производные копии. Каждая — тот же текст под своим именем: так его ищут разные CLI.
const DERIVED = [
  { file: 'AGENTS.md', reader: 'Codex CLI' },
  { file: path.join('.gemini', 'GEMINI.md'), reader: 'Antigravity (agy)' },
];

function banner(reader) {
  return [
    `<!-- СГЕНЕРИРОВАНО из ${SOURCE} командой \`node tools/gen-agents-md.js\`. Читатель: ${reader}.`,
    '     Правки вносить в CLAUDE.md — этот файл перезаписывается, и тест на дрейф краснеет. -->',
    '',
    '',
  ].join('\n');
}

// Перевод строк нормализуется к LF ДО сравнения. Иначе тест на дрейф краснел бы у любого,
// кто сделал свежий checkout под Windows с `core.autocrlf` — ровно тот класс, которым был
// D23 (пять линз ревью не грузились с CRLF).
function normalize(text) {
  return String(text).replace(/\r\n/g, '\n');
}

function sourceText(root = ROOT) {
  return normalize(fs.readFileSync(path.join(root, SOURCE), 'utf8'));
}

function render(reader, root = ROOT) {
  return banner(reader) + sourceText(root);
}

// Возвращает список расхождений: пусто — копии совпадают с источником.
function drift(root = ROOT) {
  const out = [];
  for (const { file, reader } of DERIVED) {
    const full = path.join(root, file);
    const want = render(reader, root);
    let have = null;
    try { have = normalize(fs.readFileSync(full, 'utf8')); } catch { /* нет файла */ }
    if (have === null) out.push({ file, reason: 'файла нет' });
    else if (have !== want) out.push({ file, reason: 'содержимое разошлось с CLAUDE.md' });
  }
  return out;
}

function generate(root = ROOT) {
  const written = [];
  for (const { file, reader } of DERIVED) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, render(reader, root), 'utf8');
    written.push(file);
  }
  return written;
}

function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  if (argv.includes('--check')) {
    const bad = drift();
    if (!bad.length) { out.write(`gen-agents-md: копии совпадают с ${SOURCE}\n`); return 0; }
    for (const d of bad) err.write(`gen-agents-md: ДРЕЙФ ${d.file} — ${d.reason}\n`);
    err.write('gen-agents-md: починить одной командой — node tools/gen-agents-md.js\n');
    return 1;
  }
  const written = generate();
  out.write(`gen-agents-md: из ${SOURCE} сгенерировано ${written.length}: ${written.join(', ')}\n`);
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = { generate, drift, render, sourceText, normalize, SOURCE, DERIVED, ROOT };
