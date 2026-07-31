#!/usr/bin/env node
'use strict';
// sync-bin.js — копирует замыкание моста судьи (judge-invoke.js + зависимости, T002 спеки
// 010) в `~/.claude/bin/judge/`, чтобы проекты без repo-checkout репо-разработчика (elt.js
// резолвит их фолбэком, T003) могли запускать судью через `elt judge run`.
//
// Замыкание фиксировано вручную (не auto-discovery require-графа): tasks.md T002 перечисляет
// ровно эти файлы, и relative require() внутри них (`./fleet/gate`, `../elt-config`, ...)
// резолвятся корректно, только если структура папок сохранена 1:1 при копировании.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CLOSURE = [
  'judge-invoke.js',
  'red-proof.js',
  'elt-config.js',
  'elt-gate-l0.js',   // 011 T003: gate.js требует его ДО судьи — без него мост мёртв в проектах
  'judge-replay.js',  // 011 T011: им fleet пишет proof тем же путём, что интерактив
  path.join('fleet', 'gate.js'),
  path.join('fleet', 'providers.js'),
  path.join('fleet', 'exec.js'),
  path.join('fleet', 'plan.js'),
  path.join('fleet', 'router.js'),
];

function syncBin({ toolsRoot = __dirname, home = os.homedir() } = {}) {
  const dest = path.join(home, '.claude', 'bin', 'judge');
  const copied = [];
  for (const rel of CLOSURE) {
    const src = path.join(toolsRoot, rel);
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(src, out);
    copied.push(rel);
  }
  return { dest, copied };
}

if (require.main === module) {
  const homeIdx = process.argv.indexOf('--home');
  const home = homeIdx !== -1 ? process.argv[homeIdx + 1] : os.homedir();
  const { dest, copied } = syncBin({ home });
  process.stdout.write(`sync-bin: ${copied.length} файлов → ${dest}\n`);
}

module.exports = { syncBin, CLOSURE };
