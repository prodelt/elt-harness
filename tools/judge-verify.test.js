'use strict';

// ELT v3 regression: старое judge.verify может ещё лежать в чужом harness.json, но runtime
// обязан вызвать ровно одного judge. Иначе обновление глобального ELT снова включит прежний
// каскад и вернёт ложные блокировки без каких-либо изменений в проекте.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gate = require('./fleet/gate');

test('legacy judge.verify игнорируется: запускается один judge', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-verify-ignored-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code',
    oracle: 'node --version',
    judge: {
      enabled: true,
      provider: 'claude',
      model: 'sonnet',
      verify: { provider: 'agy', model: 'gemini-3.6-flash-high' },
    },
    l0: { hotPaths: ['slice.txt'] },
  }));
  fs.mkdirSync(path.join(root, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'tasks.md'), '- [ ] **T1** demo\n');
  const primary = path.join(root, 'primary.js');
  const secondary = path.join(root, 'secondary.js');
  const marker = path.join(root, 'secondary-called.marker');
  fs.writeFileSync(primary, "console.log(JSON.stringify({verdict:'pass',reasons:['ok']}));\n");
  fs.writeFileSync(secondary,
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'called'); console.log(JSON.stringify({verdict:'block',reasons:['legacy']}));\n`);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: root });
  fs.writeFileSync(path.join(root, 'slice.txt'), 'work\n');

  process.env.FLEET_BIN_CLAUDE = JSON.stringify([process.execPath, primary]);
  process.env.FLEET_BIN_AGY = JSON.stringify([process.execPath, secondary]);
  t.after(() => {
    delete process.env.FLEET_BIN_CLAUDE;
    delete process.env.FLEET_BIN_AGY;
  });

  const result = await gate.runJudge({ cwd: root, tid: 'T1', taskText: 'demo', provider: 'claude', model: 'sonnet' });
  assert.equal(result.runOk, true);
  assert.equal(result.verdict, 'pass');
  assert.deepEqual(result.judges.filter((j) => j.runOk).map((j) => j.provider), ['claude']);
  assert.equal(fs.existsSync(marker), false, 'legacy verify CLI не должен запускаться');
});

test('solo judge сохраняет red-proof и для inconclusive', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-inconclusive-proof-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node --version', redProof: 'on',
    judge: { enabled: true, provider: 'claude', model: 'sonnet' },
    l0: { hotPaths: ['slice.txt'] },
  }));
  fs.writeFileSync(path.join(root, 'slice.txt'), 'base\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'seed'], { cwd: root });
  fs.writeFileSync(path.join(root, 'slice.txt'), 'work\n');

  const helperDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-inconclusive-cli-'));
  t.after(() => fs.rmSync(helperDir, { recursive: true, force: true }));
  const stub = path.join(helperDir, 'judge.js');
  fs.writeFileSync(stub, "console.log(JSON.stringify({verdict:'inconclusive',reasons:['diff truncated'],filesReviewed:['slice.txt']}));\n");
  const descriptor = path.join(helperDir, 'judge-desc.json');
  fs.writeFileSync(descriptor, JSON.stringify({ cwd: root, tid: 'T1', taskText: 'demo [files:slice.txt]', provider: 'claude', model: 'sonnet' }));
  const run = spawnSync(process.execPath, [path.join(__dirname, 'judge-invoke.js'), descriptor], {
    cwd: root, encoding: 'utf8', env: { ...process.env, FLEET_BIN_CLAUDE: JSON.stringify([process.execPath, stub]) },
  });
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.verdict, 'inconclusive');
  assert.equal(output.redProof.status, 'skipped');
});
