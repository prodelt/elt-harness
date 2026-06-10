const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Portable paths — work on any machine, overridable via AMOS_HOME env
const AMOS_DIR = process.env.AMOS_HOME || path.join(os.homedir(), '.amos');
const AMOS_JS = path.join(AMOS_DIR, 'bin', 'amos.js');
const ERRORS_LOG = path.join(AMOS_DIR, 'errors.log');
const STATE_SQLITE = path.join(AMOS_DIR, 'state.sqlite');

// Backups of the real user environment files
let backupErrorsLog = null;
let backupStateSqlite = null;

// Backup files helper
function backupEnv() {
  try {
    if (fs.existsSync(ERRORS_LOG)) {
      backupErrorsLog = fs.readFileSync(ERRORS_LOG);
      fs.unlinkSync(ERRORS_LOG);
    }
    if (fs.existsSync(STATE_SQLITE)) {
      backupStateSqlite = fs.readFileSync(STATE_SQLITE);
      fs.unlinkSync(STATE_SQLITE);
    }
  } catch (err) {
    console.error('Failed to backup environment files:', err);
  }
}

// Restore files helper
function restoreEnv() {
  try {
    if (fs.existsSync(ERRORS_LOG)) {
      fs.unlinkSync(ERRORS_LOG);
    }
    if (fs.existsSync(STATE_SQLITE)) {
      fs.unlinkSync(STATE_SQLITE);
    }
    if (backupErrorsLog !== null) {
      fs.writeFileSync(ERRORS_LOG, backupErrorsLog);
    }
    if (backupStateSqlite !== null) {
      fs.writeFileSync(STATE_SQLITE, backupStateSqlite);
    }
  } catch (err) {
    console.error('Failed to restore environment files:', err);
  }
}

// Initialize clean state for each test
function cleanLogsAndDb() {
  try {
    if (fs.existsSync(ERRORS_LOG)) {
      fs.unlinkSync(ERRORS_LOG);
    }
    if (fs.existsSync(STATE_SQLITE)) {
      fs.unlinkSync(STATE_SQLITE);
    }
  } catch (e) {}
}

// Perform backups at startup
backupEnv();

// Register restore on exit
process.on('exit', () => {
  restoreEnv();
});

// Run amos process helper
function runAmos(args, env = {}, stdin = null) {
  const spawnEnv = {
    ...process.env,
    ...env
  };
  // Delete AMOS_PROFILE and AMOS_DISABLE from spawnEnv if they are not explicitly set
  // to avoid pollution from the outer test runner environment.
  if (!env.hasOwnProperty('AMOS_PROFILE')) {
    delete spawnEnv.AMOS_PROFILE;
  }
  if (!env.hasOwnProperty('AMOS_DISABLE')) {
    delete spawnEnv.AMOS_DISABLE;
  }

  const options = {
    env: spawnEnv,
    encoding: 'utf8'
  };
  if (stdin !== null) {
    options.input = typeof stdin === 'string' ? stdin : JSON.stringify(stdin);
  }

  const result = cp.spawnSync('node', [AMOS_JS, ...args], options);
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

// ==========================================
// CATEGORY 1: Bypass Mode (AMOS_DISABLE=1)
// ==========================================

test('1. Bypass mode: exits with code 0 on session-start', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'session-start'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.status, 0);
});

test('2. Bypass mode: exits with code 0 on stop', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'stop'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.status, 0);
});

test('3. Bypass mode: exits with code 0 on status', () => {
  cleanLogsAndDb();
  const res = runAmos(['status'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.status, 0);
});

test('4. Bypass mode: exits with code 0 on doctor', () => {
  cleanLogsAndDb();
  const res = runAmos(['doctor'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.status, 0);
});

test('5. Bypass mode: exits with code 0 on report', () => {
  cleanLogsAndDb();
  const res = runAmos(['report'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.status, 0);
});

test('6. Bypass mode: exits with code 0 on version', () => {
  cleanLogsAndDb();
  const res = runAmos(['version'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.status, 0);
});

test('7. Bypass mode: exits with code 0 on unknown command', () => {
  cleanLogsAndDb();
  const res = runAmos(['unknown_command'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.status, 0);
});

test('8. Bypass mode: outputs nothing to stdout on session-start', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'session-start'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.stdout, '');
});

test('9. Bypass mode: outputs nothing to stdout on stop', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'stop'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.stdout, '');
});


// ==========================================
// CATEGORY 2: Unknown Commands and Events
// ==========================================

test('10. Unknown command: exits with code 0', () => {
  cleanLogsAndDb();
  const res = runAmos(['nonexistent_cmd']);
  assert.strictEqual(res.status, 0);
});

test('11. Unknown command: outputs nothing to stdout', () => {
  cleanLogsAndDb();
  const res = runAmos(['nonexistent_cmd']);
  assert.strictEqual(res.stdout, '');
});

test('12. Unknown event: exits with code 0', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'nonexistent_event']);
  assert.strictEqual(res.status, 0);
});

test('13. Unknown event: outputs nothing to stdout', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'nonexistent_event']);
  assert.strictEqual(res.stdout, '');
});

test('14. Empty arguments: exits with code 0', () => {
  cleanLogsAndDb();
  const res = runAmos([]);
  assert.strictEqual(res.status, 0);
});

test('15. Empty arguments: outputs nothing to stdout', () => {
  cleanLogsAndDb();
  const res = runAmos([]);
  assert.strictEqual(res.stdout, '');
});


// ==========================================
// CATEGORY 3: Profiles (minimal, standard, strict)
// ==========================================

test('16. Profile standard (default): status output', () => {
  cleanLogsAndDb();
  const res = runAmos(['status']);
  assert.ok(res.stdout.includes('Profile: standard'));
  assert.ok(res.stdout.includes('AMOS CLI Status: OK'));
});

test('17. Profile minimal: status output', () => {
  cleanLogsAndDb();
  const res = runAmos(['status'], { AMOS_PROFILE: 'minimal' });
  assert.strictEqual(res.stdout.trim(), 'AMOS Status: OK');
});

test('18. Profile strict: status output', () => {
  cleanLogsAndDb();
  const res = runAmos(['status'], { AMOS_PROFILE: 'strict' });
  assert.ok(res.stdout.includes('Profile: strict'));
  assert.ok(res.stdout.includes('Rules: Enforced'));
});

test('19. Profile case-insensitivity: MINIMAL works', () => {
  cleanLogsAndDb();
  const res = runAmos(['status'], { AMOS_PROFILE: 'MINIMAL' });
  assert.strictEqual(res.stdout.trim(), 'AMOS Status: OK');
});

test('20. Profile case-insensitivity: STRICT works', () => {
  cleanLogsAndDb();
  const res = runAmos(['status'], { AMOS_PROFILE: 'STRICT' });
  assert.ok(res.stdout.includes('Profile: strict'));
});

test('21. Profile invalid: falls back to standard', () => {
  cleanLogsAndDb();
  const res = runAmos(['status'], { AMOS_PROFILE: 'invalid_profile_name' });
  assert.ok(res.stdout.includes('Profile: standard'));
});


// ==========================================
// CATEGORY 4: Event Routing: session-start
// ==========================================

test('22. Event session-start: outputs valid JSON format', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'session-start']);
  assert.strictEqual(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.hookSpecificOutput);
  assert.ok(parsed.hookSpecificOutput.additionalContext);
});

test('23. Event session-start: standard profile contents', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'session-start'], { AMOS_PROFILE: 'standard' });
  const parsed = JSON.parse(res.stdout);
  const context = parsed.hookSpecificOutput.additionalContext;
  assert.ok(context.includes('AMOS Resume Pointer'));
  assert.ok(context.includes('Focus: Kernel Core CLI'));
  assert.ok(context.includes('Bootstrap'));
  assert.ok(!context.includes('Strict rules: active'));
});

test('24. Event session-start: minimal profile contents', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'session-start'], { AMOS_PROFILE: 'minimal' });
  const parsed = JSON.parse(res.stdout);
  const context = parsed.hookSpecificOutput.additionalContext;
  // Path is machine-dependent — check structure, not exact string
  assert.ok(context.includes('AMOS Resume Pointer:'));
  assert.ok(context.includes('.amos'));
  assert.ok(!context.includes('Focus:'), 'minimal should not include Focus line');
});

test('25. Event session-start: strict profile contents', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'session-start'], { AMOS_PROFILE: 'strict' });
  const parsed = JSON.parse(res.stdout);
  const context = parsed.hookSpecificOutput.additionalContext;
  assert.ok(context.includes('Focus: Kernel Core CLI'));
  assert.ok(context.includes('Strict rules: active'));
  assert.ok(context.includes('Rules enforcement: 100%'));
});

test('26. Event session-start: output size is under 2KB budget', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'session-start'], { AMOS_PROFILE: 'strict' });
  const byteLength = Buffer.byteLength(res.stdout, 'utf8');
  assert.ok(byteLength < 2048, `Output size is ${byteLength} bytes, which exceeds the 2KB budget.`);
});

test('27. Event session-start: can receive event name from stdin JSON', () => {
  cleanLogsAndDb();
  const res = runAmos(['event'], {}, { hook_event_name: 'session-start' });
  assert.strictEqual(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.hookSpecificOutput.additionalContext);
});

test('28. Event session-start: CLI argument takes priority over stdin JSON event name', () => {
  cleanLogsAndDb();
  // Call with event 'session-start' via CLI, but 'stop' in JSON stdin
  const res = runAmos(['event', 'session-start'], {}, { hook_event_name: 'stop' });
  assert.strictEqual(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  // Verify it output session-start structure, not stop structure
  assert.ok(parsed.hookSpecificOutput);
  assert.strictEqual(parsed.decision, undefined);
});


// ==========================================
// CATEGORY 5: Event Routing: stop
// ==========================================

test('29. Event stop (standard): defaults to allow', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'stop'], { AMOS_PROFILE: 'standard' });
  assert.strictEqual(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.decision, 'allow');
  assert.ok(parsed.reason);
});

test('30. Event stop (minimal): defaults to allow', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'stop'], { AMOS_PROFILE: 'minimal' });
  assert.strictEqual(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.decision, 'allow');
});

test('31. Event stop (strict): allows session when no violations', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'stop'], { AMOS_PROFILE: 'strict' }, { data: { violations: [] } });
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.decision, 'allow');
});

test('32. Event stop (strict): blocks session when violations are present', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'stop'], { AMOS_PROFILE: 'strict' }, { data: { violations: ['lint-error', 'secret-leak'] } });
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(parsed.reason.includes('Rule violations detected'));
  assert.ok(parsed.reason.includes('lint-error'));
});

test('33. Event stop (strict): blocks session when forceBlock is true', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'stop'], { AMOS_PROFILE: 'strict' }, { data: { forceBlock: true } });
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(parsed.reason.includes('forceBlock'));
});

test('34. Event stop (standard): blocks session when forceBlock is true', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'stop'], { AMOS_PROFILE: 'standard' }, { data: { forceBlock: true } });
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.decision, 'block');
  assert.ok(parsed.reason.includes('forceBlock'));
});

test('35. Event stop (standard): allows session even when violations are present', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'stop'], { AMOS_PROFILE: 'standard' }, { data: { violations: ['lint-error'] } });
  const parsed = JSON.parse(res.stdout);
  assert.strictEqual(parsed.decision, 'allow');
});


// ==========================================
// CATEGORY 6: Fail-Soft Logic and Error Handling
// ==========================================

test('36. Fail-soft: DB error during report command logs to errors.log', () => {
  cleanLogsAndDb();
  runAmos(['report'], { TRIGGER_DB_ERROR: '1' });
  assert.ok(fs.existsSync(ERRORS_LOG));
  const logContent = fs.readFileSync(ERRORS_LOG, 'utf8');
  assert.ok(logContent.includes('Simulated database corruption error'));
});

test('37. Fail-soft: DB error during report command exits with 0', () => {
  cleanLogsAndDb();
  const res = runAmos(['report'], { TRIGGER_DB_ERROR: '1' });
  assert.strictEqual(res.status, 0);
});

test('38. Fail-soft: DB error during report command produces empty stdout', () => {
  cleanLogsAndDb();
  const res = runAmos(['report'], { TRIGGER_DB_ERROR: '1' });
  assert.strictEqual(res.stdout, '');
});

test('39. Fail-soft: DB error during event session-start logs to errors.log', () => {
  cleanLogsAndDb();
  runAmos(['event', 'session-start'], { TRIGGER_DB_ERROR: '1' });
  assert.ok(fs.existsSync(ERRORS_LOG));
  const logContent = fs.readFileSync(ERRORS_LOG, 'utf8');
  assert.ok(logContent.includes('Simulated database corruption error'));
});

test('40. Fail-soft: DB error during event session-start exits with 0', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'session-start'], { TRIGGER_DB_ERROR: '1' });
  assert.strictEqual(res.status, 0);
});

test('41. Fail-soft: DB error during event session-start produces empty stdout', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'session-start'], { TRIGGER_DB_ERROR: '1' });
  assert.strictEqual(res.stdout, '');
});

test('42. Fail-soft: corrupt/invalid JSON on stdin logs error and exits with 0', () => {
  cleanLogsAndDb();
  const res = runAmos(['event', 'session-start'], {}, 'this-is-not-valid-json');
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, '');
  assert.ok(fs.existsSync(ERRORS_LOG));
  const logContent = fs.readFileSync(ERRORS_LOG, 'utf8');
  assert.ok(logContent.includes('Invalid JSON input'));
});

test('43. Fail-soft: errors.log writing failure (e.g. read-only file) is swallowed and doesn\'t crash', () => {
  cleanLogsAndDb();
  // Simulate read-only errors.log by creating a directory with the name errors.log
  // so writing to it will throw an EISDIR error.
  if (fs.existsSync(ERRORS_LOG)) {
    fs.unlinkSync(ERRORS_LOG);
  }
  fs.mkdirSync(ERRORS_LOG);

  try {
    const res = runAmos(['event', 'session-start'], { TRIGGER_DB_ERROR: '1' });
    // Should still exit 0 and not crash
    assert.strictEqual(res.status, 0);
    assert.strictEqual(res.stdout, '');
  } finally {
    // Cleanup the directory so normal restoration can work
    fs.rmdirSync(ERRORS_LOG);
  }
});


// ==========================================
// CATEGORY 7: Basic Command Executions
// ==========================================

test('44. Version command: outputs version 0.1.0', () => {
  cleanLogsAndDb();
  const res = runAmos(['version']);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout.trim(), '0.1.0');
});

test('45. Doctor command: outputs PASS/diagnostic lines', () => {
  cleanLogsAndDb();
  const res = runAmos(['doctor']);
  assert.strictEqual(res.status, 0);
  assert.ok(res.stdout.includes('Node.js Version'));
  assert.ok(res.stdout.includes('Environment'));
  assert.ok(res.stdout.includes('Workspace Directory'));
});


// ==========================================
// CATEGORY 8: Handoff Write/Read (S2.1)
// ==========================================

test('46. Event stop: structured handoff is written and readable via resume', () => {
  cleanLogsAndDb();
  const sessionId = 'sess-handoff-' + Date.now();
  const stopRes = runAmos(['event', 'stop'], {}, {
    session_id: sessionId,
    data: {
      task: 'Implement S2.1 handoff write/read',
      phase: 'implement',
      changed_files: ['bin/amos.js', 'lib/db.js'],
      open_steps: ['add tests', 'wire resume into SessionStart']
    }
  });
  assert.strictEqual(stopRes.status, 0);

  const resumeRes = runAmos(['resume', sessionId]);
  assert.strictEqual(resumeRes.status, 0);
  const parsed = JSON.parse(resumeRes.stdout);
  const context = parsed.hookSpecificOutput.additionalContext;
  assert.ok(context.includes(`AMOS Resume: ${sessionId}`));
  assert.ok(context.includes('Task: Implement S2.1 handoff write/read'));
  assert.ok(context.includes('Phase: implement'));
  assert.ok(context.includes('Changed files (2)'));
  assert.ok(context.includes('Open steps:'));
  assert.ok(context.includes('add tests'));
  assert.ok(context.includes(`Resume: amos resume ${sessionId}`));
});

test('47. Event stop: handoff written even without data, with defaults', () => {
  cleanLogsAndDb();
  const sessionId = 'sess-handoff-empty-' + Date.now();
  const stopRes = runAmos(['event', 'stop'], {}, { session_id: sessionId });
  assert.strictEqual(stopRes.status, 0);

  const resumeRes = runAmos(['resume', sessionId]);
  const parsed = JSON.parse(resumeRes.stdout);
  const context = parsed.hookSpecificOutput.additionalContext;
  assert.ok(context.includes(`AMOS Resume: ${sessionId}`));
  assert.ok(context.includes(`Resume: amos resume ${sessionId}`));
  assert.ok(!context.includes('Task:'));
  assert.ok(!context.includes('Phase:'));
});

test('48. Event stop: writes YAML mirror to .planning/handoffs/<sessionId>.yaml for real project paths', () => {
  cleanLogsAndDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-handoff-'));
  const sessionId = 'sess-yaml-' + Date.now();
  try {
    const res = runAmos(['event', 'stop'], {}, {
      session_id: sessionId,
      cwd: tmpDir,
      data: { task: 'YAML mirror test', phase: 'verify', open_steps: ['check file'] }
    });
    assert.strictEqual(res.status, 0);

    const yamlPath = path.join(tmpDir, '.planning', 'handoffs', `${sessionId}.yaml`);
    assert.ok(fs.existsSync(yamlPath), 'YAML handoff mirror should exist');

    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    assert.ok(yamlContent.includes(`session_id: ${sessionId}`));
    assert.ok(yamlContent.includes('task: YAML mirror test'));
    assert.ok(yamlContent.includes('phase: verify'));
    assert.ok(yamlContent.includes('project:'));
    assert.ok(yamlContent.includes('resume_cmd:'));
    assert.ok(yamlContent.includes('timestamp:'));
    assert.ok(yamlContent.includes('open_steps:'));
    assert.ok(yamlContent.includes('- check file'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('49. Event stop: skips YAML mirror for non-existent/relative project paths (fail-soft)', () => {
  cleanLogsAndDb();
  const sessionId = 'sess-nomirror-' + Date.now();
  const res = runAmos(['event', 'stop'], {}, {
    session_id: sessionId,
    cwd: 'relative/does-not-exist',
    data: { task: 'no mirror' }
  });
  assert.strictEqual(res.status, 0);
  assert.ok(!fs.existsSync(path.join('relative', 'does-not-exist', '.planning')));

  // SQLite handoff is still written even when the YAML mirror is skipped
  const resumeRes = runAmos(['resume', sessionId]);
  const parsed = JSON.parse(resumeRes.stdout);
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('Task: no mirror'));
});

test('50. amos resume: outputs valid hookSpecificOutput JSON', () => {
  cleanLogsAndDb();
  const sessionId = 'sess-resume-shape-' + Date.now();
  runAmos(['event', 'stop'], {}, { session_id: sessionId, data: { task: 'shape check' } });

  const res = runAmos(['resume', sessionId]);
  assert.strictEqual(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.hookSpecificOutput);
  assert.strictEqual(typeof parsed.hookSpecificOutput.additionalContext, 'string');
});

test('51. amos resume: unknown handoff id returns fail-soft message, exits 0', () => {
  cleanLogsAndDb();
  const res = runAmos(['resume', 'sess-does-not-exist-' + Date.now()]);
  assert.strictEqual(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('no handoff found'));
});

test('52. amos resume: missing handoff id argument exits 0 with empty stdout', () => {
  cleanLogsAndDb();
  const res = runAmos(['resume']);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, '');
});

test('53. amos resume: AMOS_DISABLE=1 exits 0 with empty stdout', () => {
  cleanLogsAndDb();
  const res = runAmos(['resume', 'any-id'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, '');
});

test('54. amos resume: DB error fails soft with empty stdout and logs error', () => {
  cleanLogsAndDb();
  const res = runAmos(['resume', 'any-id'], { TRIGGER_DB_ERROR: '1' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, '');
  assert.ok(fs.existsSync(ERRORS_LOG));
});

test('55. amos resume: output stays within 1.5KB budget for large handoffs', () => {
  cleanLogsAndDb();
  const sessionId = 'sess-large-' + Date.now();
  const openSteps = Array.from({ length: 50 }, (_, i) => `step-${i}-` + 'x'.repeat(40));
  const changedFiles = Array.from({ length: 50 }, (_, i) => `path/to/file-${i}.js`);
  runAmos(['event', 'stop'], {}, {
    session_id: sessionId,
    data: { task: 'large handoff', phase: 'stress', open_steps: openSteps, changed_files: changedFiles }
  });

  const res = runAmos(['resume', sessionId]);
  assert.strictEqual(res.status, 0);
  const byteLength = Buffer.byteLength(res.stdout, 'utf8');
  assert.ok(byteLength <= 1536, `Resume output is ${byteLength} bytes, exceeds 1.5KB budget`);
  const parsed = JSON.parse(res.stdout);
  assert.ok(parsed.hookSpecificOutput.additionalContext);
});

// ==========================================
// CATEGORY 9: Status Markdown (S2.2)
// ==========================================

function runAmosInDir(args, cwd, stdin = null) {
  const env = { ...process.env };
  delete env.AMOS_PROFILE;
  delete env.AMOS_DISABLE;
  const options = { env, cwd, encoding: 'utf8' };
  if (stdin !== null) {
    options.input = typeof stdin === 'string' ? stdin : JSON.stringify(stdin);
  }
  const result = cp.spawnSync('node', [AMOS_JS, ...args], options);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('56. amos status --markdown: no handoff yet for project shows defaults', () => {
  cleanLogsAndDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-status-'));
  try {
    const res = runAmosInDir(['status', '--markdown'], tmpDir);
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('# AMOS Status'));
    assert.ok(res.stdout.includes(`**Project:** ${tmpDir}`));
    assert.ok(res.stdout.includes('**Task:** (none)'));
    assert.ok(res.stdout.includes('**Phase:** (none)'));
    assert.ok(res.stdout.includes('**Last updated:** (no handoff)'));
    assert.ok(res.stdout.includes('## Changed files'));
    assert.ok(res.stdout.includes('## Open steps'));
    assert.ok(res.stdout.includes('**Resume:** `amos resume <sessionId>`'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('57. amos status --markdown: reflects latest handoff for the project', () => {
  cleanLogsAndDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-status-'));
  try {
    const sessionId = 'sess-status-' + Date.now();
    const stopRes = runAmosInDir(['event', 'stop'], tmpDir, {
      session_id: sessionId,
      cwd: tmpDir,
      data: {
        task: 'Implement S2.2 status markdown',
        phase: 'implement',
        open_steps: ['write tests', 'sync to Pipeline Setupper']
      }
    });
    assert.strictEqual(stopRes.status, 0);

    const res = runAmosInDir(['status', '--markdown'], tmpDir);
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes('**Task:** Implement S2.2 status markdown'));
    assert.ok(res.stdout.includes('**Phase:** implement'));
    assert.ok(res.stdout.includes('- write tests'));
    assert.ok(res.stdout.includes('- sync to Pipeline Setupper'));
    assert.ok(res.stdout.includes(`**Resume:** \`amos resume ${sessionId}\``));

    const byteLength = Buffer.byteLength(res.stdout, 'utf8');
    assert.ok(byteLength <= 2048, `Status output is ${byteLength} bytes, exceeds 2KB budget`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('58. amos status --markdown: AMOS_DISABLE=1 exits 0 with empty stdout', () => {
  cleanLogsAndDb();
  const res = runAmos(['status', '--markdown'], { AMOS_DISABLE: '1' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, '');
});

test('59. amos status --markdown: DB error fails soft with empty stdout and logs error', () => {
  cleanLogsAndDb();
  const res = runAmos(['status', '--markdown'], { TRIGGER_DB_ERROR: '1' });
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout, '');
  assert.ok(fs.existsSync(ERRORS_LOG));
});

test('60. amos status --markdown: output stays within 2KB budget for large handoffs', () => {
  cleanLogsAndDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amos-test-status-large-'));
  try {
    const sessionId = 'sess-status-large-' + Date.now();
    const openSteps = Array.from({ length: 50 }, (_, i) => `step-${i}-` + 'x'.repeat(40));
    const stopRes = runAmosInDir(['event', 'stop'], tmpDir, {
      session_id: sessionId,
      cwd: tmpDir,
      data: { task: 'large status', phase: 'stress', open_steps: openSteps }
    });
    assert.strictEqual(stopRes.status, 0);

    const res = runAmosInDir(['status', '--markdown'], tmpDir);
    assert.strictEqual(res.status, 0);
    const byteLength = Buffer.byteLength(res.stdout, 'utf8');
    assert.ok(byteLength <= 2048, `Status output is ${byteLength} bytes, exceeds 2KB budget`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
