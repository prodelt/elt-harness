'use strict';
// fleet.js — оркестратор параллельных слайсов (T009 MVP). Склеивает готовые кирпичи:
//   plan.nextBatch → claim+worktree (сериально, git worktree add не конкурентен) →
//   N воркеров+gate (параллельно, каждый в своём worktree) → merge (сериально) →
//   [X] ставит merge. Конфликт → requeue-serial (пересобрать worktree с обновлённой
//   интеграционной и переделать). Управление — код, 0 LLM-токенов. STOP-файл, resume
//   по claims (sweep stale на старте), лог событий в .harness/fleet/events.jsonl.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const runLog = require('../run-log');
const plan = require('./plan');
const claims = require('./claims');
const worktree = require('./worktree');
const gate = require('./gate');
const merge = require('./merge');
const watch = require('../harness-watch');
const heal = require('./heal');
const providers = require('./providers');
const attestation = require('./attest');
const { judgeSettings } = require('../elt-config');
const router = require('./router');
const approvalGuard = require('../approval-guard');

const ELT_CLI = path.join(os.homedir(), '.claude', 'bin', 'elt.js');

// 011 T020 — merge — единственное место в fleet, где интеграционная ветка сдвигается, и
// ИМЕННО там impact-выборка слепа: `git diff HEAD` сразу после merge-коммита почти пуст, так
// что оракул под `oracleSelect:impact` прогнал бы считанные файлы вместо всего дерева. merge.js
// не меняем (T020 объявляет только fleet.js, doctor-core.js, elt-oracle-runner.js, elt.js) —
// `ELT_ORACLE_FULL` тот же канал, что и в elt.js, и наследуется дочерним `node elt oracle`
// (merge.js → exec.run → spawn без явного env = process.env этого процесса на момент спавна).
// Мерж-очередь СЕРИАЛЬНА (см. шапку файла), поэтому нет риска задеть параллельный вызов.
async function mergeFullOracle(tid, opts) {
  process.env.ELT_ORACLE_FULL = '1';
  try { return await merge.mergeSlice(tid, opts); }
  finally { delete process.env.ELT_ORACLE_FULL; }
}

function currentBranch(cwd) {
  try { return execFileSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).trim(); }
  catch { return 'main'; }
}
function getChainForSlice(slice, policy) {
  const c = router.chainFor(slice.size, policy);
  if (slice.cli) {
    return [slice.cli, ...c.filter((p) => p !== slice.cli)];
  }
  return c;
}

function appendRunLog(cwd, entry) {
  try { runLog.appendRunLog(cwd, entry); } catch { /* noop */ }
}

// T026: одна ledger-строка на КАЖДЫЙ реальный spawn (implement/heal/judge), не одна
// агрегированная строка на весь батч-проход слайса (дефект 7 — heal и judge раньше вообще
// не попадали в ledger отдельно, длительности были смешаны). Строит форму через
// router.ledgerEntry (T026 делает его реальным консьюмером, не только протестированной
// в изоляции функцией) + произвольные доп.поля (verdict/attempts/healedBy) поверх.
function logSpawn(cwd, fields) {
  const { verdict, attempts, healedBy, ...rest } = fields;
  const extra = {};
  if (verdict !== undefined) extra.verdict = verdict;
  if (attempts !== undefined) extra.attempts = attempts;
  if (healedBy !== undefined) extra.healedBy = healedBy;
  appendRunLog(cwd, { ...router.ledgerEntry(rest), ...extra });
}

function eventsPath(cwd) {
  const d = path.join(cwd, '.harness', 'fleet');
  fs.mkdirSync(d, { recursive: true });
  return path.join(d, 'events.jsonl');
}

// Баг #9 (live-fire T016): воркер/судья бегут с cwd=worktree → providers.run пишет свой
// лог в <worktree>/.harness/fleet/logs/. slurpDiff (git add -N .) стейджит его → судья
// видит чужой лог ВНЕ зоны [files:] → block каждого слайса (и логи текли бы в merge).
// Пишем в .git/info/exclude (локальный, ОБЩИЙ для всех worktree, не коммитится и не мёржится
// — трекаемый .gitignore создавал бы merge-трение одинаковым путём в параллельных ветках).
// Игнорим только runtime-артефакты fleet (logs/events/claims), НЕ fleet.json (это конфиг).
// .fleet-wt/ — корень worktree'ов воркеров (worktree.js). Пропуск в этом списке означал,
// что КАЖДЫЙ fleet-прогон оставлял основное дерево грязным (`?? .fleet-wt/`) и ронял
// dirty-exit gate, хотя коммитить там нечего — это runtime-скрэтч, а не работа.
const FLEET_IGNORE_LINES = ['.harness/fleet/logs/', '.harness/fleet/events.jsonl', '.harness/fleet/claims/', '.fleet-wt/'];
function ensureFleetIgnore(dir) {
  try {
    const rel = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: dir, encoding: 'utf8' }).trim();
    const abs = path.isAbsolute(rel) ? rel : path.join(dir, rel);
    let cur = '';
    try { cur = fs.readFileSync(abs, 'utf8'); } catch { /* файла ещё нет */ }
    const add = FLEET_IGNORE_LINES.filter((l) => !cur.includes(l));
    if (!add.length) return;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.appendFileSync(abs, (cur && !cur.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n');
  } catch { /* некритично */ }
}
function emit(cwd, ev) {
  const rec = { ts: new Date().toISOString(), ...ev };
  try { fs.appendFileSync(eventsPath(cwd), JSON.stringify(rec) + '\n'); } catch { /* лог не критичен */ }
  return rec;
}

// T028 live-fire нашёл: agy (и ранее claude, T016) сам коммитит + правит tasks.md/harness.json
// вне [files:] — оркестратор гейтует НЕКОММИЧЕННЫЙ дифф (`git diff HEAD`), self-commit его
// прячет и подсовывает судье пустой/шумный дифф → REJECT-default блокирует чистую работу.
function workerPrompt(slice) {
  return `Ты — воркер fleet. Реализуй РОВНО этот слайс, строго в границах, ничего лишнего.
Слайс ${slice.id}: ${slice.text}
Меняй только файлы из зоны [files:], оракул проекта должен остаться зелёным.
НЕ выполняй git add/commit — оркестратор коммитит сам после проверки. НЕ трогай tasks.md
и harness.json. НЕ запускай elt commit/elt status — только записал файл(ы) и всё, работа окончена.

ПОСЛЕДНЕЙ строкой ответа выдай заявку о проделанной работе — ровно один JSON:
{"filesChanged":["путь/от/корня.js"],"testsAdded":["путь/к/тесту.test.js"]}
Пути — относительно корня репозитория. Заявка сверяется с реальным диффом механически:
названный, но неизменённый файл, изменённый но не названный, или отсутствие заявки —
слайс отклоняется без разбора судьёй и перевыдаётся другому исполнителю.`;
}

// Лимит воркера ОТДЕЛЬНО от дефолта providers (5 мин): тот рассчитан на короткий вызов
// судьи, а воркер пишет код и гоняет тесты. Живой прогон 007 (2026-07-22): agy дописал
// [M]-слайс за 2.5 мин, но ответ не отдал и упал по 5-минутному лимиту — работа была
// сделана и выброшена. Один холодный старт agy сам по себе ~60с (замер).
const WORKER_TIMEOUT_MS = 20 * 60 * 1000;

// Дефолтный воркер: headless-провайдер делает слайс в worktree. Тест инжектит свой.
// T027: ctx.stopFile — путь к .harness/STOP КОРНЕВОГО проекта (не wtPath) — providers.run
// поллит его и убивает child ≤секунд, не ждёт batch-границы/timeoutMs.
async function defaultWorker(slice, wtPath, ctx) {
  return providers.run({ provider: ctx.provider, prompt: workerPrompt(slice), cwd: wtPath, model: ctx.model, stopFile: ctx.stopFile, timeoutMs: WORKER_TIMEOUT_MS });
}

// 009 T008: решения watchdog применяются ЗДЕСЬ, а не в CLI-процессе — router-state и
// провайдер судьи живут в памяти этого прогона. Отдельная функция, потому что «fleet
// уважает решения» иначе нечем доказать: тест зовёт её так же, как цикл.
//   cooldown       → провайдер остывает; куда уйдёт следующий слайс, решает router.pick
//   park           → задача выпадает из батчей до конца прогона
//   judge-fallback → судья меняется на остаток прогона
// Класс без действия сюда не доходит (закрытый список — в harness-watch).
function applyWatchdog(actions, { cwd, routerState, policy, judgeProvider, judgeModel, parked }) {
  let judge = { provider: judgeProvider, model: judgeModel };
  const done = []; // подтверждаем ТОЛЬКО фактически применённые (см. watch.ack)
  for (const a of actions || []) {
    if (a.action === 'cooldown' && a.from) {
      // Воркеру маршрут не назначается: остывший провайдер выпадает из pick(), а КОГО
      // выберет следующий слайс, решает приоритет его цепочки размера (для [agy,codex,claude]
      // с остывшим codex это agy — он приоритетнее и здоров). Единственный реальный маршрут
      // здесь — судья: он в конфиге один, сам себя не заменит.
      router.cool(routerState, a.from, policy.cooldownSec);
      if (a.subject === 'judge' && a.to && a.from === judge.provider) {
        judge = { provider: a.to, model: a.toModel || router.modelFor(a.to, policy) };
      }
      emit(cwd, { event: 'watchdog-cooldown', provider: a.from, subject: a.subject || 'worker', to: a.to || null, reason: a.reason });
      done.push(a.key);
    } else if (a.action === 'park' && a.from) {
      for (const id of String(a.from).split(',')) parked.add(id.trim());
      // Парковка обязана ПЕРЕЖИТЬ прогон: in-memory Set вернул бы задаче третью попытку
      // после рестарта fleet — ровно то, что решение red-repeat и запрещает. Поэтому
      // провал `elt park` НЕ подтверждается: действие выдастся снова на следующем проходе.
      let persisted = true;
      try { execFileSync(process.execPath, [ELT_CLI, 'park', '--task', a.from, '--reason', a.reason], { cwd, encoding: 'utf8' }); }
      catch (e) { persisted = false; emit(cwd, { event: 'watchdog-park-failed', tid: a.from, err: String(e && e.message || e) }); }
      emit(cwd, { event: 'watchdog-park', tid: a.from, reason: a.reason, persisted });
      if (!persisted) continue;
      done.push(a.key);
    } else if (a.action === 'judge-fallback' && a.to) {
      // Провайдер И модель вместе: чужая модель у нового провайдера = fatal config,
      // то есть «фолбэк», который гарантированно не запускается.
      judge = { provider: a.to, model: a.toModel || router.modelFor(a.to, policy) };
      emit(cwd, { event: 'watchdog-judge-fallback', from: a.from, to: a.to, model: judge.model, reason: a.reason });
      done.push(a.key);
    }
  }
  watch.ack(cwd, done.filter(Boolean));
  return judge;
}

// 009 T010: судья не совпадает с воркером слайса. Резолв В КОДЕ, а не в конфиге: конфиг знает
// одну пару судей на прогон, а провайдер воркера меняется от слайса к слайсу (роутер по размеру
// + failover), и agy-воркер иначе штатно получал бы agy-судью. JUDGE_ALTS — те же три CLI, что
// умеет providers.js; порядок = приоритет замены.
// Заменять судью можно только на РЕАЛЬНО доступный CLI: увести его на не установленный
// провайдер значит превратить каждый слайс в judge-unavailable-парковку. Список альтернатив и
// резолв доступності — у gate/providers: той самий вибір робить gate при failover мертвого CLI.
const JUDGE_ALTS = gate.JUDGE_ALTS;
const providerAvailable = providers.available;
// avail прокинут параметром (а не берётся из модуля) ровно ради тестируемости ветки «замены
// нет»: на машине разработчика все три CLI реально в PATH, и смоделировать её иначе нельзя.
function judgeAwayFrom(cwd, workerProvider, judge, policy, avail = providerAvailable) {
  if (judge.provider !== workerProvider) return judge;
  const p = JUDGE_ALTS.find((x) => x !== workerProvider && avail(x));
  if (!p) {
    // Единственный CLI на машине — разводить не с кем. Раньше здесь возвращался тот же судья
    // (== воркер) с записью в ledger: слайс заверял сам себя, то есть ровно та дыра, которую
    // T010 и закрывает, оставалась открытой в самой опасной ветке. Теперь — null: вызывающий
    // паркует слайс как judge-unavailable. Цена осознанная: на машине с одним CLI гейт
    // непроходим. Потолок снимается установкой второго CLI, не ослаблением инварианта.
    emit(cwd, { event: 'judge-same-as-worker', provider: workerProvider });
    return null;
  }
  return { provider: p, model: router.modelFor(p, policy) };
}

function cleanupSlice(cwd, tid, { deleteBranch = true } = {}) {
  try { worktree.remove(tid, { cwd, force: true, deleteBranch }); } catch { /* уже нет */ }
  claims.release(tid, { cwd });
}

// T024: честный merge-исход. Вызывать ТОЛЬКО когда !m.conflict (конфликт разбирает
// сам вызывающий — там своя логика requeue). non-conflict m.ok=false (checkout/commit
// стадия упала) ИЛИ реальный merge с красным интеграционным оракулом ⇒ terminal-failed,
// НЕ "merged" (дефект 5). Интеграционный оракул больше не skip-абельный (дефект 4).
function applyMergeResult(m, tid, cwd, summary, mergedEvent) {
  if (!m.ok) {
    emit(cwd, { event: 'merge-failed', tid, stage: m.stage, err: m.err });
    cleanupSlice(cwd, tid);
    summary.failed.push(tid);
    return false;
  }
  if (m.merged && m.oracleOk === false) {
    emit(cwd, { event: 'merge-oracle-red', tid });
    cleanupSlice(cwd, tid);
    summary.failed.push(tid);
    return false;
  }
  emit(cwd, { event: mergedEvent, tid, oracleOk: m.oracleOk });
  cleanupSlice(cwd, tid);
  summary.merged.push(tid);
  return true;
}

// T021: дожать слайсы, застрявшие на judge_pending/merge_pending (мёртвый pid, живой worktree).
// НЕ зовёт worker — реализация уже лежит в worktree (judge_pending) или уже закоммичена
// (merge_pending), передел исключён. Судья снова недоступен → ре-парковка, суммарный
// прогон не считает это failed (ждёт следующего resume).
async function resumeParked(resumable, { cwd, integration, tasksPath, judgeProvider, judgeModel, summary }) {
  for (const c of resumable) {
    const wtPath = c.wtPath;
    claims.claim(c.tid, { cwd, pid: process.pid, worker: 'fleet-resume', meta: { provider: c.provider, state: c.state, wtPath, taskText: c.taskText } });
    emit(cwd, { event: 'resume-parked', tid: c.tid, state: c.state });

    if (c.state === 'judge_pending') {
      const judgeStart = Date.now();
      const g = await gate.gate({ tid: c.tid, taskText: c.taskText || '', cwd: wtPath, judgeProvider, judgeModel, integration, specFile: tasksPath });
      logSpawn(cwd, {
        tid: c.tid, phase: 'judge', provider: judgeProvider, model: judgeModel,
        durationSec: Math.round((Date.now() - judgeStart) / 1000),
        exit: g.ok ? 0 : 1, failoverFrom: null, limitHit: false,
        verdict: g.stage === 'judge-unavailable' ? 'judge-unavailable' : (g.ok ? 'pass' : (g.stage === 'judge' ? 'block' : g.stage)),
      });
      if (g.stage === 'judge-unavailable') {
        emit(cwd, { event: 'judge-still-unavailable', tid: c.tid });
        claims.setState(c.tid, { state: 'judge_pending' }, { cwd }); // остаётся припаркован
        continue;
      }
      if (!g.ok) {
        emit(cwd, { event: 'resume-gate-reject', tid: c.tid, stage: g.stage });
        cleanupSlice(cwd, c.tid);
        summary.failed.push(c.tid);
        continue;
      }
      claims.setState(c.tid, { state: 'merge_pending' }, { cwd });
    }

    const m = await mergeFullOracle(c.tid, { cwd, integration, tasksPath, elt: ELT_CLI, oracle: true });
    if (m.conflict) {
      emit(cwd, { event: 'resume-merge-conflict', tid: c.tid });
      summary.conflicts.push(c.tid); // claim/worktree/branch остаются — следующий resume дожмёт
      continue;
    }
    applyMergeResult(m, c.tid, cwd, summary, 'resume-merged');
  }
}

async function run(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const tasksPath = opts.tasksPath;
  if (!tasksPath) throw new Error('fleet.run: нужен tasksPath');
  const integration = opts.integration || currentBranch(cwd);
  const workers = opts.workers || 2;
  const chain = opts.providersChain || ['claude'];
  const model = opts.model || null;
  const worker = opts.worker || defaultWorker;
  const stopFile = opts.stopFile || path.join(cwd, '.harness', 'STOP');
  // Судья: явный opts побеждает, иначе — harness.json проекта (единый источник, elt-config).
  const judgeCfg = judgeSettings(cwd);
  let judgeModel = opts.judgeModel || judgeCfg.model; // let: watchdog меняет пару provider+model
  // Провайдер судьи (judge-bench 2026-07-22: agy/gemini-3.6-flash и codex/gpt-5.6 дают тот же
  // recall 7/7, что sonnet, но не жгут Claude-лимит) — из harness.json, дефолт claude.
  // let, не const: watchdog (009 T008) может увести судью на фолбэк-провайдера
  // на остаток прогона, когда основной судья умирает подряд.
  let judgeProvider = opts.judgeProvider || judgeCfg.provider;
  const watchdogParked = new Set();
  const maxLoops = opts.maxLoops || 100;
  const maxAttempts = opts.maxAttempts || 3;

  const summary = { merged: [], failed: [], conflicts: [], requeued: [], abandoned: [], parked: [], stopped: false, stoppedReason: null };

  // 006 T004: pre-run approval guard — fleet reads tasksPath directly (never
  // goes through elt.js's slice-next/commit gate at all), so an unapproved
  // spec would otherwise spawn workers on it undetected. Explicit specDir
  // (fleet already knows tasksPath) — no auto-detection needed here.
  const approval = approvalGuard.guard(cwd, path.dirname(tasksPath), ELT_CLI);
  if (!approval.ok) {
    emit(cwd, { event: 'stopped', reason: 'approval-guard', detail: approval.reason });
    summary.stopped = true;
    summary.stoppedReason = 'approval-guard';
    return summary;
  }

  const policy = router.loadPolicy(cwd);
  const routerState = router.makeState();
  const callTracker = router.makeCallTracker();
  // T020: все провайдеры цепочки в cooldown → provFor вернёт null, а НЕ тихий fallback
  // на c[0] (тот остыл тоже — спавнить на него значит бить по тому же лимиту, который
  // его туда загнал).
  // 009 T009: слайс, отклонённый worker-attestation, перевыдаётся СЛЕДУЮЩЕМУ провайдеру
  // цепочки — иначе следующий проход по приоритету вернул бы его тому же воркеру, который
  // только что соврал о своей работе. Цепочки длиной 1 — повтор тем же, ограничен maxAttempts.
  const reissueTo = new Map(); // tid → провайдер, которому перевыдан слайс
  const provFor = (slice) => {
    const c = getChainForSlice(slice, policy);
    const pref = reissueTo.get(slice.id);
    return router.pick(pref ? [pref, ...c.filter((p) => p !== pref)] : c, routerState);
  };

  // Баг #8: без верхнего предела попыток застрявший слайс (heal-failed/gate-reject) реквеился
  // каждый loop бесконечно, сжигая реальные claude -p. Cap на попытки per-слайс → abandon.
  const attempts = new Map();
  // T022: heal-бюджет и block-причина судьи ПЕРЕЖИВАЮТ повторные batch-попытки одного
  // слайса (attempts выше их не сбрасывает) — иначе каждая попытка implement заново
  // открывала полный heal-бюджет (×3-размножение, дефект 1) и судья каждый раз получал
  // тот же пустой контекст без памяти о прошлом block.
  const healUsed = new Map();
  const blockReasons = new Map();
  const recordFail = (tid) => {
    const n = (attempts.get(tid) || 0) + 1;
    attempts.set(tid, n);
    if (n >= maxAttempts) { emit(cwd, { event: 'batch-abandoned', tid, attempts: n }); summary.abandoned.push(tid); }
  };
  const isAbandoned = (tid) => (attempts.get(tid) || 0) >= maxAttempts;

  ensureFleetIgnore(cwd); // не тащить runtime-артефакты в git основного репо
  emit(cwd, { event: 'start', integration, workers, chain });

  // T021: распарковать слайсы, упавшие на judge_pending/merge_pending (мёртвый pid, живой
  // worktree) ДО общего sweep — иначе sweep их же и освободит как обычный stale-claim, и
  // следующий batch тупо перезапустит воркера поверх уже готовой (но неcommit'нутой) правки.
  const staleAtStart = claims.stale({ cwd });
  const resumable = staleAtStart.filter((c) => (c.state === 'judge_pending' || c.state === 'merge_pending') && c.wtPath && fs.existsSync(c.wtPath));
  if (resumable.length) {
    emit(cwd, { event: 'resume-parked-found', tids: resumable.map((c) => c.tid) });
    await resumeParked(resumable, { cwd, integration, tasksPath, judgeProvider, judgeModel, summary });
  }
  // T027 (crash-resume не оставляет orphan .fleet-wt): claims.sweep() снимает только
  // claim-файл — worktree упавшего процесса (implementing/oracle/heal, до judge_pending)
  // остаётся на диске без владельца. Следующий worktree.create() на ту же ветку упал бы
  // "already exists". Чистим ИХ worktree здесь же, ДО sweep — resumable уже обработаны выше
  // и трогать их нельзя (там живая незакоммиченная реализация).
  const resumableIds = new Set(resumable.map((c) => c.tid));
  const orphaned = staleAtStart.filter((c) => !resumableIds.has(c.tid) && c.wtPath && fs.existsSync(c.wtPath));
  for (const c of orphaned) {
    emit(cwd, { event: 'resume-orphan-worktree-cleaned', tid: c.tid, state: c.state });
    try { worktree.remove(c.tid, { cwd, force: true, deleteBranch: true }); } catch { /* уже нет / гонка с другим процессом */ }
  }
  const swept = claims.sweep({ cwd });
  if (swept.length) emit(cwd, { event: 'resume-sweep', freed: swept });

  for (let loop = 0; loop < maxLoops; loop++) {
    if (fs.existsSync(stopFile)) { emit(cwd, { event: 'stopped', reason: 'STOP-файл' }); summary.stopped = true; break; }

    const slices = plan.parseFile(tasksPath);
    const byId = new Map(slices.map((s) => [s.id, s]));
    // Слайсы, припаркованные (живым) claim'ом на judge_pending/merge_pending, не re-claim'ятся
    // обычным путём — их дожимает resumeParked при следующем запуске run(), не воркер здесь.
    const parkedIds = new Set(claims.list({ cwd })
      .filter((c) => !c.stale && (c.state === 'judge_pending' || c.state === 'merge_pending'))
      .map((c) => c.tid));
    // 009 T008: watchdog между батчами. Fleet держит router-state в памяти процесса,
    // поэтому решение `cooldown` применяется прямо здесь (CLI-процесс watchdog'а своим
    // state не поделился бы). Остальные классы — только запись в health.jsonl.
    // judgeProvider — текущий (opts-override или уже применённый фолбэк), не из harness.json.
    ({ provider: judgeProvider, model: judgeModel } = applyWatchdog(watch.runOnce(cwd, { judgeProvider }).actions, {
      cwd, routerState, policy, judgeProvider, judgeModel, parked: watchdogParked,
    }));

    const batch = plan.nextBatch(slices).filter((s) => !isAbandoned(s.id) && !parkedIds.has(s.id) && !watchdogParked.has(s.id)).slice(0, workers);
    if (!batch.length) { emit(cwd, { event: 'done' }); break; }
    emit(cwd, { event: 'batch', tids: batch.map((s) => s.id) });

    // T020: все провайдеры доступного слайса в cooldown → СТОП всего прогона (nonzero),
    // не fallback на остывающего. Проверяем ВЕСЬ батч до claim — ничего не спавнить дальше.
    const providersForBatch = batch.map((slice) => ({ slice, provider: provFor(slice) }));
    const allCooling = providersForBatch.find((x) => x.provider === null);
    if (allCooling) {
      emit(cwd, { event: 'all-providers-cooling', tids: batch.map((s) => s.id) });
      summary.stoppedReason = 'all-providers-cooling';
      summary.stopped = true;
      break;
    }

    // фаза 0: claim + worktree — сериально (git worktree add не конкурентен)
    const active = [];
    for (const { slice, provider } of providersForBatch) {
      const cl = claims.claim(slice.id, { cwd, worker: 'fleet', meta: { provider, state: 'implementing', taskText: slice.text } });
      if (!cl.ok) { emit(cwd, { event: 'skip-held', tid: slice.id, heldBy: cl.heldBy && cl.heldBy.pid }); continue; }
      const wt = worktree.create(slice.id, { cwd, base: integration });
      claims.setState(slice.id, { wtPath: wt.path }, { cwd });
      active.push({ slice, wtPath: wt.path, provider });
    }

    // фаза 1: воркер + gate — параллельно (разные worktree)
    const gated = await Promise.all(active.map(async ({ slice, wtPath, provider }) => {
      emit(cwd, { event: 'slice-work', tid: slice.id, provider });
      // T026: per-phase ledger — phase/phaseStart мутируются по мере прохождения
      // implement → heal → judge, каждая фаза несёт СВОЮ длительность и свою строку.
      let phase = 'implement';
      let phaseStart = Date.now();
      // T020: hard cap ПЕРЕД spawn — превышение → слайс terminal-failed, ничего не спавнить.
      const capBlock = (reason) => {
        emit(cwd, { event: 'cap-exceeded', tid: slice.id, provider, reason });
        logSpawn(cwd, {
          tid: slice.id, phase, provider, model, durationSec: Math.round((Date.now() - phaseStart) / 1000),
          exit: null, failoverFrom: null, limitHit: false, verdict: 'cap-exceeded',
        });
        return { tid: slice.id, gateOk: false, capped: true };
      };
      try {
        const workerCap = router.tryBeginCall(callTracker, policy, provider);
        if (!workerCap.ok) return capBlock(workerCap.reason);
        let res;
        try { res = await worker(slice, wtPath, { provider, model, stopFile }); }
        finally { router.endCall(callTracker, provider); }
        // Инжектируемые воркеры (тесты, часть live-стабов) могут вернуть undefined —
        // отсутствие исключения трактуем как успех (старое поведение router.failover
        // это уже терпело через !result; ledger теперь тоже не должен падать на res.exit).
        res = res || {};
        const implDurationSec = Math.round((Date.now() - phaseStart) / 1000);

        // Проверяем лимит
        const c = getChainForSlice(slice, policy);
        const limit = router.failover({ result: res, provider, chain: c, state: routerState, policy });
        // 009 T010: три причины, по которым воркер не дал работы ПО ВИНЕ ПРОВАЙДЕРА, ведут
        // в одно место — перевыдачу следующему в цепочке. Раньше туда шёл только лимит:
        // timeout хоронился как обычный fail (слайс переделывался тем же CLI, который уже
        // не уложился), а fatal-config валил ВЕСЬ прогон, хотя сломан один провайдер и рядом
        // в цепочке стоит здоровый. Остужаем тем же router.cool, чтобы следующий проход по
        // приоритету не вернул слайс обратно.
        const fatal = router.detectFatalConfig(res);
        const providerFail = res.reason === 'stopped' ? null
          : limit.limitHit ? 'limit'
            : res.reason === 'timeout' ? 'timeout'
              : fatal ? 'fatal-config' : null;
        let nextProvider = limit.limitHit ? limit.next : null;
        if (providerFail === 'timeout' || providerFail === 'fatal-config') {
          router.cool(routerState, provider, policy.cooldownSec);
          nextProvider = router.pick(c.slice(c.indexOf(provider) + 1), routerState);
        }
        // T026: implement-строка пишется ВСЕГДА (раньше — только на limit/error-ветках,
        // успешный воркер вообще не попадал в ledger). model — реальный дефолт роутера,
        // если caller не передал явный (иначе ledger врал бы null там, где providers.js
        // внутри себя всё равно резолвит --model).
        const implModel = model || router.modelFor(provider, policy);
        logSpawn(cwd, {
          tid: slice.id, phase: 'implement', provider, model: implModel, durationSec: implDurationSec,
          exit: res.exit != null ? res.exit : (res.ok === false ? 1 : 0),
          failoverFrom: providerFail ? provider : null, limitHit: limit.limitHit,
          verdict: providerFail || (res.ok === false ? (res.reason || 'fail') : 'ok'),
        });
        if (providerFail) {
          emit(cwd, { event: providerFail === 'limit' ? 'limit-hit' : 'provider-fail', tid: slice.id, provider, reason: providerFail, next: nextProvider, ...(fatal ? { detail: fatal } : {}) });
          if (fatal) emit(cwd, { event: 'fatal-config', tid: slice.id, provider, model, detail: fatal });
          return { tid: slice.id, gateOk: false, providerFail, limitHit: limit.limitHit, provider, nextProvider, fatalConfig: fatal || null };
        }
        // T027: STOP убил implement-spawn — НЕ продолжаем в heal/judge (это был бы новый
        // spawn ПОСЛЕ запроса на остановку). Слайс переделается со следующего run() —
        // cleanupSlice тут же освобождает worktree/claim, чтобы .fleet-wt не осиротел.
        if (res.reason === 'stopped') {
          emit(cwd, { event: 'stopped-mid-slice', tid: slice.id });
          return { tid: slice.id, gateOk: false, stoppedMidSlice: true };
        }
        // 009 T009: заявка воркера против реального диффа worktree — ДО оракула и судьи.
        // Проверка безусловна: воркер без транскрипта (res.stdout пуст) — это ровно
        // случай no-attestation, а не повод пропустить контроль.
        // ponytail: heal чинит красный оракул ПРАВКАМИ УЖЕ ЗАЯВЛЕННЫХ файлов; новый файл
        // от heal ломает сверку и слайс уходит на перевыдачу. Осознанный потолок: heal
        // не имеет права расширять множество файлов молча. Мешать начнёт живьём —
        // заводить отдельную заявку для heal (там же, где failover воркера, T010).
        const checkAttestation = () => {
          const at = attestation.attest({ stdout: res.stdout || '', cwd: wtPath, integration });
          if (at.ok) return null;
          const chain = getChainForSlice(slice, policy);
          const next = chain[chain.indexOf(provider) + 1] || null;
          emit(cwd, { event: 'attest-fail', tid: slice.id, provider, code: at.code, detail: at.detail, next, afterHeal: phase === 'heal' });
          logSpawn(cwd, {
            tid: slice.id, phase: 'attest', provider, model: implModel, durationSec: 0,
            exit: 1, failoverFrom: null, limitHit: false, verdict: at.code,
          });
          return { tid: slice.id, gateOk: false, attestFail: at.code, provider, nextProvider: next };
        };
        const attestFail = checkAttestation();
        if (attestFail) return attestFail;

        claims.setState(slice.id, { state: 'oracle' }, { cwd });
        // красный оракул после воркера → heal-эскалация (свой провайдер → claude → failed).
        // T022: healUsedSoFar — суммарный heal-бюджет (≤2) переживает batch-retry этого
        // слайса; callTracker/policy — heal-спавны тоже под T020 hard-cap, не только implement/judge.
        const healSoFar = healUsed.get(slice.id) || 0;
        phase = 'heal'; phaseStart = Date.now();
        const h = await heal.healSlice({ slice, wtPath, cwd: wtPath, provider, model, elt: ELT_CLI, healUsedSoFar: healSoFar, callTracker, policy });
        healUsed.set(slice.id, healSoFar + h.attempts);
        // heal.js паковал ≤2 внутренних попытки в один вызов (heal.js вне scope T026) —
        // одна ledger-строка на вызов, только если реально был spawn (h.attempts>0),
        // иначе оракул был зелёным сразу и heal ничего не спавнил.
        if (h.attempts > 0) {
          logSpawn(cwd, {
            tid: slice.id, phase: 'heal', provider, model, durationSec: Math.round((Date.now() - phaseStart) / 1000),
            exit: h.ok ? 0 : 1, failoverFrom: null, limitHit: false,
            verdict: h.ok ? 'ok' : 'heal-failed', attempts: h.attempts, healedBy: h.healedBy,
          });
        }
        if (!h.ok) {
          emit(cwd, { event: 'heal-failed', tid: slice.id, attempts: h.attempts });
          return { tid: slice.id, gateOk: false };
        }
        if (h.attempts) emit(cwd, { event: 'healed', tid: slice.id, attempts: h.attempts, by: h.healedBy });

        // Повторная сверка ПОСЛЕ heal: между первой аттестацией и судьёй дифф успел
        // измениться чужой рукой (heal — отдельный spawn того же провайдера). Без неё
        // контроль обходится тривиально: отчитаться честно, а дописать в heal-фазе.
        if (h.attempts > 0) {
          const afterHeal = checkAttestation();
          if (afterHeal) return afterHeal;
        }

        // Судья слайса не может быть тем же провайдером, що й воркер: самоперевірка не proof.
        claims.setState(slice.id, { state: 'judge_pending' }, { cwd });
        phase = 'judge'; phaseStart = Date.now();
        const jp = judgeAwayFrom(cwd, provider, { provider: judgeProvider, model: judgeModel }, policy);
        if (!jp) { // разводить не с кем — паркуем, а не судим воркером самого себя
          emit(cwd, { event: 'judge-unavailable-park', tid: slice.id, reason: 'judge-same-as-worker' });
          logSpawn(cwd, {
            tid: slice.id, phase: 'judge', provider, model: null, durationSec: 0,
            exit: null, failoverFrom: null, limitHit: false, verdict: 'judge-unavailable',
          });
          return { tid: slice.id, gateOk: false, parked: true };
        }
        const judgeCap = router.tryBeginCall(callTracker, policy, jp.provider);
        if (!judgeCap.ok) return capBlock(judgeCap.reason);
        let g;
        try { g = await gate.gate({ tid: slice.id, taskText: slice.text, cwd: wtPath, judgeProvider: jp.provider, judgeModel: jp.model, judgeExclude: [provider], prevBlockReason: blockReasons.get(slice.id) || '', integration, specFile: tasksPath }); }
        finally { router.endCall(callTracker, jp.provider); }
        const judgeDurationSec = Math.round((Date.now() - phaseStart) / 1000);

        // T021: судья НЕ отработал (timeout/spawn-error) — паркуем worktree на judge_pending,
        // НЕ трогаем реализацию. Слайс остаётся claimed (наш живой pid) → следующий loop его
        // не re-claim'ит (parkedIds), резюмируется на старте следующего run() без воркера.
        if (g.stage === 'judge-unavailable') {
          emit(cwd, { event: 'judge-unavailable-park', tid: slice.id });
          logSpawn(cwd, {
            tid: slice.id, phase: 'judge', provider: jp.provider, model: jp.model, durationSec: judgeDurationSec,
            exit: null, failoverFrom: null, limitHit: false, verdict: 'judge-unavailable',
          });
          return { tid: slice.id, gateOk: false, parked: true };
        }

        // T022: block-причина → следующей batch-попытке этого слайса; pass чистит её.
        if (g.stage === 'judge' && g.verdict === 'block') blockReasons.set(slice.id, (g.reasons || []).join('; '));
        else if (g.ok) blockReasons.delete(slice.id);

        emit(cwd, { event: g.ok ? 'gate-pass' : 'gate-reject', tid: slice.id, stage: g.stage, verdict: g.verdict, err: g.err || (g.reasons || []).join('; ') || null });
        if (g.ok) claims.setState(slice.id, { state: 'merge_pending' }, { cwd });

        logSpawn(cwd, {
          tid: slice.id, phase: 'judge', provider: jp.provider, model: jp.model, durationSec: judgeDurationSec,
          exit: g.ok ? 0 : 1, failoverFrom: null, limitHit: false,
          verdict: g.ok ? 'pass' : (g.stage === 'judge' ? 'block' : g.stage),
        });

        return { tid: slice.id, gateOk: g.ok };
      } catch (e) {
        emit(cwd, { event: 'slice-error', tid: slice.id, err: e.message });
        logSpawn(cwd, {
          tid: slice.id, phase, provider, model, durationSec: Math.round((Date.now() - phaseStart) / 1000),
          exit: null, failoverFrom: null, limitHit: false, verdict: 'error',
        });
        return { tid: slice.id, gateOk: false };
      }
    }));

    // фаза 2: merge — сериально (интеграционная одна)
    let stopHit = false;
    let stopReason = null;
    for (const r of gated) {
      if (r.parked) { summary.parked.push(r.tid); continue; } // claim/worktree нетронуты — резюмируется на следующем run()
      if (r.stoppedMidSlice) {
        // T027: STOP убил implement mid-flight — освобождаем worktree/claim СРАЗУ (не
        // оставляем .fleet-wt осиротевшим) и сигналим остановку всего прогона; без
        // recordFail — это не реальный провал, слайс просто переделается со следующего run().
        cleanupSlice(cwd, r.tid);
        stopHit = true; stopReason = stopReason || 'STOP-файл';
        continue;
      }
      if (!r.gateOk) {
        cleanupSlice(cwd, r.tid);
        if (r.capped) {
          summary.failed.push(r.tid); // terminal-failed, не транзиент — без retry
          stopHit = true; stopReason = 'cap-exceeded';
        } else if (r.providerFail && r.nextProvider) {
          // 009 T010: провайдер не дал работы (лимит/таймаут/фатальный конфиг), но в цепочке
          // есть здоровый — перевыдаём ему явно, а не надеемся на приоритет следующего прохода.
          // recordFail: перевыдачи ограничены maxAttempts, иначе слайс, который валят ВСЕ,
          // крутился бы по цепочке вечно.
          emit(cwd, { event: 'failover-reissue', tid: r.tid, from: r.provider, to: r.nextProvider, reason: r.providerFail });
          reissueTo.set(r.tid, r.nextProvider);
          summary.requeued.push(r.tid);
          recordFail(r.tid);
        } else if (r.fatalConfig) {
          // Заменить некем (цепочка кончилась): протухшая модель/флаг/логин не лечатся повтором,
          // у остальных слайсов будет ровно та же ошибка. Валим прогон с сообщением САМОГО CLI,
          // иначе юзер видит «failed» и идёт искать проблему в коде слайса, а не в конфиге.
          summary.failed.push(r.tid);
          stopHit = true;
          stopReason = `fatal-config (${r.provider}): ${r.fatalConfig}`;
        } else if (r.providerFail) {
          summary.requeued.push(r.tid); // лимит/таймаут без альтернативы — ждём остывания цепочки
        } else if (r.attestFail) {
          // Работа воркера не соответствует его отчёту: судья её не видел, переделываем
          // другим провайдером. recordFail — чтобы слайс, который врут ВСЕ, не крутился вечно.
          if (r.nextProvider) reissueTo.set(r.tid, r.nextProvider);
          summary.requeued.push(r.tid);
          recordFail(r.tid);
        } else {
          summary.failed.push(r.tid);
          recordFail(r.tid);
        }
        continue;
      }
      const m = await mergeFullOracle(r.tid, { cwd, integration, tasksPath, elt: ELT_CLI, oracle: true });
      if (m.conflict) {
        emit(cwd, { event: 'merge-conflict', tid: r.tid });
        cleanupSlice(cwd, r.tid); // сбросить ветку/worktree
        summary.conflicts.push(r.tid);
        const rr = await redoSerial(byId.get(r.tid), { cwd, integration, tasksPath, worker, model, judgeProvider, judgeModel, provFor, policy, routerState, callTracker, stopFile });
        if (rr.ok) { summary.requeued.push(r.tid); summary.merged.push(r.tid); }
        else if (rr.stoppedMidSlice) { stopHit = true; stopReason = stopReason || 'STOP-файл'; }
        else if (rr.attestFail) {
          // Тот же порядок, что на основном пути: врал воркер, а не слайс — переделываем
          // следующим провайдером цепочки, а не хороним как failed.
          if (rr.nextProvider) reissueTo.set(r.tid, rr.nextProvider);
          summary.requeued.push(r.tid);
          recordFail(r.tid);
        } else {
          summary.failed.push(r.tid);
          if (rr.capped) { stopHit = true; stopReason = 'cap-exceeded'; }
          else if (rr.allCooling) { stopHit = true; stopReason = 'all-providers-cooling'; }
          else recordFail(r.tid);
        }
      } else {
        applyMergeResult(m, r.tid, cwd, summary, 'merged');
      }
    }
    if (stopHit) {
      emit(cwd, { event: 'cap-stop', reason: stopReason });
      summary.stoppedReason = summary.stoppedReason || stopReason;
      summary.stopped = true;
      break;
    }
  }

  emit(cwd, { event: 'summary', ...summary });
  return summary;
}

// requeue-serial: пересобрать worktree с ОБНОВЛЁННОЙ интеграционной (там уже победивший
// слайс) и переделать — теперь правки ложатся сверху, merge чистый. Возвращает
// {ok, capped?, allCooling?} — T020: caller решает, стопать ли весь прогон.
async function redoSerial(slice, { cwd, integration, tasksPath, worker, model, judgeProvider, judgeModel, provFor, policy, routerState, callTracker, stopFile }) {
  const provider = provFor(slice);
  if (provider === null) {
    emit(cwd, { event: 'all-providers-cooling', tids: [slice.id] });
    return { ok: false, allCooling: true };
  }
  emit(cwd, { event: 'requeue-serial', tid: slice.id, provider });
  const cl = claims.claim(slice.id, { cwd, worker: 'fleet-serial', meta: { provider } });
  if (!cl.ok) return { ok: false };
  const wt = worktree.create(slice.id, { cwd, base: integration });
  let phase = 'implement';
  let phaseStart = Date.now();
  const capBlock = (reason) => {
    emit(cwd, { event: 'cap-exceeded', tid: slice.id, provider, reason });
    logSpawn(cwd, {
      tid: slice.id, phase, provider, model, durationSec: Math.round((Date.now() - phaseStart) / 1000),
      exit: null, failoverFrom: null, limitHit: false, verdict: 'cap-exceeded',
    });
    cleanupSlice(cwd, slice.id);
    return { ok: false, capped: true };
  };
  try {
    const workerCap = router.tryBeginCall(callTracker, policy, provider);
    if (!workerCap.ok) return capBlock(workerCap.reason);
    let res;
    try { res = await worker(slice, wt.path, { provider, model, stopFile }); }
    finally { router.endCall(callTracker, provider); }
    res = res || {}; // инжектируемый воркер без return — не исключение, трактуем как успех
    const implDurationSec = Math.round((Date.now() - phaseStart) / 1000);
    const chain = getChainForSlice(slice, policy);
    const limit = router.failover({ result: res, provider, chain, state: routerState, policy });
    const implModel = model || router.modelFor(provider, policy);
    logSpawn(cwd, {
      tid: slice.id, phase: 'implement', provider, model: implModel, durationSec: implDurationSec,
      exit: res.exit != null ? res.exit : (res.ok === false ? 1 : 0),
      failoverFrom: limit.failoverFrom, limitHit: limit.limitHit,
      verdict: limit.limitHit ? 'limit' : (res.ok === false ? (res.reason || 'fail') : 'ok'),
    });
    if (limit.limitHit) {
      cleanupSlice(cwd, slice.id);
      return { ok: false };
    }
    // T027: STOP убил implement mid-flight — не спавним judge ПОСЛЕ запроса на остановку.
    if (res.reason === 'stopped') {
      emit(cwd, { event: 'stopped-mid-slice', tid: slice.id });
      cleanupSlice(cwd, slice.id);
      return { ok: false, stoppedMidSlice: true };
    }
    // 009 T009: serial-передел — тот же контроль заявки, иначе через redoSerial к судье
    // попадала бы непроверенная работа (обход основного пути).
    const at = attestation.attest({ stdout: res.stdout || '', cwd: wt.path, integration });
    if (!at.ok) {
      const next = chain[chain.indexOf(provider) + 1] || null;
      emit(cwd, { event: 'attest-fail', tid: slice.id, provider, code: at.code, detail: at.detail, next });
      logSpawn(cwd, {
        tid: slice.id, phase: 'attest', provider, model: implModel, durationSec: 0,
        exit: 1, failoverFrom: null, limitHit: false, verdict: at.code,
      });
      cleanupSlice(cwd, slice.id);
      return { ok: false, attestFail: at.code, nextProvider: next };
    }
    // 009 T010: тот же инвариант, что на основном пути — судья не равен воркеру слайса,
    // иначе serial-передел был бы дырой в обход разведения (как это было с attest в T009).
    phase = 'judge'; phaseStart = Date.now();
    const jp = judgeAwayFrom(cwd, provider, { provider: judgeProvider, model: judgeModel }, policy);
    if (!jp) { // тот же инвариант на serial-переделе: некем судить ⇒ не судим вовсе
      emit(cwd, { event: 'redo-gate-reject', tid: slice.id, stage: 'judge-unavailable' });
      cleanupSlice(cwd, slice.id);
      return { ok: false };
    }
    const judgeCap = router.tryBeginCall(callTracker, policy, jp.provider);
    if (!judgeCap.ok) return capBlock(judgeCap.reason);
    let g;
    try { g = await gate.gate({ tid: slice.id, taskText: slice.text, cwd: wt.path, judgeProvider: jp.provider, judgeModel: jp.model, judgeExclude: [provider], integration, specFile: tasksPath }); }
    finally { router.endCall(callTracker, jp.provider); }
    logSpawn(cwd, {
      tid: slice.id, phase: 'judge', provider: jp.provider, model: jp.model, durationSec: Math.round((Date.now() - phaseStart) / 1000),
      exit: g.ok ? 0 : 1, failoverFrom: null, limitHit: false,
      verdict: g.ok ? 'pass' : (g.stage === 'judge' ? 'block' : g.stage),
    });
    if (!g.ok) { emit(cwd, { event: 'redo-gate-reject', tid: slice.id, stage: g.stage }); cleanupSlice(cwd, slice.id); return { ok: false }; }
    const m = await mergeFullOracle(slice.id, { cwd, integration, tasksPath, elt: ELT_CLI, oracle: true });
    cleanupSlice(cwd, slice.id);
    if (m.conflict) { emit(cwd, { event: 'redo-conflict', tid: slice.id }); return { ok: false }; }
    if (!m.ok || (m.merged && m.oracleOk === false)) {
      emit(cwd, { event: 'redo-merge-failed', tid: slice.id, stage: m.stage });
      return { ok: false };
    }
    emit(cwd, { event: 'redo-merged', tid: slice.id, oracleOk: m.oracleOk });
    return { ok: true };
  } catch (e) {
    emit(cwd, { event: 'redo-error', tid: slice.id, err: e.message });
    logSpawn(cwd, {
      tid: slice.id, phase, provider, model, durationSec: Math.round((Date.now() - phaseStart) / 1000),
      exit: null, failoverFrom: null, limitHit: false, verdict: 'error',
    });
    cleanupSlice(cwd, slice.id);
    return { ok: false };
  }
}

// --- status (T013): срез прогона из claims + events.jsonl ---
function readEvents(cwd) {
  const p = eventsPath(cwd);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const STATE_BY_EVENT = {
  'slice-work': 'working', healed: 'healed', 'heal-failed': 'heal-failed',
  'gate-pass': 'gated', 'gate-reject': 'rejected', merged: 'merged', 'redo-merged': 'merged',
  'merge-conflict': 'conflict', 'requeue-serial': 'requeue', 'redo-conflict': 'conflict',
  'redo-gate-reject': 'rejected', 'slice-error': 'error', 'skip-held': 'held',
  'batch-abandoned': 'abandoned', 'fatal-config': 'fatal-config',
};

function status({ cwd = process.cwd(), tasksPath = null } = {}) {
  const perTid = new Map();
  for (const e of readEvents(cwd)) {
    if (!e.tid) continue;
    const cur = perTid.get(e.tid) || { tid: e.tid, startedAt: e.ts };
    if (STATE_BY_EVENT[e.event]) cur.state = STATE_BY_EVENT[e.event];
    if (e.provider) cur.provider = e.provider;
    cur.updatedAt = e.ts;
    perTid.set(e.tid, cur);
  }
  // активные claims = кто СЕЙЧАС держит слайс (перекрывает историю событий)
  for (const c of claims.list({ cwd })) {
    const cur = perTid.get(c.tid) || { tid: c.tid, startedAt: c.ts };
    cur.worker = c.worker;
    cur.provider = cur.provider || c.provider;
    cur.stale = c.stale;
    if (!c.stale) cur.state = 'in-progress';
    perTid.set(c.tid, cur);
  }
  const slices = [...perTid.values()];
  const counts = { merged: 0, failed: 0, conflict: 0, working: 0 };
  for (const s of slices) {
    if (s.state === 'merged') counts.merged++;
    else if (['rejected', 'error', 'heal-failed', 'abandoned', 'fatal-config'].includes(s.state)) counts.failed++;
    else if (['conflict', 'requeue'].includes(s.state)) counts.conflict++;
    else if (['working', 'in-progress'].includes(s.state)) counts.working++;
  }
  let planCounts = null;
  if (tasksPath && fs.existsSync(tasksPath)) {
    const ps = plan.parseFile(tasksPath);
    planCounts = { total: ps.length, done: ps.filter((x) => x.done).length, open: ps.filter((x) => !x.done).length };
  }
  return { slices, counts, plan: planCounts, stopped: fs.existsSync(path.join(cwd, '.harness', 'STOP')) };
}

function renderStatus(st) {
  const head = 'TID    STATE        PROVIDER WORKER        UPDATED';
  const rows = st.slices.map((s) =>
    [(s.tid || '').padEnd(6), (s.state || '?').padEnd(12), (s.provider || '-').padEnd(8),
      (s.worker || '-').padEnd(13), s.updatedAt || ''].join(' '));
  const planLine = st.plan ? `\nПлан: ${st.plan.done}/${st.plan.total} закрыто, ${st.plan.open} открыто` : '';
  const stopLine = st.stopped ? '  [STOP активен]' : '';
  const cnt = st.counts;
  return [head, ...rows].join('\n') +
    `\nИтог: merged=${cnt.merged} failed=${cnt.failed} conflict=${cnt.conflict} working=${cnt.working}` +
    planLine + stopLine;
}

// T024: любой failed/abandoned слайс — нечестный success, если промолчать (как и stoppedReason, T020).
function exitCodeFor(summary) {
  return (summary.stoppedReason || summary.failed.length || summary.abandoned.length) ? 1 : 0;
}

module.exports = { run, eventsPath, currentBranch, status, renderStatus, readEvents, ensureFleetIgnore, exitCodeFor, applyWatchdog, judgeAwayFrom };

// --- CLI (для обёртки tools/elt-fleet.ps1) ---
if (require.main === module) {
  const [, , cmd, ...rest] = process.argv;
  const arg = (f, d) => { const i = rest.indexOf(f); return i >= 0 ? rest[i + 1] : d; };
  const cwd = process.cwd();
  const tasksPath = arg('--tasks', null);
  if (cmd === 'status') {
    console.log(renderStatus(status({ cwd, tasksPath })));
  } else if (cmd === 'stop') {
    fs.mkdirSync(path.join(cwd, '.harness'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.harness', 'STOP'), '');
    console.log('fleet: STOP выставлен');
  } else if (cmd === 'run') {
    run({ cwd, tasksPath, integration: arg('--integration', undefined), workers: Number(arg('--workers', 2)) })
      .then((s) => {
        console.log('fleet summary: ' + JSON.stringify(s));
        if (exitCodeFor(s)) process.exit(1);
      })
      .catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    console.error('usage: fleet.js status|run|stop [--tasks <path>] [--workers N] [--integration <branch>]');
    process.exit(2);
  }
}
