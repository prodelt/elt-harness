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
const { mutate } = require('./elt-mutate');

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
// 014 T022: рубрика и зона слайса едут в фон ЧЕРЕЗ ENV, не argv — argv здесь фиксирован
// ([--run, hash, task]) и не переживёт многострочный taskText, а тот же приём уже держит
// ELT_VERIFY_BG_ORACLE_CMD. Пустые значения не пишем: пустая строка в env неотличима от
// «передали пустое», и findSpecDir тогда молча вернулся бы к слепому поиску.
function bgChildEnv({ specFile, taskText }, base = process.env) {
  return {
    ...base,
    ...(specFile ? { ELT_VERIFY_BG_SPEC_FILE: specFile } : {}),
    ...(taskText ? { ELT_VERIFY_BG_TASK_TEXT: taskText } : {}),
  };
}
function bgChildContextFromEnv(env = process.env) {
  return { specFile: env.ELT_VERIFY_BG_SPEC_FILE || null, taskText: env.ELT_VERIFY_BG_TASK_TEXT || '' };
}

function spawnBackgroundVerify({ cwd, commitHash, taskId, specFile = null, taskText = '' }) {
  fs.mkdirSync(path.join(cwd, BG_LOG_DIR), { recursive: true });
  const logPath = path.join(cwd, BG_LOG_DIR, `bg-${commitHash}.log`);
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(
    process.execPath,
    [__filename, '--run', commitHash, taskId || ''],
    { cwd, stdio: ['ignore', logFd, logFd], detached: true, env: bgChildEnv({ specFile, taskText }) },
  );
  child.unref();
  fs.closeSync(logFd);
  return { pid: child.pid, logPath: path.relative(cwd, logPath) };
}

// ── 014 T009 (AC7): четыре слоя в фоне ────────────────────────────────────────────────
// Порядок фиксирован (схема спеки): сьют → мутатор → smoke → судья. Дешёвое впереди: красный
// сьют делает мутанта бессмысленным, а судью — дорогим шумом, но слои НЕ прерывают друг друга
// — фон не на критическом пути, а четыре причины лучше одной (за них уже заплачено worktree).
const LAYERS = ['suite', 'mutate', 'smoke', 'judge'];

// Поле `background.layers` — список ВКЛЮЧЁННЫХ слоёв; нет поля → включены все (AC7 «по
// умолчанию все»). Читаем harness.json напрямую (приём `verifyMode`): [files:] T009 не
// включает elt-config.js, а фоновому процессу через границу передаётся только cwd.
function enabledLayers(cwd) {
  try {
    const bg = JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'harness.json'), 'utf8')).background;
    const list = bg && Array.isArray(bg.layers) ? bg.layers.filter((l) => LAYERS.includes(l)) : null;
    return new Set(list || LAYERS);
  } catch { return new Set(LAYERS); }
}
function harnessField(cwd, key) {
  try { return JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'harness.json'), 'utf8'))[key]; }
  catch { return undefined; }
}
// ponytail: наивный split(' ') — команды харнесса (оракул/smoke) без пробелов внутри
// аргументов, шелл не нужен. Апгрейд до разбора кавычек — когда такая команда появится.
function runCmd(cmd, cwd) {
  const [bin, ...args] = cmd.split(' ');
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8' });
  return r.status == null ? 1 : r.status;
}
// Файлы коммита — вход мутатора. `--pretty=` глушит заголовок, остаются одни имена.
function commitFiles(cwd, commitHash) {
  const r = spawnSync('git', ['show', '--name-only', '--pretty=', commitHash], { cwd, encoding: 'utf8' });
  return (r.stdout || '').split(/\r?\n/).filter(Boolean);
}

// Судья в фоне видит дифф только так: в worktree на хеше рабочее дерево ЧИСТОЕ, и `git diff
// HEAD` (gate.slurpDiff) пуст — судья получил бы пустой слайс и отверг его по REJECT-default.
// `reset --soft HEAD~1` сдвигает HEAD на родителя, оставляя содержимое коммита в дереве: ровно
// тот дифф, который судья и должен читать. Worktree одноразовый и detached — портить нечего.
// 014 T022 (дефект, найденный САМИМ контуром на T016/T017): без specFile `findSpecDir` ищет
// `**Txxx**` по всем specs/ и берёт ПЕРВЫЙ файл — ровно коллизия, описанная в gate.js:166.
// T016/T017 спеки 014 получили рубрику из specs/002-elt-fleet и были заблокированы «не по той
// задаче». Без taskText молчит и scope-триггер L0 (011 T024 берёт зону из `[files:]`).
// Оба поля есть у `elt commit` в момент запуска фона — их надо просто донести.
async function runJudgeLayer({ cwd, wt, commitHash, taskId, taskText, specFile = null, judgeImpl = null }) {
  const back = spawnSync('git', ['reset', '--soft', 'HEAD~1'], { cwd: wt, encoding: 'utf8' });
  if (back.status !== 0) return { verdict: 'dead', reasons: [`reset --soft не удался: ${back.stderr || back.stdout}`] };
  const cfg = harnessField(cwd, 'judge') || {};
  const runJudge = judgeImpl || require('./fleet/gate').runJudge;
  try {
    const r = await runJudge({
      cwd: wt, tid: taskId || commitHash, taskText: taskText || '',
      // specFile — путь к tasks.md спеки слайса ОТНОСИТЕЛЬНО основного дерева; резолвится он в
      // worktree (cwd: wt), где лежит тот же коммит, поэтому относительный путь и корректен.
      specFile,
      provider: cfg.provider || 'claude', model: cfg.model || 'sonnet',
    });
    // 014 решение 4: судья, который НЕ отработал, — отсутствие вердикта, а не красное. Красным
    // его сделать значило бы завести очередь ложных задач на каждый упавший CLI; молчание фона
    // ловит T008 (`bg-silent`), а не эта ветка.
    if (!r || r.ok === false || r.runOk === false) return { verdict: 'dead', reasons: (r && r.reasons) || ['судья не отработал'] };
    return { verdict: r.verdict, reasons: r.reasons || [] };
  } catch (e) {
    return { verdict: 'dead', reasons: [`судья упал: ${e.message}`] };
  }
}

// Тело фонового процесса. Вынесено из require.main-ветки, чтобы тест мог прогнать его
// напрямую (без реального spawn — детство «медленный тест = никто не гоняет» здесь неуместно;
// у самого T005 уже есть кэш оракула T001, но интеграционный прогон всё равно не бесплатен).
async function runBackgroundVerify({ cwd, commitHash, taskId, taskText, specFile = null, judgeImpl = null, oracleCmd = 'node tools/elt-oracle-runner.js --full' }) {
  const started = Date.now();
  const wt = ensureWorktree(cwd, commitHash);
  const on = enabledLayers(cwd);
  const logPath = path.join(BG_LOG_DIR, `bg-${commitHash}.log`);
  const sections = [];
  // Секция на КАЖДЫЙ слой, включая выключенный: отчёт без строки о слое неотличим от отчёта,
  // где слой молча не сработал — ровно та слепота, ради которой написан T008.
  const section = (layer, body) => {
    if (!on.has(layer)) { sections.push({ layer, skipped: true, reason: 'выключен в background.layers', durationSec: 0 }); return null; }
    const t = Date.now();
    const out = body();
    return sections.push({ layer, ...out, durationSec: (Date.now() - t) / 1000 }), out;
  };

  // cwd: wt — AC4, сердце T006: слои исполняются в ИЗОЛИРОВАННОМ checkout на хеше коммита,
  // а не в основном дереве, которое к этому моменту уже могло уйти вперёд.
  section('suite', () => {
    const exit = runCmd(oracleCmd, wt);
    return { exit, red: exit !== 0, reason: exit !== 0 ? `сьют: exit ${exit}` : null };
  });
  section('mutate', () => {
    // Мутатор написан 011 T008 и до сих пор ни разу не был подключён к гейту (спека, п. 30).
    // Тесты гоняются impact-выборкой, а не `--full`: мутация трогает одну строку одного файла.
    const files = commitFiles(cwd, commitHash);
    const r = mutate({ cwd: wt, files, runTests: () => runCmd('node tools/elt-oracle-runner.js', wt) !== 0 });
    return { status: r.status, reason: r.reason, survived: r.survived.length, red: r.status === 'block' };
  });
  section('smoke', () => {
    const smoke = harnessField(cwd, 'smoke');
    if (typeof smoke !== 'string' || !smoke.trim()) return { skipped: true, reason: 'smoke не задан' };
    // 014 T010 (R2): внешние сервисы, БД и порты не терпят второго экземпляра — фоновый smoke
    // на worktree стартовал бы параллельно тому, что уже гоняет человек. Пропуск, а НЕ падение:
    // «мы это не проверяли» не то же самое, что «проверили и красное» (та же дисциплина, что у
    // бюджета мутатора). Разрешение даёт только владелец проекта полем smokeParallel:true.
    if (harnessField(cwd, 'smokeParallel') !== true) return { skipped: true, reason: 'skipped: smokeParallel=false' };
    const exit = runCmd(smoke, wt);
    return { exit, red: exit !== 0, reason: exit !== 0 ? `smoke: exit ${exit}` : null };
  });
  if (on.has('judge')) {
    const t = Date.now();
    const j = await runJudgeLayer({ cwd, wt, commitHash, taskId, taskText, specFile, judgeImpl });
    sections.push({ layer: 'judge', verdict: j.verdict, red: j.verdict === 'block',
      reason: j.verdict === 'block' ? `судья: ${(j.reasons || []).join('; ')}` : null,
      durationSec: (Date.now() - t) / 1000 });
  } else {
    sections.push({ layer: 'judge', skipped: true, reason: 'выключен в background.layers', durationSec: 0 });
  }

  const red = sections.filter((s) => s.red);
  const durationSec = (Date.now() - started) / 1000;
  // Убирается независимо от вердикта — «остаётся» относится к отказу самого remove, не к
  // красному слою (иначе .fleet-wt/ пух бы одним каталогом на каждый красный слайс).
  const cleanup = cleanupWorktree(cwd, commitHash);
  // AC5: красное не роняет и не откатывает чужую работу — оно становится строкой в очереди.
  // Строка НА КАЖДЫЙ красный слой: одна общая скрывала бы, что упало и сьютом, и судьёй.
  for (const s of red) {
    enqueueBgRed(cwd, { task: taskId || null, commit: commitHash, layer: s.layer, reason: s.reason, logPath });
  }
  const exit = red.length ? 1 : 0;
  runLog.appendRunLog(cwd, {
    task: taskId || null,
    commit: commitHash,
    // Префикс `background-verify` держит T008: его детектор `bg-silent` ищет именно его.
    status: exit === 0 ? 'background-verify-pass' : 'background-verify-red',
    background: {
      layer: 'suite', exit, durationSec, sections,
      worktree: path.relative(cwd, cleanup.path), worktreeRemoved: cleanup.removed,
    },
  });
  return { exit, durationSec, sections, worktree: wt, worktreeRemoved: cleanup.removed };
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
  const { specFile, taskText } = bgChildContextFromEnv();
  runBackgroundVerify({ cwd: process.cwd(), commitHash, taskId, specFile, taskText, ...(oracleCmd ? { oracleCmd } : {}) })
    .then(({ exit }) => process.exit(exit))
    .catch((e) => { process.stderr.write(`elt-verify-bg: ${e.stack || e.message}\n`); process.exit(1); });
}

module.exports = {
  spawnBackgroundVerify, runBackgroundVerify, BG_LOG_DIR,
  ensureWorktree, cleanupWorktree, worktreePath, WT_ROOT,
  enqueueBgRed, REVIEW_QUEUE, LAYERS, enabledLayers,
  bgChildEnv, bgChildContextFromEnv, runJudgeLayer,
};
