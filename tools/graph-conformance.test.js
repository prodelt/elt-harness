'use strict';
// 020 T022 — матрица соответствия графа. Один файл, который отвечает на вопрос «что вообще
// может пойти не так с маршрутом» перечислением, а не рассуждением.
//
// Это не дубль тестов T013–T015: там каждый модуль проверялся изнутри, здесь проверяется их
// СТЫК — то место, где реально ломалось всё предыдущее. Матрица перечисляет законные и
// незаконные рёбра явно, поэтому добавление ребра в граф без обдумывания последствий делает
// файл красным, а не тихо расширяет разрешённое.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { compile, loadCanonicalGraph, AUTHORITY_CAPABILITIES } = require('./graph-compiler');
const { advance, initialState, legalEvents, ILLEGAL } = require('./graph-core');
const { appendEvent, readEvents, defaultJournalPath, JOURNAL_SCHEMA } = require('./graph-journal');
const { deriveState, migrationSnapshot } = require('./graph-state');
const { taskIdentities, approvalDigestFromTexts } = require('./task-identity');

const tmpDirs = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-conf-'));
  tmpDirs.push(d);
  return d;
}
function cleanup() {
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* уборка не гейт */ } }
}

const GRAPH = (() => {
  const r = compile(loadCanonicalGraph());
  assert.equal(r.ok, true, `канонический граф обязан компилироваться: ${(r.errors || []).join('; ')}`);
  return r.graph;
})();

const SPEC = 'specs/020-elt-v5-codex-release-certification/tasks.md';
let seq = 0;
function envelope(state, over = {}) {
  seq += 1;
  return {
    runId: 'run-conformance',
    graphVersion: GRAPH.graphVersion,
    componentLockDigest: 'lock-1',
    specIdentity: SPEC,
    taskIdentities: [{ specPath: SPEC, id: 'T001', index: 0 }],
    batchId: 'batch-1',
    generation: state.generation,
    baseHead: 'base',
    batchHead: 'head',
    treeHash: 'tree',
    nodeId: state.node,
    seq,
    guards: {},
    ...over,
  };
}
function walk(state, steps) {
  let s = state;
  for (const [event, guards] of steps) {
    const r = advance(s, event, envelope(s, { guards }));
    assert.equal(r.ok, true, `${s.node} --${event}--> должен быть законен: ${r.reason} ${r.detail || ''}`);
    s = r.state;
  }
  return s;
}

// ── 1. Законные рёбра: полный проход до публикации ───────────────────────────────────────
function testHappyPathReachesPublish() {
  const s = walk(initialState(GRAPH, { runId: 'run-conformance' }), [
    ['known-zone', { 'familiar-zone': true, 'scope-within-limit': true }],
    ['ready', { 'task-dependencies-closed': true }],
    ['landed', { 'l0-green': true }],
    ['mirror-terminal', { 'batch-head-immutable': true }],
    ['ledger-only', { 'oracle-green': true, 'review-terminal': true, 'hashes-match': true }],
    ['publish-requested', { 'certificate-fresh': true }],
  ]);
  assert.equal(s.node, 'publish');
  assert.equal(s.terminal, true, 'публикация — терминал: после неё прогон не продолжается');
  assert.deepEqual(legalEvents(s), [], 'из терминала не ведёт ни одно ребро');
}

// ── 2. Незаконные рёбра: каждое даёт ОДИН и тот же машинный исход ────────────────────────
function testIllegalEdgesAreRefusedUniformly() {
  const start = initialState(GRAPH, { runId: 'run-conformance' });
  const cases = [
    ['recon', 'landed'], ['recon', 'ledger-only'], ['recon', 'publish-requested'],
    ['recon', 'mirror-terminal'], ['recon', 'выдуманное-событие'],
  ];
  for (const [, event] of cases) {
    const r = advance(start, event, envelope(start));
    assert.equal(r.ok, false, `${event} из recon не имеет права пройти`);
    assert.equal(r.error, ILLEGAL);
    assert.equal(r.reason, 'no-edge');
  }
}

// План нельзя пропустить, если зона незнакома: `unknown-zone` ведёт в `plan`, и из `plan`
// единственный выход требует подписи. Пропуск плана — это отсутствующее ребро, а не «можно».
function testPlanCannotBeSkipped() {
  const s = walk(initialState(GRAPH, { runId: 'run-conformance' }), [['unknown-zone', {}]]);
  assert.equal(s.node, 'plan');
  const skipped = advance(s, 'ready', envelope(s, { guards: { 'task-dependencies-closed': true } }));
  assert.equal(skipped.ok, false, 'из плана нельзя сразу в посадку');
  assert.deepEqual(legalEvents(s), ['approved']);
}

// Протухшая подпись: guard не доказан — переход не происходит. «Не измеряли» никогда не
// значит «зелено».
function testStaleApprovalBlocksBuild() {
  const s = walk(initialState(GRAPH, { runId: 'run-conformance' }), [['unknown-zone', {}]]);
  const stale = advance(s, 'approved', envelope(s, { guards: { 'approval-trailer-present': true, 'approval-fresh': false } }));
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'guard-unsatisfied');
  assert.match(stale.detail, /approval-fresh/);
}

// ── 3. Журнал: дубликат, replay, crash после посадки, resume ─────────────────────────────
function journalEvent(over = {}) {
  return {
    v: JOURNAL_SCHEMA, runId: 'run-1', graphVersion: GRAPH.graphVersion, lockDigest: 'lock-1',
    specPath: SPEC, taskIdentities: [{ specPath: SPEC, id: 'T001', index: 0 }],
    batchId: 'b1', generation: 1, node: 'recon', event: 'known-zone', seq: 1,
    ts: new Date().toISOString(), guards: { 'familiar-zone': true, 'scope-within-limit': true },
    ...over,
  };
}

function testDuplicateAndReplayAreIdempotent() {
  const file = path.join(tmp(), 'journal.jsonl');
  assert.equal(appendEvent(file, journalEvent()).appended, true);
  const again = appendEvent(file, journalEvent());
  assert.equal(again.appended, false, 'повторное событие — no-op, а не вторая строка');
  assert.equal(again.reason, 'duplicate');

  // Replay даёт ТО ЖЕ состояние: это и есть определение детерминированного resume.
  const events = readEvents(file).events;
  const first = deriveState({ graph: GRAPH, events, runId: 'run-1' });
  const second = deriveState({ graph: GRAPH, events, runId: 'run-1' });
  assert.equal(first.state.node, second.state.node);
  assert.deepEqual(first.statuses, second.statuses);
  assert.equal(first.state.node, 'build');
}

function testCrashAfterLandingResumesAtMirror() {
  const file = path.join(tmp(), 'journal.jsonl');
  appendEvent(file, journalEvent());
  appendEvent(file, journalEvent({ seq: 2, node: 'build', event: 'ready', guards: { 'task-dependencies-closed': true } }));
  appendEvent(file, journalEvent({ seq: 3, node: 'landing', event: 'landed', guards: { 'l0-green': true }, commit: 'abc1234' }));
  // Обрыв ровно здесь: процесс упал сразу после посадки, ничего дописать не успел.
  fs.appendFileSync(file, '{"v":"elt-journal/v1","runId":"run-1","seq":4');

  const read = readEvents(file);
  assert.equal(read.truncatedTail, true, 'crash-хвост обязан быть виден, а не проглочен');
  const derived = deriveState({ graph: GRAPH, events: read.events, runId: 'run-1' });
  assert.equal(derived.state.node, 'mirror', 'после падения прогон возобновляется на зеркале');
  assert.deepEqual(derived.rejected, [], 'ни одно валидное событие не отвергнуто');

  // И журнал продолжает принимать записи: одно падение не закрывает его навсегда.
  const after = appendEvent(file, journalEvent({ seq: 4, node: 'mirror', event: 'mirror-terminal', guards: { 'batch-head-immutable': true } }));
  assert.equal(after.ok, true);
  assert.equal(after.recoveredTail, true);
}

// Ремонт — новое поколение ТОГО ЖЕ батча, а не второй батч. Иначе карантин обходится
// переименованием.
function testRepairIncrementsGenerationOfSameBatch() {
  const s = walk(initialState(GRAPH, { runId: 'run-conformance' }), [
    ['known-zone', { 'familiar-zone': true, 'scope-within-limit': true }],
    ['ready', { 'task-dependencies-closed': true }],
    ['landed', { 'l0-green': true }],
  ]);
  assert.equal(s.generation, 1);
  const red = advance(s, 'mirror-red', envelope(s));
  assert.equal(red.ok, true);
  assert.equal(red.state.node, 'build', 'красное зеркало возвращает в сборку');
  assert.equal(red.state.generation, 2, 'ремонт — это следующее поколение');
}

// Терминальные отказы не превращаются в зелёное: после публикации любой шаг незаконен.
function testTerminalStateRefusesEverything() {
  const s = walk(initialState(GRAPH, { runId: 'run-conformance' }), [
    ['known-zone', { 'familiar-zone': true, 'scope-within-limit': true }],
    ['ready', { 'task-dependencies-closed': true }],
    ['landed', { 'l0-green': true }],
    ['mirror-terminal', { 'batch-head-immutable': true }],
    ['ledger-only', { 'oracle-green': true, 'review-terminal': true, 'hashes-match': true }],
    ['publish-requested', { 'certificate-fresh': true }],
  ]);
  for (const event of ['known-zone', 'ready', 'landed', 'publish-requested']) {
    const r = advance(s, event, envelope(s, { guards: { 'familiar-zone': true, 'scope-within-limit': true, 'task-dependencies-closed': true, 'l0-green': true, 'certificate-fresh': true } }));
    assert.equal(r.ok, false, `${event} после терминала обязан быть отвергнут`);
    assert.equal(r.reason, 'terminal-state');
  }
}

// ── 4. Identity: один T-номер в разных спеках — разные задачи ────────────────────────────
function testSameTaskIdInDifferentSpecsIsNotTheSameTask() {
  const text = '- [ ] **T005** первая\n- [ ] **T020** вторая\n';
  const a = taskIdentities(text, 'specs/019-a/tasks.md');
  const b = taskIdentities(text, 'specs/020-b/tasks.md');
  assert.equal(a[0].id, b[0].id, 'номера совпадают — и это ровно источник коллизии');
  assert.notEqual(a[0].specPath, b[0].specPath);
  assert.notDeepEqual(a[0], b[0], 'identity задачи включает спеку, иначе T005 закроет чужой T005');
}

// Смена схемы подписи делает старый digest недействительным — это заявленное поведение, и
// оно обязано быть проверяемым, а не подразумеваемым.
function testApprovalDigestIsStableAcrossPlatformsAndSensitiveToText() {
  const entries = [
    { role: 'spec', path: 'specs/020-x/spec.md', text: '# спека\r\nтекст\r\n' },
    { role: 'tasks', path: 'specs/020-x/tasks.md', text: '- [X] **T001** задача\r\n' },
  ];
  const lf = [
    { role: 'spec', path: 'specs/020-x/spec.md', text: '# спека\nтекст\n' },
    { role: 'tasks', path: 'specs/020-x/tasks.md', text: '- [ ] **T001** задача\n' },
  ];
  assert.equal(approvalDigestFromTexts(entries).digest, approvalDigestFromTexts(lf).digest,
    'CRLF и маркер исполнения не влияют: подпись про намерение, а не про статус');

  const changed = [lf[0], { role: 'tasks', path: 'specs/020-x/tasks.md', text: '- [ ] **T001** ДРУГАЯ задача\n' }];
  assert.notEqual(approvalDigestFromTexts(lf).digest, approvalDigestFromTexts(changed).digest,
    'смена текста задачи обязана делать подпись недействительной');
}

// ── 5. Authority: ни один pack не забирает власть ядра ──────────────────────────────────
function testExternalPackCannotOwnAuthorityCapabilities() {
  for (const capability of AUTHORITY_CAPABILITIES) {
    const graph = loadCanonicalGraph();
    graph.nodes = graph.nodes.concat([{
      id: 'grail/steal', kind: 'action', consumes: [], produces: [],
      guards: [], capabilities: [capability], sideEffects: ['git', 'network'],
      trust: 'unreviewed', platforms: ['win32', 'linux', 'darwin'], timeoutMs: 1000, failure: 'block',
    }]);
    const r = compile(graph);
    assert.equal(r.ok, false, `внешний pack не имеет права владеть ${capability}`);
  }
}

// `skip`/`degrade` на авторитетной способности — это тихое превращение красного в зелёное.
function testAuthorityNodeCannotSkipOrDegrade() {
  for (const failure of ['skip', 'degrade']) {
    const graph = loadCanonicalGraph();
    const target = graph.nodes.find((n) => (n.capabilities || []).includes('oracle'))
      || graph.nodes.find((n) => n.id === 'mirror');
    assert.ok(target, 'в графе обязан быть узел с авторитетной способностью');
    target.failure = failure;
    const r = compile(graph);
    assert.equal(r.ok, false, `failure:${failure} на авторитетном узле обязан быть отвергнут компилятором`);
  }
}

// ── 6. Cutover: неоднозначность легаси-эпохи блокирует, ничего не удаляя ────────────────
function testMigrationAmbiguityBlocksCutoverWithoutDeleting() {
  const tasksText = '- [X] **T001** закрытая\n- [ ] **T002** открытая\n';
  const snap = migrationSnapshot({
    specPath: SPEC,
    tasksText,
    runLogEntries: [],
    reviewRows: [],
    approval: { digest: 'digest-1', signedDigests: [] },
  });
  assert.equal(snap.cutoverBlocked, true);
  assert.ok(snap.ambiguities.some((a) => a.code === 'closed-without-commit'),
    'галочка без коммита — это состояние, которое нечем подтвердить');
  assert.ok(snap.ambiguities.some((a) => a.code === 'approval-schema-not-signed'));
  assert.equal(snap.rows.length, 2, 'снимок ничего не удаляет — обе задачи в отчёте');
}

function testCleanSnapshotAllowsCutover() {
  const tasksText = '- [X] **T001** закрытая\n';
  const snap = migrationSnapshot({
    specPath: SPEC,
    tasksText,
    runLogEntries: [{
      task: 'T001', commit: 'abc1234', treeHash: 'tree-1',
      batch: { specPath: SPEC, taskIdentities: [{ specPath: SPEC, id: 'T001', index: 0 }] },
      background: { outcome: 'pass' },
    }],
    reviewRows: [],
    approval: { digest: 'digest-1', signedDigests: ['digest-1'] },
  });
  assert.deepEqual(snap.ambiguities, [], `чистый снимок не имеет неоднозначностей: ${JSON.stringify(snap.ambiguities)}`);
  assert.equal(snap.cutoverBlocked, false);
}

function main() {
  try {
    testHappyPathReachesPublish();
    testIllegalEdgesAreRefusedUniformly();
    testPlanCannotBeSkipped();
    testStaleApprovalBlocksBuild();
    testDuplicateAndReplayAreIdempotent();
    testCrashAfterLandingResumesAtMirror();
    testRepairIncrementsGenerationOfSameBatch();
    testTerminalStateRefusesEverything();
    testSameTaskIdInDifferentSpecsIsNotTheSameTask();
    testApprovalDigestIsStableAcrossPlatformsAndSensitiveToText();
    testExternalPackCannotOwnAuthorityCapabilities();
    testAuthorityNodeCannotSkipOrDegrade();
    testMigrationAmbiguityBlocksCutoverWithoutDeleting();
    testCleanSnapshotAllowsCutover();
  } finally {
    cleanup();
  }
  process.stdout.write('graph conformance tests: PASS\n');
}

main();
