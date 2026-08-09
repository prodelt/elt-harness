#!/usr/bin/env node
'use strict';
// 014 T005 (фаза B, AC3) — фоновая проверка. `elt commit` при `verify:"background"` выполняет
// L0 + быстрый оракул (impact+кэш, T001) СИНХРОННО, коммитит и возвращает управление; тяжёлые
// слои уходят СЮДА, в отдельный отсоединённый (`detached`) процесс — await здесь свёл бы
// background к тому же sync под другим именем.
//
// T005 НЕ изолирует фон в worktree (это T006: `.fleet-wt/`, git checkout на хеше коммита) —
// на этом слайсе фон честно бежит по ТЕКУЩЕМУ дереву на момент старта. Гонка со следующим
// слайсом (stale-tree) — то, ради чего существует T006, и он идёт следующим по красной линии
// спеки (dogfood: T005 закрывается ещё старым синхронным гейтом).
//
// Единственный слой пока — полный оракул (`--full`, без impact-выборки: это и есть «тяжёлое»,
// которое раньше стояло на критическом пути). T009 добавит мутатор/smoke/судью в тот же файл.
//
// Файл двойного назначения (как elt-oracle-runner.js): `spawnBackgroundVerify` вызывается ИЗ
// `elt.js` (родитель), а `require.main===module` ветка — это тело САМОГО фонового процесса,
// запущенного `node tools/elt-verify-bg.js --run <hash> <taskId>`. Так append-в-run-log-после-
// завершения живёт в процессе, который переживёт родителя, без отдельного файла-обёртки —
// красная линия спеки запрещает трогать файлы вне [files:] этой задачи.

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const runLog = require('./run-log');

const BG_LOG_DIR = path.join('.harness', 'loop-logs'); // уже в .gitignore (соседи 011 T012/judge-bench)

// Родитель (elt.js commit): отправляет фон и НЕ ждёт его — `unref()` снимает child с event loop
// родителя, поэтому `process.exit()` в elt.js не убивает уже отсоединённый (`detached`) child.
function spawnBackgroundVerify({ cwd, commitHash, taskId }) {
  fs.mkdirSync(path.join(cwd, BG_LOG_DIR), { recursive: true });
  const logPath = path.join(cwd, BG_LOG_DIR, `bg-${commitHash}.log`);
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(
    process.execPath,
    [__filename, '--run', commitHash, taskId || ''],
    { cwd, stdio: ['ignore', logFd, logFd], detached: true },
  );
  child.unref();
  fs.closeSync(logFd);
  return { pid: child.pid, logPath: path.relative(cwd, logPath) };
}

// Тело фонового процесса. Вынесено из require.main-ветки, чтобы тест мог прогнать его
// напрямую (без реального spawn — детство «медленный тест = никто не гоняет» здесь неуместно;
// у самого T005 уже есть кэш оракула T001, но интеграционный прогон всё равно не бесплатен).
function runBackgroundVerify({ cwd, commitHash, taskId, oracleCmd = 'node tools/elt-oracle-runner.js --full' }) {
  const started = Date.now();
  // ponytail: наивный split(' ') — реальная команда (дефолт выше) без пробелов внутри
  // аргументов, шелл не нужен. Апгрейд до разбора кавычек — когда команда с пробелом-в-
  // аргументе реально понадобится (T009 может принести такую).
  const [bin, ...args] = oracleCmd.split(' ');
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8' });
  const exit = r.status == null ? 1 : r.status;
  const durationSec = (Date.now() - started) / 1000;
  runLog.appendRunLog(cwd, {
    task: taskId || null,
    commit: commitHash,
    status: exit === 0 ? 'background-verify-pass' : 'background-verify-red',
    background: { layer: 'suite', exit, durationSec },
  });
  return { exit, durationSec };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--run');
  const commitHash = i >= 0 ? args[i + 1] : null;
  const taskId = i >= 0 ? args[i + 2] : null;
  if (!commitHash) { process.stderr.write('elt-verify-bg: --run <hash> [taskId] required\n'); process.exit(4); }
  // Тестовый шов: без него unit-тест либо ждёт полный `--full` оракул (минуты), либо мокает
  // сам spawn (доказывал бы мок, не реальный отсоединённый процесс). env, не argv — тот же
  // приём, что у ELT_ORACLE_JOBS (elt-oracle-runner.js): argv фиксирован ([--run, hash, task]).
  const oracleCmd = process.env.ELT_VERIFY_BG_ORACLE_CMD || undefined;
  const { exit } = runBackgroundVerify({ cwd: process.cwd(), commitHash, taskId, ...(oracleCmd ? { oracleCmd } : {}) });
  process.exit(exit);
}

module.exports = { spawnBackgroundVerify, runBackgroundVerify, BG_LOG_DIR };
