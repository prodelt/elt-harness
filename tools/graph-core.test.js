'use strict';
// 020 T013 — регресс transition reducer.
//
// Тест гоняет НАСТОЯЩИЙ канонический граф (graphs/elt-v5.json), а не выдуманную фикстуру:
// иначе зелёный reducer ничего не говорит о том маршруте, которым реально ходит харнес.

const assert = require('node:assert/strict');

const { compile, loadCanonicalGraph } = require('./graph-compiler');
const { advance, initialState, legalEvents, REQUIRED_EVIDENCE_KEYS } = require('./graph-core');

const compiled = compile(loadCanonicalGraph());
assert.equal(compiled.ok, true, `канонический граф обязан компилироваться: ${compiled.errors.join('; ')}`);
const graph = compiled.graph;

let seqCounter = 0;
function evidence(node, guards = {}, over = {}) {
  seqCounter += 1;
  return {
    runId: 'run-020-T013',
    graphVersion: graph.graphVersion,
    componentLockDigest: 'lock-deadbeef',
    specIdentity: 'specs/020-elt-v5-codex-release-certification/tasks.md',
    taskIdentities: [{ specPath: 'specs/020-elt-v5-codex-release-certification/tasks.md', id: 'T013' }],
    batchId: 'b1',
    generation: 1,
    baseHead: '2f7dee2',
    batchHead: null,
    treeHash: 'tree-1',
    nodeId: node,
    seq: seqCounter,
    guards,
    ...over,
  };
}

function step(state, event, guards = {}, over = {}) {
  const result = advance(state, event, evidence(state.node, guards, over));
  assert.equal(result.ok, true, `${state.node} --${event}--> ожидался законным, получено ${result.reason}: ${result.detail}`);
  return result.state;
}

// Полный канонический маршрут: незнакомая зона → план → сборка → посадка → зеркало →
// разбор → сертификат → публикация. Ровно та последовательность, которую человек сегодня
// держит в голове.
function testCanonicalHappyPath() {
  let state = initialState(graph, { runId: 'run-020-T013' });
  assert.equal(state.node, 'recon');
  assert.equal(state.terminal, false);

  state = step(state, 'unknown-zone');
  assert.equal(state.node, 'plan');
  state = step(state, 'approved', { 'approval-trailer-present': true, 'approval-fresh': true });
  assert.equal(state.node, 'build');
  state = step(state, 'ready', { 'task-dependencies-closed': true });
  assert.equal(state.node, 'landing');
  state = step(state, 'landed', { 'l0-green': true });
  assert.equal(state.node, 'mirror');
  state = step(state, 'mirror-terminal', { 'batch-head-immutable': true });
  assert.equal(state.node, 'debrief');
  state = step(state, 'ledger-only', { 'oracle-green': true, 'review-terminal': true, 'hashes-match': true });
  assert.equal(state.node, 'certified');
  state = step(state, 'publish-requested', { 'certificate-fresh': true });
  assert.equal(state.node, 'publish');
  assert.equal(state.terminal, true, 'publish — sink, дальше переходов нет');
  assert.equal(state.generation, 1, 'маршрут без repair не поднимает поколение');
}

// Быстрая полоса: знакомая зона и малый scope идут в build мимо плана — ровно ради этого
// в спеке две дуги из recon, а не одна.
function testFastLaneSkipsPlan() {
  let state = initialState(graph);
  state = step(state, 'known-zone', { 'familiar-zone': true, 'scope-within-limit': true });
  assert.equal(state.node, 'build');
}

function testUnknownEventIsIllegal() {
  const state = initialState(graph);
  const result = advance(state, 'publish-requested', evidence('recon'));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'illegal-transition');
  assert.equal(result.reason, 'no-edge');
  assert.equal(result.state, state, 'отказ не двигает состояние');
}

// Guard, которого нет в конверте, — не «наверное, зелёный». Это тот же принцип, из-за
// которого фон стал fail-closed (020 T007).
function testMissingGuardIsIllegal() {
  const state = initialState(graph);
  const result = advance(state, 'known-zone', evidence('recon', { 'familiar-zone': true }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'guard-unsatisfied');
  assert.match(result.detail, /scope-within-limit/);
}

function testFalseGuardIsIllegal() {
  const state = initialState(graph);
  const result = advance(state, 'known-zone', evidence('recon', { 'familiar-zone': true, 'scope-within-limit': false }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'guard-unsatisfied');
}

// Guard целевого узла НЕ обязателен: у `plan` объявлены approval-предикаты, но вход в план
// как раз и происходит до того, как approval существует.
function testTargetNodeGuardsAreNotRequiredToEnter() {
  const state = initialState(graph);
  const result = advance(state, 'unknown-zone', evidence('recon'));
  assert.equal(result.ok, true, 'вход в plan не требует уже готового approval');
  assert.deepEqual(graph.nodes.plan.guards, ['approval-trailer-present', 'approval-fresh']);
}

function testEvidenceMustCarryEveryRequiredKey() {
  for (const key of REQUIRED_EVIDENCE_KEYS) {
    const env = evidence('recon');
    delete env[key];
    const result = advance(initialState(graph), 'unknown-zone', env);
    assert.equal(result.ok, false, `конверт без ${key} обязан быть отвергнут`);
    assert.equal(result.reason, 'evidence-invalid');
    assert.match(result.detail, new RegExp(key));
  }
}

function testEvidenceEmptyIdentityIsRejected() {
  const result = advance(initialState(graph), 'unknown-zone', evidence('recon', {}, { componentLockDigest: '' }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'evidence-invalid');
}

// Конверт другой версии графа: proof, снятый до правки графа, не годится после неё.
function testEvidenceFromAnotherGraphVersionIsRejected() {
  const result = advance(initialState(graph), 'unknown-zone', evidence('recon', {}, { graphVersion: '4.9.0' }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'evidence-invalid');
  assert.match(result.detail, /graphVersion/);
}

function testEvidenceFromAnotherNodeIsRejected() {
  const result = advance(initialState(graph), 'unknown-zone', evidence('mirror'));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'evidence-invalid');
  assert.match(result.detail, /nodeId/);
}

// Дубликат события (тот же seq) — обычный случай при повторе хука или resume после compact.
// Он не должен ни двигать состояние, ни считаться прогрессом.
function testDuplicateEventIsRejectedBySeq() {
  const state = initialState(graph);
  const env = evidence('recon');
  const first = advance(state, 'unknown-zone', env);
  assert.equal(first.ok, true);
  const replay = advance(first.state, 'approved', { ...env, nodeId: 'plan', guards: { 'approval-trailer-present': true, 'approval-fresh': true } });
  assert.equal(replay.ok, false, 'тот же seq второй раз — не прогресс');
  assert.equal(replay.reason, 'evidence-invalid');
  assert.match(replay.detail, /seq/);
}

function testTerminalStateRejectsEverything() {
  let state = initialState(graph);
  state = step(state, 'unknown-zone');
  state = step(state, 'approved', { 'approval-trailer-present': true, 'approval-fresh': true });
  state = step(state, 'ready', { 'task-dependencies-closed': true });
  state = step(state, 'landed', { 'l0-green': true });
  state = step(state, 'mirror-terminal', { 'batch-head-immutable': true });
  state = step(state, 'ledger-only', { 'oracle-green': true, 'review-terminal': true, 'hashes-match': true });
  state = step(state, 'publish-requested', { 'certificate-fresh': true });
  const result = advance(state, 'publish-requested', evidence('publish', { 'certificate-fresh': true }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'terminal-state');
  assert.deepEqual(legalEvents(state), [], 'из терминала нет законных событий');
}

// Красное зеркало возвращает тот же логический батч в build и поднимает поколение —
// второй uncertified батч не создаётся (спека 020, «Batch замість judge/oracle»).
function testRepairEdgeBumpsGeneration() {
  let state = initialState(graph);
  state = step(state, 'known-zone', { 'familiar-zone': true, 'scope-within-limit': true });
  state = step(state, 'ready', { 'task-dependencies-closed': true });
  state = step(state, 'landed', { 'l0-green': true });
  assert.equal(state.generation, 1);
  const repaired = step(state, 'mirror-red');
  assert.equal(repaired.node, 'build');
  assert.equal(repaired.generation, 2, 'repair-ребро увеличивает поколение');
}

// L0 red не создаёт commit и не поднимает поколение: батча ещё нет, чинить нечего.
function testL0RedLoopsBackWithoutNewGeneration() {
  let state = initialState(graph);
  state = step(state, 'known-zone', { 'familiar-zone': true, 'scope-within-limit': true });
  state = step(state, 'ready', { 'task-dependencies-closed': true });
  const back = step(state, 'l0-red');
  assert.equal(back.node, 'build');
  assert.equal(back.generation, 1);
}

function testLegalEventsListsOnlyOutgoing() {
  assert.deepEqual(legalEvents(initialState(graph)).sort(), ['known-zone', 'unknown-zone']);
}

// Чистота: тот же вход даёт тот же выход, исходное состояние не мутируется. Без этого
// replay журнала (020 T014) и фоновая проверка расходились бы с синхронной.
function testReducerIsPureAndDeterministic() {
  const state = initialState(graph);
  const frozen = JSON.stringify({ node: state.node, seq: state.seq, generation: state.generation, terminal: state.terminal });
  const env = evidence('recon', { 'familiar-zone': true, 'scope-within-limit': true });
  const a = advance(state, 'known-zone', env);
  const b = advance(state, 'known-zone', env);
  assert.deepEqual(a.state.node, b.state.node);
  assert.deepEqual(a.state.seq, b.state.seq);
  assert.deepEqual(a.state.generation, b.state.generation);
  assert.equal(JSON.stringify({ node: state.node, seq: state.seq, generation: state.generation, terminal: state.terminal }), frozen);
}

function main() {
  testCanonicalHappyPath();
  testFastLaneSkipsPlan();
  testUnknownEventIsIllegal();
  testMissingGuardIsIllegal();
  testFalseGuardIsIllegal();
  testTargetNodeGuardsAreNotRequiredToEnter();
  testEvidenceMustCarryEveryRequiredKey();
  testEvidenceEmptyIdentityIsRejected();
  testEvidenceFromAnotherGraphVersionIsRejected();
  testEvidenceFromAnotherNodeIsRejected();
  testDuplicateEventIsRejectedBySeq();
  testTerminalStateRejectsEverything();
  testRepairEdgeBumpsGeneration();
  testL0RedLoopsBackWithoutNewGeneration();
  testLegalEventsListsOnlyOutgoing();
  testReducerIsPureAndDeterministic();
  process.stdout.write('graph core tests: PASS\n');
}

main();
