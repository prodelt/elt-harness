'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateHarnessConfig } = require('./elt-config');
const { scanProject } = require('./project-bootstrap');
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

function main() {
  testValidatorFailsClosed();
  testBootstrapReportsInvalidHarness();
  testDoctorFailsInvalidHarness();
  testCliFailsClosed();
  process.stdout.write('elt config tests: PASS\n');
}

main();
