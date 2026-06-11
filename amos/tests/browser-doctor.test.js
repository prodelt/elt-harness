const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const path = require('path');
const os = require('os');

const { checkBrowserHealth, repairBrowser, runBrowserDoctor } = require('../lib/browser-doctor.js');

const AMOS_DIR = process.env.AMOS_HOME || path.join(os.homedir(), '.amos');
const AMOS_JS = path.join(AMOS_DIR, 'bin', 'amos.js');

function runAmos(args, env = {}) {
  const spawnEnv = { ...process.env, ...env };
  if (!env.hasOwnProperty('AMOS_PROFILE')) delete spawnEnv.AMOS_PROFILE;
  if (!env.hasOwnProperty('AMOS_DISABLE')) delete spawnEnv.AMOS_DISABLE;
  const result = cp.spawnSync('node', [AMOS_JS, ...args], { env: spawnEnv, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// ==========================================
// checkBrowserHealth — mocked runner
// ==========================================

test('checkBrowserHealth: healthy agent-browser -> versionOk + doctorOk', () => {
  const runner = (cmd) => {
    if (cmd === 'agent-browser --version') return 'agent-browser 0.27.1\n';
    if (cmd === 'agent-browser doctor --offline --quick') return 'OK\n';
    throw new Error('unexpected command: ' + cmd);
  };
  const health = checkBrowserHealth(runner);
  assert.strictEqual(health.versionOk, true);
  assert.strictEqual(health.version, 'agent-browser 0.27.1');
  assert.strictEqual(health.doctorOk, true);
});

test('checkBrowserHealth: missing agent-browser binary -> versionOk false, error set', () => {
  const runner = () => { throw new Error('command not found: agent-browser'); };
  const health = checkBrowserHealth(runner);
  assert.strictEqual(health.versionOk, false);
  assert.match(health.error, /not found/);
});

test('checkBrowserHealth: version OK but doctor fails -> doctorOk false', () => {
  const runner = (cmd) => {
    if (cmd === 'agent-browser --version') return 'agent-browser 0.27.1\n';
    throw new Error('chrome not found');
  };
  const health = checkBrowserHealth(runner);
  assert.strictEqual(health.versionOk, true);
  assert.strictEqual(health.doctorOk, false);
});

// ==========================================
// repairBrowser — mocked runner
// ==========================================

test('repairBrowser: both steps succeed -> repaired true', () => {
  const calls = [];
  const runner = (cmd) => { calls.push(cmd); return ''; };
  const result = repairBrowser(runner);
  assert.strictEqual(result.repaired, true);
  assert.deepStrictEqual(calls, ['npm i -g agent-browser', 'agent-browser install']);
  assert.ok(result.steps.every(s => s.ok));
});

test('repairBrowser: npm install fails -> repaired false, second step not run', () => {
  const calls = [];
  const runner = (cmd) => {
    calls.push(cmd);
    if (cmd === 'npm i -g agent-browser') throw new Error('network error');
    return '';
  };
  const result = repairBrowser(runner);
  assert.strictEqual(result.repaired, false);
  assert.deepStrictEqual(calls, ['npm i -g agent-browser']);
  assert.strictEqual(result.steps[0].ok, false);
});

// ==========================================
// runBrowserDoctor — "сломан искусственно -> doctor чинит -> smoke PASS"
// ==========================================

test('runBrowserDoctor: healthy agent-browser -> ok=true, no repair attempted', () => {
  const runner = (cmd) => {
    if (cmd === 'agent-browser --version') return 'agent-browser 0.27.1\n';
    if (cmd === 'agent-browser doctor --offline --quick') return 'OK\n';
    throw new Error('repair should not run: ' + cmd);
  };
  const result = runBrowserDoctor({ repair: true, runner });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.repairResult, null);
  assert.ok(result.lines.some(l => l.startsWith('[PASS] agent-browser CLI:')));
});

test('runBrowserDoctor: broken without --repair reports FAIL + manual hint, no repair', () => {
  let versionCalls = 0;
  const runner = (cmd) => {
    if (cmd === 'agent-browser --version') { versionCalls++; throw new Error('command not found'); }
    throw new Error('unexpected: ' + cmd);
  };
  const result = runBrowserDoctor({ repair: false, runner });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(versionCalls, 1);
  assert.ok(result.lines.some(l => l.includes('[FAIL] agent-browser CLI')));
  assert.ok(result.lines.some(l => l.includes('--repair')));
});

test('runBrowserDoctor: broken agent-browser is auto-repaired and re-checked PASS', () => {
  let versionCalls = 0;
  const calls = [];
  const runner = (cmd) => {
    calls.push(cmd);
    if (cmd === 'agent-browser --version') {
      versionCalls++;
      if (versionCalls === 1) throw new Error('command not found: agent-browser');
      return 'agent-browser 0.27.1\n';
    }
    if (cmd === 'agent-browser doctor --offline --quick') return 'OK\n';
    if (cmd === 'npm i -g agent-browser') return '';
    if (cmd === 'agent-browser install') return '';
    throw new Error('unexpected command: ' + cmd);
  };

  const result = runBrowserDoctor({ repair: true, runner });

  // Pre-repair: broken
  assert.ok(result.lines.some(l => l.includes('[FAIL] agent-browser CLI: not found')));
  // Repair attempted
  assert.ok(result.repairResult);
  assert.strictEqual(result.repairResult.repaired, true);
  assert.ok(calls.includes('npm i -g agent-browser'));
  assert.ok(calls.includes('agent-browser install'));
  // Post-repair: smoke PASS
  assert.ok(result.lines.some(l => l.includes('[PASS] agent-browser CLI (post-repair):')));
  assert.ok(result.lines.some(l => l.includes('[PASS] agent-browser doctor --offline --quick (post-repair): OK')));
  assert.strictEqual(result.ok, true);
});

test('runBrowserDoctor: repair fails -> stays broken, ok=false', () => {
  const runner = (cmd) => {
    if (cmd === 'agent-browser --version') throw new Error('command not found');
    if (cmd === 'npm i -g agent-browser') throw new Error('network error');
    throw new Error('unexpected: ' + cmd);
  };
  const result = runBrowserDoctor({ repair: true, runner });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.repairResult.repaired, false);
  assert.ok(result.lines.some(l => l.includes('[FAIL] npm i -g agent-browser')));
});

// ==========================================
// CLI integration — `amos doctor browser`
// ==========================================

test('amos doctor browser: real environment smoke (header + sections present)', () => {
  const res = runAmos(['doctor', 'browser']);
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /\[AMOS DOCTOR: BROWSER\]/);
  assert.match(res.stdout, /agent-browser CLI/);
  assert.match(res.stdout, /Browser tooling: (OK|ISSUES FOUND)/);
});

test('amos doctor: full report includes Browser Tooling section', () => {
  const res = runAmos(['doctor']);
  assert.strictEqual(res.status, 0);
  assert.match(res.stdout, /Browser Tooling:/);
  assert.match(res.stdout, /agent-browser CLI/);
});

test('amos doctor: AMOS_DISABLE=1 -> exits 0 silently for browser subcommand too', () => {
  const res = runAmos(['doctor', 'browser'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout.trim(), '');
});
