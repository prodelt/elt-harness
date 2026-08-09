#!/usr/bin/env node
'use strict';

/**
 * 009 T007 — watchdog поверх уже пишущихся артефактов харнесса.
 *
 * Мотив (аудит 141 сессии): прогон умирал/деградировал молча — limit-стрик провайдера,
 * повторный red-stop одной задачи, мёртвый судья, забытая парковка, выключенный контур
 * видны ТОЛЬКО если человек читает run-log глазами. Здесь эти паттерны — детекторы,
 * а не прозаическая дисциплина.
 *
 * Ничего не чинит (это T008) и ничего не трогает, кроме `.harness/health.jsonl`:
 * по записи на инцидент, идемпотентно по `key` — повторный прогон на тех же данных
 * не плодит дублей, поэтому watchdog можно звать между слайсами без дедупликации выше.
 */

const fs = require('fs');
const path = require('path');
const { runtimeRunLog } = require('./run-log');
const { classifyBlockSource } = require('./elt-stats');
const { backgroundTimeoutMin } = require('./elt-config');

const DEFAULTS = { window: 50, staleParkHours: 24, pollMs: 5000, oracleSlowFactor: 3, minOracleSamples: 5, blockPatternMin: 3 };

function readJsonl(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return raw.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function readConfig(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8')); }
  catch { return null; }
}

function readParked(root) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'parked.json'), 'utf8'));
    return Array.isArray(p) ? p : [];
  } catch { return []; }
}

function readEntries(root) {
  let file;
  try { file = runtimeRunLog(root); } catch { file = null; }
  return file ? readJsonl(file) : [];
}

// ── детекторы ────────────────────────────────────────────────────────────────
// Каждый отдаёт инциденты {kind, key, detail, …}. `key` обязан быть стабильным для
// одного и того же события (обычно kind + субъект + ts последней улики).

// У одного и того же события ДВА поля в зависимости от того, кто его писал: `elt.js`
// (appendRunLog) кладёт `status`, драйвер `elt-loop.ps1` — `result`. Детектор, знающий
// только одно из них, слеп ровно на автономных прогонах, ради которых он и написан.
function statusOf(e) { return e.status || e.result || null; }

// Длительность оракула: `oracle.durationSec` (solo-путь) либо запись фазы из fleet-роутера.
function oracleSec(e) {
  if (e.oracle && typeof e.oracle.durationSec === 'number') return e.oracle.durationSec;
  if (e.phase === 'oracle' && typeof e.durationSec === 'number') return e.durationSec;
  return null;
}

function groupBy(entries, keyOf) {
  const by = new Map();
  for (const e of entries) {
    const k = keyOf(e);
    if (k == null) continue;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(e);
  }
  return by;
}

function detectLimitStreak(entries) {
  const by = groupBy(entries.filter((e) => e.limitHit), (e) => e.provider || null);
  const out = [];
  for (const [provider, hits] of by) {
    if (hits.length < 2) continue;
    const last = hits[hits.length - 1];
    out.push({
      kind: 'limit-streak', key: `limit-streak:${provider}:${last.ts}`, provider, count: hits.length,
      detail: `${hits.length} limitHit у провайдера ${provider} в окне`,
    });
  }
  return out;
}

function detectRedRepeat(entries) {
  // task:null — красный оракул вне слайса (`elt oracle` без --task); группировать его
  // с чужими провалами значит выдумывать «повтор по задаче», которого не было.
  const by = groupBy(entries.filter((e) => statusOf(e) === 'red-stop'), (e) => e.task || e.tid || null);
  const out = [];
  for (const [task, reds] of by) {
    if (reds.length < 2) continue;
    const last = reds[reds.length - 1];
    out.push({
      kind: 'red-repeat', key: `red-repeat:${task}:${last.ts}`, task, count: reds.length,
      detail: `${reds.length} red-stop по задаче ${task}`,
    });
  }
  return out;
}

// Вердикт судьи в записи — ДВА формата, как и статус: `elt.js`/драйвер пишут
// status/result 'judge-dead|judge-block|judge-pass', а fleet-ledger — строку фазы
// (`phase:'judge'`, `verdict:'judge-unavailable'|'pass'|'block'`). Детектор, знающий только
// первый, слеп ровно на fleet — то есть на прогонах, где судья и умирает чаще всего.
function judgeVerdictOf(e) {
  const s = String(statusOf(e) || '');
  if (s.startsWith('judge-')) return s;
  if (e.phase === 'judge' && e.verdict) return e.verdict === 'judge-unavailable' ? 'judge-dead' : `judge-${e.verdict}`;
  return null;
}

function detectJudgeDeadStreak(entries) {
  // «Подряд» считается по вердиктам судьи, а не по всем записям: коммит между двумя
  // мёртвыми вызовами судью не воскрешает и стрик не рвёт.
  const verdicts = entries.filter((e) => judgeVerdictOf(e));
  const out = [];
  let streak = [];
  for (const e of verdicts) {
    if (judgeVerdictOf(e) === 'judge-dead') {
      streak.push(e);
      if (streak.length >= 2) {
        out.push({
          kind: 'judge-dead-streak', key: `judge-dead-streak:${e.ts}`, count: streak.length,
          detail: `${streak.length} мёртвых вызова судьи подряд`,
        });
      }
    } else streak = [];
  }
  return out;
}

function detectOracleSlow(entries, opts) {
  const samples = entries.filter((e) => oracleSec(e) !== null);
  if (samples.length < opts.minOracleSamples) return [];
  const sorted = samples.map(oracleSec).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (!(median > 0)) return [];
  const limit = median * opts.oracleSlowFactor;
  return samples.filter((e) => oracleSec(e) > limit).map((e) => ({
    kind: 'oracle-slow', key: `oracle-slow:${e.ts}`, task: e.task || e.tid || null,
    durationSec: oracleSec(e), median,
    detail: `оракул ${oracleSec(e)}s против медианы ${median}s (×${opts.oracleSlowFactor})`,
  }));
}

// Схема C, звено EV: одна и та же причина блока N раз в окне — эволюция без этого
// самообман (52 блока за 011, ни одного разобранного watchdog'ом). Группа — тот же
// разбор источника, что T022 уже даёт числами (`red-proof`/`grounding`/`судья`); L0
// группируется по имени триггера (`hot-path`, `out-of-scope`, …), не по тексту причины —
// текст несёт файлы/строки и у одного триггера никогда не повторяется дословно.
function blockReasonKey(e) {
  if (e.status === 'judge-block') return `judge:${classifyBlockSource(e.reasons)}`;
  if (e.status === 'l0-block' && e.l0 && Array.isArray(e.l0.triggers) && e.l0.triggers.length) {
    return `l0:${[...new Set(e.l0.triggers.map((t) => t.name))].sort().join('+')}`;
  }
  return null;
}

function detectBlockPattern(entries, opts) {
  const by = groupBy(entries, blockReasonKey);
  const out = [];
  for (const [key, hits] of by) {
    if (hits.length < opts.blockPatternMin) continue;
    const last = hits[hits.length - 1];
    out.push({
      kind: 'block-pattern', key: `block-pattern:${key}:${last.ts}`, reasonKey: key, count: hits.length,
      examples: hits.slice(-3).map((h) => h.task || h.commit || h.ts),
      detail: `${hits.length}× блок с причиной "${key}" в окне`,
    });
  }
  return out;
}

// 014 T008 (AC6): тихая смерть фона — сама инцидент. `judge-dead` и `timeout` дают ОТСУТСТВИЕ
// вердикта, а не красное: очередь `bg-red` пуста, и это выглядит как «всё хорошо». Значит
// смотрим не на красное, а на пару: спекулятивный коммит (`committed-speculative`, 014 T005)
// без парной записи `background-verify-*` по тому же хешу дольше `backgroundTimeoutMin`.
// Идемпотентность — по хешу коммита в `key`: он не меняется, сколько бы раз watchdog ни бегал
// (`ts` записи взять было бы нельзя — тот же коммит дал бы новый key на каждом прогоне).
function detectBgSilent(entries, opts, now) {
  const verified = new Set(entries
    .filter((e) => typeof statusOf(e) === 'string' && statusOf(e).startsWith('background-verify'))
    .map((e) => e.commit));
  const limitMs = opts.backgroundTimeoutMin * 60000;
  return entries.filter((e) => statusOf(e) === 'committed-speculative' && e.commit
    && !verified.has(e.commit) && now - Date.parse(e.ts) > limitMs).map((e) => ({
    kind: 'bg-silent', key: `bg-silent:${e.commit}`, task: e.task || null, commit: e.commit,
    detail: `спекулятивный коммит ${e.commit} без фонового вердикта дольше ${opts.backgroundTimeoutMin} мин`,
  }));
}

function detectStalePark(parked, opts, now) {
  const limitMs = opts.staleParkHours * 3600 * 1000;
  return parked.filter((p) => {
    const t = Date.parse(p && p.ts);
    return Number.isFinite(t) && now - t > limitMs;
  }).map((p) => ({
    kind: 'stale-park', key: `stale-park:${p.tid}:${p.ts}`, task: p.tid, reason: p.reason || null,
    detail: `${p.tid} припаркован дольше ${opts.staleParkHours}ч (${p.reason || 'без причины'})`,
  }));
}

function detectCircuitOff(root, config) {
  if (!config || config.kind !== 'code') return [];
  const redProof = typeof config.redProof === 'string' ? config.redProof.trim() : '';
  // Та же формула, что у `circuitEnabled()` в elt.js: в ELT v3 контур означает red-proof.
  if (redProof && redProof !== 'off') return [];
  return [{
    kind: 'circuit-off', key: 'circuit-off',
    detail: 'проект с кодом без контура: redProof выключен',
  }];
}

// ── авто-фиксы (T008) ────────────────────────────────────────────────────────
// Закрытый список: три класса инцидентов дают действие, всё остальное — только запись.
// Ни одно действие не трогает код и git — только маршрутизацию прогона и парковку.

// Есть ли у воркер-провайдера замена ХОТЬ ГДЕ в политике (цепочки по размерам + default).
// Единственный вопрос, на который watchdog вправе отвечать про воркеров: если замены нет,
// cooldown просто выключил бы единственного исполнителя. КУДА уйдёт следующий воркер —
// не его дело: цепочек несколько (по размеру слайса), и выбор делает router.pick по
// приоритету цепочки. Назвать здесь один «следующий» значило бы подать как маршрут то,
// что маршрутом не является: для [agy,codex,claude] с остывшим codex pick честно вернёт
// agy (он приоритетнее и здоров), а не заявленный claude.
function hasWorkerAlternative(root, provider) {
  try {
    const { loadPolicy } = require('./fleet/router');
    const pol = loadPolicy(root);
    const all = [...Object.values(pol.policy || {}).flat(), ...(pol.default || [])];
    return all.some((p) => p !== provider);
  } catch { return false; }
}

// Провайдер БЕЗ модели — это fatal config, а не фолбэк: codex, запущенный с моделью agy
// (`gemini-3.6-flash-high`), просто падает. Поэтому решение всегда несёт пару provider+model.
function fallbackJudge(root, config, current) {
  try {
    const { JUDGE_PROVIDERS } = require('./elt-config'); // Set, не массив
    const { available } = require('./fleet/providers');
    const to = [...JUDGE_PROVIDERS].find((p) => p !== current && available(p)) || null;
    return to ? { to, toModel: modelFor(root, to) } : null;
  } catch { return null; }
}

function modelFor(root, provider) {
  try {
    const { loadPolicy, modelFor: pick } = require('./fleet/router');
    return pick(provider, loadPolicy(root)) || null;
  } catch { return null; }
}

// judgeProvider — ФАКТИЧЕСКИЙ судья прогона, а не `harness.json`: потребитель мог получить
// его флагом (`-JudgeProvider`/`opts.judgeProvider`) или уже увести фолбэком, и то и другое
// живёт только в памяти прогона. Считать по статическому конфигу значит признать лимит
// настоящего судьи «воркерным» (noop) и назвать в `from` того, кто давно не судит.
function actionFor(incident, root, config, judgeProvider) {
  const judge = judgeProvider || (config && config.judge && config.judge.provider) || null;
  if (incident.kind === 'limit-streak') {
    const p = incident.provider;
    // Судью и воркера роутят РАЗНЫЕ множества: судья — по JUDGE_PROVIDERS,
    // воркер — по цепочкам fleet.json. Судья в конфиге один, замену ему
    // обязан назвать watchdog (сам себя он не переключит), поэтому здесь маршрут реальный —
    // и назван `judgeTo`, чтобы его нельзя было принять за маршрут воркера.
    // `subject` — кого касается решение. Судья один и сам себя не заменит, поэтому у него
    // `to` — НАСТОЯЩИЙ маршрут (потребитель обязан на него переключиться). У воркера
    // маршрута нет по построению (`to: null` — значение, а не забытое поле): куда уйдёт
    // следующий слайс, решает router.pick по приоритету его цепочки размера.
    if (judge && judge === p) {
      const fb = fallbackJudge(root, config, p);
      if (fb) return { action: 'cooldown', subject: 'judge', reason: incident.kind, from: p, to: fb.to, toModel: fb.toModel };
    }
    // Некуда переключаться — cooldown только выключил бы единственного исполнителя.
    return hasWorkerAlternative(root, p)
      ? { action: 'cooldown', subject: 'worker', reason: incident.kind, from: p, to: null }
      : null;
  }
  if (incident.kind === 'red-repeat') {
    // `to` здесь — целевое СОСТОЯНИЕ задачи, а не провайдер: парковка никуда не роутит.
    return { action: 'park', subject: 'task', reason: incident.kind, from: incident.task, to: 'parked' };
  }
  if (incident.kind === 'judge-dead-streak') {
    const fb = fallbackJudge(root, config, judge);
    return fb ? { action: 'judge-fallback', subject: 'judge', reason: incident.kind, from: judge, ...fb } : null;
  }
  return null;
}

// ── прогон ───────────────────────────────────────────────────────────────────

function healthFile(root) { return path.join(root, '.harness', 'health.jsonl'); }

// Рантайм-артефакт, не исходник: без exclude health.jsonl попадает в дифф слайса и
// судья справедливо вменяет его как чужую правку (та же причина, что у parked.json).
function excludeHealth(root) {
  const file = path.join(root, '.git', 'info', 'exclude');
  const line = '.harness/health.jsonl';
  try {
    const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (raw.split(/\r?\n/).includes(line)) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, (raw && !raw.endsWith('\n') ? '\n' : '') + line + '\n');
  } catch { /* не git-репо или read-only — молчим, это не работа watchdog'а */ }
}

function detect(root, options = {}) {
  // 014 T008: порог молчания живёт в harness.json проекта (там же, где `verify`), а не в
  // DEFAULTS — иначе проект с медленным сьютом не мог бы его поднять, не правя код харнесса.
  // options по-прежнему главнее: тесты и разовые прогоны задают его напрямую.
  const opts = { backgroundTimeoutMin: backgroundTimeoutMin(root), ...DEFAULTS, ...options };
  const now = opts.now || Date.now();
  const entries = readEntries(root).slice(-opts.window);
  return [
    ...detectBgSilent(entries, opts, now),
    ...detectLimitStreak(entries),
    ...detectRedRepeat(entries),
    ...detectJudgeDeadStreak(entries),
    ...detectBlockPattern(entries, opts),
    ...detectOracleSlow(entries, opts),
    ...detectStalePark(readParked(root), opts, now),
    ...detectCircuitOff(root, readConfig(root)),
  ];
}

function runOnce(root, options = {}) {
  const found = detect(root, options);
  const file = healthFile(root);
  const seen = new Set(readJsonl(file).map((r) => r.key));
  const fresh = found.filter((i) => !seen.has(i.key));
  // Запись инцидента — один раз (дедуп по key). А вот ДЕЙСТВИЕ выдаётся, пока потребитель
  // не подтвердил применение (`ack`): падение между записью и применением иначе теряет
  // решение навсегда. Подтверждение — такая же строка в health.jsonl, {key, applied:true},
  // поэтому «ровно раз» = выдаём неподтверждённые, а не только новые.
  const config = readConfig(root);
  const prior = readJsonl(file);
  const applied = new Set(prior.filter((r) => r.applied).map((r) => r.key));
  const actions = [];
  const records = [];
  for (const i of fresh) records.push({ ...i });
  for (const i of found) {
    const a = actionFor(i, root, config, options.judgeProvider);
    if (!a) continue;
    const key = `${i.key}#action`;
    if (applied.has(key)) continue;
    actions.push({ ...a, key });
    if (!seen.has(key)) records.push({ key, kind: i.kind, ...a });
  }
  if (records.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    excludeHealth(root);
    fs.appendFileSync(file, records.map((r) => JSON.stringify({ ts: new Date().toISOString(), ...r })).join('\n') + '\n');
  }
  return { found, fresh, actions, file };
}

// Потребитель зовёт это ПОСЛЕ фактического применения решения. Пока ack нет, действие
// выдаётся снова — падение на полпути стоит повтора, а не потерянного действия.
function ack(root, keys) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  if (!list.length) return 0;
  const file = healthFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  excludeHealth(root);
  fs.appendFileSync(file, list.map((key) => JSON.stringify({ ts: new Date().toISOString(), key, applied: true })).join('\n') + '\n');
  return list.length;
}

function argVal(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return fallback;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

function report(res) {
  for (const i of res.fresh) console.error(`harness-watch: ${i.kind} — ${i.detail}`);
  // Маршрут печатается, только если он есть: у cooldown воркера его нет по построению.
  for (const a of res.actions) {
    console.error(`harness-watch: → ${a.action} (${a.reason}): ${a.from}${a.to ? ` → ${a.to}` : ''}`);
  }
  if (!res.fresh.length && res.found.length) console.error(`harness-watch: ${res.found.length} инцидент(ов), новых нет`);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const root = process.cwd();
  // --ack k1,k2 — подтверждение применения из потребителя (драйвер: PowerShell).
  const ackAt = argv.indexOf('--ack');
  if (ackAt >= 0) {
    ack(root, String(argv[ackAt + 1] || '').split(',').map((s) => s.trim()));
    process.exit(0);
  }
  const jpAt = argv.indexOf('--judge-provider');
  const options = {
    window: argVal(argv, '--window', DEFAULTS.window),
    staleParkHours: argVal(argv, '--stale-park-hours', DEFAULTS.staleParkHours),
    // Кто судит ПРЯМО СЕЙЧАС: драйвер знает это лучше конфига (флаг запуска, фолбэк).
    judgeProvider: jpAt >= 0 ? argv[jpAt + 1] : undefined,
  };
  if (argv.includes('--watch')) {
    const pollMs = argVal(argv, '--poll-ms', DEFAULTS.pollMs);
    // ponytail: поллинг mtime, не fs.watch — watch на Windows/сети врёт и роняет дескрипторы,
    // а частота здесь секундная. Нужен мгновенный отклик — тогда fs.watch.
    let stamp = '';
    const tick = () => {
      const watched = [
        runtimeRunLog(root),
        path.join(root, '.harness', 'parked.json'),
        path.join(root, '.harness', 'harness.json'), // выключенный контур — тоже инцидент
      ];
      const next = watched.map((f) => { try { return String(fs.statSync(f).mtimeMs); } catch { return '-'; } }).join('|');
      if (next === stamp) return;
      stamp = next;
      report(runOnce(root, options));
    };
    tick();
    setInterval(tick, pollMs);
  } else {
    const res = runOnce(root, options);
    // --json на stdout: драйвер (PowerShell) читает решения отсюда, человек — из stderr.
    if (argv.includes('--json')) console.log(JSON.stringify({ incidents: res.found, actions: res.actions }));
    report(res);
    // exit отражает СОСТОЯНИЕ окна, а не новизну записи: инцидент, уже записанный в
    // health.jsonl, не перестал быть инцидентом. Идемпотентность — свойство файла, а не
    // кода возврата (иначе второй прогон объявляет больной харнесс здоровым).
    process.exit(res.found.length ? 1 : 0);
  }
}

module.exports = { detect, runOnce, ack, fallbackJudge, DEFAULTS };
