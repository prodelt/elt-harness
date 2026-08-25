'use strict';
// 014 T005 (фаза B, AC3) — verify:"background": `elt commit` возвращает управление после
// L0+быстрого оракула, тяжёлые слои уходят в отдельный отсоединённый процесс.
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const bg = require('./elt-verify-bg');
const { runBackgroundVerify, spawnBackgroundVerify, ensureWorktree, worktreePath, enabledLayers, LAYERS, classifyJudge, harnessConfigAt, REVIEW_QUEUE } = bg;
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
  // 016 T005: `shell` — часть фикстуры, потому что фон теперь исполняет команду шеллом проекта
  // (как синхронный гейт). Без поля сработал бы дефолт `bash`, а на этой машине `bash` — WSL:
  // тесты гонялись бы в чужой ОС вместо родного шелла.
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'),
    JSON.stringify({ shell: SHELL, ...(harness || { background: { layers: ['suite'] } }) }));
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
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T005', oracleCmd: 'node -e "process.exit(0)"' });
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
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T005', oracleCmd: 'node -e "process.exit(1)"' });
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
  await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T006', oracleCmd: 'node -e "process.exit(0)"' });
  assert.equal(fs.existsSync(worktreePath(root, hash)), false, 'worktree обязан быть снесён после зелёного прогона');
});

// --- 014 T009 (AC7): четыре слоя в фоне ---------------------------------------------

const sectionsOf = (r) => Object.fromEntries(r.sections.map((s) => [s.layer, s]));

test('T009: отчёт содержит все четыре секции с временем каждой', async () => {
  // Судья выключен: он единственный слой, зовущий внешний CLI — в юните это был бы не тест,
  // а живой вызов модели. Его секция обязана присутствовать, но как явно выключенная.
  const { root, hash } = gitRepo({ smoke: 'node -e "process.exit(0)"', smokeParallel: true, background: { layers: ['suite', 'mutate', 'smoke'] } });
  // 016 T003: команда обязана быть НАСТОЯЩЕЙ проверкой (`check-seed.js` — зелёная на чистом
  // коде, красная на мутанте). С `node -e "process.exit(0)"` слой mutate теперь честно краснеет:
  // константно-зелёная команда не убивает ни одной мутации. Раньше тест это не ловил, потому
  // что мутатор звал захардкоженный `tools/elt-oracle-runner.js`, которого в фикстуре нет, —
  // падение `Cannot find module` засчитывалось как «мутация убита». Ровно тот дефект, что
  // чинит T003, держал этот assert зелёным.
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T009', oracleCmd: 'node check-seed.js' });
  assert.deepEqual(r.sections.map((s) => s.layer), ['suite', 'mutate', 'smoke', 'judge'], 'четыре секции, в порядке схемы спеки');
  assert.ok(r.sections.every((s) => typeof s.durationSec === 'number'), 'у каждой секции своё время');
  assert.equal(r.exit, 0);
  const by = sectionsOf(r);
  assert.equal(by.judge.skipped, true);
  assert.match(by.judge.reason, /выключен/, 'выключенный слой отсутствует С ПРИЧИНОЙ, а не молча');
});

test('T009: smoke не задан — секция пропущена с причиной, а не падает', async () => {
  const { root, hash } = gitRepo({ background: { layers: ['suite', 'smoke'] } });
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T009', oracleCmd: 'node -e "process.exit(0)"' });
  assert.equal(r.exit, 0, 'отсутствие smoke не делает фон красным');
  assert.match(sectionsOf(r).smoke.reason, /не задан/);
});

test('T009: красный smoke — bg-red слоя smoke, сьют при этом зелёный', async () => {
  const { root, hash } = gitRepo({ smoke: 'node -e "process.exit(3)"', smokeParallel: true, background: { layers: ['suite', 'smoke'] } });
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T009', oracleCmd: 'node -e "process.exit(0)"' });
  assert.equal(r.exit, 1);
  const rows = fs.readFileSync(path.join(root, '.harness', 'review-queue.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => x.layer), ['smoke'], 'красный ровно один слой — ровно одна задача');
  assert.equal(sectionsOf(r).suite.red, false);
});

test('T009: каждый красный слой даёт СВОЮ строку очереди, а не одну общую', async () => {
  const { root, hash } = gitRepo({ smoke: 'node -e "process.exit(1)"', smokeParallel: true, background: { layers: ['suite', 'smoke'] } });
  await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T009', oracleCmd: 'node -e "process.exit(1)"' });
  const rows = fs.readFileSync(path.join(root, '.harness', 'review-queue.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => x.layer), ['suite', 'smoke'], 'две причины — две задачи');
});

// --- 014 T010: smoke в фоне только с явного разрешения ------------------------------

test('T010: smokeParallel по умолчанию false — smoke пропущен с причиной, фон зелёный', async () => {
  // Красная команда специально: если бы слой всё-таки исполнился, тест упал бы на exit.
  const { root, hash } = gitRepo({ smoke: 'node -e "process.exit(1)"', background: { layers: ['suite', 'smoke'] } });
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T010', oracleCmd: 'node -e "process.exit(0)"' });
  assert.equal(r.exit, 0, 'непрогнанный smoke не красный — «не проверяли» ≠ «проверили и упало»');
  assert.equal(sectionsOf(r).smoke.reason, 'skipped: smokeParallel=false');
  assert.equal(fs.existsSync(path.join(root, '.harness', 'review-queue.jsonl')), false, 'пропуск не заводит задачу');
});

test('T010: smokeParallel:true — слой реально исполняется и красное доходит до очереди', async () => {
  const { root, hash } = gitRepo({ smoke: 'node -e "process.exit(1)"', smokeParallel: true, background: { layers: ['suite', 'smoke'] } });
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T010', oracleCmd: 'node -e "process.exit(0)"' });
  assert.equal(r.exit, 1);
  assert.equal(sectionsOf(r).smoke.red, true);
});

test('T009: background.layers отсутствует — включены все четыре (AC7 «по умолчанию все»)', () => {
  const { root } = gitRepo({ kind: 'code' });
  assert.deepEqual([...enabledLayers(root)], LAYERS);
  const { root: only } = gitRepo({ background: { layers: ['suite'] } });
  assert.deepEqual([...enabledLayers(only)], ['suite']);
});

test('T009: run-log несёт секции — без них отчёт фона неразбираем', async () => {
  const { root, hash } = gitRepo({ background: { layers: ['suite'] } });
  await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T009', oracleCmd: 'node -e "process.exit(0)"' });
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
  process.env.ELT_VERIFY_BG_ORACLE_CMD = 'node -e "process.exit(0)"';
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
  process.env.ELT_VERIFY_BG_ORACLE_CMD = 'node -e "process.exit(0)"';
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

// --- 014 T022: фоновый судья получает рубрику СВОЕЙ спеки -------------------------------
// Живой дефект: T016/T017 спеки 014 были заблокированы фоном с причиной «рубрика относится к
// specs/002-elt-fleet». Причина — runJudge звался без specFile, и findSpecDir (gate.js:166)
// брал первый tasks.md, где встречается `**Txxx**`. Тест воспроизводит именно коллизию: две
// спеки, обе содержат **T001**, и первой по обходу идёт ЧУЖАЯ.

test('T022: runBackgroundVerify доносит до судьи specFile и taskText', async () => {
  const { root } = gitRepo({ background: { layers: ['judge'] } });
  // Второй коммит обязателен: судейский слой делает `reset --soft HEAD~1`, чтобы дифф слайса
  // оказался в дереве worktree — на корневом коммите он бы отвалился ещё до вызова судьи.
  fs.writeFileSync(path.join(root, 'slice.txt'), 'change\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'slice'], { cwd: root });
  const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  let seen = null;
  await runBackgroundVerify({
    cwd: root, commitHash: hash, taskId: 'T001',
    taskText: '**T001** first [files: a.js]',
    specFile: 'specs/014-mine/tasks.md',
    judgeImpl: async (args) => { seen = args; return { verdict: 'pass', reasons: [] }; },
  });
  assert.equal(seen.specFile, 'specs/014-mine/tasks.md', 'без specFile судья получит рубрику чужой спеки');
  assert.match(seen.taskText, /\[files: a\.js\]/, 'без taskText молчит scope-триггер L0 (011 T024)');
});

test('T022: elt commit доносит specFile/taskText в отсоединённый фон', () => {
  const root = commitRepo('background');
  // Коллизия: обе спеки объявляют **T001**; `002-collision` идёт по обходу ПЕРВОЙ.
  fs.mkdirSync(path.join(root, 'specs', '002-collision'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '002-collision', 'tasks.md'), '- [ ] **T001** чужая задача\n');
  // Слой suite и есть наблюдатель: он наследует env фонового процесса и печатает то, что дошло.
  // Пишет на два уровня вверх от worktree (.fleet-wt/bg-<hash>/) — это корень репо.
  fs.writeFileSync(path.join(root, 'dump-bg-env.js'),
    "const fs=require('fs'),p=require('path');"
    + "fs.writeFileSync(p.join(process.cwd(),'..','..','bg-env.json'),JSON.stringify("
    + "{specFile:process.env.ELT_VERIFY_BG_SPEC_FILE||null,taskText:process.env.ELT_VERIFY_BG_TASK_TEXT||null}));\n");
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL,
    judge: { enabled: true, model: 'codex' }, specApproval: false,
    verify: 'background', background: { layers: ['suite'] }, // судью в юнит-тесте не будим
  }));
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'collision fixture'], { cwd: root });
  fs.writeFileSync(path.join(root, 'slice.txt'), 'change again\n');

  process.env.ELT_VERIFY_BG_ORACLE_CMD = 'node dump-bg-env.js';
  try {
    assert.equal(run(root, ['commit', '--task', 'T001', '--spec', 'specs/001-fixture', '--skip-oracle']).status, 0);
    const out = path.join(root, 'bg-env.json');
    const deadline = Date.now() + 30000;
    while (!fs.existsSync(out) && Date.now() < deadline) execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},200)']);
    assert.ok(fs.existsSync(out), 'фон не отработал за 30 c — нечего проверять');
    const got = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(got.specFile, 'specs/001-fixture/tasks.md',
      'фон обязан получить tasks.md СВОЕЙ спеки, а не первый попавшийся с **T001**');
    assert.match(got.taskText, /first/);
  } finally { delete process.env.ELT_VERIFY_BG_ORACLE_CMD; }
});

// 014 T023: `logPath` в записи `bg-red` обязан вести к РАЗБИРАЕМОМУ логу. До фикса `runCmd`
// захватывал вывод через spawnSync(encoding) и выбрасывал его: файл содержал одну строку
// deprecation-варнинга, и красное фона было неразбираемым (живьём на T016 и T018).
test('T023: лог фона содержит вывод упавшего слоя, а не пустоту', async () => {
  const { root } = gitRepo({ background: { layers: ['suite'] } });
  fs.writeFileSync(path.join(root, 'noisy.js'),
    "console.log('ЖИВОЙ ВЫВОД СЬЮТА');process.exit(1);\n");
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'noisy'], { cwd: root });
  const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T001', oracleCmd: 'node noisy.js' });
  assert.equal(r.exit, 1, 'слой обязан быть красным — иначе тест ничего не доказывает');

  const queued = fs.readFileSync(path.join(root, '.harness', 'review-queue.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.kind === 'bg-red');
  assert.equal(queued.length, 1);
  const log = fs.readFileSync(path.join(root, queued[0].logPath), 'utf8');
  assert.match(log, /ЖИВОЙ ВЫВОД СЬЮТА/, 'вывод упавшей команды дошёл до лога');
  assert.match(log, /exit 1/, 'в логе виден и код возврата');
});

// --- 016 T002: фон гоняет оракул ПРОЕКТА, а не захардкоженный оракул домашнего репо ------
// Живой дефект (аудит 11.08, `.planning/HARNESS-DEEP-AUDIT-2026-08-11.md`): дефолт параметра
// `oracleCmd = 'node tools/elt-oracle-runner.js --full'` перекрывался ТОЛЬКО через
// ELT_VERIFY_BG_ORACLE_CMD, а её не выставлял ни один продовый вызов — только тесты выше.
// В Portfolio 7 из 7 фоновых прогонов были красные за 0,13 c с `Cannot find module
// '...\.fleet-wt\bg-9ade717\tools\elt-oracle-runner.js'`. Дома тот же слой честно молотит
// минуты — дефект невидим по построению, поэтому тест зовёт runBackgroundVerify ровно так,
// как это делает прод: БЕЗ env и БЕЗ параметра.

test('T002: без env и без параметра фон берёт команду из harness.json проекта', async () => {
  assert.equal(process.env.ELT_VERIFY_BG_ORACLE_CMD, undefined, 'тест обязан идти по продовому пути — без тестового шва');
  const { root, hash } = gitRepo({ oracle: 'node check-seed.js', background: { layers: ['suite'] } });
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T002' });
  assert.equal(r.exit, 0, 'до фикса здесь запускался оракул ДОМАШНЕГО репо, которого в чужом проекте нет');
  const log = fs.readFileSync(path.join(root, '.harness', 'loop-logs', `bg-${hash}.log`), 'utf8');
  assert.match(log, /\$ node check-seed\.js/, 'в логе обязана быть команда проекта');
  assert.doesNotMatch(log, /elt-oracle-runner/, 'команда домашнего репо не должна протекать в чужой проект');
});

test('T002: нет поля oracle — громкая ошибка, а не молчаливый фолбек на чужой путь', async () => {
  const { root, hash } = gitRepo({ background: { layers: ['suite'] } });
  await assert.rejects(
    runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T002' }),
    /oracle/,
    'отсутствие команды — конфигурационная ошибка; фолбек и есть тот дефект',
  );
  assert.equal(fs.existsSync(worktreePath(root, hash)), false, 'отказ до создания worktree — иначе .fleet-wt/ копит сирот');
});

test('T002: ELT_VERIFY_BG_ORACLE_CMD перекрывает конфиг — тестовый шов остаётся живым', async () => {
  const { root, hash } = gitRepo({ oracle: 'node -e "process.exit(1)"', background: { layers: ['suite'] } });
  process.env.ELT_VERIFY_BG_ORACLE_CMD = 'node -e "process.exit(0)"';
  try {
    const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T002' });
    assert.equal(r.exit, 0, 'env обязан выигрывать у конфига — на нём стоят тесты T005/T022 выше');
  } finally { delete process.env.ELT_VERIFY_BG_ORACLE_CMD; }
});

// --- 016 T003: слой mutate гоняет тесты командой ПРОЕКТА -------------------------------
// Второй экземпляр того же дефекта, что чинил T001, этажом ниже: `runTests` звал
// захардкоженный `node tools/elt-oracle-runner.js`. В чужом проекте каждая мутация
// «убивалась» падением `Cannot find module` — слой рапортовал бы чистоту, ничего не проверив.

test('T003: mutate гоняет тесты командой из harness.json, а не захардкоженным оракулом', async () => {
  const { root } = gitRepo({ oracle: 'node mark-oracle.js', background: { layers: ['mutate'] } });
  // Красный выход = «мутация убита»: слой остаётся зелёным, и тест меряет РОВНО команду.
  fs.writeFileSync(path.join(root, 'mark-oracle.js'), 'process.exit(1);\n');
  fs.writeFileSync(path.join(root, 'prod.js'), 'function f(a) { if (a > 1) { return 1; } return 0; }\nmodule.exports = { f };\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'prod'], { cwd: root });
  const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T003' });
  assert.notEqual(sectionsOf(r).mutate.status, 'skipped', 'слой обязан реально отработать — иначе тест ничего не доказывает');
  const log = fs.readFileSync(path.join(root, '.harness', 'loop-logs', `bg-${hash}.log`), 'utf8');
  assert.match(log, /\$ node mark-oracle\.js/, 'мутатор обязан звать команду проекта');
  assert.doesNotMatch(log, /elt-oracle-runner/, 'команда домашнего репо не должна протекать в чужой проект');
});

// --- 016 T004: фоновая полоса гоняет тесты меньшей параллелью ---------------------------

test('T004: фон снижает параллелизм — команда получает ELT_ORACLE_JOBS, а не дефолт min(8,cpus)', async () => {
  const { root } = gitRepo({ oracle: 'node dump-jobs.js', background: { layers: ['suite'] } });
  fs.writeFileSync(path.join(root, 'dump-jobs.js'),
    "console.log('JOBS=' + (process.env.ELT_ORACLE_JOBS || 'unset'));\n");
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'dump-jobs'], { cwd: root });
  const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T004' });
  const log = fs.readFileSync(path.join(root, '.harness', 'loop-logs', `bg-${hash}.log`), 'utf8');
  assert.match(log, /JOBS=2/, 'в фоне ждать некому — время бесплатно, а contention стоит четырёх подряд ложных bg-red');
});

// --- 016 T005: команду проекта исполняет шелл из его же harness.json --------------------
// Третий экземпляр той же семьи, что T001 и T003: команда уже бралась из конфига, но
// `cmd.split(' ')` не шелл. Живой прогон в Portfolio (`npx tsc --noEmit && npm run lint`) дал
// `exit 1` за 0,012 c — `&&` уехал аргументом в npx. Дискриминатор ниже работает в ОБОИХ
// шеллах: наивный split отдаёт node аргумент `"process.exit(3)"` — строковый литерал, который
// он вычисляет и выходит с 0; настоящий шелл снимает кавычки и даёт 3.

test('T005: команда с кавычками исполняется шеллом проекта, а не наивным split(" ")', async () => {
  const { root, hash } = gitRepo({ oracle: 'node -e "process.exit(3)"', background: { layers: ['suite'] } });
  const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T005' });
  // Не `equal(…, 3)`: PowerShell 5.1 с `-Command` не проксирует точный код нативной команды
  // (даёт 1), bash даёт 3. Дискриминатор всё равно точный — наивный split вернул бы РОВНО 0.
  assert.notEqual(sectionsOf(r).suite.exit, 0, 'до фикса кавычки уезжали в argv, node вычислял строковый литерал и выходил с 0');
});

// ---------------------------------------------------------------------------
// 020 T007 — фон fail-closed. Каждый тест дискриминирующий: на коде ДО этой
// задачи все исходы ниже давали `background-verify-pass`, то есть зелёное без
// единой проверки диффа.
// ---------------------------------------------------------------------------

function judgeRepo() {
  const { root } = gitRepo({ background: { layers: ['judge'] } });
  // Второй коммит обязателен: судейский слой делает `reset --soft HEAD~1`.
  fs.writeFileSync(path.join(root, 'slice.txt'), 'change\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'slice'], { cwd: root });
  const hash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, hash };
}
function queueRows(root) {
  const f = path.join(root, REVIEW_QUEUE);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const NON_CONCLUSIVE = [
  ['dead — судья не отработал', async () => ({ ok: false, reasons: ['CLI не найден'] })],
  ['malformed — вместо вердикта мусор', async () => ({ ok: true, verdict: { weird: true } })],
  ['unknown — вердикт не из закрытого списка', async () => ({ ok: true, verdict: 'probably-fine' })],
  ['exception — судья упал внутри', async () => { throw new Error('boom'); }],
];

for (const [name, judgeImpl] of NON_CONCLUSIVE) {
  test('T007: ' + name + ' → НЕ pass, свой terminal-state и bg-dead в очереди', async () => {
    const { root, hash } = judgeRepo();
    const r = await runBackgroundVerify({ cwd: root, commitHash: hash, taskId: 'T007', judgeImpl });

    assert.notEqual(r.status, 'background-verify-pass', 'неконклюзивный судья не может быть зелёным');
    assert.equal(r.status, 'background-verify-dead');
    assert.equal(r.exit, 1, 'exit ненулевой — родитель обязан узнать');

    const last = runLogEntries(root).pop();
    assert.equal(last.status, 'background-verify-dead', 'терминальная запись в run-log — та же');

    const rows = queueRows(root);
    assert.equal(rows.length, 1, 'ровно одна строка разбора');
    assert.equal(rows[0].kind, 'bg-dead', 'не bg-red: «не смогли проверить» ≠ «проверили и красное»');
    assert.match(rows[0].reason, /судья/);
  });
}

test('T007: таймаут судьи → background-verify-dead, а не бесконечное ожидание', async () => {
  const { root } = judgeRepo();
  const cfgPath = path.join(root, '.harness', 'harness.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.background = { layers: ['judge'], judgeTimeoutMs: 300 };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'timeout cfg'], { cwd: root });
  const h2 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

  const r = await runBackgroundVerify({
    cwd: root, commitHash: h2, taskId: 'T007',
    judgeImpl: () => new Promise(() => {}),
  });
  assert.equal(r.status, 'background-verify-dead');
  assert.match(queueRows(root).pop().reason, /timeout/);
});

test('T007: inconclusive — СВОЁ терминальное состояние и своя строка очереди', async () => {
  const { root, hash } = judgeRepo();
  const r = await runBackgroundVerify({
    cwd: root, commitHash: hash, taskId: 'T007',
    judgeImpl: async () => ({ ok: true, verdict: 'inconclusive', reasons: ['владения'] }),
  });
  assert.equal(r.status, 'background-verify-inconclusive', 'не pass и не red — третий исход');
  assert.equal(r.exit, 1);
  assert.equal(queueRows(root)[0].kind, 'bg-inconclusive');
  assert.equal(runLogEntries(root).pop().background.outcome, 'inconclusive');
});

test('T007: pass судьи по-прежнему зелёный — иначе тесты выше доказывали бы пустоту', async () => {
  const { root, hash } = judgeRepo();
  const r = await runBackgroundVerify({
    cwd: root, commitHash: hash, taskId: 'T007',
    judgeImpl: async () => ({ ok: true, verdict: 'pass', reasons: [] }),
  });
  assert.equal(r.status, 'background-verify-pass');
  assert.equal(r.exit, 0);
  assert.deepEqual(queueRows(root), [], 'зелёное не плодит строк разбора');
});

test('T007: после неконклюзивного прогона worktree убран и след в run-log есть', async () => {
  const { root, hash } = judgeRepo();
  await runBackgroundVerify({
    cwd: root, commitHash: hash, taskId: 'T007',
    judgeImpl: async () => { throw new Error('layer exploded'); },
  });
  assert.equal(fs.existsSync(worktreePath(root, hash)), false, 'осиротевший worktree не остался');
  assert.ok(runLogEntries(root).pop().status.startsWith('background-verify-'), 'след есть всегда');
});

test('T007: конфиг берётся из снапшота КОММИТА, а не из живого дерева', async () => {
  const { root, hash } = judgeRepo();
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'),
    JSON.stringify({ shell: SHELL, background: { layers: [] } }));
  const snap = harnessConfigAt(root, hash);
  assert.equal(snap.source, 'commit:' + hash);
  assert.deepEqual(snap.cfg.background.layers, ['judge'], 'снапшот отдаёт слои коммита');

  const r = await runBackgroundVerify({
    cwd: root, commitHash: hash, taskId: 'T007',
    judgeImpl: async () => ({ ok: true, verdict: 'block', reasons: ['реальный блок'] }),
  });
  assert.equal(r.status, 'background-verify-red', 'слой judge отработал по конфигу коммита');
  assert.equal(r.configSource, 'commit:' + hash);
});

// 020 T008: фоновая строка очереди обязана нести ПОЛНУЮ identity — спеку, коммит и слой.
// Без спеки `elt review close --task T018` не отличает находку 019/T018 от 020/T018 и
// закрывает чужую (или, что и случилось живьём, не закрывает ни одной и молчит).
test('T008: строка фона несёт specPath, commit и layer', async () => {
  const { root, hash } = gitRepo({ background: { layers: ['suite'] } });
  const r = await runBackgroundVerify({
    cwd: root, commitHash: hash, taskId: 'T018',
    specFile: 'specs/020-elt-v5-codex-release-certification/tasks.md',
    oracleCmd: 'node -e "process.exit(1)"',
  });
  assert.equal(r.status, 'background-verify-red');
  const rows = fs.readFileSync(path.join(root, REVIEW_QUEUE), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].specPath, 'specs/020-elt-v5-codex-release-certification/tasks.md');
  assert.equal(rows[0].commit, hash, 'коммит — единственный вход в дифф находки');
  assert.equal(rows[0].layer, 'suite');
});

test('T007: classifyJudge — закрытый список, всё остальное неконклюзивно', () => {
  for (const v of ['pass', 'block', 'inconclusive']) assert.equal(classifyJudge(v).conclusive, true, v);
  for (const v of ['dead', 'timeout', 'unknown', '', null, undefined, 'PASS']) {
    assert.equal(classifyJudge(v).conclusive, false, v + ' не вердикт');
  }
});

after(() => {
  for (const root of roots) { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

// ── 020 T017 (поколение 2): сертификат выписывается из РЕАЛЬНЫХ результатов ───────────────
// Судья заблокировал первое поколение по существу: алгебра сертификата существовала
// изолированно, `createBatchCertificate` звали только её собственные юнит-тесты. Значит
// требование «push/merge/tag/release принимают только соответствующий proof» было физически
// недостижимо: proof не выписывал никто. Ниже проверяется именно проводка.

const certification = require('./certification');

function certFixture(over = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-cert-wire-'));
  // Настоящий git-репозиторий, а не каталог с `.git`: путь к состоянию батчей резолвит сам
  // git (`rev-parse --git-dir`), и в worktree он не совпадает с `<cwd>/.git`. Подделка каталога
  // проверяла бы не тот код, который работает на живой машине.
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: root });
  // Настоящий коммит, а не строка: сертификат привязывается к `<commit>^{tree}`, и на
  // выдуманном хеше алгебра честно отвечает `hash-missing` — фикстура обязана это учитывать,
  // а не ослаблять требование.
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  fs.mkdirSync(path.join(root, '.git', 'elt'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'elt', 'batch-state.json'), JSON.stringify({
    batches: {
      'batch-abc': {
        specPath: 'specs/020-x/tasks.md', taskIds: ['T001'],
        taskIdentities: [{ specPath: 'specs/020-x/tasks.md', id: 'T001', index: 0 }],
        generation: 1, batchHead: head, history: [],
      },
    },
  }));
  return { root, head, ...over };
}

// Зелёный прогон обязан ОСТАВИТЬ сертификат. Это и есть та единственная точка, где алгебра
// встречается с фактами: терминал оракула, терминалы линз, терминал оценщика и хеши.
function testGreenRunIssuesCertificate() {
  const { root, head } = certFixture();
  const sections = [
    { layer: 'suite', exit: 0, red: false },
    {
      layer: 'judge',
      verdict: 'pass',
      review: {
        lensResults: {
          'review-bugs': { status: 'review-pass' },
          'review-claude-md': { status: 'review-pass' },
          'review-code-comments': { status: 'review-pass' },
        },
        scorerTerminal: 'review-pass',
        findings: [],
      },
    },
  ];
  const r = bg.issueBatchCertificate({
    cwd: root, commitHash: head, taskId: 'T001',
    specFile: 'specs/020-x/tasks.md', sections, outcome: 'pass',
  });
  assert.equal(r.ok, true, `сертификат обязан выписаться: ${r.reason} ${r.detail || ''}`);
  assert.equal(r.certificate.v, certification.BATCH_CERT_SCHEMA);
  assert.equal(r.certificate.commit, head);

  // И он лежит ВНЕ дерева: запись в дерево после сертификата сделала бы его stale немедленно.
  const certFile = certification.batchCertificatePath(root, 'batch-abc', 1);
  assert.ok(certFile.includes('.git'), 'сертификат обязан жить вне рабочего дерева');
  assert.ok(fs.existsSync(certFile));
  fs.rmSync(root, { recursive: true, force: true });
}

// Красный прогон сертификата НЕ получает — иначе «proof» перестаёт что-либо значить.
function testRedRunIssuesNothing() {
  const { root, head } = certFixture();
  const r = bg.issueBatchCertificate({
    cwd: root, commitHash: head, taskId: 'T001', specFile: 'specs/020-x/tasks.md',
    sections: [{ layer: 'suite', exit: 1, red: true }], outcome: 'red',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'outcome-not-pass');
  assert.equal(fs.existsSync(certification.batchCertificatePath(root, 'batch-abc', 1)), false,
    'красный прогон не смеет оставить сертификат на диске');
  fs.rmSync(root, { recursive: true, force: true });
}

// Отсутствие данных ревью — отказ, а не «наверное всё прошло». Подставить умолчание здесь
// значило бы выписывать proof по умолчанию, то есть ровно fail-open.
function testMissingReviewEvidenceRefusesCertificate() {
  const { root, head } = certFixture();
  const r = bg.issueBatchCertificate({
    cwd: root, commitHash: head, taskId: 'T001', specFile: 'specs/020-x/tasks.md',
    sections: [{ layer: 'suite', exit: 0 }, { layer: 'judge', verdict: 'pass' }],
    outcome: 'pass',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'review-evidence-missing');
  fs.rmSync(root, { recursive: true, force: true });
}

// Мёртвая линза не даёт сертификата, даже когда общий исход выглядит зелёным: вердикт четырёх
// линз, выданный за вердикт пяти, — та же подмена, что закрыл T007 для фона.
function testDeadLensBlocksCertificate() {
  const { root, head } = certFixture();
  const r = bg.issueBatchCertificate({
    cwd: root, commitHash: head, taskId: 'T001', specFile: 'specs/020-x/tasks.md',
    sections: [
      { layer: 'suite', exit: 0 },
      {
        layer: 'judge', verdict: 'pass',
        review: {
          lensResults: {
            'review-bugs': { status: 'review-dead', reason: 'линза не отработала' },
            'review-claude-md': { status: 'review-pass' },
            'review-code-comments': { status: 'review-pass' },
          },
          scorerTerminal: 'review-pass',
          findings: [],
        },
      },
    ],
    outcome: 'pass',
  });
  assert.equal(r.ok, false, 'мёртвая требуемая линза обязана блокировать сертификат');
  fs.rmSync(root, { recursive: true, force: true });
}

// Находка с уверенностью ровно 80 блокирует; 79 — нет. Это и есть отсечка, ради которой
// заведён оценщик.
function testFindingAtCutoffBlocksCertificate() {
  for (const [confidence, shouldIssue] of [[79, true], [80, false]]) {
    const { root, head } = certFixture();
    const r = bg.issueBatchCertificate({
      cwd: root, commitHash: head, taskId: 'T001', specFile: 'specs/020-x/tasks.md',
      sections: [
        { layer: 'suite', exit: 0 },
        {
          layer: 'judge', verdict: 'pass',
          review: {
            lensResults: {
              'review-bugs': { status: 'review-pass' },
              'review-claude-md': { status: 'review-pass' },
              'review-code-comments': { status: 'review-pass' },
            },
            scorerTerminal: 'review-pass',
            findings: [{ lens: 'review-bugs', file: 'a.js', line: 1, confidence }],
          },
        },
      ],
      outcome: 'pass',
    });
    assert.equal(r.ok, shouldIssue, `уверенность ${confidence}: сертификат ${shouldIssue ? 'обязан' : 'не имеет права'} выписаться`);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Батч, которого нет в состоянии, сертификата не получает: иначе proof выписывался бы на
// коммит, который никакому батчу не принадлежит.
function testUnregisteredBatchGetsNoCertificate() {
  const { root, head } = certFixture();
  const r = bg.issueBatchCertificate({
    cwd: root, commitHash: 'deadbee', taskId: 'T001', specFile: 'specs/020-x/tasks.md',
    sections: [{ layer: 'suite', exit: 0 }, { layer: 'judge', review: { lensResults: {}, scorerTerminal: 'review-pass', findings: [] } }],
    outcome: 'pass',
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'batch-not-registered');
  fs.rmSync(root, { recursive: true, force: true });
}

// Второй прогон на том же batchHead/generation — no-op, а не второй сертификат. «Ровно один
// impact oracle и один подграф ревью на одном batchHead» проверяется именно здесь.
function testSecondCertificateOnSameHeadIsRefused() {
  const { root, head } = certFixture();
  const args = {
    cwd: root, commitHash: head, taskId: 'T001', specFile: 'specs/020-x/tasks.md',
    sections: [
      { layer: 'suite', exit: 0 },
      {
        layer: 'judge', verdict: 'pass',
        review: {
          lensResults: {
            'review-bugs': { status: 'review-pass' },
            'review-claude-md': { status: 'review-pass' },
            'review-code-comments': { status: 'review-pass' },
          },
          scorerTerminal: 'review-pass', findings: [],
        },
      },
    ],
    outcome: 'pass',
  };
  assert.equal(bg.issueBatchCertificate(args).ok, true);
  const again = bg.issueBatchCertificate(args);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'certificate-exists');
  fs.rmSync(root, { recursive: true, force: true });
}

test('T017 gen2: зелёный фоновой прогон выписывает сертификат батча', testGreenRunIssuesCertificate);
test('T017 gen2: красный прогон сертификата не получает', testRedRunIssuesNothing);
test('T017 gen2: без данных ревью сертификат не выписывается', testMissingReviewEvidenceRefusesCertificate);
test('T017 gen2: мёртвая линза блокирует сертификат', testDeadLensBlocksCertificate);
test('T017 gen2: отсечка 80 — 79 проходит, 80 блокирует', testFindingAtCutoffBlocksCertificate);
test('T017 gen2: незарегистрированный батч сертификата не получает', testUnregisteredBatchGetsNoCertificate);
test('T017 gen2: второй сертификат на том же batchHead отвергается', testSecondCertificateOnSameHeadIsRefused);
