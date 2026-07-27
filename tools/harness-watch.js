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
const { verifySettings } = require('./elt-config');

const DEFAULTS = { window: 50, staleParkHours: 24, pollMs: 5000, oracleSlowFactor: 3, minOracleSamples: 5 };

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

function detectJudgeDeadStreak(entries) {
  // «Подряд» считается по вердиктам судьи, а не по всем записям: коммит между двумя
  // мёртвыми вызовами судью не воскрешает и стрик не рвёт.
  const verdicts = entries.filter((e) => String(statusOf(e) || '').startsWith('judge-'));
  const out = [];
  let streak = [];
  for (const e of verdicts) {
    if (statusOf(e) === 'judge-dead') {
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
  // Та же формула, что у `circuitEnabled()` в elt.js: verify-судья ИЛИ живой red-proof.
  // verifySettings — общий источник из elt-config, чтобы правило жило в одном месте.
  if (verifySettings(root) || (redProof && redProof !== 'off')) return [];
  return [{
    kind: 'circuit-off', key: 'circuit-off',
    detail: 'проект с кодом без контура: нет judge.verify и redProof выключен',
  }];
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
  const opts = { ...DEFAULTS, ...options };
  const now = opts.now || Date.now();
  const entries = readEntries(root).slice(-opts.window);
  return [
    ...detectLimitStreak(entries),
    ...detectRedRepeat(entries),
    ...detectJudgeDeadStreak(entries),
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
  if (fresh.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    excludeHealth(root);
    fs.appendFileSync(file, fresh.map((i) => JSON.stringify({ ts: new Date().toISOString(), ...i })).join('\n') + '\n');
  }
  return { found, fresh, file };
}

function argVal(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return fallback;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

function report(res) {
  for (const i of res.fresh) console.error(`harness-watch: ${i.kind} — ${i.detail}`);
  if (!res.fresh.length && res.found.length) console.error(`harness-watch: ${res.found.length} инцидент(ов), новых нет`);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const root = process.cwd();
  const options = {
    window: argVal(argv, '--window', DEFAULTS.window),
    staleParkHours: argVal(argv, '--stale-park-hours', DEFAULTS.staleParkHours),
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
    report(res);
    // exit отражает СОСТОЯНИЕ окна, а не новизну записи: инцидент, уже записанный в
    // health.jsonl, не перестал быть инцидентом. Идемпотентность — свойство файла, а не
    // кода возврата (иначе второй прогон объявляет больной харнесс здоровым).
    process.exit(res.found.length ? 1 : 0);
  }
}

module.exports = { detect, runOnce, DEFAULTS };
