const { execSync } = require('child_process');

// Default command runner — real shell execution. Tests inject a mock runner.
function defaultRunner(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
}

// Checks agent-browser CLI presence + offline doctor smoke
function checkBrowserHealth(runner = defaultRunner) {
  const result = { versionOk: false, version: null, doctorOk: false, doctorOutput: '', error: null };

  try {
    result.version = String(runner('agent-browser --version')).trim();
    result.versionOk = true;
  } catch (e) {
    result.error = e.message;
    return result;
  }

  try {
    result.doctorOutput = String(runner('agent-browser doctor --offline --quick'));
    result.doctorOk = true;
  } catch (e) {
    result.doctorOutput = String((e.stdout || '') + (e.message || ''));
    result.doctorOk = false;
  }

  return result;
}

// Auto-repair: reinstall agent-browser CLI + download its bundled Chrome
function repairBrowser(runner = defaultRunner) {
  const steps = [];

  try {
    runner('npm i -g agent-browser');
    steps.push({ step: 'npm i -g agent-browser', ok: true });
  } catch (e) {
    steps.push({ step: 'npm i -g agent-browser', ok: false, error: e.message });
    return { repaired: false, steps };
  }

  try {
    runner('agent-browser install');
    steps.push({ step: 'agent-browser install', ok: true });
  } catch (e) {
    steps.push({ step: 'agent-browser install', ok: false, error: e.message });
    return { repaired: false, steps };
  }

  return { repaired: true, steps };
}

// Runs the browser health check, optionally auto-repairing on failure
function runBrowserDoctor({ repair = false, runner = defaultRunner } = {}) {
  const lines = [];
  let health = checkBrowserHealth(runner);

  lines.push(health.versionOk
    ? `[PASS] agent-browser CLI: ${health.version}`
    : `[FAIL] agent-browser CLI: not found (${health.error || 'unknown error'})`);

  if (health.versionOk) {
    lines.push(health.doctorOk
      ? '[PASS] agent-browser doctor --offline --quick: OK'
      : '[FAIL] agent-browser doctor --offline --quick: failed');
  }

  let repairResult = null;
  const broken = !health.versionOk || !health.doctorOk;

  if (broken && repair) {
    lines.push('[INFO] Auto-repair: npm i -g agent-browser && agent-browser install');
    repairResult = repairBrowser(runner);
    for (const step of repairResult.steps) {
      lines.push(step.ok ? `[PASS] ${step.step}` : `[FAIL] ${step.step}: ${step.error}`);
    }

    if (repairResult.repaired) {
      health = checkBrowserHealth(runner);
      lines.push(health.versionOk
        ? `[PASS] agent-browser CLI (post-repair): ${health.version}`
        : '[FAIL] agent-browser CLI (post-repair): still missing');
      if (health.versionOk) {
        lines.push(health.doctorOk
          ? '[PASS] agent-browser doctor --offline --quick (post-repair): OK'
          : '[FAIL] agent-browser doctor --offline --quick (post-repair): failed');
      }
    }
  } else if (broken) {
    lines.push('[INFO] Run `amos doctor browser --repair` to attempt: npm i -g agent-browser && agent-browser install');
  }

  return { ok: health.versionOk && health.doctorOk, lines, health, repairResult };
}

module.exports = { checkBrowserHealth, repairBrowser, runBrowserDoctor, defaultRunner };
