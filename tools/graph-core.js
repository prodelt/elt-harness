'use strict';
// 020 T013 — чистый transition reducer: `advance(state, event, evidence)`.
//
// До этой задачи маршрут `oracle → judge → commit` жил в голове человека и в argv. Отсюда
// два системных отказа, которые видно в run-log: шаг забывали (гейт покрывал 55,8% коммитов)
// и порядок нарушали (`stale-oracle` от собственного фона). Reducer убирает саму возможность:
// следующий шаг вычисляется из графа, а не вспоминается.
//
// Файл намеренно без fs, git, сети и часов. Тот же (state, event, evidence) обязан дать тот
// же результат на Windows и Linux, в фоне и при replay журнала (020 T014) — иначе proof,
// привязанный к хешам, ничего не доказывает. Всё побочное живёт в вызывающем слое.

// Минимальный evidence envelope (спека 020, «Канонічний runtime-граф»). Ключ обязан
// присутствовать всегда; значение может быть null там, где сущности ещё нет (`batchHead` до
// посадки). Отсутствие ключа — не «пока нет», а необъявленный конверт, и это отказ.
const REQUIRED_EVIDENCE_KEYS = [
  'runId', 'graphVersion', 'componentLockDigest', 'specIdentity', 'taskIdentities',
  'batchId', 'generation', 'baseHead', 'batchHead', 'treeHash', 'nodeId', 'seq',
];

// Эти же поля обязаны быть непустыми на любом узле: без них evidence нельзя ни привязать к
// прогону, ни отличить от конверта другой версии графа.
const NON_EMPTY_EVIDENCE_KEYS = ['runId', 'graphVersion', 'componentLockDigest', 'specIdentity', 'nodeId'];

const ILLEGAL = 'illegal-transition';

function fail(reason, detail, state) {
  return { ok: false, error: ILLEGAL, reason, detail, state };
}

function initialState(graph, { runId = null } = {}) {
  return {
    graph,
    node: graph.entry,
    seq: 0,
    generation: 1,
    runId,
    terminal: false,
  };
}

// Какие события вообще законны здесь и сейчас. Нужна не только тестам: `elt status --json`
// (020 T015) показывает человеку ровно этот список вместо инструкции по памяти.
function legalEvents(state) {
  if (!state || state.terminal) return [];
  return state.graph.edges.filter((e) => e.from === state.node).map((e) => e.event);
}

function validateEvidence(state, evidence) {
  if (!evidence || typeof evidence !== 'object') return 'evidence envelope missing';
  for (const key of REQUIRED_EVIDENCE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(evidence, key)) return `evidence missing ${key}`;
  }
  for (const key of NON_EMPTY_EVIDENCE_KEYS) {
    if (evidence[key] === null || evidence[key] === undefined || evidence[key] === '') return `evidence ${key} is empty`;
  }
  if (evidence.graphVersion !== state.graph.graphVersion) {
    return `evidence graphVersion ${evidence.graphVersion} != graph ${state.graph.graphVersion}`;
  }
  // Конверт с чужого узла — признак гонки или подставленного proof: два процесса двигают
  // один прогон. Молча принять его значит потерять привязку доказательства к шагу.
  if (evidence.nodeId !== state.node) return `evidence nodeId ${evidence.nodeId} != current node ${state.node}`;
  if (!Number.isInteger(evidence.seq)) return 'evidence seq must be an integer';
  if (evidence.seq <= state.seq) return `evidence seq ${evidence.seq} is not newer than ${state.seq}`;
  return null;
}

/**
 * advance(state, event, evidence) → { ok: true, state, edge }
 *                                 | { ok: false, error: 'illegal-transition', reason, detail, state }
 *
 * Fail-closed по каждому измерению: неизвестное событие, невыполненный guard, устаревший или
 * неполный конверт и любой шаг после терминала — один и тот же исход `illegal-transition`.
 * Причина остаётся машинной в `reason`, чтобы ledger писал код, а не фразу.
 */
function advance(state, event, evidence) {
  if (!state || !state.graph) return fail('no-state', 'state without compiled graph', state);
  if (state.terminal) return fail('terminal-state', `${state.node} is terminal`, state);

  const candidates = state.graph.edges.filter((e) => e.from === state.node && e.event === event);
  if (!candidates.length) {
    return fail('no-edge', `no edge ${state.node} --${event}-->; legal: ${legalEvents(state).join(', ') || 'none'}`, state);
  }
  // Два ребра с одинаковым (from, event) сделали бы переход недетерминированным — компилятор
  // такого графа не выпустит, но reducer не полагается на чужую проверку.
  if (candidates.length > 1) {
    return fail('ambiguous-edge', `${candidates.length} edges match ${state.node} --${event}-->`, state);
  }
  const edge = candidates[0];

  const evidenceError = validateEvidence(state, evidence);
  if (evidenceError) return fail('evidence-invalid', evidenceError, state);

  const provided = (evidence.guards && typeof evidence.guards === 'object') ? evidence.guards : {};
  const target = state.graph.nodes[edge.to];
  // Обязательны guard именно ребра. Узел объявляет ВЕСЬ набор своих механических предикатов
  // (`node.guards`), а каждое исходящее ребро выбирает подмножество: из `recon` два законных
  // выхода с разными условиями, и общий на узел список сделал бы один из них недостижимым.
  // Связность «guard ребра объявлен узлом» проверяет компилятор, не рантайм.
  for (const guard of edge.guards) {
    // Отсутствующий guard считается невыполненным: «не измеряли» никогда не значит «зелено».
    if (provided[guard] !== true) return fail('guard-unsatisfied', `guard ${guard} is not proven true`, state);
  }

  return {
    ok: true,
    edge,
    state: {
      ...state,
      node: edge.to,
      seq: evidence.seq,
      generation: edge.repair ? state.generation + 1 : state.generation,
      runId: state.runId || evidence.runId,
      terminal: Boolean(target) && target.kind === 'sink',
    },
  };
}

module.exports = {
  ILLEGAL,
  REQUIRED_EVIDENCE_KEYS,
  advance,
  initialState,
  legalEvents,
};
