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
const plan = require('./plan');
const claims = require('./claims');
const worktree = require('./worktree');
const gate = require('./gate');
const merge = require('./merge');
const heal = require('./heal');
const providers = require('./providers');
const router = require('./router');

const ELT_CLI = path.join(os.homedir(), '.claude', 'bin', 'elt.js');

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
  const runlog = path.join(cwd, '.harness', 'run-log.jsonl');
  try {
    fs.mkdirSync(path.dirname(runlog), { recursive: true });
    fs.appendFileSync(runlog, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* noop */ }
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
const FLEET_IGNORE_LINES = ['.harness/fleet/logs/', '.harness/fleet/events.jsonl', '.harness/fleet/claims/'];
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

function workerPrompt(slice) {
  return `Ты — воркер fleet. Реализуй РОВНО этот слайс, строго в границах, ничего лишнего.
Слайс ${slice.id}: ${slice.text}
Меняй только файлы из зоны [files:], оракул проекта должен остаться зелёным.`;
}

// Дефолтный воркер: headless-провайдер делает слайс в worktree. Тест инжектит свой.
async function defaultWorker(slice, wtPath, ctx) {
  return providers.run({ provider: ctx.provider, prompt: workerPrompt(slice), cwd: wtPath, model: ctx.model });
}

function cleanupSlice(cwd, tid, { deleteBranch = true } = {}) {
  try { worktree.remove(tid, { cwd, force: true, deleteBranch }); } catch { /* уже нет */ }
  claims.release(tid, { cwd });
}

// T021: дожать слайсы, застрявшие на judge_pending/merge_pending (мёртвый pid, живой worktree).
// НЕ зовёт worker — реализация уже лежит в worktree (judge_pending) или уже закоммичена
// (merge_pending), передел исключён. Судья снова недоступен → ре-парковка, суммарный
// прогон не считает это failed (ждёт следующего resume).
async function resumeParked(resumable, { cwd, integration, tasksPath, judgeModel, summary }) {
  for (const c of resumable) {
    const wtPath = c.wtPath;
    claims.claim(c.tid, { cwd, pid: process.pid, worker: 'fleet-resume', meta: { provider: c.provider, state: c.state, wtPath, taskText: c.taskText } });
    emit(cwd, { event: 'resume-parked', tid: c.tid, state: c.state });

    if (c.state === 'judge_pending') {
      const g = await gate.gate({ tid: c.tid, taskText: c.taskText || '', cwd: wtPath, judgeModel });
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

    const m = merge.mergeSlice(c.tid, { cwd, integration, tasksPath, elt: ELT_CLI, oracle: false });
    if (m.conflict) {
      emit(cwd, { event: 'resume-merge-conflict', tid: c.tid });
      summary.conflicts.push(c.tid); // claim/worktree/branch остаются — следующий resume дожмёт
      continue;
    }
    emit(cwd, { event: 'resume-merged', tid: c.tid, oracleOk: m.oracleOk });
    cleanupSlice(cwd, c.tid);
    summary.merged.push(c.tid);
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
  const judgeModel = opts.judgeModel || 'sonnet';
  const maxLoops = opts.maxLoops || 100;
  const maxAttempts = opts.maxAttempts || 3;

  const summary = { merged: [], failed: [], conflicts: [], requeued: [], abandoned: [], parked: [], stopped: false, stoppedReason: null };
  const policy = router.loadPolicy(cwd);
  const routerState = router.makeState();
  const callTracker = router.makeCallTracker();
  // T020: все провайдеры цепочки в cooldown → provFor вернёт null, а НЕ тихий fallback
  // на c[0] (тот остыл тоже — спавнить на него значит бить по тому же лимиту, который
  // его туда загнал).
  const provFor = (slice) => {
    const c = getChainForSlice(slice, policy);
    return router.pick(c, routerState);
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
    await resumeParked(resumable, { cwd, integration, tasksPath, judgeModel, summary });
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
    const batch = plan.nextBatch(slices).filter((s) => !isAbandoned(s.id) && !parkedIds.has(s.id)).slice(0, workers);
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
      const started = Date.now();
      // T020: hard cap ПЕРЕД spawn — превышение → слайс terminal-failed, ничего не спавнить.
      const capBlock = (reason) => {
        emit(cwd, { event: 'cap-exceeded', tid: slice.id, provider, reason });
        appendRunLog(cwd, {
          tid: slice.id, provider, model, durationSec: Math.round((Date.now() - started) / 1000),
          failoverFrom: null, limitHit: false, verdict: 'cap-exceeded'
        });
        return { tid: slice.id, gateOk: false, capped: true };
      };
      try {
        const workerCap = router.tryBeginCall(callTracker, policy, provider);
        if (!workerCap.ok) return capBlock(workerCap.reason);
        let res;
        try { res = await worker(slice, wtPath, { provider, model }); }
        finally { router.endCall(callTracker, provider); }
        const durationSec = Math.round((Date.now() - started) / 1000);

        // Проверяем лимит
        const c = getChainForSlice(slice, policy);
        const limit = router.failover({ result: res, provider, chain: c, state: routerState, policy });
        if (limit.limitHit) {
          appendRunLog(cwd, {
            tid: slice.id, provider, model, durationSec,
            failoverFrom: limit.failoverFrom, limitHit: true, verdict: 'limit'
          });
          emit(cwd, { event: 'limit-hit', tid: slice.id, provider, next: limit.next });
          return { tid: slice.id, gateOk: false, limitHit: true, nextProvider: limit.next };
        }

        claims.setState(slice.id, { state: 'oracle' }, { cwd });
        // красный оракул после воркера → heal-эскалация (свой провайдер → claude → failed).
        // T022: healUsedSoFar — суммарный heal-бюджет (≤2) переживает batch-retry этого
        // слайса; callTracker/policy — heal-спавны тоже под T020 hard-cap, не только implement/judge.
        const healSoFar = healUsed.get(slice.id) || 0;
        const h = await heal.healSlice({ slice, wtPath, cwd: wtPath, provider, model, elt: ELT_CLI, healUsedSoFar: healSoFar, callTracker, policy });
        healUsed.set(slice.id, healSoFar + h.attempts);
        if (!h.ok) {
          emit(cwd, { event: 'heal-failed', tid: slice.id, attempts: h.attempts });
          appendRunLog(cwd, {
            tid: slice.id, provider, model, durationSec: Math.round((Date.now() - started) / 1000),
            failoverFrom: null, limitHit: false, verdict: 'heal-failed'
          });
          return { tid: slice.id, gateOk: false };
        }
        if (h.attempts) emit(cwd, { event: 'healed', tid: slice.id, attempts: h.attempts, by: h.healedBy });

        // Судья всегда claude (gate.gate/runJudge) — cap проверяем под провайдером 'claude'.
        claims.setState(slice.id, { state: 'judge_pending' }, { cwd });
        const judgeCap = router.tryBeginCall(callTracker, policy, 'claude');
        if (!judgeCap.ok) return capBlock(judgeCap.reason);
        let g;
        try { g = await gate.gate({ tid: slice.id, taskText: slice.text, cwd: wtPath, judgeModel, prevBlockReason: blockReasons.get(slice.id) || '' }); }
        finally { router.endCall(callTracker, 'claude'); }

        // T021: судья НЕ отработал (timeout/spawn-error) — паркуем worktree на judge_pending,
        // НЕ трогаем реализацию. Слайс остаётся claimed (наш живой pid) → следующий loop его
        // не re-claim'ит (parkedIds), резюмируется на старте следующего run() без воркера.
        if (g.stage === 'judge-unavailable') {
          emit(cwd, { event: 'judge-unavailable-park', tid: slice.id });
          appendRunLog(cwd, {
            tid: slice.id, provider, model, durationSec: Math.round((Date.now() - started) / 1000),
            failoverFrom: null, limitHit: false, verdict: 'judge-unavailable'
          });
          return { tid: slice.id, gateOk: false, parked: true };
        }

        // T022: block-причина → следующей batch-попытке этого слайса; pass чистит её.
        if (g.stage === 'judge' && g.verdict === 'block') blockReasons.set(slice.id, (g.reasons || []).join('; '));
        else if (g.ok) blockReasons.delete(slice.id);

        emit(cwd, { event: g.ok ? 'gate-pass' : 'gate-reject', tid: slice.id, stage: g.stage, verdict: g.verdict });
        if (g.ok) claims.setState(slice.id, { state: 'merge_pending' }, { cwd });

        appendRunLog(cwd, {
          tid: slice.id, provider, model, durationSec: Math.round((Date.now() - started) / 1000),
          failoverFrom: null, limitHit: false, verdict: g.ok ? 'pass' : 'gate-reject'
        });

        return { tid: slice.id, gateOk: g.ok };
      } catch (e) {
        emit(cwd, { event: 'slice-error', tid: slice.id, err: e.message });
        appendRunLog(cwd, {
          tid: slice.id, provider, model, durationSec: Math.round((Date.now() - started) / 1000),
          failoverFrom: null, limitHit: false, verdict: 'error'
        });
        return { tid: slice.id, gateOk: false };
      }
    }));

    // фаза 2: merge — сериально (интеграционная одна)
    let stopHit = false;
    let stopReason = null;
    for (const r of gated) {
      if (r.parked) { summary.parked.push(r.tid); continue; } // claim/worktree нетронуты — резюмируется на следующем run()
      if (!r.gateOk) {
        cleanupSlice(cwd, r.tid);
        if (r.capped) {
          summary.failed.push(r.tid); // terminal-failed, не транзиент — без retry
          stopHit = true; stopReason = 'cap-exceeded';
        } else if (r.limitHit) {
          summary.requeued.push(r.tid);
        } else {
          summary.failed.push(r.tid);
          recordFail(r.tid);
        }
        continue;
      }
      const m = merge.mergeSlice(r.tid, { cwd, integration, tasksPath, elt: ELT_CLI, oracle: false });
      if (m.conflict) {
        emit(cwd, { event: 'merge-conflict', tid: r.tid });
        cleanupSlice(cwd, r.tid); // сбросить ветку/worktree
        summary.conflicts.push(r.tid);
        const rr = await redoSerial(byId.get(r.tid), { cwd, integration, tasksPath, worker, model, judgeModel, provFor, policy, routerState, callTracker });
        if (rr.ok) { summary.requeued.push(r.tid); summary.merged.push(r.tid); }
        else {
          summary.failed.push(r.tid);
          if (rr.capped) { stopHit = true; stopReason = 'cap-exceeded'; }
          else if (rr.allCooling) { stopHit = true; stopReason = 'all-providers-cooling'; }
          else recordFail(r.tid);
        }
      } else {
        emit(cwd, { event: 'merged', tid: r.tid, oracleOk: m.oracleOk });
        cleanupSlice(cwd, r.tid);
        summary.merged.push(r.tid);
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
async function redoSerial(slice, { cwd, integration, tasksPath, worker, model, judgeModel, provFor, policy, routerState, callTracker }) {
  const provider = provFor(slice);
  if (provider === null) {
    emit(cwd, { event: 'all-providers-cooling', tids: [slice.id] });
    return { ok: false, allCooling: true };
  }
  emit(cwd, { event: 'requeue-serial', tid: slice.id, provider });
  const cl = claims.claim(slice.id, { cwd, worker: 'fleet-serial', meta: { provider } });
  if (!cl.ok) return { ok: false };
  const wt = worktree.create(slice.id, { cwd, base: integration });
  const started = Date.now();
  const capBlock = (reason) => {
    emit(cwd, { event: 'cap-exceeded', tid: slice.id, provider, reason });
    appendRunLog(cwd, {
      tid: slice.id, provider, model, durationSec: Math.round((Date.now() - started) / 1000),
      failoverFrom: null, limitHit: false, verdict: 'cap-exceeded'
    });
    cleanupSlice(cwd, slice.id);
    return { ok: false, capped: true };
  };
  try {
    const workerCap = router.tryBeginCall(callTracker, policy, provider);
    if (!workerCap.ok) return capBlock(workerCap.reason);
    let res;
    try { res = await worker(slice, wt.path, { provider, model }); }
    finally { router.endCall(callTracker, provider); }
    const chain = getChainForSlice(slice, policy);
    const limit = router.failover({ result: res, provider, chain, state: routerState, policy });
    if (limit.limitHit) {
      appendRunLog(cwd, {
        tid: slice.id, provider, model, durationSec: Math.round((Date.now() - started) / 1000),
        failoverFrom: limit.failoverFrom, limitHit: true, verdict: 'limit'
      });
      cleanupSlice(cwd, slice.id);
      return { ok: false };
    }
    const judgeCap = router.tryBeginCall(callTracker, policy, 'claude');
    if (!judgeCap.ok) return capBlock(judgeCap.reason);
    let g;
    try { g = await gate.gate({ tid: slice.id, taskText: slice.text, cwd: wt.path, judgeModel }); }
    finally { router.endCall(callTracker, 'claude'); }
    appendRunLog(cwd, {
      tid: slice.id, provider, model, durationSec: Math.round((Date.now() - started) / 1000),
      failoverFrom: null, limitHit: false, verdict: g.ok ? 'pass' : 'gate-reject'
    });
    if (!g.ok) { emit(cwd, { event: 'redo-gate-reject', tid: slice.id, stage: g.stage }); cleanupSlice(cwd, slice.id); return { ok: false }; }
    const m = merge.mergeSlice(slice.id, { cwd, integration, tasksPath, elt: ELT_CLI, oracle: false });
    cleanupSlice(cwd, slice.id);
    if (m.conflict) { emit(cwd, { event: 'redo-conflict', tid: slice.id }); return { ok: false }; }
    emit(cwd, { event: 'redo-merged', tid: slice.id });
    return { ok: true };
  } catch (e) {
    emit(cwd, { event: 'redo-error', tid: slice.id, err: e.message });
    appendRunLog(cwd, {
      tid: slice.id, provider, model, durationSec: Math.round((Date.now() - started) / 1000),
      failoverFrom: null, limitHit: false, verdict: 'error'
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
  'batch-abandoned': 'abandoned',
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
    else if (['rejected', 'error', 'heal-failed', 'abandoned'].includes(s.state)) counts.failed++;
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

module.exports = { run, eventsPath, currentBranch, status, renderStatus, readEvents, ensureFleetIgnore };

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
        // T020: cap-exceeded/all-providers-cooling — честный nonzero, не тихий success.
        if (s.stoppedReason) process.exit(1);
      })
      .catch((e) => { console.error(e.message); process.exit(1); });
  } else {
    console.error('usage: fleet.js status|run|stop [--tasks <path>] [--workers N] [--integration <branch>]');
    process.exit(2);
  }
}
