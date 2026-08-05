#!/usr/bin/env node
'use strict';
// Тесты для sync-bin.js (T002 спеки 010).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const { syncBin, CLOSURE, ROOT_CLOSURE, DEPRECATED_SHIMS } = require('./sync-bin');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    process.stdout.write(`  [PASS] ${label}\n`);
  } else {
    failed++;
    process.stdout.write(`  [FAIL] ${label}\n`);
  }
}

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ── все файлы замыкания скопированы на диск ────────────────────────────────

{
  const tmpHome = makeTmpDir('sync-bin-copy-');
  const { rootDest, rootCopied, shimmed, dest, copied } = syncBin({ toolsRoot: __dirname, home: tmpHome });
  assert(copied.length === CLOSURE.length, 'copied.length === CLOSURE.length');
  assert(rootCopied.length === ROOT_CLOSURE.length, 'rootCopied.length === ROOT_CLOSURE.length');
  assert(shimmed.length === Object.keys(DEPRECATED_SHIMS).length, 'все deprecated-шлюзы установлены');
  for (const rel of ROOT_CLOSURE) {
    assert(fs.existsSync(path.join(rootDest, rel)), `скопирован runtime ${rel}`);
  }
  for (const rel of CLOSURE) {
    assert(fs.existsSync(path.join(dest, rel)), `скопирован ${rel}`);
  }
  for (const [name, content] of Object.entries(DEPRECATED_SHIMS)) {
    assert(fs.readFileSync(path.join(rootDest, name), 'utf8') === content, `${name} закреплён sync-bin`);
  }
  if (process.platform === 'win32') {
    for (const name of Object.keys(DEPRECATED_SHIMS)) {
      const file = path.join(rootDest, name);
      const run = name.endsWith('.cmd')
        ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', file], { encoding: 'utf8' })
        : spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { encoding: 'utf8' });
      assert(run.status === 64, `${name} завершает старый маршрут с exit 64`);
      assert(/DEPRECATED:.*ELT v3/.test(run.stderr) && !/MODULE_NOT_FOUND/.test(run.stderr), `${name} указывает на ELT v3 без старого runtime`);
    }
  }
}

// ── мост грузится и работает из копии во временном HOME, репо на пути загрузки
//    отсутствует (require резолвится целиком внутри копии) ─────────────────

{
  const tmpHome = makeTmpDir('sync-bin-load-');
  const { dest } = syncBin({ toolsRoot: __dirname, home: tmpHome });
  const bridgePath = path.join(dest, 'judge-invoke.js');

  // Запускаем require() копии из процесса с cwd ВНЕ репо (temp-каталог), без
  // usage-аргумента: judge-invoke.js падает на "usage: ..." при отсутствии descriptor.json —
  // это ожидаемо, проверяем именно что require() всех зависимостей прошёл успешно (exit 2,
  // не MODULE_NOT_FOUND).
  const outsideCwd = makeTmpDir('sync-bin-cwd-');
  try {
    execFileSync(process.execPath, [bridgePath], {
      cwd: outsideCwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert(false, 'ожидался exit 2 (нет descriptor.json)');
  } catch (err) {
    const stderr = err.stderr || '';
    assert(err.status === 2, `exit 2 (получен ${err.status})`);
    assert(!/MODULE_NOT_FOUND/.test(stderr), `require() резолвится без MODULE_NOT_FOUND (stderr: ${stderr.slice(0, 200)})`);
    assert(/usage:/.test(stderr), 'usage-сообщение из скопированного judge-invoke.js');
  }

  // Путь копии не пересекается с репо-tools/ — доказывает, что резолв целиком внутри неё.
  const repoToolsRoot = path.resolve(__dirname);
  assert(!dest.startsWith(repoToolsRoot), 'копия вне репо-tools/');
}

// ── summary ──────────────────────────────────────────────────────────────────

process.stdout.write(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
