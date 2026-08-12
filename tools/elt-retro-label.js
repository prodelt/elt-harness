#!/usr/bin/env node
'use strict';
// 014 T012 (фаза D, AC8) — ретро-разметка вердиктов механикой над git. Ноль LLM, ноль сети.
//
// Зачем: `.harness/learnings.jsonl` пуст, judge-bench не растёт, и качество судьи не с чем
// сравнивать. Разметка даёт обратную связь из уже случившейся истории: блок, после которого
// почти ничего не правили, был ложным; `pass`, за которым быстро пришёл фикс тех же строк,
// пропустил дефект. Это чистая функция от (run-log, git) — её можно гонять по расписанию.
//
// Дисциплина метки: ЛЮБАЯ неуверенность → `unknown`. Доля unknown печатается и является
// главным числом отчёта: разметка, которая уверена во всём, врёт.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runtimeRunLog } = require('./run-log');

// Константы, а не поля конфига (решение спеки): их смысл — калибровка эвристики, и проект,
// который их крутит, получает несравнимые между собой числа.
//
// FIX_WINDOW — сколько коммитов после `pass` считаем «быстро пришедшим фиксом». 5 ≈ рабочий
// день этого репо; дальше связь «фикс именно этого дефекта» перестаёт быть механической.
const FIX_WINDOW = 5;
// LINE_TOLERANCE — допуск совпадения строк между слайсом и фиксом. Строки сдвигаются от
// соседних правок, поэтому точное равенство номеров дало бы почти одни unknown.
const LINE_TOLERANCE = 10;
// RETRY_LIMIT — «после блока файлы почти не менялись»: между блоком и коммитом задачи не было
// ни одной новой красной попытки. Прокси для «правок почти не было»: снимка дерева на момент
// блока в истории нет, а количество попыток — есть.
const RETRY_LIMIT = 0;
const FIX_RE = /^(fix|hotfix|revert)\b/i;

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '') : '';
}

// Изменённые строки коммита: файл → массив номеров строк (по новой версии). `-U0` — только
// сами изменения, без контекста, иначе пересечение ловило бы соседний нетронутый код.
function touchedLines(cwd, sha) {
  const out = git(cwd, ['show', '-U0', '--format=', sha]);
  const map = new Map();
  let file = null;
  for (const line of out.split(/\r?\n/)) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) { file = f[1].replace(/\\/g, '/'); if (!map.has(file)) map.set(file, []); continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      for (let i = 0; i < count; i += 1) map.get(file).push(start + i);
    }
  }
  return map;
}
function overlaps(a, b) {
  for (const [file, linesA] of a) {
    const linesB = b.get(file);
    if (!linesB || !linesB.length || !linesA.length) continue;
    if (linesA.some((x) => linesB.some((y) => Math.abs(x - y) <= LINE_TOLERANCE))) return { file };
  }
  return null;
}

// История коммитов, новые первыми: {sha, subject}.
function commits(cwd, limit = 300) {
  return git(cwd, ['log', `-n${limit}`, '--format=%H %s']).split(/\r?\n/).filter(Boolean).map((l) => {
    const sp = l.indexOf(' ');
    return { sha: l.slice(0, sp), subject: l.slice(sp + 1) };
  });
}

function statusOf(e) { return e.status || null; }
function isBlock(e) { return e.verdict === 'block' || statusOf(e) === 'judge-block' || statusOf(e) === 'l0-block'; }
function isPass(e) { return (e.verdict === 'pass' || statusOf(e) === 'committed-speculative') && !!e.commit; }
function isRed(e) { return statusOf(e) === 'red-stop' || isBlock(e); }

function label(cwd, options = {}) {
  const entries = readJsonl(options.runLog || runtimeRunLog(cwd));
  const history = options.commits || commits(cwd);
  // Индекс «короткий sha → позиция в истории»: run-log хранит короткие хеши, git отдаёт полные.
  const posOf = (short) => history.findIndex((c) => c.sha.startsWith(short));
  const results = [];

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (!e.task) continue;
    const verdictId = `${e.task}:${e.ts}`;
    const later = entries.slice(i + 1).filter((x) => x.task === e.task);

    if (isBlock(e)) {
      const closing = later.find((x) => x.commit);
      if (!closing) { results.push({ verdictId, label: 'unknown', evidence: 'блок без последующего коммита задачи — работа не закончена' }); continue; }
      const retries = later.slice(0, later.indexOf(closing)).filter(isRed).length;
      results.push(retries <= RETRY_LIMIT
        ? { verdictId, label: 'false-block', evidence: `после блока ни одной новой красной попытки, задача закрылась коммитом ${closing.commit}` }
        : { verdictId, label: 'correct', evidence: `после блока ${retries} красных попыток — блок указал на реальную работу` });
      continue;
    }

    if (isPass(e)) {
      const at = posOf(e.commit);
      if (at < 0) { results.push({ verdictId, label: 'unknown', evidence: `коммит ${e.commit} вне окна истории git` }); continue; }
      // history[0] — самый новый, значит «после» это МЕНЬШИЕ индексы.
      const after = history.slice(Math.max(0, at - FIX_WINDOW), at);
      const fixes = after.filter((c) => FIX_RE.test(c.subject));
      if (!fixes.length) { results.push({ verdictId, label: 'correct', evidence: `в окне ${FIX_WINDOW} коммитов после ${e.commit} фиксов нет` }); continue; }
      const mine = touchedLines(cwd, e.commit);
      const hit = fixes.map((c) => ({ c, hit: overlaps(mine, touchedLines(cwd, c.sha)) })).find((x) => x.hit);
      results.push(hit
        ? { verdictId, label: 'missed-defect', evidence: `фикс ${hit.c.sha.slice(0, 7)} трогает те же строки ${hit.hit.file}` }
        : { verdictId, label: 'correct', evidence: `фиксы в окне есть, но других строк` });
      continue;
    }
  }
  const unknown = results.filter((r) => r.label === 'unknown').length;
  return { results, total: results.length, unknown, unknownShare: results.length ? unknown / results.length : 0 };
}

function format(r) {
  const by = (l) => r.results.filter((x) => x.label === l).length;
  return [
    `elt retro-label: ${r.total} вердиктов размечено`,
    `  false-block: ${by('false-block')}  missed-defect: ${by('missed-defect')}  correct: ${by('correct')}`,
    `  unknown: ${r.unknown} (${Math.round(r.unknownShare * 100)}%) — разметка, уверенная во всём, врёт`,
  ].join('\n');
}

// ── 014 T015: разметка ходит по расписанию, а не рукой ──────────────────────────────────
// Ретро-разметка ценна только накопительно: раз в сутки она видит новые вердикты и новые
// коммиты-фиксы, а запущенная рукой — не запускается никогда. Планировщик — Windows Task
// Scheduler (решение пользователя 02.07): у CronCreate 7-дневный авто-истечок, то есть ровно
// то свойство, из-за которого задача и умирает молча.
//
// `propose` СЮДА НЕ ВХОДИТ намеренно (текст T015): автомат готовит данные, правку гейта
// предлагает человек или слайс. Авто-propose менял бы гейт без единого читателя.
const REPORT = path.join('.harness', 'judge-bench', 'retro-report.json'); // каталог уже в .gitignore:75
const TASK_NAME = 'ELT-retro-label';

// Один суточный проход: разметить → пополнить bench → положить отчёт на диск. Отчёт и есть
// пруф того, что задача отработала: LastTaskResult=0 говорит лишь, что процесс не упал.
function daily(cwd) {
  const r = label(cwd);
  const { ingest } = require('./judge-bench-ingest');
  const ing = ingest(cwd);
  const by = (l) => r.results.filter((x) => x.label === l).length;
  const report = {
    ts: new Date().toISOString(),
    total: r.total,
    labels: { 'false-block': by('false-block'), 'missed-defect': by('missed-defect'), correct: by('correct'), unknown: r.unknown },
    unknownShare: r.unknownShare,
    benchAdded: ing.added,
    benchTotal: ing.total,
  };
  const file = path.join(cwd, REPORT);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  return report;
}

// 016 T006 — `schtasks /Create` без `/RU`+`/RP` даёт "Logon Mode: Interactive only": в 03:00 при
// заблокированной сессии задача падает с 0x80070520 (ERROR_NO_SUCH_LOGON_SESSION) и разметка
// молча не идёт. Пароль в аргументах хранить нельзя, а `schtasks` не умеет S4U — поэтому
// регистрация идёт через `Register-ScheduledTask` с `-LogonType S4U`: "run whether user is
// logged on or not" без сохранённого пароля.
// Идемпотентно: `-Force` перезаписывает задачу, заодно чиня устаревший путь к node после переезда.
function scheduleCommand(cwd, { time = '03:00', name = TASK_NAME } = {}) {
  const script = path.join(cwd, 'tools', 'elt-retro-label.js');
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`; // PowerShell single-quote escaping
  const args = `"${script}" --daily --project "${cwd}"`;
  return [
    `$a = New-ScheduledTaskAction -Execute ${q(process.execPath)} -Argument ${q(args)}`,
    `$t = New-ScheduledTaskTrigger -Daily -At ${q(time)}`,
    `$p = New-ScheduledTaskPrincipal -UserId ${q(process.env.USERNAME || 'SYSTEM')} -LogonType S4U -RunLevel Limited`,
    `$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries`,
    `Register-ScheduledTask -TaskName ${q(name)} -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null`,
  ].join('; ');
}

function installSchedule(cwd, opts = {}) {
  const name = opts.name || TASK_NAME;
  const cmd = scheduleCommand(cwd, opts);
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' });
  return { ok: r.status === 0, taskName: name, command: cmd, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

// Экспорт ДО main-ветки: `judge-bench-ingest` требует этот модуль обратно (цикл), и если
// `daily()` стартует раньше присвоения, ingest получит пустой exports и упадёт на `label`.
module.exports = { label, format, touchedLines, overlaps, daily, installSchedule, scheduleCommand, REPORT, TASK_NAME, FIX_WINDOW, LINE_TOLERANCE };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const at = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
  // --project: планировщик стартует процесс не в корне репо, cwd там — system32.
  const cwd = at('--project') || process.cwd();
  if (argv.includes('--install-schedule')) {
    const r = installSchedule(cwd, { ...(at('--at') ? { time: at('--at') } : {}) });
    console.log(`elt retro-label: задача ${r.taskName} ${r.ok ? 'зарегистрирована' : 'НЕ зарегистрирована'}\n  ${r.command}\n  ${r.out}`);
    process.exit(r.ok ? 0 : 1);
  }
  if (argv.includes('--daily')) {
    const rep = daily(cwd);
    console.log(`elt retro-label --daily: ${rep.total} вердиктов, unknown ${Math.round(rep.unknownShare * 100)}%, `
      + `bench +${rep.benchAdded} (всего ${rep.benchTotal}) → ${REPORT}`);
    process.exit(0);
  }
  const r = label(cwd);
  console.log(format(r));
  if (argv.includes('--json')) console.log(JSON.stringify(r.results, null, 2));
}
