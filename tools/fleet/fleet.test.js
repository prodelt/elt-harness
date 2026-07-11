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
