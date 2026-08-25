'use strict';
// 020 T014 — регресс append-only журнала.
//
// Все проверки идут по НАСТОЯЩЕМУ файлу во временном каталоге: журнал — это про атомарность
// записи, замок и оборванный хвост после падения, и на моках ни одно из этого не проверяется.

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  JOURNAL_SCHEMA, appendEvent, defaultJournalPath, eventsForRun, readEvents, validateEvent,
} = require('./graph-journal');

let tmpRoot = null;
function tmpJournal() {
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-journal-'));
  return path.join(fs.mkdtempSync(path.join(tmpRoot, 'j-')), 'graph-journal.jsonl');
}
function cleanup() {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
}

function event(over = {}) {
  return {
    v: JOURNAL_SCHEMA,
    runId: 'run-1',
    graphVersion: '5.0.0',
    lockDigest: 'lock-1',
    specPath: 'specs/020-x/tasks.md',
    taskIdentities: [{ specPath: 'specs/020-x/tasks.md', id: 'T014', index: 0 }],
    batchId: 'batch-1',
    generation: 1,
    node: 'recon',
    event: 'unknown-zone',
    guards: {},
    commit: null,
    treeHash: null,
    seq: 1,
    ts: '2026-08-25T10:00:00.000Z',
    terminal: false,
    ...over,
  };
}

function testValidateRejectsIncompleteEvent() {
  assert.deepEqual(validateEvent(event()), []);
  assert.ok(validateEvent({ ...event(), runId: '' }).some((e) => e.includes('runId')));
  assert.ok(validateEvent({ ...event(), seq: 0 }).some((e) => e.includes('seq')));
  assert.ok(validateEvent({ ...event(), generation: 0 }).some((e) => e.includes('generation')));
  assert.ok(validateEvent({ ...event(), taskIdentities: [] }).some((e) => e.includes('taskIdentities')));
  assert.ok(validateEvent({ ...event(), v: 'elt-journal/v2' }).some((e) => e.includes('unknown schema')));
  assert.ok(validateEvent({ ...event(), guards: [] }).some((e) => e.includes('guards')));
}

function testAppendAndRead() {
  const file = tmpJournal();
  assert.equal(appendEvent(file, event()).appended, true);
  assert.equal(appendEvent(file, event({ seq: 2, node: 'plan', event: 'approved' })).appended, true);
  const { events, truncatedTail, corrupt } = readEvents(file);
  assert.equal(events.length, 2);
  assert.equal(truncatedTail, false);
  assert.deepEqual(corrupt, []);
  assert.deepEqual(events.map((e) => e.seq), [1, 2]);
  assert.equal(events[0].v, JOURNAL_SCHEMA, 'версия схемы проставляется журналом, а не вызывающим');
}

// Идемпотентность: тот же (runId, seq) второй раз — не вторая строка. Это ровно случай
// повторного хука и resume после compact.
function testDuplicateEventIsNoOp() {
  const file = tmpJournal();
  appendEvent(file, event());
  const second = appendEvent(file, event());
  assert.equal(second.ok, true);
  assert.equal(second.appended, false);
  assert.equal(second.reason, 'duplicate');
  assert.equal(readEvents(file).events.length, 1);
}

function testNonMonotonicSeqIsRefused() {
  const file = tmpJournal();
  appendEvent(file, event({ seq: 5 }));
  const back = appendEvent(file, event({ seq: 4 }));
  assert.equal(back.ok, false);
  assert.equal(back.reason, 'non-monotonic-seq');
  assert.equal(readEvents(file).events.length, 1, 'отказ не пишет строку');
}

// Ровно один terminal на (runId, batchId, generation): второй означал бы, что одно и то же
// поколение батча завершилось дважды — а именно на этом строится сертификат.
function testSecondTerminalInSameGenerationIsRefused() {
  const file = tmpJournal();
  appendEvent(file, event({ seq: 1, terminal: true, node: 'publish' }));
  const again = appendEvent(file, event({ seq: 2, terminal: true, node: 'publish' }));
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'terminal-exists');

  // Следующее ПОКОЛЕНИЕ того же батча терминал получить обязано — иначе repair невозможен.
  const nextGen = appendEvent(file, event({ seq: 3, generation: 2, terminal: true, node: 'publish' }));
  assert.equal(nextGen.ok, true);
  assert.equal(nextGen.appended, true);

  // И другой прогон тоже: ограничение действует внутри runId, а не глобально.
  const otherRun = appendEvent(file, event({ runId: 'run-2', seq: 1, terminal: true, node: 'publish' }));
  assert.equal(otherRun.appended, true);
}

// Обрыв процесса на середине строки: чтение обязано отличать crash-хвост от порчи в
// середине и не «чинить» журнал молча.
function testTruncatedTailIsDetectedNotSwallowed() {
  const file = tmpJournal();
  appendEvent(file, event());
  fs.appendFileSync(file, '{"v":"elt-journal/v1","runId":"run-1","seq":2');
  const read = readEvents(file);
  assert.equal(read.events.length, 1);
  assert.equal(read.truncatedTail, true, 'оборванный хвост обязан быть виден вызывающему');
}

// Регресс на реальный failure-mode «падение → следующая попытка записи»: одного обрыва
// достаточно, чтобы журнал закрылся на запись НАВСЕГДА, если хвост не усечь перед append.
function testAppendRecoversAfterCrashTail() {
  const file = tmpJournal();
  appendEvent(file, event());
  fs.appendFileSync(file, '{"v":"elt-journal/v1","runId":"run-1","seq":2');
  const after = appendEvent(file, event({ seq: 2, node: 'plan', event: 'approved' }));
  assert.equal(after.ok, true, 'обрыв процесса не имеет права закрыть журнал на запись');
  assert.equal(after.appended, true);
  assert.equal(after.recoveredTail, true, 'усечение crash-хвоста обязано быть видимым, а не молчаливым');
  const read = readEvents(file);
  assert.deepEqual(read.corrupt, [], 'слепленной строки не осталось');
  assert.equal(read.truncatedTail, false);
  assert.deepEqual(read.events.map((e) => e.seq), [1, 2]);
  // Третья запись доказывает, что журнал не «принял один раз и умер».
  assert.equal(appendEvent(file, event({ seq: 3, node: 'build', event: 'ready' })).appended, true);
  assert.equal(readEvents(file).events.length, 3);
}

function testCorruptMiddleLineBlocksAppend() {
  const file = tmpJournal();
  appendEvent(file, event());
  fs.appendFileSync(file, 'не-json\n');
  const result = appendEvent(file, event({ seq: 2 }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'journal-corrupt', 'правленый журнал не дописывается молча');
}

// Append-only на деле: после серии записей ни одна прежняя строка не изменилась.
function testJournalIsAppendOnly() {
  const file = tmpJournal();
  appendEvent(file, event());
  const afterFirst = fs.readFileSync(file, 'utf8');
  appendEvent(file, event({ seq: 2, node: 'plan', event: 'approved' }));
  appendEvent(file, event({ seq: 3, node: 'build', event: 'ready' }));
  const full = fs.readFileSync(file, 'utf8');
  assert.ok(full.startsWith(afterFirst), 'прежние строки обязаны остаться байт в байт');
}

// Осиротевший замок убитого процесса не должен останавливать харнес навсегда: TaskStop не
// убивает цепочку powershell→node, и такие артефакты здесь — норма.
function testStaleLockIsBrokenAfterTimeout() {
  const file = tmpJournal();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lockPath = `${file}.lock`;
  fs.mkdirSync(lockPath);
  const old = Date.now() - 120000;
  fs.utimesSync(lockPath, new Date(old), new Date(old));
  const result = appendEvent(file, event());
  assert.equal(result.ok, true, 'протухший замок обязан сниматься');
  assert.equal(fs.existsSync(lockPath), false, 'после записи замок снят');
}

function testFreshLockBlocksWithTimeout() {
  const file = tmpJournal();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lockPath = `${file}.lock`;
  fs.mkdirSync(lockPath);
  try {
    const started = Date.now();
    const result = appendEvent(file, event());
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'lock-timeout');
    assert.ok(Date.now() - started >= 1000, 'замок держится ожиданием, а не мгновенным отказом');
  } finally {
    fs.rmdirSync(lockPath);
  }
}

// Два процесса пишут в один журнал одновременно: ни одна строка не должна порваться и ни
// одна запись — потеряться. Это и есть тот случай, ради которого замок вообще существует.
async function testConcurrentWritersDoNotTearLines() {
  const file = tmpJournal();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const script = path.join(path.dirname(file), 'writer.js');
  fs.writeFileSync(script, [
    "const { appendEvent } = require(" + JSON.stringify(path.join(__dirname, 'graph-journal.js')) + ');',
    'const [file, runId, from] = process.argv.slice(2);',
    'for (let i = 0; i < 10; i += 1) {',
    '  appendEvent(file, {',
    "    v: 'elt-journal/v1', runId, graphVersion: '5.0.0', lockDigest: 'lock-1',",
    "    specPath: 'specs/020-x/tasks.md',",
    "    taskIdentities: [{ specPath: 'specs/020-x/tasks.md', id: 'T014', index: 0 }],",
    "    batchId: 'batch-1', generation: 1, node: 'recon', event: 'unknown-zone',",
    "    guards: {}, seq: Number(from) + i, ts: new Date().toISOString(), terminal: false,",
    '  });',
    '}',
  ].join('\n'), 'utf8');

  // Процессы стартуют ОДНОВРЕМЕННО: последовательный запуск замок не проверяет вовсе.
  const runs = ['a', 'b', 'c'].map((tag) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, file, `run-${tag}`, '1'], { stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(code) : reject(new Error(`writer ${tag} exited ${code}`))));
  }));
  await Promise.all(runs);
  const read = readEvents(file);
  assert.deepEqual(read.corrupt, [], 'ни одна строка не порвана');
  assert.equal(read.truncatedTail, false);
  assert.equal(read.events.length, 30, 'все три серии записей на месте');
  assert.equal(eventsForRun(file, 'run-a').length, 10);
  assert.deepEqual(eventsForRun(file, 'run-b').map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
}

// Журнал один на репозиторий: worktree с `.git`-файлом обязан указывать на тот же каталог,
// иначе фоновая ветка и основное дерево разойдутся в истории прогонов.
function testJournalPathFollowsWorktreePointer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-wt-'));
  try {
    const realGit = path.join(root, 'main', '.git');
    fs.mkdirSync(realGit, { recursive: true });
    const wt = path.join(root, 'wt');
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${realGit.split(path.sep).join('/')}\n`, 'utf8');
    assert.equal(defaultJournalPath(wt), path.join(realGit, 'elt', 'graph-journal.jsonl'));
    assert.equal(defaultJournalPath(path.join(root, 'main')), path.join(realGit, 'elt', 'graph-journal.jsonl'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  try {
    testValidateRejectsIncompleteEvent();
    testAppendAndRead();
    testDuplicateEventIsNoOp();
    testNonMonotonicSeqIsRefused();
    testSecondTerminalInSameGenerationIsRefused();
    testTruncatedTailIsDetectedNotSwallowed();
    testAppendRecoversAfterCrashTail();
    testCorruptMiddleLineBlocksAppend();
    testJournalIsAppendOnly();
    testStaleLockIsBrokenAfterTimeout();
    testFreshLockBlocksWithTimeout();
    await testConcurrentWritersDoNotTearLines();
    testJournalPathFollowsWorktreePointer();
  } finally {
    cleanup();
  }
  process.stdout.write('graph journal tests: PASS\n');
}

main().catch((error) => { process.stderr.write(`${error.stack || error}
`); process.exit(1); });
