#!/usr/bin/env node
'use strict';
// 011 T011 — мост-повтор для fleet-гейта.
//
// Зачем: до 011 fleet писал proof отдельной командой `judge-proof write --attested-by
// fleet-gate` — то есть в CLI существовал флаг, который проводил вердикт мимо судьи. Агент с
// доступом к шеллу мог набрать его сам, и это было переименованное самозаверение, а не защита.
// Флага больше нет; вместо него fleet идёт ТЕМ ЖЕ путём, что интерактив — `elt judge run`.
//
// Судью гейт уже отработал (`runJudge` внутри процесса), второй раз спавнить его нельзя —
// это плюс 190 c и другой вердикт. Поэтому мост не судит, а ПОВТОРЯЕТ готовый результат:
// gate.js кладёт его в файл и называет путь в ELT_JUDGE_REPLAY. Контракт stdout — тот же, что
// у judge-invoke.js (один JSON), так что `elt judge run` не знает разницы и писать proof
// продолжает одна функция на оба пути.
const fs = require('node:fs');

const file = process.env.ELT_JUDGE_REPLAY;
if (!file) {
  process.stderr.write('judge-replay: не задан ELT_JUDGE_REPLAY (путь к результату судьи)\n');
  process.exit(2);
}
// BOM снимаем по той же причине, что и в judge-invoke.js: PS5.1 пишет utf8 с ним.
process.stdout.write(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
