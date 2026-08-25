'use strict';
// 020 T014 — append-only журнал графа: единственная будущая точка истины о том, что
// произошло в прогоне.
//
// Почему не хватило существующего `run-log.jsonl`: он пишется постфактум и описывает
// КОММИТ, а не переход. По нему нельзя ни восстановить состояние после compact/restart, ни
// доказать, что фон и синхронная ветка видели одно и то же. Живой пример из этой же спеки —
// фоновой вердикт, который дописал лог, но не оставил ни строки в run-log: снаружи это
// неотличимо от «фон не запускался».
//
// Правила журнала механические и проверяются здесь, а не в вызывающем коде:
//   • append-only: событий не удаляем и не переписываем;
//   • ровно один terminal на (runId, batchId, generation);
//   • seq монотонен внутри runId, дубликат (runId, seq) — no-op, а не вторая запись;
//   • запись под межпроцессным замком, чтобы фон и передний план не рвали строку.
//
// До T015 журнал НЕ авторитетен: эпоха `legacy-v1` продолжает жить на checkbox/approval/
// run-log. Здесь только пишем и читаем, ничего не отменяя.

const fs = require('node:fs');
const path = require('node:path');

const JOURNAL_SCHEMA = 'elt-journal/v1';
const LEGACY_EPOCH = 'legacy-v1';

// Поля, без которых событие не привязано ни к прогону, ни к доказательству. Совпадает с
// минимальным evidence envelope reducer-а (020 T013) плюс сам переход.
const REQUIRED_FIELDS = [
  'v', 'runId', 'graphVersion', 'lockDigest', 'specPath', 'taskIdentities',
  'batchId', 'generation', 'node', 'event', 'seq', 'ts',
];

const LOCK_STALE_MS = 30000;
const LOCK_WAIT_MS = 5000;

function defaultJournalPath(repoDir) {
  // В worktree `.git` — файл с указателем; журнал обязан быть один на репозиторий, иначе
  // основное дерево и фоновой worktree разойдутся в истории прогонов.
  const dotGit = path.join(repoDir, '.git');
  let gitDir = dotGit;
  try {
    const stat = fs.statSync(dotGit);
    if (stat.isFile()) {
      const pointer = fs.readFileSync(dotGit, 'utf8').trim();
      const m = /^gitdir:\s*(.+)$/.exec(pointer);
      if (m) gitDir = path.resolve(repoDir, m[1].trim());
    }
  } catch { /* нет .git — вернём путь как есть, вызывающий решит сам */ }
  return path.join(gitDir, 'elt', 'graph-journal.jsonl');
}

function validateEvent(event) {
  const errors = [];
  if (!event || typeof event !== 'object') return ['event must be an object'];
  for (const field of REQUIRED_FIELDS) {
    if (event[field] === undefined || event[field] === null || event[field] === '') errors.push(`missing ${field}`);
  }
  if (event.v && event.v !== JOURNAL_SCHEMA) errors.push(`unknown schema ${event.v}`);
  if (!Number.isInteger(event.seq) || event.seq < 1) errors.push('seq must be a positive integer');
  if (!Number.isInteger(event.generation) || event.generation < 1) errors.push('generation must be a positive integer');
  if (!Array.isArray(event.taskIdentities) || !event.taskIdentities.length) errors.push('taskIdentities must be a non-empty array');
  if (event.terminal !== undefined && typeof event.terminal !== 'boolean') errors.push('terminal must be boolean');
  if (event.guards !== undefined && (typeof event.guards !== 'object' || Array.isArray(event.guards))) {
    errors.push('guards must be an object');
  }
  return errors;
}

// Чтение терпит ровно один вид порчи — оборванный хвост после падения процесса. Всё
// остальное (мусор в середине) означает, что журнал редактировали, и это не «почини молча».
function readEvents(journalPath) {
  if (!fs.existsSync(journalPath)) return { events: [], truncatedTail: false, corrupt: [] };
  const raw = fs.readFileSync(journalPath, 'utf8');
  const lines = raw.split('\n');
  const tail = lines.pop(); // после последнего '\n' обязан быть пустой хвост
  const events = [];
  const corrupt = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try { events.push(JSON.parse(line)); } catch { corrupt.push({ line: i + 1, text: line.slice(0, 200) }); }
  });
  return { events, truncatedTail: Boolean(tail && tail.trim()), corrupt };
}

function sleepMs(ms) {
  // Синхронный сон без busy-wait: журнал пишут и хуки, и фон, где async-цикла может не быть.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(journalPath, waitMs = LOCK_WAIT_MS) {
  const lockPath = `${journalPath}.lock`;
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      // mkdir атомарен и на Windows, и на Linux — в отличие от «проверил, потом создал».
      fs.mkdirSync(lockPath);
      return { ok: true, lockPath };
    } catch (error) {
      if (error.code !== 'EEXIST') return { ok: false, reason: `lock-failed: ${error.code}` };
      let age = 0;
      try { age = Date.now() - fs.statSync(lockPath).mtimeMs; } catch { age = 0; }
      // Замок убитого процесса иначе останавливает харнес навсегда: TaskStop не убивает
      // цепочку powershell→node, и осиротевшие артефакты здесь — норма, а не экзотика.
      if (age > LOCK_STALE_MS) { try { fs.rmdirSync(lockPath); } catch { /* другой успел */ } continue; }
      if (Date.now() > deadline) return { ok: false, reason: 'lock-timeout' };
      sleepMs(25);
    }
  }
}

function releaseLock(lockPath) {
  try { fs.rmdirSync(lockPath); } catch { /* уже снят */ }
}

/**
 * appendEvent(journalPath, event) →
 *   { ok:true, appended:true, seq } | { ok:true, appended:false, reason:'duplicate' } |
 *   { ok:false, reason, detail }
 *
 * Идемпотентность здесь не удобство, а требование replay: тот же хук после restart
 * присылает то же событие, и вторая запись сделала бы прогон «прошедшим дважды».
 */
function appendEvent(journalPath, event) {
  const errors = validateEvent(event);
  if (errors.length) return { ok: false, reason: 'invalid-event', detail: errors.join('; ') };

  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const lock = acquireLock(journalPath);
  if (!lock.ok) return { ok: false, reason: lock.reason };
  try {
    const { events, corrupt } = readEvents(journalPath);
    if (corrupt.length) return { ok: false, reason: 'journal-corrupt', detail: `line ${corrupt[0].line}` };

    const sameRun = events.filter((e) => e.runId === event.runId);
    if (sameRun.some((e) => e.seq === event.seq)) return { ok: true, appended: false, reason: 'duplicate' };
    const maxSeq = sameRun.reduce((max, e) => Math.max(max, e.seq || 0), 0);
    if (event.seq <= maxSeq) return { ok: false, reason: 'non-monotonic-seq', detail: `seq ${event.seq} <= ${maxSeq}` };

    if (event.terminal) {
      const clash = sameRun.find((e) => e.terminal && e.batchId === event.batchId && e.generation === event.generation);
      if (clash) return { ok: false, reason: 'terminal-exists', detail: `generation ${event.generation} already terminal at seq ${clash.seq}` };
    }

    // Одна строка, один write, затем fsync: обрыв питания оставит либо полную строку, либо
    // неполный хвост, который readEvents() опознаёт как crash-остаток.
    const fd = fs.openSync(journalPath, 'a');
    try {
      fs.writeSync(fd, `${JSON.stringify({ ...event, v: JOURNAL_SCHEMA })}\n`);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    return { ok: true, appended: true, seq: event.seq };
  } finally {
    releaseLock(lock.lockPath);
  }
}

function eventsForRun(journalPath, runId) {
  return readEvents(journalPath).events.filter((e) => e.runId === runId).sort((a, b) => a.seq - b.seq);
}

module.exports = {
  JOURNAL_SCHEMA,
  LEGACY_EPOCH,
  appendEvent,
  defaultJournalPath,
  eventsForRun,
  readEvents,
  validateEvent,
};
