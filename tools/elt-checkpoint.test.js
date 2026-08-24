'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const roots = [];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
function run(root) {
  return spawnSync(process.execPath, [ELT, 'checkpoint', '-m', 'docs: checkpoint fixture'], { cwd: root, encoding: 'utf8' });
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-checkpoint-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.planning'));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, '.planning', 'STATE.md'), 'seed\n');
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** fixture\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  return root;
}
function commitCount(root) {
  return Number(git(root, ['rev-list', '--count', 'HEAD']));
}
function assertRejected(root) {
  const before = commitCount(root);
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.equal(commitCount(root), before, result.stderr.toString());
  assert.equal(git(root, ['diff', '--cached', '--name-only']), '', 'rejected checkpoint must not stage files');
}

test('checkpoint commits planning-only changes without judge', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, '.planning', 'STATE.md'), 'checkpoint\n');
  const before = commitCount(root);
  const result = run(root);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(commitCount(root), before + 1);
  assert.equal(git(root, ['status', '--porcelain']), '');
});

test('checkpoint rejects code, harness config, and mixed changes before staging', () => {
  let root = fixture();
  fs.mkdirSync(path.join(root, 'tools'));
  fs.writeFileSync(path.join(root, 'tools', 'x.js'), 'module.exports = 1;\n');
  assertRejected(root);

  root = fixture();
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), '{}\n');
  assertRejected(root);

  root = fixture();
  fs.writeFileSync(path.join(root, '.planning', 'STATE.md'), 'allowed\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'blocked\n');
  assertRejected(root);
});

// --- 011 T012: авто-чекпоинт молчит, пока идёт цепочка гейта -------------------------
//
// Почему это не косметика. Хук `checkpoint-writer.js` пишет `.planning/CHECKPOINT-*-auto.md`
// по расходу токенов, не спрашивая, чем занят репозиторий. Попав между оракулом и коммитом,
// он: (а) двигает treeHash — оракул-пруф становится stale и `elt commit --skip-oracle`
// отказывает; (б) появляется в диффе слайса, где судья законно ловит его как scope creep.
// Оба случая живые (прогоны июля 2026), и стоили они по 10–20 минут гейта каждый.

const { runCheckpointWriter, gateActive, profileFor, findEltJs } = require('./checkpoint-writer');

const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const elt = (root, args) => spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' });
const markerPath = (root) => path.join(root, '.git', 'elt', 'gate-active.json');
const stubBridge = (out) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-cp-bridge-'));
  roots.push(dir);
  const p = path.join(dir, 'stub.js');
  fs.writeFileSync(p, `process.stdout.write(${JSON.stringify(JSON.stringify(out))});\n`);
  return p;
};
const judgeOut = (verdict) => ({
  runOk: true, verdict, reasons: [verdict === 'pass' ? 'в границах' : 'scope creep'],
  judges: [{ provider: 'agy', model: 'gemini', verdict, runOk: true }],
  grounding: { filesReviewed: ['slice.txt'] },
});
// Полноценный elt-репозиторий: маркер ставит и снимает САМ CLI, и проверять это на подделке
// смысла нет — весь дефект был в том, что между реальными шагами кто-то писал в дерево.
function gateRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-gate-marker-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, branchPolicy: 'none',
    judge: { enabled: true, provider: 'agy', model: 'gemini', attest: true },
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** слайс\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  return root;
}
// Транскрипт с расходом ВЫШЕ порога: без него writer молчал бы по другой причине, и тест
// «маркер работает» проходил бы фиктивно.
function writerArgs(root) {
  const tPath = path.join(root, '..', `transcript-${path.basename(root)}.jsonl`);
  fs.writeFileSync(tPath, JSON.stringify({
    message: { model: 'claude-sonnet-4', usage: { input_tokens: 150000, output_tokens: 500, cache_read_input_tokens: 0 } },
  }) + '\n');
  roots.push(tPath);
  return { sessionId: `sess-${path.basename(root)}`, transcriptPath: tPath, projectDir: root, stateFile: path.join(root, '..', `st-${path.basename(root)}.json`) };
}
const autoCheckpoints = (root) => {
  const dir = path.join(root, '.planning');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('CHECKPOINT-')) : [];
};

test('011 T012: маркера нет → чекпоинт пишется (иначе тест ниже доказывал бы пустоту)', () => {
  const root = gateRepo();
  const r = runCheckpointWriter(writerArgs(root));
  assert.equal(r.wrote, true, r.reason);
  assert.equal(autoCheckpoints(root).length, 1);
});

test('011 T012: маркер стоит → чекпоинт НЕ пишется, причина названа, дерево не тронуто', () => {
  const root = gateRepo();
  fs.mkdirSync(path.dirname(markerPath(root)), { recursive: true });
  fs.writeFileSync(markerPath(root), JSON.stringify({ pid: 1, task: 'T001', ts: new Date().toISOString(), ttlMs: 60000 }));
  const r = runCheckpointWriter(writerArgs(root));
  assert.equal(r.wrote, false);
  assert.equal(r.reason, 'gate-active');
  assert.deepEqual(autoCheckpoints(root), [], 'ни одного файла в дереве — treeHash цел');
});

test('011 T012: протухший маркер игнорируется — оборванная цепочка не глушит чекпоинты навсегда', () => {
  const root = gateRepo();
  fs.mkdirSync(path.dirname(markerPath(root)), { recursive: true });
  fs.writeFileSync(markerPath(root), JSON.stringify({ pid: 1, ts: new Date(Date.now() - 3600e3).toISOString(), ttlMs: 1800e3 }));
  assert.equal(gateActive(root), false);
  assert.equal(runCheckpointWriter(writerArgs(root)).wrote, true);
  fs.writeFileSync(markerPath(root), 'не json');
  assert.equal(gateActive(root), false, 'битый маркер — тоже не повод молчать');
});

test('011 T012 живьём: `elt oracle` ставит маркер, `elt commit` снимает', () => {
  const root = gateRepo();
  assert.equal(fs.existsSync(markerPath(root)), false, 'до гейта маркера нет');

  fs.writeFileSync(path.join(root, 'slice.txt'), 'работа слайса\n');
  assert.equal(elt(root, ['oracle']).status, 0);
  assert.equal(gateActive(root), true, 'оракул начал цепочку — чекпоинт замолчал');
  assert.equal(runCheckpointWriter(writerArgs(root)).reason, 'gate-active', 'и это не теория');

  assert.equal(elt(root, ['judge', 'run', '--task', 'T001', '--invoke', stubBridge(judgeOut('pass'))]).status, 0);
  assert.equal(gateActive(root), true, 'между судьёй и коммитом молчание продолжается');

  const c = elt(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(c.status, 0, c.stderr);
  assert.equal(gateActive(root), false, 'цепочка закончилась — чекпоинту снова можно');
  assert.equal(runCheckpointWriter(writerArgs(root)).wrote, true);
});

test('011 T012 живьём: block судьи снимает маркер — попытка кончилась, ждать TTL незачем', () => {
  const root = gateRepo();
  fs.writeFileSync(path.join(root, 'slice.txt'), 'работа слайса\n');
  assert.equal(elt(root, ['oracle']).status, 0);
  assert.equal(gateActive(root), true);
  assert.equal(elt(root, ['judge', 'run', '--task', 'T001', '--invoke', stubBridge(judgeOut('block'))]).status, 4);
  assert.equal(gateActive(root), false, 'блок = конец попытки, чекпоинт не должен ждать полчаса');
});

// ---------------------------------------------------------------------------
// 020 T001 / D25 — три регресса. Четвёртый (gateActive глушит запись во время
// oracle→judge→commit) уже живёт выше: «011 T012 живьём». Дублировать не за чем.
// ---------------------------------------------------------------------------

test('D25: opus-5 получает окно 1M, small-модели — 200k', () => {
  // Дефект: в BIG_MODEL стояли sonnet-5 и fable-5, но НЕ opus-5. Рабочая модель
  // попадала в small-профиль, и ротация срабатывала вчетверо раньше нужного.
  for (const id of ['claude-opus-5', 'opus-5', 'claude-sonnet-5', 'claude-fable-5', 'opus', 'sonnet']) {
    assert.equal(profileFor(id).window, 1000000, `${id} обязан быть big-профилем`);
    assert.equal(profileFor(id).stage2, 200000, `${id}: порог ротации big`);
  }
  for (const id of ['claude-haiku-4-5-20251001', 'haiku', '', undefined]) {
    assert.equal(profileFor(id).window, 200000, `${id}: small-профиль 200k`);
    assert.equal(profileFor(id).stage2, 120000, `${id}: порог ротации small`);
  }
});

test('D25: ручной хвост чекпоинта переживает ПОВТОРНУЮ ротацию', () => {
  // Дефект: файл перезаписывался целиком, и дописанные руками resume-инструкции
  // стирались на второй ротации того же дня — ровно то, ради чего его читают.
  const root = gateRepo();
  const args = writerArgs(root);

  assert.equal(runCheckpointWriter(args).wrote, true);
  const file = path.join(root, '.planning', autoCheckpoints(root)[0]);

  const manual = 'НЕ ТЕРЯТЬ: сначала добить T007, ключ лежит в elt-verify-bg.js';
  fs.appendFileSync(file, `\n${manual}\n`, 'utf8');

  // вторая ротация той же сессии: токены выросли выше repeat-порога
  const bump = (tok) => fs.writeFileSync(args.transcriptPath, JSON.stringify({
    message: { model: 'claude-sonnet-4', usage: { input_tokens: tok } },
  }) + '\n');

  bump(400000);
  assert.equal(runCheckpointWriter(args).wrote, true, 'вторая ротация состоялась');
  let text = fs.readFileSync(file, 'utf8');
  assert.ok(text.includes(manual), 'ручной хвост пережил первую перезапись');
  assert.ok(text.includes('## Resume Prompt'), 'машинная часть на месте и обновлена');

  bump(800000);
  assert.equal(runCheckpointWriter(args).wrote, true, 'третья ротация состоялась');
  text = fs.readFileSync(file, 'utf8');
  assert.equal(text.split(manual).length - 1, 1, 'хвост сохранён РОВНО один раз, без размножения');
  assert.equal(autoCheckpoints(root).length, 1, 'ротация не плодит файлы за один день');
});

test('D25: развёрнутый хук находит CLI проверяемого проекта, а не только соседа', () => {
  // Дефект: findEltJs() смотрел лишь на path.join(__dirname, 'elt.js'). В
  // ~/.claude/hooks/ соседа нет — `elt status` возвращал null, и чекпоинт писался
  // БЕЗ следующего слайса. Тест поднимает копию хука в каталоге без соседа.
  const root = gateRepo();
  const deployDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-hook-deploy-'));
  roots.push(deployDir);
  const deployed = path.join(deployDir, 'checkpoint-writer.js');
  fs.copyFileSync(path.join(__dirname, 'checkpoint-writer.js'), deployed);
  assert.equal(fs.existsSync(path.join(deployDir, 'elt.js')), false, 'у копии нет соседа — как в hooks/');

  const hook = require(deployed);
  const projectCli = path.join(root, 'tools', 'elt.js');
  fs.mkdirSync(path.dirname(projectCli), { recursive: true });
  fs.copyFileSync(ELT, projectCli);

  assert.equal(hook.findEltJs(root), projectCli, 'CLI проекта найден из каталога без соседа');
  assert.equal(hook.findEltJs(null), null, 'без проекта и без соседа — честный null, не чужой путь');
  // сосед по каталогу остаётся кандидатом для модуля плагина
  assert.equal(findEltJs(null), ELT, 'в tools/ приоритет соседа сохранён');
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
