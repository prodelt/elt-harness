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
function run(root, args, env) {
  return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
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
// stubBridgeSrc(marker) — минимальный судья-мост для тестов резолва (T003): не гоняет
// реального провайдера, читает дескриптор и печатает pass-JSON с УНИКАЛЬНЫМ по маркеру
// reasons — так тест на приоритет explicit>local>global различает, КАКОЙ именно мост
// реально выбрал резолв (codex-судья T003 забраковал версию с одинаковым результатом у
// всех трёх мостов как недоказательную — см. run-log).
function stubBridgeSrc(marker) {
  return [
    "'use strict';",
    "const fs = require('fs');",
    "const descPath = process.argv[2];",
    "if (!descPath) { process.stderr.write('usage: stub <descriptor.json>\\n'); process.exit(2); }",
    "JSON.parse(fs.readFileSync(descPath, 'utf8'));",
    `process.stdout.write(JSON.stringify({ runOk: true, verdict: 'pass', reasons: ['stub:${marker}'], judges: [], grounding: {} }));`,
  ].join('\n');
}

function fixture({ verify = null, redProofMode, localBridge = false } = {}) {
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
  // localBridge — ДО oracle: файл в дереве, добавленный ПОСЛЕ прогона, делает proof stale
  // (та же ловушка, что 010-T001 живьём — см. CHECKPOINT-2026-07-29).
  if (localBridge) {
    fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(root, 'tools', 'judge-invoke.js'), stubBridgeSrc('local'));
  }
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

// 011 T019(а): зелёный red-proof больше не переворачивает работу в block — он даёт
// `inconclusive`. Пара «pass + green» при этом остаётся отказом (тест выше): такое сочетание
// может прийти только с пути, который правило T019 не прогнал, и молча провести его = вернуть
// дыру, ради которой контур писался.
test('011 T019: inconclusive + зелёный red-proof → validate ПРОПУСКАЕТ (сомнение записано, работа не блокируется)', () => {
  const root = fixture({ verify: { provider: 'agy', model: 'agy-model' } });
  const extra = fullExtra();
  extra.redProof = { status: 'green', reason: 'passes-on-base', files: ['x.test.js'], tail: '' };
  extra.judges = extra.judges.map((j) => ({ ...j, verdict: 'inconclusive' }));
  const extraFile = writeExtraFile(extra);
  run(root, ['judge-proof', 'write', '--task', 'T001', '--verdict', 'inconclusive', '--model', 'codex', '--extra-file', extraFile]);
  const v = run(root, ['judge-proof', 'validate', '--task', 'T001']);
  assert.equal(v.status, 0, v.stderr);
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

// T003 010: резолв судьи-моста — явный --invoke > локальный (tools/judge-invoke.js) >
// глобальный (~/.claude/bin/judge/judge-invoke.js, T002) > exit 4 с инструкцией sync-bin.js.

function fakeHome(withGlobalBridge) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-judge-contract-home-'));
  roots.push(home);
  if (withGlobalBridge) {
    const dir = path.join(home, '.claude', 'bin', 'judge');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'judge-invoke.js'), stubBridgeSrc('global'));
  }
  return home;
}

test('резолв: явный --invoke сильнее локального и глобального (различимый маркер доказывает выбор)', () => {
  const root = fixture({ localBridge: true }); // local-мост тоже присутствует и отвечал бы pass
  const home = fakeHome(true); // global-мост тоже присутствует и отвечал бы pass
  const explicitRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-judge-contract-explicit-'));
  roots.push(explicitRoot);
  const explicitInvoke = path.join(explicitRoot, 'bridge.js');
  fs.writeFileSync(explicitInvoke, stubBridgeSrc('explicit'));
  const r = run(root, ['judge', 'run', '--task', 'T001', '--invoke', explicitInvoke], { USERPROFILE: home, HOME: home });
  assert.equal(r.status, 0, r.stderr.toString());
  assert.deepEqual(result(r).reasons, ['stub:explicit'], 'резолв реально взял explicit-мост, не local/global');
});

test('резолв: локальный tools/judge-invoke.js используется без --invoke (различимый маркер доказывает выбор)', () => {
  const root = fixture({ localBridge: true });
  const home = fakeHome(true); // global тоже присутствует — different-marker доказывает, что взят именно local
  const r = run(root, ['judge', 'run', '--task', 'T001'], { USERPROFILE: home, HOME: home });
  assert.equal(r.status, 0, r.stderr.toString());
  assert.deepEqual(result(r).reasons, ['stub:local'], 'резолв реально взял local-мост, не global');
});

test('резолв: без локального падает на глобальный ~/.claude/bin/judge/', () => {
  const root = fixture({ localBridge: false });
  const home = fakeHome(true);
  const r = run(root, ['judge', 'run', '--task', 'T001'], { USERPROFILE: home, HOME: home });
  assert.equal(r.status, 0, r.stderr.toString());
  assert.deepEqual(result(r).reasons, ['stub:global']);
});

test('резолв: ни локального, ни глобального → exit 4 с инструкцией sync-bin.js', () => {
  const root = fixture({ localBridge: false });
  const home = fakeHome(false);
  const r = run(root, ['judge', 'run', '--task', 'T001'], { USERPROFILE: home, HOME: home });
  assert.equal(r.status, 4);
  assert.match(r.stderr.toString(), /sync-bin\.js/);
});

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
