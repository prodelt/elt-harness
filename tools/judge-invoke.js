#!/usr/bin/env node
'use strict';
// judge-invoke.js — мост elt-loop.ps1 (solo-драйвер) → tools/fleet/gate.runJudge().
//
// Почему существует (T002, spec 004-elt-selfdrive): solo-драйвер раньше инлайнил вызов
// судьи + парсинг вердикта прямо в PowerShell и НЕ отличал «судья не отработал» (пустой
// вывод / timeout / spawn-fail) от реального `block`: пустой $judgeOut → REJECT-default
// оставлял $verdict = "block" → драйвер писал `judge-block` и стопался, неотличимо от
// настоящего reject (баг 3e73423 — судья молча блокировал ЛЮБОЙ слайс). Fleet-путь этот
// класс уже закрыл (gate.runJudge: r.ok=false → runOk:false, НЕ вердикт; T021). Solo теперь
// делегирует туда же — один протестированный источник истины вместо хрупкого PS-дубля.
//
// Контракт: STDIN-дескриптор через файл (без argv-кавычек, как claude-invoke.js —
// PS5.1 не маршалит embedded `"`). STDOUT = один JSON: {runOk, verdict, reasons, judgeLog}.
//   runOk:false          → судья мёртв (ERROR-STOP у драйвера, judge-dead в run-log)
//   runOk:true, verdict  → реальный вердикт (pass|block, REJECT-default внутри gate)
const fs = require('node:fs');
const { runJudge } = require('./fleet/gate');
const { judgeSettings } = require('./elt-config');

async function main() {
  const descPath = process.argv[2];
  if (!descPath) { process.stderr.write('usage: node judge-invoke.js <descriptor.json>\n'); process.exit(2); }
  // PS5.1 Out-File -Encoding utf8 пишет BOM — снимаем перед JSON.parse (ловушка проекта).
  const desc = JSON.parse(fs.readFileSync(descPath, 'utf8').replace(/^﻿/, ''));
  const { cwd = process.cwd(), tid = '', taskText = '', specFile = null } = desc;
  // Судья из harness.json проекта; дескриптор драйвера перебивает (явный флаг сильнее конфига).
  const cfg = judgeSettings(cwd);
  const provider = desc.provider || cfg.provider;
  const model = desc.model || cfg.model;
  const r = await runJudge({ cwd, tid, taskText, provider, model, specFile });
  process.stdout.write(JSON.stringify({
    runOk: !!r.runOk, verdict: r.verdict || null, reasons: r.reasons || [], judgeLog: r.judgeLog || null,
  }));
  process.exit(0);
}

main();
