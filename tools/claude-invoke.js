#!/usr/bin/env node
'use strict';
// claude-invoke.js — совместимое имя универсального моста elt-loop.ps1 → providers.run().
//
// Почему это существует: Windows PowerShell 5.1 (`& $exe @ArgsArray`) не умеет
// корректно маршалить argv-элементы с embedded `"` в нативный .exe — отдельный,
// более глубокий дефект, чем уже пофикшенный баг #10 (cmd.exe-шим). Судейская
// --json-schema (и промпты имплементатора с diff'ами реального кода, где
// двойные кавычки почти неизбежны) ломались молча: PowerShell манглит аргумент,
// claude.exe падает с ошибкой в stderr, elt-loop.ps1 глушит stderr (2>$null) →
// пустой лог → REJECT-default блокирует ЛЮБОЙ слайс, неотличимо от реального
// reject (обнаружено 2026-07-11 на A/B fleet-vs-solo прогоне, solo T002).
//
// providers.run() уже спавнит claude.exe БЕЗ shell → Windows-экранирование
// делает сам Node (корректно, проверено live: fleet T001-T003 в этом же
// прогоне). Обходим PowerShell-маршалинг ПОЛНОСТЬЮ: PowerShell пишет промпт
// и параметры вызова во временные файлы (без argv), сюда прилетает только
// путь к JSON-дескриптору — единственный argv-элемент, простая строка без
// кавычек внутри.
const fs = require('node:fs');
const path = require('node:path');
const { run, DEFAULT_TIMEOUT_MS } = require('./providers');
const { effortFor } = require('./effort-policy');

async function main() {
  const descPath = process.argv[2];
  if (!descPath) {
    process.stderr.write('usage: node claude-invoke.js <descriptor.json>\n');
    process.exit(2);
  }
  // PS5.1 `Out-File -Encoding utf8` пишет BOM (задокументированная ловушка проекта) —
  // JSON.parse иначе падает на U+FEFF в начале файла, до всякого спавна claude.
  const desc = JSON.parse(fs.readFileSync(descPath, 'utf8').replace(/^﻿/, ''));
  const {
    provider = 'claude',
    prompt = '',
    cwd = process.cwd(),
    model = null,
    jsonSchema = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    logPath = null,
    effort = null, // T003: адаптивный эффорт (claude --effort), проброс из elt-loop.ps1
    phase = null,  // T004: 'impl'|'heal' — драйвер объявляет фазу, политика маппит в уровень
    sessionId = null, // T007: session-rotation (elt-drive.ps1) — проброс к providers.run()
    resume = false,   // T007: true → -r/--resume <sessionId>; false → --session-id <sessionId>
  } = desc;

  // T004: явный effort побеждает; иначе резолвим из фазы (impl→high, heal→max). Нет ни того,
  // ни другого → null (флаг не добавится, старое поведение). Единый источник — effort-policy.js.
  const resolvedEffort = effort || (phase ? effortFor(phase) : null);

  // Solo-driver передаёт явную роль (agy writer; claude/codex fixer). lean:false сохраняет
  // проектные AGENTS/GEMINI/CLAUDE инструкции; это не изолированный fleet-worker.
  const r = await run({ provider, prompt, cwd, model, jsonSchema, timeoutMs, lean: false, effort: resolvedEffort, sessionId, resume });

  // Append, не overwrite: сохраняет старую семантику elt-loop.ps1 (self-heal дописывался
  // в тот же $implLog, что и имплементатор). Для свежего logPath (implLog/judgeLog в первый
  // раз) append на несуществующий/пустой файл эквивалентен записи — разницы нет.
  if (logPath && r.logPath) {
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, fs.readFileSync(r.logPath));
    } catch { /* лог не критичен для вердикта */ }
  }

  process.stdout.write(r.stdout || '');
  process.exit(r.ok ? 0 : 1);
}

main();
