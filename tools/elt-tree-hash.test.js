'use strict';
// 024 T003 — пруф о дереве не зависит от ИНДЕКСАЦИИ.
//
// До этой спеки `treeHash()` складывал в sha256 строки `git status --porcelain` дословно,
// вместе с двухсимвольной колонкой кода. Колонка меняется от `git add`, не трогая ни байта
// содержимого: `" M f"` → `"M  f"`, `"?? g"` → `"A  g"`. А `elt commit` делает `git add -A`
// ровно МЕЖДУ записью пруфа и его сверкой в pre-commit хуке, поэтому в режиме
// `verify: "background"` доверенный путь гейта не мог совпасть НИКОГДА — и `elt commit` при
// включённом хуке был непроходим в принципе.
//
// Тест дискриминирующий: на коде до 024 T003 обе первые проверки красные.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function run(root, args, env = {}) {
  return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
}
function sha256(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
function proofPath(root) { return path.join(git(root, ['rev-parse', '--git-dir']).replace(/^/, root + path.sep), 'elt-oracle-proof.json'); }
function readProofRaw(root) {
  const dir = git(root, ['rev-parse', '--absolute-git-dir']);
  return fs.readFileSync(path.join(dir, 'elt-oracle-proof.json'), 'utf8');
}

function fixture({ planLayout = 'spec-dir' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-tree-hash-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL,
    branchPolicy: 'feature', verify: 'background', specApproval: false,
    judge: { enabled: true, model: 'codex' },
  }));
  const plan = planLayout === 'root' ? path.join(root, 'tasks.md')
    : path.join(root, 'specs', '001-fixture', 'tasks.md');
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  fs.writeFileSync(plan, '- [ ] **T001** fixture task\n');
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  git(root, ['checkout', '-qb', 'work']);
  // Слайс: правка отслеживаемого файла + новый файл. Оба класса и ломались индексацией.
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'changed\n');
  fs.writeFileSync(path.join(root, 'brand-new.txt'), 'new\n');
  return { root, plan };
}

after(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } } });

test('024 T003: доверенный пруф переживает `git add -A` между снятием и сверкой', () => {
  const { root } = fixture();
  assert.equal(run(root, ['oracle']).status, 0);
  const trust = sha256(readProofRaw(root));

  // Хук `elt gate` вызывается ИЗ `git commit`, то есть уже после `git add -A`.
  git(root, ['add', '-A']);
  const gate = run(root, ['gate'], { ELT_GATE_TRUST_ORACLE: trust });
  assert.equal(gate.status, 0, `гейт обязан принять свой же пруф после индексации:\n${gate.stdout}${gate.stderr}`);
});

test('024 T003: `elt commit` проходит при ВКЛЮЧЁННОМ managed-хуке (verify: background)', () => {
  const { root } = fixture();
  // Ровно та установка, которую делает `project-bootstrap apply --apply`.
  fs.mkdirSync(path.join(root, '.githooks'), { recursive: true });
  const hook = path.join(root, '.githooks', 'pre-commit');
  // Прямые слэши намеренно: хук исполняет sh (на Windows — тот, что приходит с Git for
  // Windows), а в его двойных кавычках обратный слэш перед некоторыми символами съедается.
  // Windows-путь через прямые слэши понимают одинаково и sh, и node; через обратные — нет.
  const posix = (p) => String(p).replace(/\\/g, '/');
  fs.writeFileSync(hook, `#!/bin/sh\nexec "${posix(process.execPath)}" "${posix(ELT)}" gate\n`, { mode: 0o755 });
  git(root, ['config', 'core.hooksPath', '.githooks']);
  fs.chmodSync(hook, 0o755);

  const before = Number(git(root, ['rev-list', '--count', 'HEAD']));
  const r = run(root, ['commit', '--task', 'T001', '-m', 'feat: T001 slice']);
  assert.equal(r.status, 0, `коммит под собственным хуком:\n${r.stdout}${r.stderr}`);
  assert.equal(Number(git(root, ['rev-list', '--count', 'HEAD'])), before + 1, 'коммит обязан появиться');
});

test('024 T003: чувствительность сохранена — правка содержимого после пруфа отвергается', () => {
  const { root } = fixture();
  assert.equal(run(root, ['oracle']).status, 0);
  const trust = sha256(readProofRaw(root));
  // Не индексация, а НАСТОЯЩАЯ правка: гейт обязан её увидеть, иначе фикс превратил бы
  // пруф в бумажку, принимающую любое дерево.
  fs.appendFileSync(path.join(root, 'tracked.txt'), 'sneaked in after the proof\n');
  git(root, ['add', '-A']);
  const gate = run(root, ['gate'], { ELT_GATE_TRUST_ORACLE: trust });
  assert.notEqual(gate.status, 0, 'изменение содержимого после пруфа обязано быть отвергнуто');
});

test('024 T003: новый файл после пруфа отвергается и до, и после индексации', () => {
  for (const stage of [false, true]) {
    const { root } = fixture();
    assert.equal(run(root, ['oracle']).status, 0);
    const trust = sha256(readProofRaw(root));
    fs.writeFileSync(path.join(root, 'sneaked.txt'), 'not covered by the proof\n');
    if (stage) git(root, ['add', '-A']);
    const gate = run(root, ['gate'], { ELT_GATE_TRUST_ORACLE: trust });
    assert.notEqual(gate.status, 0, `новый файл после пруфа (staged=${stage}) обязан быть отвергнут`);
  }
});

test('024 T003: маркер задачи нормализуется и в раскладке с КОРНЕВЫМ tasks.md', () => {
  // `planPath` знал только `specs/<dir>/tasks.md`, а `findTasks()` принимает ещё корневой
  // `tasks.md` и `specs/tasks.md`. В такой раскладке `[X]` от markDone оставался в диффе,
  // и доверенный путь отказывал на задаче, которая уже помечена закрытой.
  const { root, plan } = fixture({ planLayout: 'root' });
  assert.equal(run(root, ['oracle']).status, 0);
  const trust = sha256(readProofRaw(root));
  fs.writeFileSync(plan, '- [X] **T001** fixture task\n'); // ровно то, что делает markDone
  git(root, ['add', '-A']);
  const gate = run(root, ['gate'], { ELT_GATE_TRUST_ORACLE: trust });
  assert.equal(gate.status, 0, `маркер задачи в корневом плане обязан прощаться:\n${gate.stdout}${gate.stderr}`);
});

// ── 024 (ревью) ──────────────────────────────────────────────────────────────
// Две дыры того же класса, что и исходный дефект: хеш зависел от формы вывода git, а форма
// настраивается ПОЛЬЗОВАТЕЛЕМ и меняется индексацией.

test('024 (ревью): пруф не слепнет при diff.noprefix в чужом .gitconfig', () => {
  // `diff.noprefix` (и `diff.mnemonicPrefix`) убирает `a/`…`b/` из заголовка. Разбор блоков
  // диффа переставал находить хоть один файл, и ВЕСЬ дифф выпадал из хеша — то есть пруф
  // переставал видеть правки отслеживаемых файлов вовсе, при том что печатал «дерево сверено».
  const { root } = fixture();
  git(root, ['config', 'diff.noprefix', 'true']);
  assert.equal(run(root, ['oracle']).status, 0);
  const trust = sha256(readProofRaw(root));
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'СОВСЕМ другое содержимое\n');
  git(root, ['add', '-A']);
  const gate = run(root, ['gate'], { ELT_GATE_TRUST_ORACLE: trust });
  assert.notEqual(gate.status, 0, `правка обязана быть видна и при diff.noprefix:\n${gate.stdout}${gate.stderr}`);
});

test('024 (ревью): переименование файла не ломает пруф индексацией', () => {
  // До индексации git видит `D old` + `?? new`; после `git add -A` — одну строку
  // `R old -> new` плюс rename-блок в диффе. Это ровно та зависимость от индексации, ради
  // снятия которой писался T003, и слайс с переносом файла был непроходим под своим же хуком.
  const { root } = fixture();
  fs.writeFileSync(path.join(root, 'moveme.txt'), 'содержимое для переноса\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'add movable file']);

  assert.equal(run(root, ['oracle']).status, 0);
  const trust = sha256(readProofRaw(root));
  // Переименование ПОСЛЕ пруфа обязано быть отвергнуто — и до, и после индексации одинаково.
  fs.renameSync(path.join(root, 'moveme.txt'), path.join(root, 'moved.txt'));
  const beforeStage = run(root, ['gate'], { ELT_GATE_TRUST_ORACLE: trust });
  assert.notEqual(beforeStage.status, 0, 'перенос после пруфа — изменение дерева');
  git(root, ['add', '-A']);
  const afterStage = run(root, ['gate'], { ELT_GATE_TRUST_ORACLE: trust });
  assert.notEqual(afterStage.status, 0, 'и после индексации тоже');
});

test('024 (ревью): слайс с переносом файла коммитится под управляемым хуком', () => {
  // Обратная сторона: раз перенос виден одинаково до и после `git add -A`, пруф, снятый
  // ПОСЛЕ переноса, обязан пройти. До канонизации вывода git такой слайс был непроходим.
  const { root } = fixture();
  fs.writeFileSync(path.join(root, 'moveme.txt'), 'содержимое для переноса\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'add movable file']);

  const posix = (p) => String(p).replace(/\\/g, '/');
  fs.mkdirSync(path.join(root, '.githooks'), { recursive: true });
  const hook = path.join(root, '.githooks', 'pre-commit');
  fs.writeFileSync(hook, `#!/bin/sh\nexec "${posix(process.execPath)}" "${posix(ELT)}" gate\n`, { mode: 0o755 });
  git(root, ['config', 'core.hooksPath', '.githooks']);
  fs.chmodSync(hook, 0o755);

  fs.renameSync(path.join(root, 'moveme.txt'), path.join(root, 'moved.txt'));
  const before = Number(git(root, ['rev-list', '--count', 'HEAD']));
  const r = run(root, ['commit', '--task', 'T001', '-m', 'feat: T001 move a file']);
  assert.equal(r.status, 0, `слайс с переносом:\n${r.stdout}${r.stderr}`);
  assert.equal(Number(git(root, ['rev-list', '--count', 'HEAD'])), before + 1);
});
