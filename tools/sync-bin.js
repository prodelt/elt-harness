#!/usr/bin/env node
'use strict';
// sync-bin.js — один деплой ELT runtime: CLI в `~/.claude/bin/` и замыкание judge-моста
// в `~/.claude/bin/judge/`. Раньше команда обновляла только judge/, а сам elt.js оставался
// старым — именно так разные проекты получали разные протоколы после «успешной» синхронизации.
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
  'elt-oracle-select.js', // 011 T025: elt-gate-l0.js требует его для фан-ин (walkJs+dependents)
  'judge-replay.js',  // 011 T011: им fleet пишет proof тем же путём, что интерактив
  path.join('fleet', 'gate.js'),
  path.join('fleet', 'providers.js'),
  path.join('fleet', 'exec.js'),
  path.join('fleet', 'plan.js'),
  path.join('fleet', 'router.js'),
];

const ROOT_CLOSURE = [
  'elt.js',
  'elt-config.js',
  'run-log.js',
  'elt-stats.js',
  // 014 T018: `elt brief` (T011) в deploy-копии падал `Cannot find module './elt-brief'` — файл
  // не входил в замыкание, а smoke этого не ловит. Скилл теперь прямо велит звать brief ПЕРЕД
  // слайсом, значит снаружи он обязан работать, а не только в репо-разработчике.
  'elt-brief.js',
  'harness-watch.js',
  'elt-verify-bg.js', // 014 T005: elt.js commit требует его лениво в verify:"background" ветке
  // 014 T009: слои фона тянут мутатор (верхний require) и судью (ленивый require fleet/gate.js
  // со всем его замыканием). Без них deploy-копия падала MODULE_NOT_FOUND ДО открытия лога —
  // фон не стартовал вовсе, и это выглядело как «всё тихо», ровно та слепота, ради которой
  // написан T008. Поймано живым прогоном T009/T010, а не тестом: тесты требуют tools/ напрямую.
  'elt-mutate.js',
  ...CLOSURE,
  path.join('fleet', 'providers.js'),
  path.join('fleet', 'router.js'),
];

const DEPRECATED_SHIMS = {
  'harness-runner.cmd': '@echo off\r\n1>&2 echo DEPRECATED: harness-runner removed. Use ELT v3: node "%USERPROFILE%\\.claude\\bin\\elt.js" status ^| oracle ^| judge run ^| commit\r\nexit /b 64\r\n',
  'harness-runner.ps1': '[Console]::Error.WriteLine(\'DEPRECATED: harness-runner removed. Use ELT v3: node "$env:USERPROFILE\\.claude\\bin\\elt.js" status | oracle | judge run | commit\')\r\nexit 64\r\n',
  'harness-gates.cmd': '@echo off\r\n1>&2 echo DEPRECATED: harness-gates removed. Use ELT v3: node "%USERPROFILE%\\.claude\\bin\\elt.js" oracle ^| judge run ^| commit\r\nexit /b 64\r\n',
  'harness-gates.ps1': '[Console]::Error.WriteLine(\'DEPRECATED: harness-gates removed. Use ELT v3: node "$env:USERPROFILE\\.claude\\bin\\elt.js" oracle | judge run | commit\')\r\nexit 64\r\n',
};

function syncBin({ toolsRoot = __dirname, home = os.homedir() } = {}) {
  const rootDest = path.join(home, '.claude', 'bin');
  const dest = path.join(rootDest, 'judge');
  const copied = [];
  const rootCopied = [];
  const shimmed = [];
  for (const rel of ROOT_CLOSURE) {
    const src = path.join(toolsRoot, rel);
    const out = path.join(rootDest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(src, out);
    rootCopied.push(rel);
  }
  for (const [name, content] of Object.entries(DEPRECATED_SHIMS)) {
    fs.writeFileSync(path.join(rootDest, name), content, 'utf8');
    shimmed.push(name);
  }
  for (const rel of CLOSURE) {
    const src = path.join(toolsRoot, rel);
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(src, out);
    copied.push(rel);
  }
  return { rootDest, rootCopied, shimmed, dest, copied };
}

if (require.main === module) {
  const homeIdx = process.argv.indexOf('--home');
  const home = homeIdx !== -1 ? process.argv[homeIdx + 1] : os.homedir();
  const { rootDest, rootCopied, shimmed, dest, copied } = syncBin({ home });
  process.stdout.write(`sync-bin: runtime ${rootCopied.length} + ${shimmed.length} deprecated shims → ${rootDest}; judge ${copied.length} → ${dest}\n`);
}

module.exports = { syncBin, CLOSURE, ROOT_CLOSURE, DEPRECATED_SHIMS };
