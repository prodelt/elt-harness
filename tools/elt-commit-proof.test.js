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

test('T009 gen2: доверие проводит ровно ТЕ байты, что назвал elt commit', () => {
  const root = bgFixture();
  assert.equal(run(root, ['oracle']).status, 0);
  const raw = fs.readFileSync(oracleProofPath(root), 'utf8');
  // Дерево двигаем намеренно: доверенный путь существует именно ради этого случая (между
  // валидацией в `elt commit` и хуком меняется `[X]` в tasks.md).
  fs.writeFileSync(path.join(root, 'moved.txt'), 'как после markDone\n');
  const good = gateRun(root, { ELT_GATE_TRUST_ORACLE: crypto.createHash('sha256').update(raw).digest('hex') });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /trusted elt commit/);

  const forged = gateRun(root, { ELT_GATE_TRUST_ORACLE: 'f'.repeat(64) });
  assert.equal(forged.status, 4, 'чужой хеш обязан упасть на независимой проверке дерева');
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
