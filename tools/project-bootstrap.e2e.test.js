#!/usr/bin/env node
'use strict';
// T011 — deterministic project-bootstrap live-fire on a disposable temp repo.
// One test drives the full lifecycle a real adopted project goes through:
// apply x2 (idempotent) -> red oracle -> green implementation fixture ->
// stub judge proof -> guarded commit (via the bootstrap-produced $HOME hook,
// not a hand-installed one) -> clean tree. No paid API/LLM call anywhere —
// the judge proof is written directly through the CLI, same as a stub judge.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const { applyPlan, verifyProject } = require('./project-bootstrap');

const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];
const homes = [];

function git(root, home, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } }).trim();
}
function gitTry(root, home, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
}
function commitCount(root, home) { return Number(git(root, home, ['rev-list', '--count', 'HEAD'])); }

// 019 T015: раньше хук бутстрапнутого проекта звал `$HOME/.claude/bin/elt.js`, и фикстура
// клала туда срез из четырёх файлов. Срез и был источником целого класса дефектов (D16, D18):
// он отставал от репо молча и разваливался на пятом соседе. Теперь хук зовёт CLI плагина по
// запечённому пути, а HOME остаётся одноразовым только ради git-конфига фикстуры.
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-e2e-home-'));
  homes.push(home);
  return home;
}

const ELT_CLI = path.join(__dirname, 'elt.js');
function runElt(root, home, args) {
  return spawnSync(process.execPath, [ELT_CLI, ...args], { cwd: root, encoding: 'utf8' });
}

function fixture(home) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-e2e-'));
  roots.push(root);
  git(root, home, ['init', '-q']);
  git(root, home, ['config', 'user.email', 'test@example.com']);
  git(root, home, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo"}\n');
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code',
    oracle: 'node oracle-check.js',
    shell: SHELL,
    branchPolicy: 'feature',
    judge: { enabled: true, model: 'sonnet' },
  }, null, 2));
  // Deterministic stand-in oracle: red until IMPLEMENTED.txt exists, green after.
  fs.writeFileSync(path.join(root, 'oracle-check.js'), "process.exit(require('fs').existsSync('IMPLEMENTED.txt') ? 0 : 1);\n");
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** live-fire slice\n');
  git(root, home, ['add', '-A']);
  git(root, home, ['commit', '-qm', 'seed']);
  git(root, home, ['checkout', '-qb', 'work']);
  return root;
}

test('project-bootstrap live-fire: apply x2, red->green oracle, stub judge proof, guarded commit, clean tree', () => {
  const home = makeHome();
  const root = fixture(home);

  // apply x2: first creates scaffolding, second is a true no-op (idempotent).
  const first = applyPlan(root, { home });
  assert.equal(first.blocked.length, 0, JSON.stringify(first.blocked));
  assert.ok(first.changes.some((c) => c.id === 'project-docs'));
  assert.ok(first.changes.some((c) => c.id === 'planning-state'));
  assert.ok(first.changes.some((c) => c.id === 'git-gate'));
  assert.ok(fs.existsSync(path.join(root, '.githooks', 'pre-commit')));

  const second = applyPlan(root, { home });
  assert.deepEqual(second.changes, []);

  // Land the bootstrap scaffolding before the gate is even enabled.
  git(root, home, ['add', '-A']);
  git(root, home, ['commit', '-qm', 'chore: project-bootstrap apply']);

  // Enable the managed gate exactly as documented ("once per clone").
  git(root, home, ['config', 'core.hooksPath', '.githooks']);

  // Red oracle: implementation fixture not written yet.
  const redOracle = runElt(root, home, ['oracle']);
  assert.notEqual(redOracle.status, 0, redOracle.stderr);

  // Guarded commit, negative path: code change staged, no judge proof yet ->
  // the bootstrap-produced $HOME hook must block it, not a repo-local stand-in.
  fs.writeFileSync(path.join(root, 'IMPLEMENTED.txt'), 'ok\n');
  git(root, home, ['add', '-A']);
  const before = commitCount(root, home);
  const blocked = gitTry(root, home, ['commit', '-qm', 'implement T001']);
  assert.notEqual(blocked.status, 0);
  assert.equal(commitCount(root, home), before);

  // Green oracle now that the fixture exists.
  const greenOracle = runElt(root, home, ['oracle']);
  assert.equal(greenOracle.status, 0, greenOracle.stderr);

  // Stub judge proof — no LLM/paid API call.
  // 009 T003: bootstrap включает контур (judge.attest + verify + redProof), поэтому proof
  // обязан нести полный набор полей контура. 011 T011: аварийного люка (`--skip-attest`)
  // больше нет — при attest:true записать proof можно ТОЛЬКО через `elt judge run`, поэтому
  // стабом подменяется мост судьи, а не проверка. Это и есть проверка, что bootstrap реально
  // включил контур: убери поля контура из ответа моста — и гейт откажет.
  const bridge = path.join(root, '..', 'stub-judge-bridge.js');   // вне дерева: treeHash
  fs.writeFileSync(bridge, `process.stdout.write(${JSON.stringify(JSON.stringify({
    runOk: true, verdict: 'pass', reasons: ['deterministic live-fire stub'],
    judges: [{ provider: 'codex', model: 'stub-e2e', verdict: 'pass', runOk: true }],
    grounding: { filesReviewed: ['IMPLEMENTED.txt'] },
    redProof: { status: 'red' },
  }))});\n`);
  const proof = runElt(root, home, ['judge', 'run', '--task', 'T001', '--invoke', bridge]);
  assert.equal(proof.status, 0, proof.stderr);
  assert.equal(JSON.parse(proof.stdout).verdict, 'pass', 'proof написан машинным путём');

  // Guarded commit, positive path: same staged tree, now with a valid proof.
  const allowed = gitTry(root, home, ['commit', '-qm', 'implement T001']);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(commitCount(root, home), before + 1);

  // Clean tree, verified both directly and through the T010 verify contract.
  assert.equal(git(root, home, ['status', '--porcelain']), '');
  const verify = verifyProject(root, { supplyChain: false });
  assert.equal(verify.signals.cleanTree.ok, true);
  assert.equal(verify.contracts.docs.ok, true);
  assert.equal(verify.contracts.harnessConfig.ok, true);
  assert.equal(verify.contracts.oracleVerifier.ok, true);
  assert.equal(verify.contracts.gate.ok, true);
  assert.equal(verify.ok, true);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
});
