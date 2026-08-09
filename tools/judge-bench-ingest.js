#!/usr/bin/env node
'use strict';
// 014 T013 (фаза D, AC9) — размеченные кейсы пополняют judge-bench САМИ.
//
// До этого набор кейсов рос только руками, поэтому не рос: 22 кейса за всё время. Ретро-разметка
// (T012) даёт именно то, чего не хватает бенчу — случаи, где судья ОШИБСЯ, с известным
// правильным ответом:
//   false-block   → судья заблокировал зря  → в бенче ожидается `pass`
//   missed-defect → судья пропустил дефект  → в бенче ожидается `block`
// `correct` и `unknown` не добавляются: первое ничего не проверяет (судья уже прав), второе —
// признанная неуверенность, и кейс с придуманным ответом отравил бы замер.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { label } = require('./elt-retro-label');
const { runtimeRunLog } = require('./run-log');

// Хранилище отдельным json: cases.js — рукописный набор с пояснениями, и машинная дозапись в
// него смешала бы источники (вынос допустим и предпочтителен — формулировка задачи).
const STORE = path.join(__dirname, 'judge-bench', 'cases-ingested.json');
// Дифф в кейсе — вход судьи, а не архив: за пределами этого объёма кейс перестаёт быть
// читаемым человеком, который будет разбирать промах бенча.
const DIFF_CAP_LINES = 200;

function readStore(file = STORE) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j) ? j : []; }
  catch { return []; }
}
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

// Кейс строится из РЕАЛЬНОГО коммита: тот же дифф и тот же status, что видел судья в проде.
function caseFromCommit(cwd, sha, { id, expect, why }) {
  const subject = git(cwd, ['show', '-s', '--format=%s', sha]).trim();
  const diff = git(cwd, ['show', '--format=', sha]).split(/\r?\n/).slice(0, DIFF_CAP_LINES).join('\n');
  const files = git(cwd, ['show', '--name-only', '--format=', sha]).split(/\r?\n/).filter(Boolean);
  if (!diff.trim()) return null; // пустой дифф не кейс, а мусор
  return {
    id, expect, why, ingested: true, commit: sha,
    taskText: subject,
    status: files.map((f) => ` M ${f}`).join('\n') + '\n',
    diff,
  };
}

function ingest(cwd, options = {}) {
  const store = options.store || STORE;
  const existing = readStore(store);
  const seen = new Set(existing.map((c) => c.id));
  const entries = readJsonl(options.runLog || runtimeRunLog(cwd));
  const { results } = label(cwd, options);
  const added = [];

  for (const r of results) {
    if (r.label !== 'false-block' && r.label !== 'missed-defect') continue;
    if (seen.has(r.verdictId)) continue; // идемпотентность: повторная разметка не плодит дублей
    const [task] = r.verdictId.split(':');
    // Коммит слайса: у missed-defect он в самой записи, у false-block — в следующей записи
    // той же задачи (у блока своего коммита нет по определению).
    const ofTask = entries.filter((e) => e.task === task && e.commit);
    const sha = ofTask.length ? ofTask[ofTask.length - 1].commit : null;
    if (!sha) continue;
    const c = caseFromCommit(cwd, sha, {
      id: r.verdictId,
      expect: r.label === 'false-block' ? 'pass' : 'block',
      why: `${r.label} (ретро-разметка): ${r.evidence}`,
    });
    if (c) { added.push(c); seen.add(r.verdictId); }
  }
  if (added.length) fs.writeFileSync(store, JSON.stringify([...existing, ...added], null, 2) + '\n');
  return { added: added.length, total: existing.length + added.length, cases: added };
}

if (require.main === module) {
  const r = ingest(process.cwd());
  console.log(`judge-bench-ingest: +${r.added} кейсов, всего размеченных ${r.total}`);
}

module.exports = { ingest, readStore, caseFromCommit, STORE, DIFF_CAP_LINES };
