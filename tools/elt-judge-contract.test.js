'use strict';
// 008 T004: контракт proof — judges[]/grounding/redProof. Круг включён (judge.verify задан
// ИЛИ harness.json.redProof != "off") → elt commit/judge-proof validate требует все три поля
// и отвергает зелёный red-proof; круг выключен → старое поведение (обратная совместимость).

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}
function run(root, args) {
  return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' });
}
function result(run_) {
  return JSON.parse(run_.stdout.toString());
}
// ВНЕ репо (os.tmpdir(), не root) — extra-файл внутри рабочего дерева был бы untracked-файлом
// и сам менял бы treeHash между `oracle` и `judge-proof write`, ломая stale-oracle-proof чек
// (та же причина, по которой elt-loop.ps1 берёт temp-файл из системного tmpdir, не из проекта).
function writeExtraFile(extra) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-judge-contract-extra-')) + path.sep + 'extra.json';
  fs.writeFileSync(p, JSON.stringify(extra));
  return p;
}

// verify: null → круг выключен; {provider,model} → круг включён через двойного судью.
// redProofMode: undefined → не задан, 'off' → явно выключен, любая другая строка → включён.
function fixture({ verify = null, redProofMode } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-judge-contract-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# fixture\n');
  fs.mkdirSync(path.join(root, '.harness'));
  const cfg = { kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, judge: { enabled: true, model: 'codex' } };
  if (verify) cfg.judge.verify = verify;
  if (redProofMode !== undefined) cfg.redProof = redProofMode;
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify(cfg));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** first\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  fs.writeFileSync(path.join(root, 'slice.txt'), 'change\n');
  assert.equal(run(root, ['oracle']).status, 0);
  return root;
}
function fullExtra() {
  return {
    judges: [{ provider: 'codex', model: 'codex', verdict: 'pass' }, { provider: 'agy', model: 'agy-model', verdict: 'pass' }],
    grounding: { filesReviewed: ['slice.txt'] },
    redProof: { status: 'red', reason: 'fails-on-base', files: ['x.test.js'], tail: '' },
  };
}

test('круг включён (verify) + полный proof → validate ok', () => {
  const root = fixture({ verify: { provider: 'agy', model: 'agy-model' } });
  const extraFile = writeExtraFile(fullExtra());
  const write = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex', '--extra-file', extraFile]);
  assert.equal(write.status, 0, write.stderr.toString());
  const v = run(root, ['judge-proof', 'validate', '--task', 'T001']);
  assert.equal(v.status, 0, v.stderr.toString());
  assert.equal(result(v).ok, true);
});

test('круг включён + урезанный proof (без redProof) → validate отвергает missing-redProof', () => {
  const root = fixture({ verify: { provider: 'agy', model: 'agy-model' } });
  const extra = fullExtra();
  delete extra.redProof;
  const extraFile = writeExtraFile(extra);
  run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex', '--extra-file', extraFile]);
  const v = run(root, ['judge-proof', 'validate', '--task', 'T001']);
  assert.equal(v.status, 4);
  assert.equal(result(v).reason, 'missing-redProof');
});

test('круг включён + урезанный proof (без judges) → validate отвергает missing-judges', () => {
  const root = fixture({ redProofMode: 'on' });
  const extra = fullExtra();
  delete extra.judges;
  const extraFile = writeExtraFile(extra);
  run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex', '--extra-file', extraFile]);
  const v = run(root, ['judge-proof', 'validate', '--task', 'T001']);
  assert.equal(v.status, 4);
  assert.equal(result(v).reason, 'missing-judges');
});

test('круг включён + зелёный red-proof → validate отвергает red-proof-green (слайс не доказан)', () => {
  const root = fixture({ verify: { provider: 'agy', model: 'agy-model' } });
  const extra = fullExtra();
  extra.redProof = { status: 'green', reason: 'passes-on-base', files: ['x.test.js'], tail: '' };
  const extraFile = writeExtraFile(extra);
  run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex', '--extra-file', extraFile]);
  const v = run(root, ['judge-proof', 'validate', '--task', 'T001']);
  assert.equal(v.status, 4);
  assert.equal(result(v).reason, 'red-proof-green');
});

test('круг включён + полный proof → elt commit проходит (реальная точка проверки, не только validate)', () => {
  const root = fixture({ verify: { provider: 'agy', model: 'agy-model' } });
  const extraFile = writeExtraFile(fullExtra());
  run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex', '--extra-file', extraFile]);
  const c = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(c.status, 0, c.stderr.toString());
});

test('круг включён + урезанный proof → elt commit падает exit 4, НЕ коммитит', () => {
  const root = fixture({ redProofMode: 'on' });
  const extra = fullExtra();
  delete extra.grounding;
  const extraFile = writeExtraFile(extra);
  run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex', '--extra-file', extraFile]);
  const c = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(c.status, 4);
  const log = git(root, ['log', '--oneline']);
  assert.equal(log.trim().split('\n').length, 1, 'коммита слайса быть не должно — только seed');
});

test('круг выключен (нет verify, redProof не задан) → старое поведение: proof без extra проходит', () => {
  const root = fixture();
  const write = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex']);
  assert.equal(write.status, 0, write.stderr.toString());
  const v = run(root, ['judge-proof', 'validate', '--task', 'T001']);
  assert.equal(v.status, 0, v.stderr.toString());
  assert.equal(result(v).ok, true);
});

test('круг выключен явно (redProof:"off") → старое поведение сохраняется', () => {
  const root = fixture({ redProofMode: 'off' });
  const write = run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'pass', '--model', 'codex']);
  assert.equal(write.status, 0, write.stderr.toString());
  const c = run(root, ['commit', '--task', 'T001', '--skip-oracle']);
  assert.equal(c.status, 0, c.stderr.toString());
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
