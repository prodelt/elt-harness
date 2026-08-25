'use strict';
// 020 T014 — регресс производного состояния и снимка миграции легаси-эпохи.

const assert = require('node:assert/strict');

const { compile, loadCanonicalGraph } = require('./graph-compiler');
const { JOURNAL_SCHEMA } = require('./graph-journal');
const { deriveState, evidenceFromEvent, migrationSnapshot } = require('./graph-state');

const compiled = compile(loadCanonicalGraph());
assert.equal(compiled.ok, true, compiled.errors.join('; '));
const graph = compiled.graph;

const SPEC = 'specs/020-elt-v5-codex-release-certification/tasks.md';

function event(seq, node, name, guards = {}, over = {}) {
  return {
    v: JOURNAL_SCHEMA,
    runId: 'run-1',
    graphVersion: graph.graphVersion,
    lockDigest: 'lock-1',
    specPath: SPEC,
    taskIdentities: [{ specPath: SPEC, id: 'T014', index: 13 }],
    batchId: 'batch-1',
    generation: 1,
    node,
    event: name,
    guards,
    commit: null,
    treeHash: null,
    baseHead: 'base-1',
    batchHead: null,
    seq,
    ts: '2026-08-25T10:00:00.000Z',
    terminal: false,
    ...over,
  };
}

const HAPPY = [
  event(1, 'recon', 'unknown-zone'),
  event(2, 'plan', 'approved', { 'approval-trailer-present': true, 'approval-fresh': true }),
  event(3, 'build', 'ready', { 'task-dependencies-closed': true }),
  event(4, 'landing', 'landed', { 'l0-green': true }, { commit: 'e43c22b', batchHead: 'e43c22b' }),
];

function testReplayRebuildsState() {
  const { state, applied, rejected } = deriveState({ graph, events: HAPPY });
  assert.deepEqual(rejected, []);
  assert.equal(applied.length, 4);
  assert.equal(state.node, 'mirror');
  assert.equal(state.seq, 4);
  assert.equal(state.generation, 1);
}

// Порядок в файле журнала не обязан совпадать с порядком seq (две ветки писали в разное
// время). Replay обязан упорядочивать сам, иначе состояние зависит от гонки записи.
function testReplayIsOrderIndependent() {
  const shuffled = [HAPPY[2], HAPPY[0], HAPPY[3], HAPPY[1]];
  const a = deriveState({ graph, events: HAPPY });
  const b = deriveState({ graph, events: shuffled });
  assert.deepEqual(b.state.node, a.state.node);
  assert.deepEqual(b.state.seq, a.state.seq);
  assert.deepEqual(b.rejected, []);
}

// Идемпотентность replay: повторный прогон тех же событий даёт то же состояние. Это то
// самое свойство, ради которого состояние не хранится, а вычисляется.
function testReplayIsIdempotent() {
  const first = deriveState({ graph, events: HAPPY });
  const second = deriveState({ graph, events: [...HAPPY, ...HAPPY] });
  assert.equal(second.state.node, first.state.node);
  assert.equal(second.state.seq, first.state.seq);
  assert.equal(second.rejected.length, 4, 'дубликаты видны как отвергнутые, а не применяются второй раз');
  // Причина именно механическая: на узле, куда прогон уже ушёл, повторного ребра нет.
  assert.ok(second.rejected.every((r) => r.reason === 'no-edge'), JSON.stringify(second.rejected));
}

// Чужие события не «чинятся» и не выбрасываются молча: они возвращаются с машинной причиной.
function testIllegalEventIsRejectedWithReason() {
  const { state, rejected } = deriveState({ graph, events: [...HAPPY, event(5, 'mirror', 'publish-requested')] });
  assert.equal(state.node, 'mirror', 'незаконное событие не двигает состояние');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'no-edge');
}

function testGuardMissingInJournalBlocksReplay() {
  const events = [event(1, 'recon', 'known-zone', { 'familiar-zone': true })];
  const { state, rejected } = deriveState({ graph, events });
  assert.equal(state.node, 'recon');
  assert.equal(rejected[0].reason, 'guard-unsatisfied');
}

// Крах и перезапуск: хвост журнала потерян, состояние восстанавливается по уцелевшим
// событиям — ровно то, что произойдёт после падения фонового процесса.
function testCrashRestartRebuildsFromSurvivingEvents() {
  const survived = HAPPY.slice(0, 2);
  const { state } = deriveState({ graph, events: survived });
  assert.equal(state.node, 'build', 'после перезапуска возвращаемся на последний доказанный узел');
}

function testRepairGenerationIsDerived() {
  const events = [...HAPPY, event(5, 'mirror', 'mirror-red')];
  const { state } = deriveState({ graph, events });
  assert.equal(state.node, 'build');
  assert.equal(state.generation, 2, 'repair-ребро поднимает поколение и при replay');
}

// Проекция статусов: пересчитывается из ИТОГОВОГО узла, откат из mirror возвращает задачу
// в `open`, а не оставляет «был landed».
function testStatusProjectionFollowsFinalNode() {
  const landed = deriveState({ graph, events: HAPPY });
  assert.deepEqual(landed.statuses, { [`${SPEC}#T014`]: 'landed' });
  const rolledBack = deriveState({ graph, events: [...HAPPY, event(5, 'mirror', 'mirror-red')] });
  assert.deepEqual(rolledBack.statuses, { [`${SPEC}#T014`]: 'open' });
}

function testRunIsolation() {
  const other = event(1, 'recon', 'unknown-zone', {}, { runId: 'run-2' });
  const { state, applied } = deriveState({ graph, events: [...HAPPY, other], runId: 'run-1' });
  assert.equal(state.node, 'mirror');
  assert.equal(applied.length, 4, 'события чужого прогона не участвуют');
}

function testEvidenceBridgeRenamesFields() {
  const envelope = evidenceFromEvent(HAPPY[0]);
  assert.equal(envelope.componentLockDigest, 'lock-1');
  assert.equal(envelope.specIdentity, SPEC);
  assert.equal(envelope.nodeId, 'recon');
  assert.equal(envelope.batchHead, null, 'отсутствующее поле становится явным null, а не undefined');
}

// --- снимок миграции ---------------------------------------------------------------------

const TASKS = [
  '- [X] **T001** Перша',
  '  [files: tools/a.js]',
  '- [ ] **T002** Друга',
  '  [files: tools/b.js]',
  '',
].join('\n');

function runLogRow(id, over = {}) {
  return {
    ts: '2026-08-25T09:00:00.000Z',
    task: id,
    batch: { specPath: SPEC, taskIdentities: [{ specPath: SPEC, id }] },
    commit: 'aaaaaaa',
    treeHash: 'tree-aaa',
    ...over,
  };
}

function bgRow(id, outcome = 'pass') {
  return { ...runLogRow(id), background: { outcome, layer: 'suite' } };
}

function testCleanLegacyRowsAllowCutover() {
  const snapshot = migrationSnapshot({
    specPath: SPEC,
    tasksText: TASKS,
    runLogEntries: [runLogRow('T001'), bgRow('T001')],
    reviewRows: [],
    approval: { digest: 'digest-1', signedDigests: ['digest-1'] },
  });
  assert.deepEqual(snapshot.ambiguities, [], JSON.stringify(snapshot.ambiguities));
  assert.equal(snapshot.cutoverBlocked, false);
  assert.equal(snapshot.epoch, 'legacy-v1');
  assert.equal(snapshot.rows.length, 2);
  assert.equal(snapshot.rows[0].commit, 'aaaaaaa');
  assert.equal(snapshot.rows[0].proof, 'pass');
  assert.equal(snapshot.rows[1].checkbox, ' ');
}

function codes(snapshot) { return snapshot.ambiguities.map((a) => a.code); }

function testClosedWithoutCommitBlocksCutover() {
  const snapshot = migrationSnapshot({
    specPath: SPEC, tasksText: TASKS, runLogEntries: [], reviewRows: [],
    approval: { digest: 'd', signedDigests: ['d'] },
  });
  assert.ok(codes(snapshot).includes('closed-without-commit'));
  assert.equal(snapshot.cutoverBlocked, true);
  assert.equal(snapshot.rows.length, 2, 'снимок ничего не удаляет — строки остаются на месте');
}

function testCommitWithoutCheckboxBlocksCutover() {
  const snapshot = migrationSnapshot({
    specPath: SPEC, tasksText: TASKS,
    runLogEntries: [runLogRow('T001'), bgRow('T001'), runLogRow('T002', { commit: 'bbbbbbb' })],
    reviewRows: [], approval: { digest: 'd', signedDigests: ['d'] },
  });
  assert.ok(codes(snapshot).includes('commit-without-checkbox'));
}

function testMultipleCommitsForOneTaskAreAmbiguous() {
  const snapshot = migrationSnapshot({
    specPath: SPEC, tasksText: TASKS,
    runLogEntries: [runLogRow('T001'), runLogRow('T001', { commit: 'ccccccc' }), bgRow('T001')],
    reviewRows: [], approval: { digest: 'd', signedDigests: ['d'] },
  });
  assert.ok(codes(snapshot).includes('multiple-commits'));
}

function testMissingProofIsAmbiguous() {
  const snapshot = migrationSnapshot({
    specPath: SPEC, tasksText: TASKS, runLogEntries: [runLogRow('T001')],
    reviewRows: [], approval: { digest: 'd', signedDigests: ['d'] },
  });
  assert.ok(codes(snapshot).includes('missing-proof'));
}

// Строка run-log без specPath — ровно те легаси-батчи, что сейчас лежат в очереди ревью:
// голый `T001,T007` не разрешается ни в одну спеку, и догадываться здесь нельзя.
function testRunLogRowWithoutSpecIsAmbiguous() {
  const snapshot = migrationSnapshot({
    specPath: SPEC, tasksText: TASKS,
    runLogEntries: [runLogRow('T001'), bgRow('T001'), { ts: 'x', task: 'T001,T007', commit: 'b6cd3b4' }],
    reviewRows: [], approval: { digest: 'd', signedDigests: ['d'] },
  });
  assert.ok(codes(snapshot).includes('runlog-without-spec'));
  assert.equal(snapshot.cutoverBlocked, true);
}

function testUnresolvedReviewRowBlocksCutover() {
  const snapshot = migrationSnapshot({
    specPath: SPEC, tasksText: TASKS, runLogEntries: [runLogRow('T001'), bgRow('T001')],
    reviewRows: [{ kind: 'bg-red', task: 'T002,T003', commit: '4603a9e' }],
    approval: { digest: 'd', signedDigests: ['d'] },
  });
  assert.ok(codes(snapshot).includes('unresolved-review-row'));
  assert.equal(snapshot.cutoverBlocked, true);
}

// Смена схемы подписи делает прежний approval stale — это заявленное поведение спеки.
// Cutover на неподписанном по новой схеме плане запрещён.
function testUnsignedApprovalBlocksCutover() {
  const snapshot = migrationSnapshot({
    specPath: SPEC, tasksText: TASKS, runLogEntries: [runLogRow('T001'), bgRow('T001')],
    reviewRows: [], approval: { digest: 'new-digest', signedDigests: ['old-digest'] },
  });
  assert.ok(codes(snapshot).includes('approval-schema-not-signed'));

  const none = migrationSnapshot({ specPath: SPEC, tasksText: TASKS, runLogEntries: [runLogRow('T001'), bgRow('T001')], reviewRows: [] });
  assert.ok(codes(none).includes('approval-missing'));
}

function main() {
  testReplayRebuildsState();
  testReplayIsOrderIndependent();
  testReplayIsIdempotent();
  testIllegalEventIsRejectedWithReason();
  testGuardMissingInJournalBlocksReplay();
  testCrashRestartRebuildsFromSurvivingEvents();
  testRepairGenerationIsDerived();
  testStatusProjectionFollowsFinalNode();
  testRunIsolation();
  testEvidenceBridgeRenamesFields();
  testCleanLegacyRowsAllowCutover();
  testClosedWithoutCommitBlocksCutover();
  testCommitWithoutCheckboxBlocksCutover();
  testMultipleCommitsForOneTaskAreAmbiguous();
  testMissingProofIsAmbiguous();
  testRunLogRowWithoutSpecIsAmbiguous();
  testUnresolvedReviewRowBlocksCutover();
  testUnsignedApprovalBlocksCutover();
  process.stdout.write('graph state tests: PASS\n');
}

main();
