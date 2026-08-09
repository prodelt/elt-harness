'use strict';
// 014 T005 (фаза B, AC3) — verify:"background": `elt commit` возвращает управление после
// L0+быстрого оракула, тяжёлые слои уходят в отдельный отсоединённый процесс.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { runBackgroundVerify, spawnBackgroundVerify, ensureWorktree, worktreePath, enabledLayers, LAYERS } = require('./elt-verify-bg');
const { validateHarnessConfig, verifyMode, VERIFY_MODES } = require('./elt-config');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

// Возвращает { root, hash } — реальный commit-ish обязателен с T006: фон делает `git worktree
// add --detach <path> <hash>`, фейковая строка вроде 'abc123' больше не резолвится. Заодно
// коммитит `check-seed.js` — маленький чекер БЕЗ пробелов в оракул-команде (наивный split(' ')
// в elt-verify-bg.js не понимает кавычки, см. его ponytail-комментарий).
function gitRepo(harness) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-verify-bg-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  fs.writeFileSync(path.join(root, 'check-seed.js'),
    "process.exit(require('fs').readFileSync('seed.txt','utf8').trim()==='seed'?0:1);\n");
  // 014 T009: фикстура по умолчанию гоняет только suite — остальные слои включаются точечно
  // в своих тестах (судья иначе позвал бы настоящий CLI из юнит-теста).
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify(harness || { background: { layers: ['suite'] } }));
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: root });
  const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, hash };
}
function runLogEntries(root) {
  const file = path.join(root, '.git', 'elt', 'run-log.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// --- runBackgroundVerify (прямой вызов, без spawn — быстро) -------------------------

test('runBackgroundVerify: зелёная команда пишет background-verify-pass с хешем коммита', async () => {
  const { root, hash } = gitRepo();
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T005', oracleCmd: 'node -e process.exit(0)' });
  assert.equal(r.exit, 0);
  const entries = runLogEntries(root);
  const last = entries[entries.length - 1];
  assert.equal(last.commit, hash);
  assert.equal(last.task, 'T005');
  assert.equal(last.status, 'background-verify-pass');
  assert.equal(last.background.layer, 'suite');
  assert.equal(last.background.exit, 0);
});

test('runBackgroundVerify: красная команда пишет background-verify-red, не маскирует провал', async () => {
  const { root, hash } = gitRepo();
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T005', oracleCmd: 'node -e process.exit(1)' });
  assert.equal(r.exit, 1);
  const entries = runLogEntries(root);
  assert.equal(entries[entries.length - 1].status, 'background-verify-red');
});

// --- T006 (AC4): worktree на ХЕШЕ коммита, не на живом дереве -----------------------

test('runBackgroundVerify (AC4): фон видит содержимое НА ХЕШЕ, не правку основного дерева после старта', async () => {
  const { root, hash } = gitRepo();
  // Гонка со следующим слайсом: правим main-дерево ПОСЛЕ того, как коммит (и его хеш) уже
  // зафиксирован — ровно то, что произошло бы, если бы пользователь начал T+1, пока фон T ещё
  // не закончил. check-seed.js на хеше `hash` обязан по-прежнему видеть 'seed', не правку.
  fs.writeFileSync(path.join(root, 'seed.txt'), 'CORRUPTED-BY-NEXT-SLICE\n');
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T006', oracleCmd: 'node check-seed.js' });
  assert.equal(r.exit, 0, 'worktree обязан видеть seed.txt НА ХЕШЕ коммита — не текущую правку основного дерева (stale-tree)');
  // Основное дерево осталось с правкой — фон её не тронул и не откатил.
  assert.equal(fs.readFileSync(path.join(root, 'seed.txt'), 'utf8'), 'CORRUPTED-BY-NEXT-SLICE\n');
});

test('runBackgroundVerify (AC4): worktree убирается после прогона (не копится в .fleet-wt/)', async () => {
  const { root, hash } = gitRepo();
  await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T006', oracleCmd: 'node -e process.exit(0)' });
  assert.equal(fs.existsSync(worktreePath(root, hash)), false, 'worktree обязан быть снесён после зелёного прогона');
});

// --- 014 T009 (AC7): четыре слоя в фоне ---------------------------------------------

const sectionsOf = (r) => Object.fromEntries(r.sections.map((s) => [s.layer, s]));

test('T009: отчёт содержит все четыре секции с временем каждой', async () => {
  // Судья выключен: он единственный слой, зовущий внешний CLI — в юните это был бы не тест,
  // а живой вызов модели. Его секция обязана присутствовать, но как явно выключенная.
  const { root, hash } = gitRepo({ smoke: 'node -e process.exit(0)', background: { layers: ['suite', 'mutate', 'smoke'] } });
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T009', oracleCmd: 'node -e process.exit(0)' });
  assert.deepEqual(r.sections.map((s) => s.layer), ['suite', 'mutate', 'smoke', 'judge'], 'четыре секции, в порядке схемы спеки');
  assert.ok(r.sections.every((s) => typeof s.durationSec === 'number'), 'у каждой секции своё время');
  assert.equal(r.exit, 0);
  const by = sectionsOf(r);
  assert.equal(by.judge.skipped, true);
  assert.match(by.judge.reason, /выключен/, 'выключенный слой отсутствует С ПРИЧИНОЙ, а не молча');
});

test('T009: smoke не задан — секция пропущена с причиной, а не падает', async () => {
  const { root, hash } = gitRepo({ background: { layers: ['suite', 'smoke'] } });
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T009', oracleCmd: 'node -e process.exit(0)' });
  assert.equal(r.exit, 0, 'отсутствие smoke не делает фон красным');
  assert.match(sectionsOf(r).smoke.reason, /не задан/);
});

test('T009: красный smoke — bg-red слоя smoke, сьют при этом зелёный', async () => {
  const { root, hash } = gitRepo({ smoke: 'node -e process.exit(3)', background: { layers: ['suite', 'smoke'] } });
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T009', oracleCmd: 'node -e process.exit(0)' });
  assert.equal(r.exit, 1);
  const rows = fs.readFileSync(path.join(root, '.harness', 'review-queue.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => x.layer), ['smoke'], 'красный ровно один слой — ровно одна задача');
  assert.equal(sectionsOf(r).suite.red, false);
});

test('T009: каждый красный слой даёт СВОЮ строку очереди, а не одну общую', async () => {
  const { root, hash } = gitRepo({ smoke: 'node -e process.exit(1)', background: { layers: ['suite', 'smoke'] } });
  await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T009', oracleCmd: 'node -e process.exit(1)' });
  const rows = fs.readFileSync(path.join(root, '.harness', 'review-queue.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => x.layer), ['suite', 'smoke'], 'две причины — две задачи');
});

test('T009: background.layers отсутствует — включены все четыре (AC7 «по умолчанию все»)', () => {
  const { root } = gitRepo({ kind: 'code' });
  assert.deepEqual([...enabledLayers(root)], LAYERS);
  const { root: only } = gitRepo({ background: { layers: ['suite'] } });
  assert.deepEqual([...enabledLayers(only)], ['suite']);
});

test('T009: run-log несёт секции — без них отчёт фона неразбираем', async () => {
  const { root, hash } = gitRepo({ background: { layers: ['suite'] } });
  await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T009', oracleCmd: 'node -e process.exit(0)' });
  const last = runLogEntries(root).pop();
  assert.equal(last.status, 'background-verify-pass', 'префикс background-verify держит детектор bg-silent (T008)');
  assert.equal(last.background.sections.length, 4);
});

test('ensureWorktree: реальный checkout на хеше — файлы читаемы напрямую из worktree-пути', () => {
  const { root, hash } = gitRepo();
  const wt = ensureWorktree(root, hash);
  // .trim(): Windows git (core.autocrlf) переписывает \n в \r\n при checkout — содержимое,
  // не перевод строки, доказывает, что это реальный чекаут, а не заглушка.
  assert.equal(fs.readFileSync(path.join(wt, 'seed.txt'), 'utf8').trim(), 'seed');
  execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root });
});

// --- spawnBackgroundVerify (реальный detached-процесс) -------------------------------

test('spawnBackgroundVerify: возвращает управление немедленно (не ждёт завершения фона)', () => {
  const { root, hash } = gitRepo();
  process.env.ELT_VERIFY_BG_ORACLE_CMD = 'node -e setTimeout(()=>process.exit(0),1500)';
  try {
    const started = Date.now();
    const r = spawnBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T005' });
    const elapsedMs = Date.now() - started;
    assert.ok(elapsedMs < 800, `spawnBackgroundVerify обязан вернуть управление сразу, занял ${elapsedMs}ms`);
    assert.ok(r.pid > 0, 'фон реально запущен — есть pid');
    assert.ok(fs.existsSync(path.join(root, r.logPath)), 'лог фона создан');
  } finally { delete process.env.ELT_VERIFY_BG_ORACLE_CMD; }
});

test('spawnBackgroundVerify: фон реально дописывает run-log ПОСЛЕ того, как родитель уже вернул управление', async () => {
  const { root, hash } = gitRepo();
  process.env.ELT_VERIFY_BG_ORACLE_CMD = 'node -e process.exit(0)';
  try {
    spawnBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T005' });
    // Родитель уже не ждёт — тест ждёт САМ, с таймаутом, а не синхронно в вызывающем коде.
    const deadline = Date.now() + 10000;
    let found = null;
    while (Date.now() < deadline && !found) {
      found = runLogEntries(root).find((e) => e.commit === hash);
      if (!found) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(found, 'фон обязан дописать run-log в разумное время после старта');
    assert.equal(found.status, 'background-verify-pass');
  } finally { delete process.env.ELT_VERIFY_BG_ORACLE_CMD; }
});

// --- elt-config: поле verify (AC12: отсутствие поля = поведение 011) -----------------

test('validateHarnessConfig: verify опционален, дефолт не проверяется здесь — это дело verifyMode', () => {
  assert.deepEqual(validateHarnessConfig({ kind: 'code', oracle: 'x', judge: { enabled: false } }).errors, []);
});

test('validateHarnessConfig: verify:"background"/"sync" — валидны; опечатка — ошибка конфига', () => {
  const base = { kind: 'code', oracle: 'x', judge: { enabled: false } };
  assert.deepEqual(validateHarnessConfig({ ...base, verify: 'sync' }).errors, []);
  assert.deepEqual(validateHarnessConfig({ ...base, verify: 'background' }).errors, []);
  assert.match(validateHarnessConfig({ ...base, verify: 'async' }).errors.join(';'), /verify must be one of/);
});

test('verifyMode: нет поля/битый конфиг → sync (AC12 обратная совместимость)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-verify-mode-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true }); // gitRepo() уже мог его создать (T009)
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({ kind: 'code', oracle: 'x' }));
  assert.equal(verifyMode(root), 'sync');
  assert.equal(verifyMode(path.join(root, 'nope')), 'sync', 'нечитаемый путь — тоже sync, не бросает');
});

test('verifyMode: явный background читается как есть', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-verify-mode-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true }); // gitRepo() уже мог его создать (T009)
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({ kind: 'code', oracle: 'x', verify: 'background' }));
  assert.equal(verifyMode(root), 'background');
});

test('VERIFY_MODES: закрытый список из двух значений', () => {
  assert.deepEqual([...VERIFY_MODES].sort(), ['background', 'sync']);
});

// --- elt.js commit: интеграция (AC3) --------------------------------------------------

function run(root, args) {
  return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' });
}
function harness(verify) {
  return JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL,
    judge: { enabled: true, model: 'codex' }, specApproval: false,
    ...(verify ? { verify } : {}),
  });
}
function commitRepo(verify) {
  const { root } = gitRepo();
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true }); // gitRepo() уже мог его создать (T009)
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), harness(verify));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** first\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'seed harness'], { cwd: root });
  fs.writeFileSync(path.join(root, 'slice.txt'), 'change\n');
  assert.equal(run(root, ['oracle']).status, 0);
  return root;
}

test('commit: sync (дефолт, поле отсутствует) — БЕЗ судейского пруфа падает, как в 011', () => {
  const root = commitRepo(undefined);
  const r = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.notEqual(r.status, 0, 'без judge proof sync-коммит обязан отказать');
  assert.match(r.stderr, /judge proof/);
});

test('commit: verify:"background" — коммитит БЕЗ судейского пруфа и возвращает управление быстро', () => {
  const root = commitRepo('background');
  process.env.ELT_VERIFY_BG_ORACLE_CMD = 'node -e process.exit(0)';
  try {
    const started = Date.now();
    const r = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
    const elapsedMs = Date.now() - started;
    assert.equal(r.status, 0, r.stderr);
    assert.ok(elapsedMs < 8000, `commit в background-режиме обязан вернуть управление быстро, занял ${elapsedMs}ms`);
    const entries = runLogEntries(root);
    const last = entries[entries.length - 1];
    assert.equal(last.status, 'committed-speculative');
    assert.ok(last.commit, 'запись несёт хеш коммита');
    assert.equal(last.task, 'T001');
    const log = execFileSync('git', ['log', '--oneline'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
    assert.ok(log[0].includes(last.commit), 'коммит реально создан на хеше из run-log');
  } finally { delete process.env.ELT_VERIFY_BG_ORACLE_CMD; }
});

after(() => {
  for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows lock */ } }
});
