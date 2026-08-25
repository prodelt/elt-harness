'use strict';
// 020 T014 — производное состояние: replay журнала и снимок миграции легаси-эпохи.
//
// Две функции, обе чистые.
//
// 1) `deriveState` — состояние прогона НЕ хранится, а вычисляется из журнала через тот же
//    reducer, что и живой переход (020 T013). Именно это даёт deterministic resume: после
//    compact, перезапуска сессии или падения фона состояние восстанавливается из событий, а
//    не из памяти процесса, которой уже нет.
//
// 2) `migrationSnapshot` — сверка легаси-эпохи `legacy-v1` с точными
//    `specPath/task/commit/tree/proof`. Снимок НИЧЕГО не удаляет и не переписывает: он лишь
//    отвечает на вопрос «можно ли вообще делать cutover». Любая неоднозначность — блокер
//    будущего T015, потому что переключить авторитет на журнал, не умея объяснить старую
//    строку, значит потерять её молча.

const { advance, initialState } = require('./graph-core');
const { identityKey, taskIdentities } = require('./task-identity');
const { LEGACY_EPOCH } = require('./graph-journal');

// Узел графа → статус задачи в проекции. Проекция (checkbox, state.md) после T015 становится
// перестраиваемой; сама таблица живёт здесь, чтобы «built/landed/certified» имели ровно одно
// определение на весь харнес.
const NODE_STATUS = {
  build: 'open',
  landing: 'built',
  mirror: 'landed',
  debrief: 'landed',
  certified: 'certified',
  publish: 'certified',
};

// Событие журнала → evidence envelope reducer-а. Мост нужен потому, что журнал хранит
// плоскую запись, а reducer требует именованный конверт: два разных контракта намеренно не
// склеены в один, иначе изменение схемы журнала молча меняло бы правила переходов.
function evidenceFromEvent(event) {
  return {
    runId: event.runId,
    graphVersion: event.graphVersion,
    componentLockDigest: event.lockDigest,
    specIdentity: event.specPath,
    taskIdentities: event.taskIdentities,
    batchId: event.batchId,
    generation: event.generation,
    baseHead: event.baseHead === undefined ? null : event.baseHead,
    batchHead: event.batchHead === undefined ? null : event.batchHead,
    treeHash: event.treeHash === undefined ? null : event.treeHash,
    nodeId: event.node,
    seq: event.seq,
    guards: event.guards || {},
  };
}

/**
 * deriveState({ graph, events, runId }) → { state, applied, rejected, statuses }
 * Отвергнутые события не выбрасываются и не «чинятся»: они возвращаются списком с машинной
 * причиной, чтобы расхождение журнала и графа было видно, а не сглажено.
 */
function deriveState({ graph, events, runId = null }) {
  const ordered = [...events]
    .filter((e) => !runId || e.runId === runId)
    .sort((a, b) => a.seq - b.seq);

  let state = initialState(graph, { runId: runId || (ordered[0] && ordered[0].runId) || null });
  const applied = [];
  const rejected = [];
  for (const event of ordered) {
    const result = advance(state, event.event, evidenceFromEvent(event));
    if (!result.ok) { rejected.push({ seq: event.seq, event: event.event, reason: result.reason, detail: result.detail }); continue; }
    state = result.state;
    applied.push({ seq: event.seq, event: event.event, node: state.node });
  }

  // Статусы задач — проекция, а не источник: пересчитываются целиком из ИТОГОВОГО узла при
  // каждом replay. Промежуточные узлы намеренно не оставляют следа: задача, откатившаяся из
  // mirror обратно в build, снова `open`, и никакой «был landed» в проекции не живёт.
  const status = NODE_STATUS[state.node] || 'open';
  const statuses = {};
  const appliedSeqs = new Set(applied.map((a) => a.seq));
  for (const event of ordered) {
    if (!appliedSeqs.has(event.seq)) continue;
    for (const identity of event.taskIdentities || []) statuses[identityKey(identity)] = status;
  }

  return { state, applied, rejected, statuses };
}

function ambiguity(code, detail) {
  return { code, detail };
}

/**
 * migrationSnapshot(input) → { epoch, rows, ambiguities, cutoverBlocked }
 *
 * input:
 *   specPath      — repo-relative POSIX путь к tasks.md (identity спеки);
 *   tasksText     — содержимое tasks.md;
 *   runLogEntries — строки `.git/elt/run-log.jsonl` как объекты;
 *   reviewRows    — строки `.harness/review-queue.jsonl` как объекты;
 *   approval      — { digest, signedDigests: [] } по схеме `elt-approval/v1`.
 *
 * Вход инъектируется, а не читается изнутри: снимок обязан считаться одинаково в основном
 * дереве и в фоновом worktree, где часть источников физически другая.
 */
function migrationSnapshot({ specPath, tasksText, runLogEntries = [], reviewRows = [], approval = null }) {
  const identities = taskIdentities(tasksText, specPath);
  const closed = new Set();
  for (const line of String(tasksText).split(/\r?\n/)) {
    const m = /^\s*[-*]\s*\[[xX]\]\s*\*\*(T\d{3})\*\*/.exec(line);
    if (m) closed.add(m[1]);
  }

  const ambiguities = [];
  const rows = [];

  // Записи run-log, относящиеся к ЭТОЙ спеке. Строка без разрешимой спеки (в очереди сейчас
  // две таких, из легаси-батчей) не приписывается сюда по догадке — это отдельная
  // неоднозначность.
  const relevant = runLogEntries.filter((e) => {
    const fromBatch = e.batch && e.batch.specPath;
    return fromBatch === specPath;
  });
  const orphanRunLog = runLogEntries.filter((e) => e.task && !(e.batch && e.batch.specPath));
  for (const entry of orphanRunLog) {
    ambiguities.push(ambiguity('runlog-without-spec', `task ${entry.task} @ ${entry.commit || 'no-commit'} не несёт specPath`));
  }

  for (const identity of identities) {
    const commits = relevant.filter((e) => {
      const ids = (e.batch && e.batch.taskIdentities) || [];
      return ids.some((t) => t.id === identity.id) || e.task === identity.id;
    });
    const committed = commits.filter((e) => e.commit);
    const proofs = commits.filter((e) => e.background && e.background.outcome);
    const isClosed = closed.has(identity.id);

    rows.push({
      specPath,
      id: identity.id,
      index: identity.index,
      checkbox: isClosed ? 'X' : ' ',
      commit: committed.length ? committed[committed.length - 1].commit : null,
      treeHash: committed.length ? (committed[committed.length - 1].treeHash || null) : null,
      proof: proofs.length ? proofs[proofs.length - 1].background.outcome : null,
    });

    // Закрытая галочка без коммита — ровно тот случай, когда старое состояние нечем
    // подтвердить: после cutover такая задача выглядела бы сделанной без единого события.
    if (isClosed && !committed.length) {
      ambiguities.push(ambiguity('closed-without-commit', `${identity.id}: [X] без коммита в run-log`));
    }
    if (!isClosed && committed.length) {
      ambiguities.push(ambiguity('commit-without-checkbox', `${identity.id}: коммит ${committed[committed.length - 1].commit} при открытой задаче`));
    }
    const distinct = new Set(committed.map((e) => e.commit));
    if (distinct.size > 1) {
      ambiguities.push(ambiguity('multiple-commits', `${identity.id}: ${[...distinct].join(', ')}`));
    }
    if (isClosed && committed.length && !proofs.length) {
      ambiguities.push(ambiguity('missing-proof', `${identity.id}: коммит есть, терминального фонового вердикта нет`));
    }
  }

  for (const row of reviewRows) {
    if (row.resolved) continue;
    ambiguities.push(ambiguity('unresolved-review-row', `${row.kind || 'row'} ${row.task || '?'} @ ${row.commit || '?'}`));
  }

  // Смена схемы подписи делает старую подпись stale — это заявленное поведение спеки, а не
  // дефект. Но cutover на непереподписанном плане запрещён: журнал станет авторитетным для
  // намерения, которое никто не подтвердил в новой канонической форме.
  if (approval) {
    const signed = new Set(approval.signedDigests || []);
    if (!signed.has(approval.digest)) {
      ambiguities.push(ambiguity('approval-schema-not-signed', `elt-approval/v1 digest ${String(approval.digest).slice(0, 12)} не подписан`));
    }
  } else {
    ambiguities.push(ambiguity('approval-missing', `${specPath}: подпись схемы elt-approval/v1 не предъявлена`));
  }

  return { epoch: LEGACY_EPOCH, rows, ambiguities, cutoverBlocked: ambiguities.length > 0 };
}

module.exports = {
  NODE_STATUS,
  deriveState,
  evidenceFromEvent,
  migrationSnapshot,
};
