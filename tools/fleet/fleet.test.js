'use strict';
// Интеграционный тест оркестратора (критерий приёмки №1 спеки): стабы, 2 воркера,
// 3 слайса, 1 искусственный merge-конфликт — все слайсы закрыты через gate+merge,
// конфликтный дожат serial. Воркер инжектится (пишет предопределённый файл), судья —
// FLEET_BIN_CLAUDE=pass-стаб, оракул проекта зелёный (node --version).
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fleet = require('./fleet');
const worktree = require('./worktree');
const claims = require('./claims');

let REPO, JUDGE_STUB;
const git = (args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const tasksPath = () => path.join(REPO, 'specs', 'tasks.md');

function seedRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-run-'));
  const g = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'base\n');
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  // T1,T2 оба пишут shared (конфликт при параллели); T3 — свой файл. Глобы disjoint →
  // nextBatch берёт всех; workers=2 → батч [T1,T2] → конфликт → requeue-serial.
  fs.writeFileSync(path.join(repo, 'specs', 'tasks.md'),
    '- [ ] **T1** пишет shared [P] [files:s1*]\n- [ ] **T2** пишет shared [P] [files:s2*]\n- [ ] **T3** пишет a [P] [files:a*]\n');
  fs.mkdirSync(path.join(repo, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'),
    JSON.stringify({ oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false }));
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);
  return repo;
}

// Инжектируемый воркер — детерминированная «работа» слайса.
const WORK = {
  T1: (wt) => fs.writeFileSync(path.join(wt, 'shared.txt'), 'from-T1\n'),
  T2: (wt) => fs.writeFileSync(path.join(wt, 'shared.txt'), 'from-T2\n'),
  T3: (wt) => fs.writeFileSync(path.join(wt, 'a.txt'), 'from-T3\n'),
};
const injectedWorker = async (slice, wtPath) => { WORK[slice.id](wtPath); };

before(() => {
  REPO = seedRepo();
  JUDGE_STUB = path.join(REPO, 'judge-pass.js');
  fs.writeFileSync(JUDGE_STUB, "console.log('{\"verdict\":\"pass\"}');");
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', JUDGE_STUB]);
});
after(() => {
  delete process.env.FLEET_BIN_CLAUDE;
  try { fs.rmSync(REPO, { recursive: true, force: true }); } catch { /* noop */ }
});

test('STOP-файл до старта → прогон не начинает батчи', async () => {
  const stop = path.join(REPO, '.harness', 'STOP');
  fs.writeFileSync(stop, '');
  const s = await fleet.run({ cwd: REPO, tasksPath: tasksPath(), integration: 'main', workers: 2, worker: injectedWorker });
  fs.rmSync(stop);
  assert.equal(s.stopped, true);
  assert.deepEqual(s.merged, []);
});

test('resume-sweep снимает stale-claim мёртвого воркера на старте', async () => {
  // засеять claim с заведомо мёртвым pid
  fs.mkdirSync(path.join(REPO, '.harness', 'fleet', 'claims'), { recursive: true });
  fs.writeFileSync(claims.claimPath(REPO, 'T1'), JSON.stringify({ tid: 'T1', pid: 2147480000, worker: 'ghost' }));
  const s = await fleet.run({ cwd: REPO, tasksPath: tasksPath(), integration: 'main', workers: 2, worker: injectedWorker });
  // прогон должен был перехватить T1 (stale снят) и закрыть всё
  assert.ok(s.merged.includes('T1'));
});

test('баг #8: застрявший слайс (оракул всегда красный) abandon после maxAttempts, не бесконечно', async () => {
  // свежий репо: 1 слайс, воркер ломает оракул (пустой diff → heal не поможет).
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-cap-'));
  const g = (a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'specs', 'tasks.md'), '- [ ] **T9** застрял [P] [files:z*]\n');
  fs.mkdirSync(path.join(repo, '.harness'), { recursive: true });
  // оракул всегда красный → healSlice исчерпает попытки → heal-failed каждый батч
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'),
    JSON.stringify({ oracle: 'exit 1', shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false }));
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);

  let calls = 0;
  const brokenWorker = async (_slice, wt) => { calls++; fs.writeFileSync(path.join(wt, 'z.txt'), 'x\n'); };
  const s = await fleet.run({ cwd: repo, tasksPath: path.join(repo, 'specs', 'tasks.md'),
    integration: 'main', workers: 1, worker: brokenWorker, maxAttempts: 3 });

  assert.deepEqual(s.merged, [], 'ничего не влито');
  assert.ok(s.abandoned.includes('T9'), 'T9 помечен abandoned');
  // ключевое: воркер вызван РОВНО maxAttempts раз (+ healSlice внутри), не maxLoops=100
  assert.equal(calls, 3, `воркер вызван ${calls} раз, ожидалось 3 (cap)`);
  const events = fs.readFileSync(path.join(repo, '.harness', 'fleet', 'events.jsonl'), 'utf8');
  assert.match(events, /"event":"batch-abandoned"/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('баг #9: ensureFleetIgnore прячет лог воркера от git (судья не видит его как scope creep)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-ignore-'));
  const g = (a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  g(['commit', '-q', '--allow-empty', '-m', 'base']);
  // воркер сделал слайс (out/x.txt) + providers.run написал свой лог в worktree
  fs.mkdirSync(path.join(repo, 'out'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'out', 'x.txt'), 'X\n');
  fs.mkdirSync(path.join(repo, '.harness', 'fleet', 'logs'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'fleet', 'logs', 'claude-1.log'), 'весь транскрипт воркера\n');

  const st = (r) => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: r, encoding: 'utf8' });
  assert.match(st(repo), /\.harness\/fleet\/logs\/claude-1\.log/, 'до фикса лог виден git (= судье)');

  fleet.ensureFleetIgnore(repo);
  const after = st(repo);
  assert.doesNotMatch(after, /logs\/claude-1\.log/, 'после фикса лог скрыт от судьи');
  assert.match(after, /out\/x\.txt/, 'слайс-файл по-прежнему виден');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('2 воркера, 3 слайса, 1 конфликт → все закрыты, конфликтный дожат serial', async () => {
  // (repo уже прогнан в resume-тесте — план закрыт; проверяем итог того прогона)
  const tasks = fs.readFileSync(tasksPath(), 'utf8');
  assert.match(tasks, /- \[X\] \*\*T1\*\*/);
  assert.match(tasks, /- \[X\] \*\*T2\*\*/);
  assert.match(tasks, /- \[X\] \*\*T3\*\*/);
  // конфликт был и дожат: T2 пробегал через requeue-serial (events)
  const events = fs.readFileSync(path.join(REPO, '.harness', 'fleet', 'events.jsonl'), 'utf8');
  assert.match(events, /"event":"merge-conflict"/);
  assert.match(events, /"event":"requeue-serial"/);
  assert.match(events, /"event":"redo-merged"/);
  // всё прибрано: ни worktree, ни claims не осталось
  assert.deepEqual(worktree.list({ cwd: REPO }), []);
  const claimsDir = path.join(REPO, '.harness', 'fleet', 'claims');
  const leftover = fs.existsSync(claimsDir) ? fs.readdirSync(claimsDir).filter((f) => f.endsWith('.json')) : [];
  assert.deepEqual(leftover, [], 'claims освобождены');
  // код влит на интеграционную
  git(['checkout', '-q', 'main']);
  assert.ok(fs.existsSync(path.join(REPO, 'a.txt')), 'файл T3 на main');
});

test('провайдер возвращает 429 → failover на следующего в цепочке', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-failover-'));
  const g = (a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'specs', 'tasks.md'), '- [ ] **T80** слайс [P] [S] [files:s*]\n');
  
  fs.mkdirSync(path.join(repo, '.harness', 'fleet'), { recursive: true });
  // fleet.json: для S цепочка: ['agy', 'claude']
  fs.writeFileSync(path.join(repo, '.harness', 'fleet', 'fleet.json'), JSON.stringify({
    policy: { S: ['agy', 'claude'] },
    cooldownSec: 60
  }));
  
  fs.mkdirSync(path.join(repo, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'),
    JSON.stringify({ oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false }));
  
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);

  // фейковый судья pass
  const judgeStub = path.join(repo, 'judge-pass.js');
  fs.writeFileSync(judgeStub, "console.log('{\"verdict\":\"pass\"}');");
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', judgeStub]);

  let calls = [];
  const mockWorker = async (slice, wt, ctx) => {
    calls.push(ctx.provider);
    if (ctx.provider === 'agy') {
      return { ok: false, lastMsg: 'Error 429: Too Many Requests' };
    }
    fs.writeFileSync(path.join(wt, 's.txt'), 'done\n');
    return { ok: true, stdout: 'done' };
  };

  const s = await fleet.run({
    cwd: repo,
    tasksPath: path.join(repo, 'specs', 'tasks.md'),
    integration: 'main',
    workers: 1,
    worker: mockWorker,
    maxLoops: 5
  });

  delete process.env.FLEET_BIN_CLAUDE;

  // agy вернул 429 → failover на claude → claude сделал слайс → merged
  assert.deepEqual(calls, ['agy', 'claude']);
  assert.deepEqual(s.merged, ['T80']);

  // Проверим ledger
  const runlog = fs.readFileSync(path.join(repo, '.harness', 'run-log.jsonl'), 'utf8');
  assert.match(runlog, /"provider":"agy".*"limitHit":true.*"verdict":"limit"/);
  assert.match(runlog, /"provider":"claude".*"limitHit":false.*"verdict":"pass"/);

  fs.rmSync(repo, { recursive: true, force: true });
});

// --- T020: hard caps до spawn ---
test('T020: cap=4 → 5-й spawn заблокирован, слайс terminal-failed, прогон стопает (nonzero-сигнал)', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-cap4-'));
  const g = (a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  // 3 слайса; happy-path даёт по 2 spawn'а (worker+judge) — 5-й spawn (worker T3) должен упереться в cap=4.
  fs.writeFileSync(path.join(repo, 'specs', 'tasks.md'),
    '- [ ] **T1** пишет 1 [P] [files:o1*]\n- [ ] **T2** пишет 2 [P] [files:o2*]\n- [ ] **T3** пишет 3 [P] [files:o3*]\n');
  fs.mkdirSync(path.join(repo, '.harness', 'fleet'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'fleet', 'fleet.json'), JSON.stringify({ caps: { maxCalls: 4 } }));
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'),
    JSON.stringify({ oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false }));
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);

  const judgeStub = path.join(repo, 'judge-pass.js');
  fs.writeFileSync(judgeStub, "console.log('{\"verdict\":\"pass\"}');");
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', judgeStub]);

  const workerCalls = [];
  const mockWorker = async (slice, wt) => {
    workerCalls.push(slice.id);
    fs.writeFileSync(path.join(wt, `${slice.id}.txt`), 'done\n');
    return { ok: true, stdout: 'done' };
  };

  const s = await fleet.run({
    cwd: repo, tasksPath: path.join(repo, 'specs', 'tasks.md'),
    integration: 'main', workers: 1, worker: mockWorker, maxLoops: 10,
  });
  delete process.env.FLEET_BIN_CLAUDE;

  assert.deepEqual(workerCalls, ['T1', 'T2'], 'T3-воркер вообще не спавнится — cap словлен до его spawn');
  assert.deepEqual(s.merged, ['T1', 'T2']);
  assert.ok(s.failed.includes('T3'), 'T3 помечен terminal-failed');
  assert.equal(s.stoppedReason, 'cap-exceeded');
  assert.equal(s.stopped, true);
  const events = fs.readFileSync(path.join(repo, '.harness', 'fleet', 'events.jsonl'), 'utf8');
  assert.match(events, /"event":"cap-exceeded".*"tid":"T3"/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('T020: все провайдеры цепочки в cooldown → стоп прогона (не fallback на остывающего)', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-allcool-'));
  const g = (a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'specs', 'tasks.md'), '- [ ] **T90** слайс [P] [S] [files:s*]\n');
  fs.mkdirSync(path.join(repo, '.harness', 'fleet'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'fleet', 'fleet.json'),
    JSON.stringify({ policy: { S: ['agy', 'codex'] }, cooldownSec: 300 }));
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'),
    JSON.stringify({ oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false }));
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);

  // и agy, и codex всегда возвращают 429 — оба провайдера в цепочке уходят в cooldown
  // за первые 2 итерации, на 3-й provFor(T90) отдаст null → прогон должен остановиться,
  // а НЕ упасть обратно на c[0] (agy), который тоже остыл.
  const providersSeen = [];
  const mockWorker = async (_slice, _wt, ctx) => {
    providersSeen.push(ctx.provider);
    return { ok: false, lastMsg: 'Error 429: Too Many Requests' };
  };

  const s = await fleet.run({
    cwd: repo, tasksPath: path.join(repo, 'specs', 'tasks.md'),
    integration: 'main', workers: 1, worker: mockWorker, maxLoops: 10,
  });

  assert.deepEqual(s.merged, []);
  assert.equal(s.stoppedReason, 'all-providers-cooling');
  assert.equal(s.stopped, true);
  assert.deepEqual([...new Set(providersSeen)].sort(), ['agy', 'codex'], 'оба провайдера реально пробованы, ни один не пропущен');
  const events = fs.readFileSync(path.join(repo, '.harness', 'fleet', 'events.jsonl'), 'utf8');
  assert.match(events, /"event":"all-providers-cooling"/);
  fs.rmSync(repo, { recursive: true, force: true });
});

// --- T021: персистентная state machine + crash-resume ---
function seedT021Repo(prefix) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const g = (a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'specs', 'tasks.md'), '- [ ] **T1** слайс [P] [files:a*]\n');
  fs.mkdirSync(path.join(repo, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'),
    JSON.stringify({ oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false }));
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);
  return repo;
}

test('T021: судья недоступен (краш/timeout) → слайс паркуется judge_pending, worktree/claim не тронуты', async () => {
  const repo = seedT021Repo('fleet-park-');
  const tasksPath = path.join(repo, 'specs', 'tasks.md');

  // судья "недоступен": процесс падает без валидного вывода — nonzero-exit, НЕ легитимный block.
  const crashStub = path.join(repo, 'judge-crash.js');
  fs.writeFileSync(crashStub, 'process.exit(1);');
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', crashStub]);

  let workerCalls = 0;
  const worker = async (_slice, wt) => { workerCalls++; fs.writeFileSync(path.join(wt, 'a.txt'), 'impl\n'); return { ok: true, stdout: 'done' }; };

  const s = await fleet.run({ cwd: repo, tasksPath, integration: 'main', workers: 1, worker, maxLoops: 3 });
  delete process.env.FLEET_BIN_CLAUDE;

  assert.equal(workerCalls, 1, 'воркер вызван ровно раз — реализация не переделывается из-за недоступного судьи');
  assert.deepEqual(s.merged, []);
  assert.deepEqual(s.failed, []);
  assert.ok(s.parked.includes('T1'), 'T1 припаркован, не failed');
  assert.deepEqual(worktree.list({ cwd: repo }).map((w) => w.tid), ['T1'], 'worktree сохранён (реализация не потеряна)');
  const claim = claims.list({ cwd: repo }).find((c) => c.tid === 'T1');
  assert.ok(claim, 'claim T1 не снят');
  assert.equal(claim.state, 'judge_pending');
  const tasks = fs.readFileSync(tasksPath, 'utf8');
  assert.match(tasks, /- \[ \] \*\*T1\*\*/, 'T1 не отмечен — merge не произошёл');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('T021: crash-resume дожимает judge_pending БЕЗ повторного вызова воркера (implementer не перезапущен)', async () => {
  const repo = seedT021Repo('fleet-resume-');
  const tasksPath = path.join(repo, 'specs', 'tasks.md');

  // симулируем «упавший на judge_pending прошлый процесс»: worktree с уже готовой (uncommitted)
  // реализацией + claim с мёртвым pid и state=judge_pending — БЕЗ прогона воркера в этом тесте.
  const wt = worktree.create('T1', { cwd: repo, base: 'main' });
  fs.writeFileSync(path.join(wt.path, 'a.txt'), 'impl-from-crashed-run\n');
  const DEAD_PID = 2147480000;
  claims.claim('T1', {
    cwd: repo, pid: DEAD_PID, worker: 'ghost',
    meta: { state: 'judge_pending', wtPath: wt.path, taskText: 'слайс', provider: 'claude' },
  });

  const passStub = path.join(repo, 'judge-pass.js');
  fs.writeFileSync(passStub, "console.log('{\"verdict\":\"pass\"}');");
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', passStub]);

  let workerCalls = 0;
  const worker = async () => { workerCalls++; throw new Error('воркер НЕ должен вызываться на resume'); };

  const s = await fleet.run({ cwd: repo, tasksPath, integration: 'main', workers: 1, worker, maxLoops: 3 });
  delete process.env.FLEET_BIN_CLAUDE;

  assert.equal(workerCalls, 0, 'implementer не перезапущен на resume');
  assert.deepEqual(s.merged, ['T1']);
  const tasks = fs.readFileSync(tasksPath, 'utf8');
  assert.match(tasks, /- \[X\] \*\*T1\*\*/, 'T1 закрыт через resume');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('T024: exitCodeFor — failed/abandoned тоже даёт nonzero, не только stoppedReason', () => {
  const base = { merged: [], failed: [], conflicts: [], requeued: [], abandoned: [], parked: [], stopped: false, stoppedReason: null };
  assert.equal(fleet.exitCodeFor(base), 0, 'всё чисто → 0');
  assert.equal(fleet.exitCodeFor({ ...base, stoppedReason: 'cap-exceeded' }), 1, 'T020: stoppedReason → 1');
  assert.equal(fleet.exitCodeFor({ ...base, failed: ['T3'] }), 1, 'T024: failed без stoppedReason → 1 (раньше было 0)');
  assert.equal(fleet.exitCodeFor({ ...base, abandoned: ['T9'] }), 1, 'T024: abandoned без stoppedReason → 1 (раньше было 0)');
});

test('T024: 1 abandoned слайс среди прочих → честный failed/exitCodeFor, интеграционный оракул реально вызван после merge', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-honesty-'));
  const g = (a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'specs', 'tasks.md'),
    '- [ ] **T1** здоровый [P] [files:a*]\n- [ ] **T9** застрял [P] [files:z*]\n');
  fs.mkdirSync(path.join(repo, '.harness'), { recursive: true });
  // оракул красный, если существует broken.flag — T9 сам его создаёт КАЖДЫЙ раз (не
  // унаследовать «случайно зелёный» оракул от merge'а T1 в интеграционную, в отличие
  // от позитивного маркера, которого мог бы не досоздать T9 на уже обновлённой main).
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'), JSON.stringify({
    oracle: process.platform === 'win32' ? "if (Test-Path 'broken.flag') { exit 1 }" : "test ! -f broken.flag",
    shell: process.platform === 'win32' ? 'powershell' : 'bash', branchPolicy: 'feature', push: false,
  }));
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);

  const judgeStub = path.join(repo, 'judge-pass.js');
  fs.writeFileSync(judgeStub, "console.log('{\"verdict\":\"pass\"}');");
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', judgeStub]);

  const mockWorker = async (slice, wt) => {
    if (slice.id === 'T1') {
      fs.writeFileSync(path.join(wt, 'a.txt'), 'A\n');
    } else {
      fs.writeFileSync(path.join(wt, 'z.txt'), 'z\n');
      fs.writeFileSync(path.join(wt, 'broken.flag'), 'x\n'); // оракул слайса всегда красный
    }
    return { ok: true, stdout: 'done' };
  };

  const s = await fleet.run({
    cwd: repo, tasksPath: path.join(repo, 'specs', 'tasks.md'),
    integration: 'main', workers: 2, worker: mockWorker, maxAttempts: 2,
  });
  delete process.env.FLEET_BIN_CLAUDE;

  assert.deepEqual(s.merged, ['T1'], 'T1 честно влит');
  assert.ok(s.abandoned.includes('T9'), 'T9 abandoned — heal исчерпан, до judge/merge не дошёл');
  assert.equal(fleet.exitCodeFor(s), 1, 'CLI вернул бы nonzero из-за abandoned-слайса');

  // интеграционный оракул реально прогнан ПОСЛЕ merge T1 (дефект 4 — больше не skip-абелен).
  const events = fs.readFileSync(path.join(repo, '.harness', 'fleet', 'events.jsonl'), 'utf8');
  assert.match(events, /"event":"merged","tid":"T1","oracleOk":true/, 'merge-событие несёт РЕАЛЬНЫЙ oracleOk:true, не null (oracle:false)');
  fs.rmSync(repo, { recursive: true, force: true });
});
