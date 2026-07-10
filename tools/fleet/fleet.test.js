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
    JSON.stringify({ oracle: 'node --version', shell: 'bash', branchPolicy: 'feature', push: false }));
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
    JSON.stringify({ oracle: 'exit 1', shell: 'bash', branchPolicy: 'feature', push: false }));
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
