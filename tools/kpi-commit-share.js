#!/usr/bin/env node
'use strict';
// kpi-commit-share.js — 019 T016. Единственное число, которым харнес отчитывается о себе:
// какая доля коммитов прошла через него, а не мимо.
//
// Почему именно это число. Диагноз, с которого началась пересборка v5: харнес обходили в 81%
// коммитов (41 из 220 за 14 дней прошли через него). Любая другая метрика — покрытие, число
// правил, время гейта — измеряет механизм, который может стоять выключенным. Эта измеряет,
// пользуются ли им.
//
// Метод: сверка `.git/elt/run-log.jsonl` с `git log` ПО ХЕШУ, а не по времени. Сверка по
// времени завышала долю: коммит, сделанный руками через минуту после прогона харнеса,
// попадал в окно и засчитывался.
//
//   строгая — sha коммита есть в run-log. Это коммит, который СОЗДАЛ сам харнес.
//   мягкая  — строгая плюс коммиты, чьё сообщение совпало с записанным в run-log, но sha
//             разошёлся: так выглядит коммит харнеса, переписанный после (amend, rebase,
//             hook). Разрыв между мягкой и строгой — это и есть объём переписывания.
//
// Сводную выборку по нескольким репозиториям и однорепную СМЕШИВАТЬ НЕЛЬЗЯ: знаменатель у
// них разный, и «доля упала» будет означать лишь, что в выборку добавился чужой проект.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_DAYS = 14;

function git(args, cwd) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
}

// Хвост run-log: {sha → true} и {первая строка сообщения → true}.
function readRunLog(cwd) {
  const file = path.join(cwd, '.git', 'elt', 'run-log.jsonl');
  const shas = new Set();
  const messages = new Set();
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return { shas, messages, file, exists: false }; }
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    let entry = null;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry && typeof entry.commit === 'string' && entry.commit.trim()) shas.add(entry.commit.trim());
    if (entry && typeof entry.msg === 'string' && entry.msg.trim()) messages.add(normalizeMsg(entry.msg));
  }
  return { shas, messages, file, exists: true };
}

// run-log пишет обрезанное сообщение — сравниваем по нормализованному префиксу, а не целиком.
function normalizeMsg(text) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 60).toLowerCase();
}

// Совпадение sha: run-log хранит короткий хеш, git log отдаёт полный.
function shaMatches(fullSha, shas) {
  if (shas.has(fullSha)) return true;
  for (const recorded of shas) {
    if (recorded.length >= 7 && fullSha.startsWith(recorded)) return true;
  }
  return false;
}

function measure({ cwd = process.cwd(), days = DEFAULT_DAYS, asOf = null } = {}) {
  const runLog = readRunLog(cwd);
  const untilDate = asOf ? new Date(`${asOf}T23:59:59.999Z`) : new Date();
  if (Number.isNaN(untilDate.getTime())) throw new Error(`kpi-commit-share: неверный --as-of ${asOf}`);
  const since = new Date(untilDate.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const until = untilDate.toISOString();
  const raw = git(['log', `--since=${since}`, `--until=${until}`, '--pretty=format:%H%x09%s'], cwd);
  const commits = raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const [sha, subject] = line.split('\t');
    return { sha, subject: subject || '' };
  });

  const strict = commits.filter((c) => shaMatches(c.sha, runLog.shas));
  const strictShas = new Set(strict.map((c) => c.sha));
  const softExtra = commits.filter((c) => !strictShas.has(c.sha) && runLog.messages.has(normalizeMsg(c.subject)));

  const total = commits.length;
  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    project: path.basename(path.resolve(cwd)),
    period: { since, until: asOf || until.slice(0, 10), days },
    total,
    strict: { count: strict.length, share: pct(strict.length) },
    soft: { count: strict.length + softExtra.length, share: pct(strict.length + softExtra.length) },
    runLog: { file: runLog.file, exists: runLog.exists, records: runLog.shas.size },
    bypassed: commits.filter((c) => !strictShas.has(c.sha) && !runLog.messages.has(normalizeMsg(c.subject)))
      .map((c) => `${c.sha.slice(0, 7)} ${c.subject}`),
  };
}

function measureMany({ cwds, days = DEFAULT_DAYS, asOf = null }) {
  const projects = cwds.map((cwd) => measure({ cwd, days, asOf }));
  const total = projects.reduce((sum, r) => sum + r.total, 0);
  const strictCount = projects.reduce((sum, r) => sum + r.strict.count, 0);
  const softCount = projects.reduce((sum, r) => sum + r.soft.count, 0);
  const pct = (n) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  return {
    aggregate: true,
    period: {
      since: projects[0] ? projects[0].period.since : null,
      until: projects[0] ? projects[0].period.until : asOf,
      days,
    },
    total,
    strict: { count: strictCount, share: pct(strictCount) },
    soft: { count: softCount, share: pct(softCount) },
    projects,
  };
}

function formatText(r) {
  const lines = [
    `kpi-commit-share: ${r.project}, окно ${r.period.days} дн. (${r.period.since}..${r.period.until})`,
    `  коммитов всего:        ${r.total}`,
    `  через харнес (строго): ${r.strict.count}/${r.total} = ${r.strict.share}%`,
    `  через харнес (мягко):  ${r.soft.count}/${r.total} = ${r.soft.share}%`,
    `  run-log:               ${r.runLog.exists ? `${r.runLog.records} записей` : 'НЕТ ФАЙЛА — доля будет 0% не потому, что харнес не работал'}`,
  ];
  if (r.bypassed.length) {
    lines.push(`  мимо харнеса (${r.bypassed.length}):`);
    for (const c of r.bypassed.slice(0, 15)) lines.push(`    ${c}`);
    if (r.bypassed.length > 15) lines.push(`    … и ещё ${r.bypassed.length - 15}`);
  }
  return lines.join('\n') + '\n';
}

function formatAggregate(r) {
  const lines = [
    `kpi-commit-share: ${r.projects.length} репо, окно ${r.period.days} дн. (${r.period.since}..${r.period.until})`,
    `  коммитов всего:        ${r.total}`,
    `  через харнес (строго): ${r.strict.count}/${r.total} = ${r.strict.share}%`,
    `  через харнес (мягко):  ${r.soft.count}/${r.total} = ${r.soft.share}%`,
    '  по проектам:',
  ];
  for (const p of r.projects) {
    lines.push(`    ${p.project}: ${p.strict.count}/${p.total} = ${p.strict.share}%${p.runLog.exists ? '' : ' (run-log отсутствует)'}`);
  }
  return lines.join('\n') + '\n';
}

function optionValues(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === name && argv[i + 1]) values.push(argv[i + 1]);
  }
  return values;
}

function main(argv = process.argv.slice(2), out = process.stdout) {
  const i = argv.indexOf('--days');
  const days = i !== -1 ? Number(argv[i + 1]) : DEFAULT_DAYS;
  const validDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_DAYS;
  const a = argv.indexOf('--as-of');
  const asOf = a !== -1 ? argv[a + 1] : null;
  const cwds = optionValues(argv, '--cwd');
  const report = cwds.length > 1
    ? measureMany({ cwds, days: validDays, asOf })
    : measure({ cwd: cwds[0] || process.cwd(), days: validDays, asOf });
  const formatted = report.aggregate ? formatAggregate(report) : formatText(report);
  out.write(argv.includes('--json') ? JSON.stringify(report, null, 2) + '\n' : formatted);
  return 0;
}

if (require.main === module) process.exit(main());

module.exports = {
  measure, measureMany, formatText, formatAggregate, optionValues,
  readRunLog, normalizeMsg, shaMatches, main, DEFAULT_DAYS,
};
