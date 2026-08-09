#!/usr/bin/env node
'use strict';
// 014 T005 (фаза B, AC3) — фоновая проверка. `elt commit` при `verify:"background"` выполняет
// L0 + быстрый оракул (impact+кэш, T001) СИНХРОННО, коммитит и возвращает управление; тяжёлые
// слои уходят СЮДА, в отдельный отсоединённый (`detached`) процесс — await здесь свёл бы
// background к тому же sync под другим именем.
//
// 014 T006 (AC4): фон работает в `.fleet-wt/bg-<hash>` — DETACHED checkout ровно на хеше
// коммита, не на живом branch. Директория переиспользует `.fleet-wt/` (простаивает с 01.08,
// уже гитигнорена fleet.js:FLEET_IGNORE_LINES), но НЕ `fleet/worktree.js` — та создаёт/
// переиспользует ветку `fleet/<Tid>` для ПАРАЛЛЕЛЬНОЙ работы воркера; здесь read-only
// верификация на неизменном коммите, отдельная ветка была бы мусором в `git branch -a` на
// каждый спекулятивный коммит. [files:] T006 = только этот файл — новая мини-реализация тут,
// не правка worktree.js.
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
const WT_ROOT = '.fleet-wt';
const REVIEW_QUEUE = path.join('.harness', 'review-queue.jsonl');

// 014 T007 (AC5): красный фон — задача в очередь, НЕ блок. Пишем в ту же
// `.harness/review-queue.jsonl`, что и `inconclusive` (011 T012): второго механизма не
// заводить — иначе разбор красного зависел бы от того, какой слой его нашёл. `kind:"bg-red"`
// отличает запись от inconclusive-строк (у тех поля kind нет — старые не размечаем).
// `elt review close --task` работает без правок: строка несёт `task`.
function enqueueBgRed(cwd, { task, commit, layer, reason, logPath }) {
  const queue = path.join(cwd, REVIEW_QUEUE);
  fs.mkdirSync(path.dirname(queue), { recursive: true });
  const row = {
    kind: 'bg-red', task: task || null, commit, layer, reason,
    logPath, ts: new Date().toISOString(),
  };
  fs.appendFileSync(queue, JSON.stringify(row) + '\n');
  return row;
}

function worktreePath(cwd, commitHash) { return path.join(cwd, WT_ROOT, `bg-${commitHash}`); }

// AC4: изолирует фон от правок в основном дереве. Переиспользует запись, если worktree уже
// ЗАРЕГИСТРИРОВАН в git (resume после падения на том же хеше — путь ключуется хешем, поэтому
// переиспользование всегда корректно, это тот же коммит). Осиротевший каталог БЕЗ регистрации
// (crash до её завершения) — сносится перед повторным `add`, иначе git откажет "already exists".
function ensureWorktree(cwd, commitHash) {
  const p = worktreePath(cwd, commitHash);
  const listed = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd, encoding: 'utf8' }).stdout || '';
  if (listed.replace(/\\/g, '/').includes(p.replace(/\\/g, '/'))) return p;
  fs.mkdirSync(path.join(cwd, WT_ROOT), { recursive: true });
  fs.rmSync(p, { recursive: true, force: true });
  const r = spawnSync('git', ['worktree', 'add', '--detach', p, commitHash], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`worktree add failed (${commitHash}): ${r.stderr || r.stdout}`);
  return p;
}

// Убирается ПОСЛЕ прогона независимо от вердикта (красный тоже убирает — «падение» ниже это
// отказ САМОЙ команды remove, не красный оракул). При отказе remove — путь остаётся и едет в
// отчёт (background.worktree/worktreeRemoved в run-log), не теряется молча.
function cleanupWorktree(cwd, commitHash) {
  const p = worktreePath(cwd, commitHash);
  const r = spawnSync('git', ['worktree', 'remove', '--force', p], { cwd, encoding: 'utf8' });
  return { removed: r.status === 0, path: p };
}

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
  const wt = ensureWorktree(cwd, commitHash);
  // ponytail: наивный split(' ') — реальная команда (дефолт выше) без пробелов внутри
  // аргументов, шелл не нужен. Апгрейд до разбора кавычек — когда команда с пробелом-в-
  // аргументе реально понадобится (T009 может принести такую).
  const [bin, ...args] = oracleCmd.split(' ');
  // cwd: wt — AC4, сердце слайса: команда исполняется в ИЗОЛИРОВАННОМ checkout на хеше
  // коммита, а не в основном дереве, которое к этому моменту уже могло уйти вперёд.
  const r = spawnSync(bin, args, { cwd: wt, encoding: 'utf8' });
  const exit = r.status == null ? 1 : r.status;
  const durationSec = (Date.now() - started) / 1000;
  // Убирается независимо от вердикта — «остаётся» относится к отказу самого remove, не к
  // красному оракулу (иначе .fleet-wt/ пух бы одним каталогом на каждый красный слайс).
  const cleanup = cleanupWorktree(cwd, commitHash);
  // AC5: красное не роняет и не откатывает чужую работу — оно становится строкой в очереди.
  // logPath детерминирован от хеша (тот же, что открыл `spawnBackgroundVerify`), поэтому его
  // не надо протаскивать через argv отсоединённого процесса.
  if (exit !== 0) {
    enqueueBgRed(cwd, {
      task: taskId || null, commit: commitHash, layer: 'suite',
      reason: `фоновый слой suite: exit ${exit}`,
      logPath: path.join(BG_LOG_DIR, `bg-${commitHash}.log`),
    });
  }
  runLog.appendRunLog(cwd, {
    task: taskId || null,
    commit: commitHash,
    status: exit === 0 ? 'background-verify-pass' : 'background-verify-red',
    background: {
      layer: 'suite', exit, durationSec,
      worktree: path.relative(cwd, cleanup.path), worktreeRemoved: cleanup.removed,
    },
  });
  return { exit, durationSec, worktree: wt, worktreeRemoved: cleanup.removed };
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

module.exports = {
  spawnBackgroundVerify, runBackgroundVerify, BG_LOG_DIR,
  ensureWorktree, cleanupWorktree, worktreePath, WT_ROOT,
  enqueueBgRed, REVIEW_QUEUE,
};
