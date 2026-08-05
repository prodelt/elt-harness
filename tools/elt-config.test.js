'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateHarnessConfig, verifySettings } = require('./elt-config');
const { scanProject, applyPlan } = require('./project-bootstrap');
const { checkHarnessConfig } = require('./doctor-core');

function tempProject(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-config-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# test fixture\n');
  fs.mkdirSync(path.join(root, '.harness'));
  if (config !== undefined) fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify(config));
  return root;
}

function validCodeConfig() {
  return {
    kind: 'code',
    oracle: 'node --test',
    shell: 'powershell',
    judge: { enabled: true, model: 'sonnet' },
  };
}

function testValidatorFailsClosed() {
  assert.equal(validateHarnessConfig({}).ok, false, 'missing kind and oracle must fail');
  assert.equal(validateHarnessConfig({ kind: 'code', oracle: '   ', judge: { enabled: true, model: 'sonnet' } }).ok, false, 'empty oracle must fail');
  assert.equal(validateHarnessConfig({ kind: 'docs', artifactVerifier: ' ', judge: { enabled: true, model: 'sonnet' } }).ok, false, 'empty artifact verifier must fail');
  assert.equal(validateHarnessConfig({ kind: 'code', oracle: 'node --test', judge: { enabled: 'yes', model: 'sonnet' } }).ok, false, 'malformed judge must fail');
  assert.equal(validateHarnessConfig(validCodeConfig()).ok, true, 'current code config must pass');

  // judge.provider: опционален (дефолт claude), но опечатка обязана падать на валидации, а не
  // в рантайме (unknown-provider → судья «мёртв» → слайс паркуется без внятной причины).
  const withProvider = (p) => ({ kind: 'code', oracle: 'node --test', judge: { enabled: true, model: 'sonnet', provider: p } });
  assert.equal(validateHarnessConfig(withProvider('agy')).ok, true, 'agy is a valid judge provider');
  assert.equal(validateHarnessConfig(withProvider('codex')).ok, true, 'codex is a valid judge provider');
  assert.equal(validateHarnessConfig(withProvider('gemini')).ok, false, 'unknown judge provider must fail');
  assert.equal(validateHarnessConfig(withProvider('')).ok, false, 'empty judge provider must fail');
}

function testBootstrapReportsInvalidHarness() {
  const root = tempProject({ kind: 'code', oracle: '', judge: { enabled: true, model: 'sonnet' } });
  const report = scanProject(root, { supplyChain: false });
  assert.equal(report.checks.harness.ok, false);
  assert.match(report.checks.harness.errors.join('\n'), /oracle/);
}

function testDoctorFailsInvalidHarness() {
  const root = tempProject({ kind: 'code', oracle: 'node --test', judge: { enabled: true, model: '' } });
  const check = checkHarnessConfig(root);
  assert.equal(check.status, 'fail');
  assert.match(check.detail, /judge/);
}

function testCliFailsClosed() {
  const cases = [
    ['missing', undefined],
    ['empty oracle', { kind: 'code', oracle: ' ', judge: { enabled: true, model: 'sonnet' } }],
    ['malformed judge', { kind: 'code', oracle: 'node --test', judge: { enabled: 'yes', model: 'sonnet' } }],
  ];

  for (const [label, config] of cases) {
    const root = tempProject(config);
    const elt = spawnSync(process.execPath, [path.join(__dirname, 'elt.js'), 'oracle'], { cwd: root });
    assert.notEqual(elt.status, 0, `elt CLI must fail for ${label} harness config`);

    const bootstrap = spawnSync(process.execPath, [path.join(__dirname, 'project-bootstrap.js'), '--root', root, '--no-supply-chain']);
    assert.notEqual(bootstrap.status, 0, `bootstrap CLI must fail for ${label} harness config`);

    const doctor = spawnSync(process.execPath, [path.join(__dirname, 'doctor.js'), '--root', root, '--json']);
    assert.notEqual(doctor.status, 0, `doctor CLI must fail for ${label} harness config`);
    const report = JSON.parse(doctor.stdout.toString());
    assert.ok(report.checks.some((check) => check.id === 'harness:config' && check.status === 'fail'), `doctor must report invalid config for ${label}`);
  }

  const valid = tempProject(validCodeConfig());
  const current = spawnSync(process.execPath, [path.join(__dirname, 'project-bootstrap.js'), '--root', valid, '--no-supply-chain']);
  assert.equal(current.status, 0, current.stderr.toString());
}

// ELT v3: новый проект получает один judge + red-proof, без второго LLM-вызова.
function testInitCreatesSingleJudgeCircuit() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-init-circuit-'));
  const init = spawnSync(process.execPath, [path.join(__dirname, 'elt.js'), 'init', '--oracle', 'node --test'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const cfg = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8'));
  assert.equal(validateHarnessConfig(cfg).ok, true, 'сгенерированный конфиг обязан быть схема-валидным');
  assert.equal(cfg.judge.attest, true, 'вердикт пишет только `elt judge run`');
  assert.equal(cfg.redProof, 'on');
  assert.equal(Object.hasOwn(cfg.judge, 'verify'), false, 'init не должен создавать legacy verify-on-pass');
  assert.equal(verifySettings(root), null, 'runtime всегда игнорирует legacy verify');
  fs.rmSync(root, { recursive: true, force: true });

  // Удалённые флаги отвергаются явно, а не создают конфиг, который runtime игнорирует.
  const same = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-init-same-'));
  const bad = spawnSync(process.execPath, [path.join(__dirname, 'elt.js'), 'init', '--oracle', 'node --test',
    '--judge-provider', 'codex', '--verify-provider', 'codex'], { cwd: same, encoding: 'utf8' });
  assert.equal(bad.status, 4, 'init обязан отказать на удалённых verify-флагах');
  assert.match(bad.stderr, /удалены в ELT v3/);
  assert.equal(fs.existsSync(path.join(same, '.harness', 'harness.json')), false, 'битый конфиг не создаётся');
  fs.rmSync(same, { recursive: true, force: true });
}

// project-bootstrap apply мигрирует живой проект: удаляет старый verify и оставляет red-proof.
function testBootstrapRemovesLegacyVerify() {
  const legacy = validCodeConfig();
  legacy.judge.verify = { provider: 'codex', model: 'gpt-5.6-sol' };
  const root = tempProject({ ...legacy, specApproval: true, ctx7Gate: 'warn' });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# fixture\n');
  // Патч контура — только для kind:code, а kind определяется наличием кода, не конфигом.
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'module.exports = 1;\n');
  const report = applyPlan(root, { supplyChain: false });
  const cfg = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8'));
  assert.equal(cfg.judge.attest, true, JSON.stringify(report.changes));
  assert.equal(cfg.redProof, 'on');
  assert.equal(Object.hasOwn(cfg.judge, 'verify'), false, JSON.stringify(report.changes));
  assert.equal(verifySettings(root), null);
  // circuitEnabled() ЖИВЬЁМ, а не пересказом её логики: при включённом контуре elt требует в
  // proof judges[]/grounding/redProof, и урезанный proof отвергается именно с missing-judges.
  // Поломка circuitEnabled() уронит этот assert, а копия условия — нет.
  assert.equal(circuitVerdictFor(root), 'missing-judges', 'CLI реально считает контур включённым');
  fs.rmSync(root, { recursive: true, force: true });
}

// Прогоняет проект через настоящий elt CLI: оракул → урезанный proof → validate. Причина
// отказа и есть ответ живой circuitEnabled().
// 011 T011: аварийного люка (`--skip-attest`) больше нет — при attest:true записать proof можно
// ТОЛЬКО через `elt judge run`. Урезанность отдаём стаб-мостом (без judges[]), а не флагом.
function circuitVerdictFor(root) {
  const elt = (...args) => spawnSync(process.execPath, [path.join(__dirname, 'elt.js'), ...args], { cwd: root, encoding: 'utf8' });
  const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** слайс\n');
  git('add', '-A'); git('commit', '-qm', 'seed');
  fs.writeFileSync(path.join(root, 'slice.txt'), 'работа\n');
  assert.equal(elt('oracle').status, 0, 'оракул фикстуры обязан быть зелёным');
  // Мост живёт ВНЕ дерева: файл в нём сдвинул бы treeHash и сделал оракул-пруф stale.
  const bridgeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-config-bridge-'));
  const bridge = path.join(bridgeDir, 'stub-invoke.js');
  fs.writeFileSync(bridge, `process.stdout.write(${JSON.stringify(JSON.stringify({ runOk: true, verdict: 'pass', reasons: ['ok'] }))});\n`);
  const write = elt('judge', 'run', '--task', 'T001', '--invoke', bridge);
  assert.equal(write.status, 0, write.stderr);
  fs.rmSync(bridgeDir, { recursive: true, force: true });
  const v = elt('judge-proof', 'validate', '--task', 'T001');
  return JSON.parse(v.stdout).reason;
}

function main() {
  testValidatorFailsClosed();
  testInitCreatesSingleJudgeCircuit();
  testBootstrapRemovesLegacyVerify();
  testBootstrapReportsInvalidHarness();
  testDoctorFailsInvalidHarness();
  testCliFailsClosed();
  process.stdout.write('elt config tests: PASS\n');
}

main();
