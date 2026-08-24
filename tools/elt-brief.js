#!/usr/bin/env node
'use strict';
// 014 T011 (US6, AC11) — `elt brief <файлы>`: питание модели ДО работы, а не проверка после.
//
// Все остальные слои спеки ловят ошибку, когда она уже сделана. Этот — единственный, который
// снижает её вероятность: перед правкой файла показать, чем этот файл уже был красным.
//
// Связь «файл → запись run-log» непрямая: записи несут task/commit, но не файлы. Берём её из
// git ОДНИМ вызовом `git log --name-only` (не по вызову на запись — иначе бюджет 2 c улетает
// на спавны): commit → файлы, сообщение коммита → задача. Дальше файл → задачи → все записи
// этих задач, включая красные, у которых своего коммита нет по определению.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runtimeRunLog } = require('./run-log');

// Окно истории. 300 коммитов — примерно два месяца работы этого репо; дальше сигнал устаревает
// быстрее, чем помогает, а бюджет 2 c начинает жать.
const LOG_LIMIT = 300;
const TASK_RE = /\bT\d{3}\b/;

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// commit → {task, files}. Один git-вызов на весь brief. %x01 перед каждым коммитом —
// разделитель записей: имена файлов идут списком строк, и по переводу строки границу коммита
// не отличить от следующего имени файла.
function commitIndex(cwd) {
  const r = spawnSync('git', ['log', `-n${LOG_LIMIT}`, '--name-only', '--format=%x01%H %s'], { cwd, encoding: 'utf8' });
  const out = r.stdout || '';
  const index = [];
  for (const chunk of out.split('').slice(1)) {
    const [head, ...rest] = chunk.split(/\r?\n/);
    const sp = head.indexOf(' ');
    const subject = sp >= 0 ? head.slice(sp + 1) : '';
    const m = subject.match(TASK_RE);
    index.push({ task: m ? m[0] : null, files: rest.filter(Boolean).map((f) => f.replace(/\\/g, '/')) });
  }
  return index;
}

function statusOf(e) { return e.status || e.result || null; }
// Красное — и «оракул упал», и «судья заблокировал», и «фон покраснел»: для человека перед
// правкой это один класс «здесь уже спотыкались», а не три разных счётчика.
function isRed(e) {
  const s = statusOf(e);
  // 020 T007: у фона теперь четыре не-зелёных терминала, не один. `dead`/`inconclusive`/`error`
  // — это «здесь не смогли проверить», и для человека перед правкой это тот же сигнал
  // «смотреть глазами», что и красное. Молча считать их зелёными значило бы вернуть ровно тот
  // дефект, который T007 и закрывает.
  return s === 'red-stop' || s === 'l0-block' || s === 'judge-block'
    || (typeof s === 'string' && s.startsWith('background-verify') && s !== 'background-verify-pass')
    || e.verdict === 'block';
}
// В run-log встречаются и строковые причины, и объекты (запись судьи/фона несёт структуру).
// Без разбора объект печатался бы как `[object Object]` — строка, которая ничего не сообщает.
function reasonText(r) {
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object') return String(r.reason || r.kind || r.trigger || JSON.stringify(r)).slice(0, 120);
  return String(r);
}
function reasonsOf(e) {
  if (Array.isArray(e.reasons) && e.reasons.length) return e.reasons.map(reasonText);
  if (e.l0 && Array.isArray(e.l0.triggers) && e.l0.triggers.length) return e.l0.triggers.map(reasonText);
  const s = statusOf(e);
  return s ? [s] : [];
}

function brief(cwd, files) {
  const wanted = new Set(files.map((f) => f.replace(/\\/g, '/')));
  const index = commitIndex(cwd);
  // Задачи, которые когда-либо трогали хотя бы один из запрошенных файлов.
  const tasks = new Set();
  for (const c of index) {
    if (c.task && c.files.some((f) => wanted.has(f))) tasks.add(c.task);
  }
  const entries = readJsonl(runtimeRunLog(cwd)).filter((e) => e.task && tasks.has(String(e.task).split(',')[0]));
  const reds = entries.filter(isRed);
  const counts = new Map();
  for (const e of reds) for (const r of reasonsOf(e)) counts.set(r, (counts.get(r) || 0) + 1);
  const topReasons = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([reason, count]) => ({ reason, count }));
  // Инциденты живут отдельно от run-log (harness-watch пишет health.jsonl) — дата последнего
  // отвечает на «этот участок недавно горел или это древняя история».
  const health = readJsonl(path.join(cwd, '.harness', 'health.jsonl'))
    .filter((r) => r.task && tasks.has(String(r.task)));
  const lastIncident = health.length ? health[health.length - 1].ts || null : null;
  return { files: [...wanted], tasks: [...tasks], runs: entries.length, reds: reds.length, topReasons, lastIncident };
}

function format(b) {
  if (!b.runs) return `elt brief: по ${b.files.length} файл(ам) истории нет — новый участок`;
  const lines = [`elt brief: ${b.files.length} файл(ов), ${b.runs} прогонов, ${b.reds} красных (задачи: ${b.tasks.join(', ') || 'нет'})`];
  for (const r of b.topReasons) lines.push(`  ${r.count}×  ${r.reason}`);
  if (b.lastIncident) lines.push(`  последний инцидент: ${b.lastIncident}`);
  return lines.join('\n');
}

module.exports = { brief, format, commitIndex, isRed, LOG_LIMIT };
