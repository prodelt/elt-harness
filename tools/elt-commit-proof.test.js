'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function run(root, args) { return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' }); }
function commitCount(root) { return Number(git(root, ['rev-list', '--count', 'HEAD'])); }
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-commit-proof-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, branchPolicy: 'feature', judge: { enabled: true, model: 'codex' },
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** fixture\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  git(root, ['checkout', '-qb', 'work']);
  fs.writeFileSync(path.join(root, 'slice.txt'), 'change\n');
  return root;
}
function writeProof(root, verdict = 'pass') {
  assert.equal(run(root, ['oracle']).status, 0);
  const proof = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', verdict, '--model', 'codex']);
  assert.equal(proof.status, 0, proof.stderr.toString());
}
function assertRejected(root, args = []) {
  const before = commitCount(root);
  const result = run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'test commit', ...args]);
  assert.notEqual(result.status, 0, result.stderr.toString());
  assert.equal(commitCount(root), before, result.stderr.toString());
  assert.equal(git(root, ['diff', '--cached', '--name-only']), '', 'rejected commit must not stage files');
}

test('commit proof: missing, stale, block, and dead fail closed', () => {
  let root = fixture();
  assert.equal(run(root, ['oracle']).status, 0);
  assertRejected(root);

  root = fixture();
  writeProof(root);
  fs.appendFileSync(path.join(root, 'slice.txt'), 'after proof\n');
  assertRejected(root);

  root = fixture();
  writeProof(root, 'block');
  assertRejected(root);

  root = fixture();
  writeProof(root, 'dead');
  assertRejected(root);
});

test('commit proof: valid pass creates exactly one commit and rejects free verdict', () => {
  const root = fixture();
  writeProof(root);
  const before = commitCount(root);
  const result = run(root, ['commit', '--task', 'T001', '--skip-oracle', '-m', 'test commit']);
  assert.equal(result.status, 0, result.stderr.toString());
  assert.equal(commitCount(root), before + 1);
  assert.match(fs.readFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), 'utf8'), /\[X\] \*\*T001\*\*/);

  const fresh = fixture();
  writeProof(fresh);
  assertRejected(fresh, ['--verdict', 'pass']);
});

// 020 T009: провал push обязан возвращать НЕНУЛЕВОЙ код. До этой задачи он печатался в
// stderr, а команда выходила с 0: драйвер считал слайс доехавшим, коммита на remote не было,
// и для релизной цепочки (push/tag receipts) это прямой источник false-green.
test('T009: push провалился — exit non-zero, коммит при этом остаётся локально', () => {
  const root = fixture();
  writeProof(root);
  // origin указывает в никуда: push обязан упасть по-настоящему, без сети и без заглушек.
  git(root, ['remote', 'add', 'origin', path.join(root, 'no-such-remote.git')]);
  const before = commitCount(root);
  const r = run(root, ['commit', '--task', 'T001', '--skip-oracle', '--push', '-m', 'feat: T001']);
  assert.notEqual(r.status, 0, 'молчаливый 0 здесь и есть дефект');
  assert.match(r.stderr, /push FAILED/);
  assert.equal(commitCount(root), before + 1, 'локальный коммит не откатывается — он состоялся');
  assert.match(r.stdout, /push не прошёл/, 'человеку сказано, что на remote коммита нет');
});

test('T009: успешный push оставляет exit 0 — отказ не должен стать безусловным', () => {
  const root = fixture();
  writeProof(root);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-remote-'));
  roots.push(bare);
  execFileSync('git', ['init', '-q', '--bare', bare], { encoding: 'utf8' });
  git(root, ['remote', 'add', 'origin', bare]);
  const r = run(root, ['commit', '--task', 'T001', '--skip-oracle', '--push', '-m', 'feat: T001']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /pushed/);
});

// ── 020 T009 (поколение 2): фоновая ветка `elt gate` ─────────────────────────────────────
// Судья заблокировал первое поколение по существу: ветка `verify:"background"` с обходом
// `ELT_GATE_TRUST_ORACLE` была нетривиальной, security-relevant и НЕ покрытой ни одним тестом,
// хотя `.harness/harness.json` самого репозитория стоит на `background` — то есть этот код
// стережёт коммиты прямо здесь. Ниже покрыт каждый путь ветки, включая отрицательные.
function bgFixture() {
  const root = fixture();
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, branchPolicy: 'feature',
    verify: 'background', judge: { enabled: true, model: 'codex' },
  }));
  return root;
}
const gateRun = (root, env = {}) => spawnSync(process.execPath, [ELT, 'gate'], {
  cwd: root, encoding: 'utf8', env: { ...process.env, ...env },
});
const oracleProofPath = (root) => path.join(root, '.git', 'elt-oracle-proof.json');

test('T009 gen2: background без оракул-пруфа — гейт отказывает, а не пропускает', () => {
  const root = bgFixture();
  try { fs.unlinkSync(oracleProofPath(root)); } catch { /* его и не было */ }
  const r = gateRun(root);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /нет оракул-пруфа/);
});

test('T009 gen2: зелёный пруф, привязанный к ЭТОМУ дереву, проводит без всякого env', () => {
  const root = bgFixture();
  assert.equal(run(root, ['oracle']).status, 0);
  const r = gateRun(root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /привязан к этому дереву/);
});

test('T009 gen2: дерево уехало после оракула — отказ (иначе пруф ни к чему не привязан)', () => {
  const root = bgFixture();
  assert.equal(run(root, ['oracle']).status, 0);
  fs.writeFileSync(path.join(root, 'moved.txt'), 'дерево уехало\n');
  const r = gateRun(root);
  assert.equal(r.status, 4);
  assert.match(r.stderr, /не про это дерево|красный|отсутствует/);
});

test('T009 gen2: доверие к байтам пруфа НЕ проводит красный оракул', () => {
  const root = bgFixture();
  assert.equal(run(root, ['oracle']).status, 0);
  const raw = fs.readFileSync(oracleProofPath(root), 'utf8');
  const red = JSON.stringify({ ...JSON.parse(raw), exit: 1 });
  fs.writeFileSync(oracleProofPath(root), red);
  const trust = crypto.createHash('sha256').update(red).digest('hex');
  const r = gateRun(root, { ELT_GATE_TRUST_ORACLE: trust });
  assert.equal(r.status, 4, 'совпадение хеша байтов не делает красный оракул зелёным');
});

// 020 T009 (поколение 3). Судья нашёл дыру в поколении 2, и прошлый тест её ЗАКРЕПЛЯЛ:
// он двигал дерево посторонним файлом `moved.txt` и ждал pass. Значение
// `ELT_GATE_TRUST_ORACLE` считается из ПУБЛИЧНЫХ байтов `.git/elt-oracle-proof.json`, то есть
// доступно любому, кто может позвать `git commit`, — и при досрочном выходе из гейта оно
// проводило произвольную правку дерева. Ниже проверяется исправленная семантика: доверие
// прощает ровно одну известную мутацию (маркер задачи) и НИЧЕГО больше.
test('T009 gen3: доверие прощает смену [X], но не постороннюю правку дерева', () => {
  const root = bgFixture();
  fs.writeFileSync(path.join(root, 'slice.js'), '// код слайса\n');
  assert.equal(run(root, ['oracle']).status, 0);
  const raw = fs.readFileSync(oracleProofPath(root), 'utf8');
  const trust = crypto.createHash('sha256').update(raw).digest('hex');

  // Ровно то, ради чего доверенный путь заведён: `markDone()` ставит `[X]` после того, как
  // `elt commit` уже проверил пруф. Это обязано проходить.
  //
  // Кодовый файл в дереве обязателен: без него гейт отпускает коммит раньше, на документной
  // двери ('только .planning/** и specs/**'), и доверенная ветка вообще не выполняется — тест
  // проверял бы не то, что думает.
  const plan = path.join(root, 'specs', '001-fixture', 'tasks.md');
  fs.writeFileSync(plan, fs.readFileSync(plan, 'utf8').replace('- [ ] **T001**', '- [X] **T001**'));
  const good = gateRun(root, { ELT_GATE_TRUST_ORACLE: trust });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /trusted elt commit/);

  // А это — подделка: тот же вычислимый хеш плюс посторонний файл. Раньше проходило.
  fs.writeFileSync(path.join(root, 'moved.txt'), 'посторонняя правка после оракула\n');
  const smuggled = gateRun(root, { ELT_GATE_TRUST_ORACLE: trust });
  assert.equal(smuggled.status, 4, 'доверие не смеет проводить правку вне маркера задачи');
  assert.match(smuggled.stderr, /вне маркера задачи/);

  const forged = gateRun(root, { ELT_GATE_TRUST_ORACLE: 'f'.repeat(64) });
  assert.equal(forged.status, 4, 'чужой хеш обязан упасть на независимой проверке дерева');
});

// Пруф, записанный до появления нормализованного хеша, не имеет права молча получить
// доверенный проход: старая схема — это ровно то состояние, в котором дыра и жила.
test('T009 gen3: пруф старой схемы без нормализованного хеша не проходит доверием', () => {
  const root = bgFixture();
  fs.writeFileSync(path.join(root, 'slice.js'), '// код слайса\n');
  assert.equal(run(root, ['oracle']).status, 0);
  const parsed = JSON.parse(fs.readFileSync(oracleProofPath(root), 'utf8'));
  delete parsed.hashTaskMarksNormalized;
  const legacy = JSON.stringify(parsed);
  fs.writeFileSync(oracleProofPath(root), legacy);
  const r = gateRun(root, { ELT_GATE_TRUST_ORACLE: crypto.createHash('sha256').update(legacy).digest('hex') });
  assert.equal(r.status, 4);
  assert.match(r.stderr, /старой схемы/);
});

test('T009 gen2: прямой git commit с кодом в background-проекте отвергается хуком', () => {
  const root = bgFixture();
  fs.mkdirSync(path.join(root, '.githooks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.githooks', 'pre-commit'),
    fs.readFileSync(path.join(__dirname, '..', '.githooks', 'pre-commit'), 'utf8').split('\r\n').join('\n'), { mode: 0o755 });
  git(root, ['config', 'core.hooksPath', '.githooks']);
  try { fs.unlinkSync(oracleProofPath(root)); } catch { /* нет так нет */ }
  git(root, ['add', '-A']);
  const before = commitCount(root);
  const r = spawnSync('git', ['commit', '-q', '-m', 'прямой коммит кода'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ELT_CLI: ELT.split(path.sep).join('/') },
  });
  assert.notEqual(r.status, 0, 'дверь обязана быть закрыта и для прямого git commit');
  assert.equal(commitCount(root), before);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

// ── 024 T004 ─────────────────────────────────────────────────────────────────
// Кэш оракула лежит в `.git/` и в `treeHash` не входит по построению: записать туда ключи,
// посчитанные на СЛОМАННОМ дереве, значило получить `N/N passed in 0.0s`, exit 0 и зелёный
// пруф, не исполнив ни одного теста. Воспроизведено живьём. Поэтому пруф теперь несёт, сколько
// файлов ИСПОЛНЕНО, и «ноль исполнено при непустой выборке» — не зелёный прогон, а отсутствие
// проверки. Доверие к байтам пруфа на это не распространяется: `elt commit` передаёт хеш
// пруфа хуку, но содержание пруфа хук всё равно обязан прочесть.
function patchProof(root, patch) {
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir']);
  const file = path.join(gitDir, 'elt-oracle-proof.json');
  const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...proof, ...patch }));
  return file;
}

test('024 (ревью): тёплый кэш — законный зелёный прогон, гейт обязан его принять', () => {
  // Здесь стояло правило «ran === 0 при непустой выборке — не доказательство». Оно неверно:
  // второй подряд прогон оракула даёт ровно `ran: 0, cached: N, total: N`, потому что
  // замыкание тестов не изменилось. Правило ломало обычную работу — второй `elt commit`
  // подряд умирал exit 4, и выходом был только `--full`, о котором сообщение не говорило.
  // От подделки кэша защищает не эта эвристика (из пруфа подделка и тёплый кэш неотличимы
  // в принципе), а переезд кэша в `.git/elt/` и `--full` у бэкстопа `elt gate --ci`.
  const root = bgFixture();
  assert.equal(run(root, ['oracle']).status, 0);
  const file = patchProof(root, { ran: 0, cached: 42, total: 42 });
  const trust = crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8')).digest('hex');
  const gate = spawnSync(process.execPath, [ELT, 'gate'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ELT_GATE_TRUST_ORACLE: trust },
  });
  assert.equal(gate.status, 0, `тёплый кэш обязан проходить:\n${gate.stdout}${gate.stderr}`);
});

test('024 (ревью): elt gate --ci гоняет оракул мимо кэша', () => {
  // Бэкстоп CI кэшу не доверяет: на границе, где решается «пускать ли в main», подделанный
  // или протухший кэш проезжал бы там, где проверка дороже всего.
  const root = fixture();
  const marker = path.join(root, 'oracle-ran.txt');
  const cfgPath = path.join(root, '.harness', 'harness.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  // Оракул фикстуры печатает, ВИДИТ ли он ELT_ORACLE_FULL — так проверяется, что --ci
  // доносит full через границу процесса (shell-строка, а не argv).
  fs.writeFileSync(cfgPath, JSON.stringify({
    ...cfg,
    oracle: `node -e "require('fs').writeFileSync(${JSON.stringify(marker).replace(/"/g, '\\"')}, String(process.env.ELT_ORACLE_FULL))"`,
  }));
  const r = run(root, ['gate', '--ci']);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(fs.readFileSync(marker, 'utf8'), '1', 'gate --ci обязан выставить ELT_ORACLE_FULL=1');
});

test('024 T003/T004: пруф старой схемы отвергается по имени, а не загадкой про дерево', () => {
  const root = bgFixture();
  assert.equal(run(root, ['oracle']).status, 0);
  const file = patchProof(root, { proofSchema: 1 });
  const trust = crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8')).digest('hex');
  const gate = spawnSync(process.execPath, [ELT, 'gate'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ELT_GATE_TRUST_ORACLE: trust },
  });
  assert.notEqual(gate.status, 0);
  assert.match(`${gate.stdout}${gate.stderr}`, /перепрогони оракул/);
});
