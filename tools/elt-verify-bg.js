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
function enqueueBgRed(cwd, { task, specPath = null, commit, layer, reason, logPath, kind = 'bg-red' }) {
  const queue = path.join(cwd, REVIEW_QUEUE);
  fs.mkdirSync(path.dirname(queue), { recursive: true });
  const row = {
    // 020 T007: `bg-dead`/`bg-inconclusive` — отдельные kind, см. finish().
    // 020 T008: identity фоновой строки — (specPath, task) плюс `commit` и `layer`: без спеки
    // `review close` не отличит T018 из 019 от T018 из 020, а без коммита и слоя строку
    // физически нечем разбирать.
    kind, task: task || null, specPath: specPath || null, commit, layer, reason,
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

// 020 T007: конфиг фона брался из ЖИВОГО дерева, а слои исполнялись на снапшоте коммита.
// Человек правит `.harness/harness.json` сразу после `elt commit` — и фон судит старый коммит
// новыми правилами: другой оракул, другой набор слоёв, другой судья. Расхождение молчаливое,
// в отчёте от него не остаётся следа. Источник истины — тот же коммит, что и дифф.
// Живое дерево остаётся фолбеком ТОЛЬКО когда коммита ещё нет (тесты гоняют слои напрямую),
// и это записывается в отчёт полем `configSource`, а не подразумевается.
function harnessConfigAt(cwd, commitHash) {
  if (commitHash) {
    const r = spawnSync('git', ['show', `${commitHash}:.harness/harness.json`], { cwd, encoding: 'utf8' });
    if (r.status === 0 && r.stdout) {
      try { return { cfg: JSON.parse(r.stdout), source: `commit:${commitHash}` }; }
      catch { /* битый снапшот — ниже честный фолбек с пометкой */ }
    }
  }
  try {
    return { cfg: JSON.parse(fs.readFileSync(path.join(cwd, '.harness', 'harness.json'), 'utf8')), source: 'worktree' };
  } catch { return { cfg: {}, source: 'none' }; }
}

// Известные вердикты судьи. Всё остальное — НЕ вердикт, а неизвестность: см. classifyJudge.
const JUDGE_VERDICTS = ['pass', 'block', 'inconclusive'];

// 020 T007. До этой задачи фон метил красным только `verdict === 'block'`, поэтому `dead`,
// битый JSON, таймаут, исключение и любой незнакомый вердикт давали `background-verify-pass` —
// зелёный, за которым НИКТО не смотрел на дифф. Решение 014/4 («не отработавший судья — не
// красное») остаётся в силе в своей верной части: это не `block`. Но и не `pass`: у такого
// исхода теперь собственное терминальное состояние и собственная строка очереди.
function classifyJudge(verdict) {
  if (JUDGE_VERDICTS.includes(verdict)) return { verdict, conclusive: true };
  return { verdict: verdict || 'dead', conclusive: false };
}
// 016 T005: команду проекта запускает ШЕЛЛ из его же harness.json — тот же разбор, что у
// синхронного гейта (`elt.js:42` sh()). Наивный `split(' ')` стоял здесь с 014 и жил только
// потому, что домашний оракул — одно слово плюс путь. Живой прогон в Portfolio
// (`oracle: "npx tsc --noEmit && npm run lint"`) дал `exit 1` за 0,012 c: `&&` уехал
// аргументом в npx, а на Windows `npx`/`npm` вообще .cmd-шимы, которых spawnSync без шелла
// не видит. Третий дефект той же семьи, что T001 и T003: команда уже правильная, а выполнить
// её фон не мог. Ветка в ветку с sh(): улучшать нельзя — расхождение с синхронным гейтом
// означало бы, что фон проверяет не то, что человек.
// 024 T001: та же таблица, что у синхронного гейта, — теперь буквально одна, в
// `tools/shell-run.js`. Расхождение здесь означало бы, что фон проверяет не то, что человек.
const shellRun = require('./shell-run');
function shellArgv(cmd, shell) {
  return shellRun.shellArgv(cmd, shellRun.resolveShell(shell) || shellRun.defaultShell());
}
// Дефолт spawnSync — 1 МБ, и при переполнении процесс УБИВАЕТСЯ (ENOBUFS, status null → exit 1):
// болтливый оракул чужого проекта давал бы ложное красное. То же число, что у elt.js.
const BG_MAX_BUFFER = 256 * 1024 * 1024;
// 014 T023: вывод дочернего процесса ДОПИСЫВАЕТСЯ в лог фона. До этого `spawnSync` с `encoding`
// захватывал stdout/stderr в объект результата и молча их выбрасывал: `logPath` в каждой записи
// `bg-red` указывал на файл с одной строкой deprecation-варнинга, и разобрать красное фона было
// физически нечем (поймано живьём на T016 и T018). Лог не гейт — отказ записи не роняет слой.
// 016 T004: фоновая полоса гоняет тесты МЕНЬШИМ числом параллельных процессов, чем
// интерактивная. Дефолт `jobs = min(8, cpus)` разумен на критическом пути, где ждёт человек;
// в фоне ждать некому — время бесплатно, а вот контention стоит дорого. Живой счёт: четыре
// подряд `bg-red/suite` (39912f3, 31ee775, f452f27, 6e85a2c), последний — `elt: git commit
// failed:` с ПУСТЫМ stdout и stderr, то есть git не написал ничего: процесс не отработал, а не
// упал по существу. Тот же файл изолированно даёт 12/12 зелёных. Плюс harness-watch.test.js
// молотил 118,0 c и 107,8 c при СВОИХ дедлайнах 110–120 c — под нагрузкой он срывался бы в
// собственный таймаут. Меньше параллели → меньше и того, и другого.
// ponytail: одно число, не поле конфига — «фон медленнее интерактива» не настройка, а свойство
// полосы. Появится проект, которому 2 мало, — тогда и поле.
const BG_ORACLE_JOBS = '2';
function bgOracleEnv() { return { ...process.env, ELT_ORACLE_JOBS: BG_ORACLE_JOBS }; }

function runCmd(cmd, cwd, logFile = null, shell = null) {
  const [bin, args] = shellArgv(cmd, shell);
  const r = spawnSync(bin, args, { cwd, encoding: 'utf8', env: bgOracleEnv(), maxBuffer: BG_MAX_BUFFER });
  const exit = r.status == null ? 1 : r.status;
  if (logFile) {
    try {
      fs.appendFileSync(logFile, `\n$ ${cmd}  (exit ${exit})\n${r.stdout || ''}${r.stderr || ''}`);
    } catch { /* лог не гейт */ }
  }
  return exit;
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
async function runJudgeLayer({ cwd, wt, commitHash, taskId, taskText, specFile = null, judgeImpl = null, judgeCfg = null, reviewCfg = null }) {
  const back = spawnSync('git', ['reset', '--soft', 'HEAD~1'], { cwd: wt, encoding: 'utf8' });
  if (back.status !== 0) return { verdict: 'dead', reasons: [`reset --soft не удался: ${back.stderr || back.stdout}`] };
  // 020 T007: конфиг судьи — из того же снапшота коммита, что и остальные слои.
  const cfg = judgeCfg || harnessField(cwd, 'judge') || {};
  const runJudge = judgeImpl || require('./judge-core').runJudge;
  try {
    const r = await runJudge({
      cwd: wt, tid: taskId || commitHash, taskText: taskText || '',
      // 020 T010: конфиг ревью едет из ТОГО ЖЕ снапшота коммита, что и остальные слои (020 T007).
      // Иначе фон судил бы старый коммит новыми правилами ревью — молчаливое расхождение,
      // от которого в отчёте не остаётся следа. `null` = решает сам runJudge по дереву worktree.
      review: reviewCfg || null,
      // specFile — путь к tasks.md спеки слайса ОТНОСИТЕЛЬНО основного дерева; резолвится он в
      // worktree (cwd: wt), где лежит тот же коммит, поэтому относительный путь и корректен.
      specFile,
      provider: cfg.provider || 'claude', model: cfg.model || 'sonnet',
    });
    // 014 решение 4: судья, который НЕ отработал, — отсутствие вердикта, а не красное. Красным
    // его сделать значило бы завести очередь ложных задач на каждый упавший CLI; молчание фона
    // ловит T008 (`bg-silent`), а не эта ветка.
    if (!r || r.ok === false || r.runOk === false) return { verdict: 'dead', reasons: (r && r.reasons) || ['судья не отработал'] };
    // 020 T007: незнакомый вердикт — не «почти pass». Ловится ЗДЕСЬ, у источника, иначе он
    // просто не совпадёт с 'block' этажом ниже и утечёт в зелёное.
    if (!JUDGE_VERDICTS.includes(r.verdict)) {
      return { verdict: 'unknown', reasons: [`судья вернул неизвестный вердикт: ${JSON.stringify(r.verdict)}`] };
    }
    return { verdict: r.verdict, reasons: r.reasons || [] };
  } catch (e) {
    return { verdict: 'dead', reasons: [`судья упал: ${e.message}`] };
  }
}

// 020 T007: судья, который не вернулся НИКОГДА, — не зелёное и не молчание фона: у процесса
// есть свой предел терпения. Без него `runJudge`, зависший на сетевом вызове, держал бы
// фоновый процесс до бесконечности, а `bg-silent` T008 срабатывал бы лишь по внешнему таймеру.
// 024 T002: БЕЗ `timer.unref()`. Он стоял здесь и отменял весь смысл гарда: unref'нутый
// таймер не держит event loop, поэтому при зависшем `promise` (судья, не вернувшийся
// НИКОГДА — ровно тот случай, ради которого гард написан) больше ничего ref'нутого не
// остаётся, Node осушает цикл и выходит ДО срабатывания таймаута. `try/finally` в
// `runBackgroundVerify` не выполняется: ни `finish()`, ни `appendRunLog`, ни `enqueueBgRed`,
// плюс осиротевший `.fleet-wt/bg-<hash>` — а процесс возвращает НОЛЬ. На сервере это
// непроверенный коммит, уехавший молча; у нас это ещё и красный сьют, потому что
// собственная регрессия гарда (`T007: таймаут судьи`) виснет и уносит 13 тестов за собой.
// Держать таймер ref'нутым безопасно: `.finally` снимает его на ЛЮБОМ исходе гонки, поэтому
// лишней задержки выхода он не создаёт — именно ради этого `clearTimeout` там и стоит.
function withJudgeTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer = null;
  const guard = new Promise((resolve) => {
    timer = setTimeout(() => resolve({
      verdict: 'timeout', reasons: [`судья не ответил за ${Math.round(timeoutMs / 1000)} c`],
    }), timeoutMs);
  });
  return Promise.race([promise, guard]).finally(() => { if (timer) clearTimeout(timer); });
}

// Тело фонового процесса. Вынесено из require.main-ветки, чтобы тест мог прогнать его
// напрямую (без реального spawn — детство «медленный тест = никто не гоняет» здесь неуместно;
// у самого T005 уже есть кэш оракула T001, но интеграционный прогон всё равно не бесплатен).
async function runBackgroundVerify({ cwd, commitHash, taskId, taskText, specFile = null, judgeImpl = null, oracleCmd = null }) {
  const started = Date.now();
  // 016 T001: команда оракула — из `.harness/harness.json` ПРОЕКТА. Дефолт
  // `'node tools/elt-oracle-runner.js --full'` стоял здесь с 014 T005 и перекрывался только
  // через ELT_VERIFY_BG_ORACLE_CMD, которую не выставлял ни один продовый вызов: в чужом
  // проекте фон 7 из 7 раз падал за 0,13 c на `Cannot find module .../tools/elt-oracle-runner.js`,
  // а дома тот же слой честно работал минуты — дефект был невидим по построению.
  // `--full` не приклеиваем: в detached worktree дерево чистое, impact-выборка на пустом диффе
  // fail-open'ится в полный прогон (elt-oracle-select.js:123), а склейка исказила бы команду,
  // которую владелец проекта видит в логе.
  // Резолв ОДИН, здесь: класть его ещё и в bgChildEnv значило бы завести вторую копию того же
  // правила — и мёртвую ветку, ведь родитель всегда перекрывал бы конфиг. cwd дочернего
  // процесса и есть корень проекта, поэтому читается тот же самый harness.json.
  // Порядок: параметр (тесты) > env (шов для spawn-тестов) > конфиг > громкий отказ.
  // 020 T007: конфиг — из снапшота коммита, а не из живого дерева (см. harnessConfigAt).
  const { cfg: snapCfg, source: configSource } = harnessConfigAt(cwd, commitHash);
  const snapField = (key) => snapCfg[key];
  const cmd = oracleCmd || process.env.ELT_VERIFY_BG_ORACLE_CMD || snapField('oracle');
  // 016 T005: шелл берётся из конфига ОСНОВНОГО дерева (тот же файл, что и `oracle`), а не из
  // worktree — читается один раз здесь, чтобы слои не расходились в способе запуска.
  const shell = snapField('shell');
  const bgCfg = snapCfg.background && typeof snapCfg.background === 'object' ? snapCfg.background : {};
  const on = new Set(Array.isArray(bgCfg.layers) ? bgCfg.layers.filter((l) => LAYERS.includes(l)) : LAYERS);
  const judgeTimeoutMs = Number.isFinite(bgCfg.judgeTimeoutMs) ? bgCfg.judgeTimeoutMs : 15 * 60 * 1000;
  // До ensureWorktree: отказ после него оставил бы осиротевший .fleet-wt/bg-<hash> — cleanup
  // живёт только в конце функции. Отказ ровно тогда, когда команда кому-то нужна: с
  // `background.layers` без `suite` и `mutate` фону оракул не требуется, и требовать его было бы
  // новым блокирующим условием на пустом месте (красная линия спеки 016).
  if ((on.has('suite') || on.has('mutate')) && (typeof cmd !== 'string' || !cmd.trim())) {
    throw new Error('elt-verify-bg: поле `oracle` не задано в .harness/harness.json — фоновым слоям suite/mutate нечего запускать (молчаливого дефолта больше нет, 016 T001)');
  }
  const wt = ensureWorktree(cwd, commitHash);
  const logPath = path.join(BG_LOG_DIR, `bg-${commitHash}.log`);
  const logFile = path.join(cwd, logPath); // 014 T023: тот же файл, что уже указан в очереди
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  // 020 T007: всё, что после ensureWorktree, живёт под try/finally. Раньше исключение в любом
  // слое уносило функцию наружу ДО cleanupWorktree и ДО записи в run-log: оставался осиротевший
  // `.fleet-wt/bg-<hash>` и — что хуже — фоновой прогон не оставлял вообще никакого следа.
  // Терминальная запись пишется всегда: без неё падение неотличимо от «фон ещё идёт».
  const sections = [];
  try {
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
      const exit = runCmd(cmd, wt, logFile, shell);
      return { exit, red: exit !== 0, reason: exit !== 0 ? `сьют: exit ${exit}` : null };
    });
    section('mutate', () => {
      // Мутатор написан 011 T008 и до сих пор ни разу не был подключён к гейту (спека, п. 30).
      // Тесты гоняются impact-выборкой, а не `--full`: мутация трогает одну строку одного файла.
      const files = commitFiles(cwd, commitHash);
      // 016 T003: та же команда проекта, что и у слоя `suite`. Здесь стоял второй захардкоженный
      // `node tools/elt-oracle-runner.js` — тот же дефект, что чинил T001, просто этажом ниже:
      // в чужом проекте каждая мутация «убивалась» падением `Cannot find module`, то есть слой
      // рапортовал бы чистоту, ничего не проверив.
      const r = mutate({ cwd: wt, files, runTests: () => runCmd(cmd, wt, logFile, shell) !== 0 });
      return { status: r.status, reason: r.reason, survived: r.survived.length, red: r.status === 'block' };
    });
    section('smoke', () => {
      const smoke = snapField('smoke');
      if (typeof smoke !== 'string' || !smoke.trim()) return { skipped: true, reason: 'smoke не задан' };
      // 014 T010 (R2): внешние сервисы, БД и порты не терпят второго экземпляра — фоновый smoke
      // на worktree стартовал бы параллельно тому, что уже гоняет человек. Пропуск, а НЕ падение:
      // «мы это не проверяли» не то же самое, что «проверили и красное» (та же дисциплина, что у
      // бюджета мутатора). Разрешение даёт только владелец проекта полем smokeParallel:true.
      if (snapField('smokeParallel') !== true) return { skipped: true, reason: 'skipped: smokeParallel=false' };
      const exit = runCmd(smoke, wt, logFile, shell);
      return { exit, red: exit !== 0, reason: exit !== 0 ? `smoke: exit ${exit}` : null };
    });
    if (on.has('judge')) {
      const t = Date.now();
      const raw = await withJudgeTimeout(
        runJudgeLayer({ cwd, wt, commitHash, taskId, taskText, specFile, judgeImpl, judgeCfg: snapField('judge'), reviewCfg: snapField('review') }),
        judgeTimeoutMs,
      );
      const j = classifyJudge(raw && raw.verdict);
      const why = (raw && raw.reasons || []).join('; ');
      sections.push({
        layer: 'judge', verdict: j.verdict, conclusive: j.conclusive,
        // 020 T017: сырьё для сертификата. Оно живёт ровно здесь, потому что дальше по коду
        // остаются только терминальные строки очереди, из которых алгебру pass не собрать.
        review: (raw && raw.review) || null,
        red: j.verdict === 'block',
        // 020 T007: неконклюзивный судья и `inconclusive` больше не «ничего»: у каждого есть
        // причина в отчёте, потому что зелёным они уже не станут.
        inconclusive: j.verdict === 'inconclusive',
        nonConclusive: !j.conclusive,
        reason: j.verdict === 'pass' ? null : `судья: ${j.verdict}${why ? ` — ${why}` : ''}`,
        durationSec: (Date.now() - t) / 1000,
      });
    } else {
      sections.push({ layer: 'judge', skipped: true, reason: 'выключен в background.layers', durationSec: 0 });
    }

    return finish({ sections, started, cwd, commitHash, taskId, specFile, logPath, wt, configSource });
  } catch (e) {
    const durationSec = (Date.now() - started) / 1000;
    sections.push({ layer: 'runner', nonConclusive: true, red: false, reason: `фон упал: ${e.message}`, durationSec });
    enqueueBgRed(cwd, {
      task: taskId || null, specPath: specFile, commit: commitHash, layer: 'runner',
      reason: `фон упал: ${e.message}`, logPath, kind: 'bg-dead',
    });
    const cleanup = cleanupWorktree(cwd, commitHash);
    runLog.appendRunLog(cwd, {
      task: taskId || null, commit: commitHash, status: BG_TERMINAL.error,
      background: {
        layer: 'runner', exit: 1, outcome: 'error', durationSec, sections, configSource,
        error: e.stack || e.message,
        worktree: path.relative(cwd, cleanup.path), worktreeRemoved: cleanup.removed,
      },
    });
    return { exit: 1, outcome: 'error', status: BG_TERMINAL.error, durationSec, sections, worktree: wt, worktreeRemoved: cleanup.removed, configSource };
  } finally {
    // Идемпотентно: в happy-path его уже снял finish(), здесь снимается только осиротевший.
    cleanupWorktree(cwd, commitHash);
  }
}

// 020 T007. Единственное место, где фоновой прогон получает терминальное состояние. Раньше
// оно вычислялось одной тернаркой `exit === 0 ? pass : red`, и всё, что не помечено `red`,
// автоматически становилось зелёным — то есть КАЖДЫЙ неучтённый исход по умолчанию был pass.
// Здесь умолчание перевёрнуто: зелёное выдаётся только когда все слои закончились
// конклюзивно и ни один не красный. Порядок приоритетов зафиксирован: red > dead > inconclusive.
const BG_TERMINAL = {
  pass: 'background-verify-pass',
  red: 'background-verify-red',
  dead: 'background-verify-dead',
  inconclusive: 'background-verify-inconclusive',
  error: 'background-verify-error',
};

function classifyRun(sections) {
  if (sections.some((s) => s.red)) return 'red';
  if (sections.some((s) => s.nonConclusive)) return 'dead';
  if (sections.some((s) => s.inconclusive)) return 'inconclusive';
  return 'pass';
}

// 020 T017: сертификат батча выписывается ЗДЕСЬ — в единственной точке, где одновременно
// известны терминал оракула, терминалы линз, терминал оценщика и хеши коммита. Раньше
// алгебра существовала отдельным модулем, который звали только его собственные тесты: это
// значит, что требование «push принимает только соответствующий proof» было недостижимо —
// proof не выписывал никто. Сертификат живёт ВНЕ дерева (`.git/elt/certificates/`), иначе
// сам факт его записи делал бы его stale.
function issueBatchCertificate({ cwd, commitHash, taskId, specFile, sections, outcome }) {
  if (outcome !== 'pass') return { ok: false, reason: 'outcome-not-pass' };
  let certification; let batchState; let graph;
  try {
    certification = require('./certification');
    const compiler = require('./graph-compiler');
    graph = compiler.compile(compiler.loadCanonicalGraph()).graph;
  } catch (e) { return { ok: false, reason: 'certification-unavailable', detail: e.message }; }

  const gitDir = runLog.gitDir(cwd);
  try { batchState = JSON.parse(fs.readFileSync(path.join(gitDir, 'elt', 'batch-state.json'), 'utf8')); }
  catch { return { ok: false, reason: 'batch-state-missing' }; }
  const entry = Object.entries(batchState.batches || {})
    .find(([, b]) => String(b.batchHead || '').startsWith(commitHash) || commitHash.startsWith(String(b.batchHead || '')));
  if (!entry) return { ok: false, reason: 'batch-not-registered' };
  const [batchId, batch] = entry;

  const suite = sections.find((x) => x.layer === 'suite') || {};
  const judge = sections.find((x) => x.layer === 'judge') || {};
  const review = judge.review || null;
  // Нет данных ревью — нет сертификата. Подставить сюда «наверное всё прошло» значило бы
  // выписать proof по умолчанию, то есть ровно fail-open, который T017 и закрывает.
  if (!review || !review.lensResults) return { ok: false, reason: 'review-evidence-missing' };

  let lockDigest = 'no-component-lock';
  try {
    lockDigest = require('node:crypto').createHash('sha256')
      .update(fs.readFileSync(path.join(cwd, '.elt', 'components.lock.json'), 'utf8')).digest('hex');
  } catch { /* lock ещё нет — это состояние, а не отказ */ }

  const treeHashOfCommit = (() => {
    const r = spawnSync('git', ['rev-parse', `${commitHash}^{tree}`], { cwd, encoding: 'utf8' });
    return r.status === 0 ? String(r.stdout).trim() : null;
  })();

  const evidence = {
    oracleTerminal: suite.exit === 0 ? certification.ORACLE_TERMINAL.exit0
      : suite.skipped ? certification.ORACLE_TERMINAL.unknown : certification.ORACLE_TERMINAL.nonzero,
    lensResults: review.lensResults,
    scorerTerminal: review.scorerTerminal,
    findings: review.findings || [],
    riskLevel: 'default',
    graphHash: graph.graphVersion,
    lockHash: lockDigest,
    specHash: specFile,
    batchHash: batchId,
    generationHash: String(batch.generation),
    commitHash,
    treeHash: treeHashOfCommit,
    expected: {
      graphHash: graph.graphVersion, lockHash: lockDigest, specHash: specFile,
      batchHash: batchId, generationHash: String(batch.generation),
      commitHash, treeHash: treeHashOfCommit,
    },
  };
  return certification.createBatchCertificate(cwd, {
    batchId, generation: batch.generation, commit: commitHash, treeHash: treeHashOfCommit,
    specIdentity: specFile, taskIdentities: batch.taskIdentities || [],
    graphVersion: graph.graphVersion, componentLockDigest: lockDigest,
    riskLevel: 'default', evidence,
  });
}

function finish({ sections, started, cwd, commitHash, taskId, specFile = null, logPath, wt, configSource }) {
  const outcome = classifyRun(sections);
  const durationSec = (Date.now() - started) / 1000;
  // Убирается независимо от вердикта — «остаётся» относится к отказу самого remove, не к
  // красному слою (иначе .fleet-wt/ пух бы одним каталогом на каждый красный слайс).
  const cleanup = cleanupWorktree(cwd, commitHash);
  // AC5: красное не роняет и не откатывает чужую работу — оно становится строкой в очереди.
  // Строка НА КАЖДЫЙ проблемный слой: одна общая скрывала бы, что упало и сьютом, и судьёй.
  // 020 T007: у неконклюзивного и `inconclusive` — СВОИ kind, иначе разбор очереди не отличит
  // «проверили и красное» от «не смогли проверить».
  const KIND = { red: 'bg-red', dead: 'bg-dead', inconclusive: 'bg-inconclusive' };
  for (const s of sections) {
    const kind = s.red ? KIND.red : s.nonConclusive ? KIND.dead : s.inconclusive ? KIND.inconclusive : null;
    if (!kind) continue;
    enqueueBgRed(cwd, { task: taskId || null, specPath: specFile, commit: commitHash, layer: s.layer, reason: s.reason, logPath, kind });
  }
  const exit = outcome === 'pass' ? 0 : 1;
  // Сертификат — часть терминального результата, а не отдельный ритуал. Его отказ НЕ делает
  // зелёный прогон красным: причина уезжает в run-log, где её видно, а не в тишину.
  const certificate = issueBatchCertificate({ cwd, commitHash, taskId, specFile, sections, outcome });
  runLog.appendRunLog(cwd, {
    task: taskId || null,
    commit: commitHash,
    // Префикс `background-verify` держит T008: его детектор `bg-silent` ищет именно его.
    status: BG_TERMINAL[outcome],
    background: {
      layer: 'suite', exit, outcome, durationSec, sections, configSource,
      certificate: certificate.ok
        ? { id: certificate.certificate.certificateId, schema: certificate.certificate.v }
        : { issued: false, reason: certificate.reason, detail: certificate.detail || null },
      worktree: path.relative(cwd, cleanup.path), worktreeRemoved: cleanup.removed,
    },
  });
  return { exit, outcome, status: BG_TERMINAL[outcome], durationSec, sections, certificate, worktree: wt, worktreeRemoved: cleanup.removed, configSource };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--run');
  const commitHash = i >= 0 ? args[i + 1] : null;
  const taskId = i >= 0 ? args[i + 2] : null;
  if (!commitHash) { process.stderr.write('elt-verify-bg: --run <hash> [taskId] required\n'); process.exit(4); }
  // 016 T001: ELT_VERIFY_BG_ORACLE_CMD (тестовый шов для spawn-тестов — без него unit-тест ждал
  // бы полный оракул) читается теперь внутри runBackgroundVerify, вместе с конфигом проекта:
  // одно правило, одно место. Здесь пробрасывать нечего.
  const { specFile, taskText } = bgChildContextFromEnv();
  // 024 T002: сеть под гардом таймаута. `beforeExit` срабатывает ТОЛЬКО когда цикл осушился
  // сам — то есть когда фон завис и ни один терминальный путь не отработал; при штатном
  // завершении ниже зовётся `process.exit()`, а он `beforeExit` не поднимает. Значит эта
  // ветка недостижима на нормальном прогоне и достижима ровно на том отказе, который до
  // 024 возвращал ноль. Выход ненулевой: «не смогли проверить» никогда не равно «зелено».
  let settled = false;
  process.on('beforeExit', () => {
    if (settled) return;
    settled = true;
    process.stderr.write('elt-verify-bg: фон завершился без терминальной записи (зависший слой) — выход 1\n');
    process.exit(1);
  });
  runBackgroundVerify({ cwd: process.cwd(), commitHash, taskId, specFile, taskText })
    .then(({ exit }) => { settled = true; process.exit(exit); })
    .catch((e) => { settled = true; process.stderr.write(`elt-verify-bg: ${e.stack || e.message}\n`); process.exit(1); });
}

module.exports = {
  spawnBackgroundVerify, runBackgroundVerify, BG_LOG_DIR,
  ensureWorktree, cleanupWorktree, worktreePath, WT_ROOT,
  enqueueBgRed, REVIEW_QUEUE, LAYERS, enabledLayers,
  bgChildEnv, bgChildContextFromEnv, runJudgeLayer,
  classifyJudge, classifyRun, harnessConfigAt, withJudgeTimeout, BG_TERMINAL, JUDGE_VERDICTS,
  issueBatchCertificate,
};
