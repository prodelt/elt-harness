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
const path = require('node:path');
const { runJudge } = require('./fleet/gate');
const { redProof } = require('./red-proof');
const { judgeSettings, verifySettings } = require('./elt-config');

// 008 T004: включённый контур — verify задан ИЛИ harness.json.redProof не "off"/пуст.
// redProof — простое строковое поле, elt-config.js его не валидирует, читаем напрямую.
function redProofMode(cwd) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'harness.json'), 'utf8'));
    return typeof j.redProof === 'string' ? j.redProof.trim() : '';
  } catch { return ''; }
}
function circuitEnabled(cwd) {
  return !!verifySettings(cwd) || (redProofMode(cwd) !== '' && redProofMode(cwd) !== 'off');
}

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

  // judges[] (008 T004): всегда массив, даже без второго судьи (T002 обратная совместимость
  // оставляет r.judges===undefined без verify) — иначе proof не мог бы требовать judges[]
  // при контуре, включённом только через redProof (без verify).
  const judges = Array.isArray(r.judges) && r.judges.length
    ? r.judges
    : [{ provider, model, verdict: r.verdict, reasons: r.reasons || [], durationSec: r.durationSec, runOk: r.runOk }];
  const grounding = { filesReviewed: r.filesReviewed || [] };

  let verdict = r.verdict || null;
  let reasons = r.reasons || [];
  let redProofResult = null;
  // Red-proof — только на легитимный pass (флоу спеки 008: судья(и) pass → red-proof) и
  // только когда контур включён (без опт-ина — не платим прогоном тестов на каждом слайсе).
  if (r.runOk && verdict === 'pass' && circuitEnabled(cwd)) {
    redProofResult = redProof({ cwd, baseHead: 'HEAD' });
    if (redProofResult.status === 'green') {
      verdict = 'block';
      reasons = [...reasons, 'red-proof:green'];
    }
  }

  // l0 (011 T003) — решение механики «звать ли судью» и список триггеров. Едет наружу as-is:
  // без него `elt judge run` не отличит `l0-clean` от обычного pass и run-log потеряет причину.
  process.stdout.write(JSON.stringify({
    runOk: !!r.runOk, verdict: r.runOk ? verdict : null, reasons, judgeLog: r.judgeLog || null,
    judges, grounding, redProof: redProofResult, l0: r.l0 || null,
  }));
  process.exit(0);
}

main();
