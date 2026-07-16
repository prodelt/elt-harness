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
          { hooks: [{ type: 'command', command: 'node "C:/Users/espad/.amos/bin/amos.js" event session-start' }] }
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
          { hooks: [{ type: 'command', command: 'node "C:/Users/espad/.claude/hooks/session-focus-gate.js"' }] }
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

// ==========================================
// Hook Integration Checks (S2.4)
// `amos doctor` reports whether `amos event stop` is wired into
// Stop hooks for Claude / Codex / Gemini.
// ==========================================

test('doctor: reports INFO for Stop hook when client config files do not exist', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-doctor-stop-missing-'));
  try {
    const res = runAmos(['doctor'], {
      AMOS_CLAUDE_SETTINGS: path.join(tmpDir, 'claude-settings.json'),
      AMOS_CODEX_HOOKS: path.join(tmpDir, 'codex-hooks.json'),
      AMOS_GEMINI_SETTINGS: path.join(tmpDir, 'gemini-settings.json')
    });
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('[INFO] Claude Stop Hook: config not found'));
    assert.ok(res.stdout.includes('[INFO] Codex Stop Hook: config not found'));
    assert.ok(res.stdout.includes('[INFO] Gemini Stop Hook: config not found'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('doctor: reports PASS when amos event stop is wired', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-doctor-stop-wired-'));
  try {
    const wired = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'node "C:/Users/espad/.amos/bin/amos.js" event session-start' }] }
        ],
        Stop: [
          { hooks: [{ type: 'command', command: 'node "C:/Users/espad/.amos/bin/amos.js" event stop' }] }
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
    assert.ok(res.stdout.includes('[PASS] Claude Stop Hook: amos event stop configured'));
    assert.ok(res.stdout.includes('[PASS] Codex Stop Hook: amos event stop configured'));
    assert.ok(res.stdout.includes('[PASS] Gemini Stop Hook: amos event stop configured'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('doctor: reports WARN when Stop exists but amos event stop hook is missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-doctor-stop-unwired-'));
  try {
    const unwired = {
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'node "C:/Users/espad/.claude/hooks/stop-verification.js"' }] }
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
    assert.ok(res.stdout.includes('[WARN] Claude Stop Hook: amos event stop not found'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('doctor: reports WARN for Stop hook on malformed client config JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-doctor-stop-malformed-'));
  try {
    const claudePath = path.join(tmpDir, 'claude-settings.json');
    fs.writeFileSync(claudePath, '{ not valid json', 'utf8');

    const res = runAmos(['doctor'], {
      AMOS_CLAUDE_SETTINGS: claudePath,
      AMOS_CODEX_HOOKS: path.join(tmpDir, 'missing-codex.json'),
      AMOS_GEMINI_SETTINGS: path.join(tmpDir, 'missing-gemini.json')
    });
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('[WARN] Claude Stop Hook: failed to parse'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ==========================================
// Hook Integration Checks (S3.x)
// `amos doctor` reports whether `amos event pre-tool` is wired into
// PreToolUse hooks for Claude / Codex / Gemini (Tool Policy Gate).
// ==========================================

test('doctor: reports INFO for PreToolUse hook when client config files do not exist', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-doctor-pretool-missing-'));
  try {
    const res = runAmos(['doctor'], {
      AMOS_CLAUDE_SETTINGS: path.join(tmpDir, 'claude-settings.json'),
      AMOS_CODEX_HOOKS: path.join(tmpDir, 'codex-hooks.json'),
      AMOS_GEMINI_SETTINGS: path.join(tmpDir, 'gemini-settings.json')
    });
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('[INFO] Claude PreToolUse Hook: config not found'));
    assert.ok(res.stdout.includes('[INFO] Codex PreToolUse Hook: config not found'));
    assert.ok(res.stdout.includes('[INFO] Gemini PreToolUse Hook: config not found'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('doctor: reports PASS when amos event pre-tool is wired', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-doctor-pretool-wired-'));
  try {
    const wired = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'mcp__claude-in-chrome|mcp__chrome-devtools|mcp__context7|WebSearch',
            hooks: [{ type: 'command', command: 'node "C:/Users/espad/.amos/bin/amos.js" event pre-tool' }]
          }
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
    assert.ok(res.stdout.includes('[PASS] Claude PreToolUse Hook: amos event pre-tool configured'));
    assert.ok(res.stdout.includes('[PASS] Codex PreToolUse Hook: amos event pre-tool configured'));
    assert.ok(res.stdout.includes('[PASS] Gemini PreToolUse Hook: amos event pre-tool configured'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('doctor: reports WARN when PreToolUse exists but amos event pre-tool hook is missing', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-doctor-pretool-unwired-'));
  try {
    const unwired = {
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'node "C:/Users/espad/.claude/hooks/secret-scanner.js"' }] }
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
    assert.ok(res.stdout.includes('[WARN] Claude PreToolUse Hook: amos event pre-tool not found'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
