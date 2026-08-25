'use strict';
// Regression tests for the versioned benchmark contour (spec 021 T002). No test here
// spawns a real agent — execAgent is always injected — so this suite is free to run
// inside the mechanical oracle on every commit, unlike an actual benchmark pair.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runner = require('./runner.js');
const datasetLib = require('./build-gate-dataset.js');
const summarizeLib = require('./summarize.js');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// --- sha256 / seededShuffle / wilsonInterval / classifyFailure ---

test('sha256: deterministic', () => {
  assert.equal(runner.sha256('abc'), runner.sha256('abc'));
  assert.notEqual(runner.sha256('abc'), runner.sha256('abd'));
});

test('seededShuffle: same seed -> same order, preserves multiset', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f'];
  const s1 = runner.seededShuffle(items, 'seed-x');
  const s2 = runner.seededShuffle(items, 'seed-x');
  assert.deepEqual(s1, s2);
  assert.deepEqual([...s1].sort(), [...items].sort());
});

test('seededShuffle: different seed -> different order (for this fixture)', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const s1 = runner.seededShuffle(items, 'seed-x');
  const s2 = runner.seededShuffle(items, 'seed-y');
  assert.notDeepEqual(s1, s2);
});

test('wilsonInterval: n=0 returns full [0,1]', () => {
  const ci = runner.wilsonInterval(0, 0);
  assert.equal(ci.lo, 0);
  assert.equal(ci.hi, 1);
});

test('wilsonInterval: 3/3 gives a lower bound well above 0', () => {
  const ci = runner.wilsonInterval(3, 3);
  assert.ok(ci.lo > 0.4, `lo=${ci.lo} expected >0.4 (small-n honesty, not a false 100%)`);
  assert.equal(ci.hi, 1);
});

test('classifyFailure: transport vs content', () => {
  assert.equal(runner.classifyFailure('Error: timeout waiting for response'), 'transport');
  assert.equal(runner.classifyFailure('spawn agy ENOENT'), 'transport');
  assert.equal(runner.classifyFailure('grader reported 3 failed tests'), 'content');
  assert.equal(runner.classifyFailure(undefined), 'content');
});

// --- append-only log ---

test('appendResultRow/readResultRows: round-trips and never overwrites prior lines', () => {
  const dir = tmpDir('elt-bench-log-');
  const logPath = path.join(dir, 'raw.jsonl');
  runner.appendResultRow(logPath, { id: 'a', hand: 'plain', outcome: 'pass' });
  runner.appendResultRow(logPath, { id: 'b', hand: 'plain', outcome: 'fail' });
  const rows = runner.readResultRows(logPath);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[1].id, 'b');
});

test('pendingItems: terminal outcomes are skipped, transport-failure is not', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const rows = [
    { id: 'a', hand: 'plain', outcome: 'pass' },
    { id: 'b', hand: 'plain', outcome: 'transport-failure' },
  ];
  const pending = runner.pendingItems(items, 'plain', rows);
  assert.deepEqual(pending.map((i) => i.id), ['b', 'c']);
});

// --- runOneTask ---

function fakeItem(id, { guardPath = null } = {}) {
  return {
    id,
    guardPath,
    materialize(workDir) {
      fs.mkdirSync(workDir, { recursive: true });
      if (guardPath) fs.writeFileSync(path.join(workDir, guardPath), 'ORIGINAL TEST CONTENT', 'utf8');
    },
    prompt() {
      return `solve ${id}`;
    },
  };
}

test('runOneTask: guard file tampered by the agent -> outcome invalid', async () => {
  const workRoot = tmpDir('elt-bench-work-');
  const item = fakeItem('t1', { guardPath: 'test.py' });
  const execAgent = async ({ cwd }) => {
    fs.writeFileSync(path.join(cwd, 'test.py'), 'TAMPERED', 'utf8'); // agent edited the guard
    return { ok: true, reason: null };
  };
  const grade = async () => ({ pass: true });
  const result = await runner.runOneTask({ item, hand: 'elt', workRoot, execAgent, grade });
  assert.equal(result.outcome, 'invalid');
  assert.equal(result.reason, 'guard-tampered');
});

test('runOneTask: transport failure is retried up to retryMax then reported', async () => {
  const workRoot = tmpDir('elt-bench-work-');
  const item = fakeItem('t2');
  let calls = 0;
  const execAgent = async () => {
    calls += 1;
    return { ok: false, reason: 'Error: timeout waiting for response' };
  };
  const grade = async () => ({ pass: false });
  const result = await runner.runOneTask({ item, hand: 'plain', workRoot, execAgent, grade, retryMax: 2 });
  assert.equal(result.outcome, 'transport-failure');
  assert.equal(calls, 3); // 1 initial + 2 retries
});

test('runOneTask: content failure is NOT retried (equal-budget contract)', async () => {
  const workRoot = tmpDir('elt-bench-work-');
  const item = fakeItem('t3');
  let calls = 0;
  const execAgent = async () => {
    calls += 1;
    return { ok: false, reason: 'CLI printed a malformed answer' };
  };
  const grade = async () => ({ pass: false });
  const result = await runner.runOneTask({ item, hand: 'plain', workRoot, execAgent, grade, retryMax: 2 });
  assert.equal(result.outcome, 'agent-error');
  assert.equal(calls, 1);
});

test('runOneTask: agent ok + grader fail -> outcome fail, no tamper false-positive', async () => {
  const workRoot = tmpDir('elt-bench-work-');
  const item = fakeItem('t4', { guardPath: 'test.py' });
  const execAgent = async () => ({ ok: true, reason: null });
  const grade = async () => ({ pass: false, detail: '2 failed' });
  const result = await runner.runOneTask({ item, hand: 'elt', workRoot, execAgent, grade });
  assert.equal(result.outcome, 'fail');
  assert.equal(result.graderDetail, '2 failed');
});

// --- graders (real pytest, not mocked — the grader is not part of ELT) ---

test('gradePolyglotWriter: real pytest pass/fail, not mocked', async () => {
  const dir = tmpDir('elt-bench-grade-');
  fs.writeFileSync(path.join(dir, 'sol.py'), 'def add(a, b):\n    return a + b\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'sol_test.py'), 'from sol import add\ndef test_add():\n    assert add(2, 3) == 5\n', 'utf8');
  const passResult = await runner.gradePolyglotWriter({ workDir: dir, item: { guardPath: 'sol_test.py' } });
  assert.equal(passResult.pass, true);

  fs.writeFileSync(path.join(dir, 'sol.py'), 'def add(a, b):\n    return a - b\n', 'utf8'); // now wrong
  const failResult = await runner.gradePolyglotWriter({ workDir: dir, item: { guardPath: 'sol_test.py' } });
  assert.equal(failResult.pass, false);
  assert.ok(failResult.detail.length > 0);
});

test('graderFor: swebench-gate throws a clear not-implemented error instead of faking a verdict', async () => {
  const grade = runner.graderFor('swebench-gate');
  await assert.rejects(() => grade({ hand: 'bare-gold' }), /не реализован/);
  await assert.rejects(() => grade({ hand: 'judgeDiff-gold' }), /не реализован/);
});

test('itemFromDatasetRow: writer prompt is byte-identical across hands (no per-hand contamination)', () => {
  const row = { id: 'x', file: 'x.py', testFile: 'x_test.py', stub: 's', test: 't' };
  const item = runner.itemFromDatasetRow(row, 'polyglot-writer');
  assert.equal(item.prompt('plain'), item.prompt('elt'));
});

test('itemFromDatasetRow: swebench-gate materialize rejects an unknown hand loudly', () => {
  const row = { id: 'x', repo: 'r', baseCommit: 'c', goldPatch: 'g', brokenPatch: 'b' };
  const item = runner.itemFromDatasetRow(row, 'swebench-gate');
  const dir = tmpDir('elt-bench-gate-materialize-');
  assert.throws(() => item.materialize(dir, 'not-a-real-hand'), /unknown hand/);
});

// --- hash-lock enforcement ---

test('verifyRunnerHash: ok=true when preregistration matches the real file on disk', () => {
  const realHash = runner.sha256(fs.readFileSync(path.join(__dirname, 'runner.js'), 'utf8'));
  const dir = tmpDir('elt-bench-hashlock-');
  const preregPath = path.join(dir, 'preregistration.json');
  fs.writeFileSync(preregPath, JSON.stringify({ runner: { sha256: realHash } }), 'utf8');
  const result = runner.verifyRunnerHash(preregPath);
  assert.equal(result.ok, true);
});

test('verifyRunnerHash: ok=false and reports both hashes on mismatch', () => {
  const dir = tmpDir('elt-bench-hashlock-');
  const preregPath = path.join(dir, 'preregistration.json');
  fs.writeFileSync(preregPath, JSON.stringify({ runner: { sha256: 'deadbeef' } }), 'utf8');
  const result = runner.verifyRunnerHash(preregPath);
  assert.equal(result.ok, false);
  assert.equal(result.expected, 'deadbeef');
  assert.notEqual(result.actual, 'deadbeef');
});

// --- build-gate-dataset: polyglot-writer ---

function makePolyglotFixture(root) {
  const practice = path.join(root, 'python', 'exercises', 'practice');
  for (const id of ['alpha', 'beta', 'gamma', 'delta']) {
    const dir = path.join(practice, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.py`), `def solve(): pass  # ${id}`, 'utf8');
    fs.writeFileSync(path.join(dir, `${id}_test.py`), `def test_${id}(): assert solve() is None`, 'utf8');
  }
  // one incomplete task (no test file) must be skipped, not counted
  fs.mkdirSync(path.join(practice, 'incomplete'), { recursive: true });
  fs.writeFileSync(path.join(practice, 'incomplete', 'incomplete.py'), 'x', 'utf8');
  return root;
}

test('selectPolyglotTasks: deterministic, skips incomplete tasks, sorted output', () => {
  const root = tmpDir('elt-bench-polyglot-');
  makePolyglotFixture(root);
  const a = datasetLib.selectPolyglotTasks({ repoDir: root, lang: 'python', ext: 'py', count: 4, seed: 'seed-1' });
  const b = datasetLib.selectPolyglotTasks({ repoDir: root, lang: 'python', ext: 'py', count: 4, seed: 'seed-1' });
  assert.deepEqual(a.map((t) => t.id), b.map((t) => t.id));
  assert.deepEqual(a.map((t) => t.id), ['alpha', 'beta', 'delta', 'gamma']); // sorted
  assert.ok(!a.some((t) => t.id === 'incomplete'));
  assert.equal(a[0].stubSha256, runner.sha256(a[0].stub));
});

test('selectPolyglotTasks: throws loudly instead of shrinking when count exceeds eligible', () => {
  const root = tmpDir('elt-bench-polyglot-');
  makePolyglotFixture(root);
  assert.throws(() => datasetLib.selectPolyglotTasks({ repoDir: root, lang: 'python', ext: 'py', count: 10, seed: 's' }));
});

// --- build-gate-dataset: swebench-gate ---

test('stripLastHunk: drops the last hunk of the last file section', () => {
  const patch = [
    'diff --git a/x.py b/x.py',
    '@@ -1,2 +1,2 @@',
    '-old1',
    '+new1',
    '@@ -10,2 +10,2 @@',
    '-old2',
    '+new2',
    '',
  ].join('\n');
  const stripped = datasetLib.stripLastHunk(patch);
  assert.ok(stripped.includes('@@ -1,2 +1,2 @@'));
  assert.ok(!stripped.includes('@@ -10,2 +10,2 @@'), 'last hunk must be gone');
  assert.ok(!stripped.includes('new2'));
});

test('stripLastHunk: single-hunk patch drops the whole file section (never a no-op)', () => {
  const patch = ['diff --git a/x.py b/x.py', '@@ -1,1 +1,1 @@', '-old', '+new', ''].join('\n');
  const stripped = datasetLib.stripLastHunk(patch);
  assert.notEqual(stripped.trim(), patch.trim());
  assert.ok(!stripped.includes('@@'));
});

test('selectSweBenchInstances: balances across repos, deterministic, produces broken patch', () => {
  const goldPatch = ['diff --git a/x.py b/x.py', '@@ -1,1 +1,1 @@', '-old', '+new', ''].join('\n');
  const instances = [];
  for (let i = 0; i < 3; i++) instances.push({ instance_id: `r1-${i}`, repo: 'repoA', base_commit: 'c1', patch: goldPatch });
  for (let i = 0; i < 1; i++) instances.push({ instance_id: `r2-${i}`, repo: 'repoB', base_commit: 'c2', patch: goldPatch });
  const picked = datasetLib.selectSweBenchInstances({ instances, count: 2, seed: 'seed-2' });
  const repos = new Set(picked.map((p) => p.repo));
  assert.equal(picked.length, 2);
  assert.equal(repos.size, 2, 'round-robin balancing should draw from both repos before a second from either');
  for (const p of picked) {
    assert.notEqual(p.brokenPatch, p.goldPatch);
    assert.equal(p.goldPatchSha256, runner.sha256(p.goldPatch));
  }
});

// --- summarize ---

test('summarize: claimEligible false when a hand is incomplete', () => {
  const dataset = { kind: 'polyglot-writer', datasetSha256: 'x', items: [{ id: 'a' }, { id: 'b' }] };
  const rows = [
    { id: 'a', hand: 'plain', outcome: 'pass' },
    { id: 'b', hand: 'plain', outcome: 'pass' },
    { id: 'a', hand: 'elt', outcome: 'pass' },
    // 'b' under elt never ran -> incomplete
  ];
  const summary = summarizeLib.summarize({ dataset, rows, hands: ['plain', 'elt'] });
  assert.equal(summary.claimEligible, false);
});

test('summarize: claimEligible true and pass rate correct when both hands complete', () => {
  const dataset = { kind: 'polyglot-writer', datasetSha256: 'x', items: [{ id: 'a' }, { id: 'b' }] };
  const rows = [
    { id: 'a', hand: 'plain', outcome: 'pass' },
    { id: 'b', hand: 'plain', outcome: 'fail' },
    { id: 'a', hand: 'elt', outcome: 'pass' },
    { id: 'b', hand: 'elt', outcome: 'pass' },
  ];
  const summary = summarizeLib.summarize({ dataset, rows, hands: ['plain', 'elt'] });
  assert.equal(summary.claimEligible, true);
  const plain = summary.hands.find((h) => h.hand === 'plain');
  const elt = summary.hands.find((h) => h.hand === 'elt');
  assert.equal(plain.passRate, 0.5);
  assert.equal(elt.passRate, 1);
});

test('summarize: invalid rows are excluded from pass rate but reported', () => {
  const dataset = { kind: 'polyglot-writer', datasetSha256: 'x', items: [{ id: 'a' }, { id: 'b' }] };
  const rows = [
    { id: 'a', hand: 'plain', outcome: 'pass' },
    { id: 'b', hand: 'plain', outcome: 'invalid' },
  ];
  const summary = summarizeLib.summarize({ dataset, rows, hands: ['plain'] });
  const plain = summary.hands[0];
  assert.equal(plain.graded, 1);
  assert.equal(plain.invalid, 1);
  assert.equal(plain.passRate, 1);
});

async function main() {
  console.log('gemini-3.7-flash-high/runner.test.js');
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  PASS: ${name}`);
      passed += 1;
    } catch (err) {
      console.log(`  FAIL: ${name}\n    ${err.message}`);
      failed += 1;
    }
  }
  console.log(`\nrunner.test.js: ${tests.length} tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
