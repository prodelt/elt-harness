const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Portable paths — work on any machine, overridable via AMOS_HOME env
const AMOS_DIR = process.env.AMOS_HOME || path.join(os.homedir(), '.amos');
const AMOS_JS = path.join(AMOS_DIR, 'bin', 'amos.js');

function runAmos(args, env = {}) {
  const spawnEnv = { ...process.env, ...env };
  if (!env.hasOwnProperty('AMOS_PROFILE')) delete spawnEnv.AMOS_PROFILE;
  if (!env.hasOwnProperty('AMOS_DISABLE')) delete spawnEnv.AMOS_DISABLE;
  const result = cp.spawnSync('node', [AMOS_JS, ...args], { env: spawnEnv, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeFixtureConfig(dir, name, content) {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, JSON.stringify(content), 'utf8');
  return filePath;
}

// ==========================================
// Hook Integration Checks (S2.3)
// `amos doctor` reports whether `amos event session-start` is wired into
// SessionStart hooks for Claude / Codex / Gemini.
// ==========================================

test('doctor: reports INFO when client config files do not exist', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-doctor-missing-'));
  try {
    const res = runAmos(['doctor'], {
      AMOS_CLAUDE_SETTINGS: path.join(tmpDir, 'claude-settings.json'),
      AMOS_CODEX_HOOKS: path.join(tmpDir, 'codex-hooks.json'),
      AMOS_GEMINI_SETTINGS: path.join(tmpDir, 'gemini-settings.json')
    });
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('[INFO] Claude SessionStart Hook: config not found'));
    assert.ok(res.stdout.includes('[INFO] Codex SessionStart Hook: config not found'));
    assert.ok(res.stdout.includes('[INFO] Gemini SessionStart Hook: config not found'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('doctor: reports PASS when amos event session-start is wired', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-doctor-wired-'));
  try {
    const wired = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'node "C:/Users/user/.amos/bin/amos.js" event session-start' }] }
        ]
      }
    };
    const claudePath = writeFixtureConfig(tmpDir, 'claude-settings.json', wired);
    const codexPath = writeFixtureConfig(tmpDir, 'codex-hooks.json', wired);
    const geminiPath = writeFixtureConfig(tmpDir, 'gemini-settings.json', wired);

    const res = runAmos(['doctor'], {
      AMOS_CLAUDE_SETTINGS: claudePath,
      AMOS_CODEX_HOOKS: codexPath,
      AMOS_GEMINI_SETTINGS: geminiPath
    });
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('[PASS] Claude SessionStart Hook: amos event session-start configured'));
    assert.ok(res.stdout.includes('[PASS] Codex SessionStart Hook: amos event session-start configured'));
    assert.ok(res.stdout.includes('[PASS] Gemini SessionStart Hook: amos event session-start configured'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('doctor: reports WARN when SessionStart exists but amos hook is missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-doctor-unwired-'));
  try {
    const unwired = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'node "C:/Users/user/.claude/hooks/session-focus-gate.js"' }] }
        ]
      }
    };
    const claudePath = writeFixtureConfig(tmpDir, 'claude-settings.json', unwired);

    const res = runAmos(['doctor'], {
      AMOS_CLAUDE_SETTINGS: claudePath,
      AMOS_CODEX_HOOKS: path.join(tmpDir, 'missing-codex.json'),
      AMOS_GEMINI_SETTINGS: path.join(tmpDir, 'missing-gemini.json')
    });
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('[WARN] Claude SessionStart Hook: amos event session-start not found'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('doctor: reports WARN for malformed client config JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-doctor-malformed-'));
  try {
    const claudePath = path.join(tmpDir, 'claude-settings.json');
    fs.writeFileSync(claudePath, '{ not valid json', 'utf8');

    const res = runAmos(['doctor'], {
      AMOS_CLAUDE_SETTINGS: claudePath,
      AMOS_CODEX_HOOKS: path.join(tmpDir, 'missing-codex.json'),
      AMOS_GEMINI_SETTINGS: path.join(tmpDir, 'missing-gemini.json')
    });
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('[WARN] Claude SessionStart Hook: failed to parse'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
