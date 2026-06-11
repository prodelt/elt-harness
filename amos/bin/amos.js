#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

// Portable AMOS_DIR — works on any machine, overridable via env
const AMOS_DIR = process.env.AMOS_HOME || path.join(os.homedir(), '.amos');
const ERRORS_LOG = path.join(AMOS_DIR, 'errors.log');

// 2KB hard budget for session-start injection
const MAX_OUTPUT_BYTES = 2048;

// 1.5KB hard budget for resume injection
const RESUME_BUDGET_BYTES = 1536;

// Global fail-soft handler — logs to errors.log, always exits 0
function handleGlobalError(err) {
  try {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ERROR: ${err.message}\nStack: ${err.stack || err}\n\n`;
    fs.appendFileSync(ERRORS_LOG, logMessage, 'utf8');
  } catch (e) {
    // Swallow logging errors — silent exit is mandatory
  }
  process.exit(0);
}

// Wrap all execution in top-level try-catch
try {
  // AMOS_DISABLE=1 → immediate silent exit
  if (process.env.AMOS_DISABLE === '1') {
    process.exit(0);
  }

  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case 'event':   handleEvent(args[1]);  break;
    case 'resume':  handleResume(args[1]); break;
    case 'status':  handleStatus(args.slice(1)); break;
    case 'report':  handleReport();        break;
    case 'doctor':  handleDoctor();        break;
    case 'version': handleVersion();       break;
    default:
      // Unknown command → silent exit 0
      process.exit(0);
  }
} catch (err) {
  handleGlobalError(err);
}

// ---------------------------------------------------------------------------
// Event handler
// ---------------------------------------------------------------------------
function handleEvent(eventArg) {
  const startTime = Date.now();

  // Early DB health check — must happen BEFORE any console.log
  // Guarantees empty stdout when DB is corrupt (TRIGGER_DB_ERROR or real error)
  try {
    const db = require('../lib/db.js');
    db.initDb();
  } catch (err) {
    handleGlobalError(err);
    return;
  }

  // Read stdin
  let stdinData = '';
  try {
    stdinData = fs.readFileSync(0, 'utf8');
  } catch (e) { /* no stdin — fine */ }

  // Parse JSON — invalid JSON → silent exit 0 (fail-soft, no throw)
  let parsedInput = {};
  if (stdinData && stdinData.trim()) {
    try {
      parsedInput = JSON.parse(stdinData);
    } catch (e) {
      // Log and exit silently — do NOT throw to global handler
      try {
        const ts = new Date().toISOString();
        fs.appendFileSync(ERRORS_LOG, `[${ts}] ERROR: Invalid JSON input: ${e.message}\n\n`, 'utf8');
      } catch (_) {}
      process.exit(0);
    }
  }

  // Resolve event name: CLI arg takes priority over stdin field
  const eventName = eventArg || parsedInput.hook_event_name;

  if (!eventName || !['session-start', 'stop'].includes(eventName)) {
    process.exit(0);
  }

  const profile = getProfile();
  let responseString = '';

  if (eventName === 'session-start') {
    let contextStr = '';
    if (profile === 'minimal') {
      contextStr = `AMOS Resume Pointer: ${AMOS_DIR}`;
    } else if (profile === 'strict') {
      contextStr = [
        `AMOS Resume Pointer: ${AMOS_DIR}`,
        'Focus: Kernel Core CLI',
        "Bootstrap: Please verify your amos installation using 'amos doctor'.",
        'Strict rules: active. Rules enforcement: 100%.'
      ].join('\n');
    } else {
      // standard (default)
      contextStr = [
        `AMOS Resume Pointer: ${AMOS_DIR}`,
        'Focus: Kernel Core CLI',
        "Bootstrap: Please verify your amos installation using 'amos doctor'."
      ].join('\n');
    }

    const output = { hookSpecificOutput: { additionalContext: contextStr } };
    responseString = JSON.stringify(output);

    // ── 2KB HARD BUDGET ──────────────────────────────────────────────────
    if (Buffer.byteLength(responseString, 'utf8') > MAX_OUTPUT_BYTES) {
      const truncated = contextStr.slice(0, 400) + '\n…[AMOS: truncated to 2KB budget]';
      responseString = JSON.stringify({ hookSpecificOutput: { additionalContext: truncated } });
    }
    // ─────────────────────────────────────────────────────────────────────

    console.log(responseString);

    // Persist session + project to SQLite (fail-soft)
    try {
      const db = require('../lib/db.js');
      db.initDb();
      const sessionId = parsedInput.session_id || 'default_session';
      const projectPath = parsedInput.cwd || 'default_project';
      db.saveSession(sessionId, projectPath, true);
      db.saveProject(projectPath, path.basename(projectPath));
    } catch (_) { /* fail-soft */ }

  } else if (eventName === 'stop') {
    let decision = 'allow';
    let reason = 'Stop event processed successfully.';

    if (profile === 'strict') {
      if (parsedInput.data && parsedInput.data.violations && parsedInput.data.violations.length > 0) {
        decision = 'block';
        reason = `Rule violations detected: ${parsedInput.data.violations.join(', ')}`;
      } else if (parsedInput.data && parsedInput.data.forceBlock) {
        decision = 'block';
        reason = 'Blocked by forceBlock directive.';
      } else {
        reason = 'All rules enforced and verified. No violations found.';
      }
    } else {
      if (parsedInput.data && parsedInput.data.forceBlock) {
        decision = 'block';
        reason = 'Blocked by forceBlock directive.';
      }
    }

    responseString = JSON.stringify({ decision, reason });
    console.log(responseString);

    // Persist session end + structured handoff (fail-soft)
    try {
      const db = require('../lib/db.js');
      db.initDb();
      const sessionId = parsedInput.session_id || 'default_session';
      const projectPath = parsedInput.cwd || 'default_project';
      db.saveSession(sessionId, projectPath, false);

      const data = (parsedInput.data && typeof parsedInput.data === 'object') ? parsedInput.data : {};
      const handoff = {
        session_id: sessionId,
        task: typeof data.task === 'string' ? data.task : '',
        phase: typeof data.phase === 'string' ? data.phase : '',
        project: projectPath,
        changed_files: Array.isArray(data.changed_files) ? data.changed_files : [],
        open_steps: Array.isArray(data.open_steps) ? data.open_steps : [],
        resume_cmd: `amos resume ${sessionId}`,
        timestamp: new Date().toISOString()
      };
      db.saveHandoff(sessionId, handoff);

      // Mirror to project .planning/handoffs/<sessionId>.yaml — only for real project paths
      if (path.isAbsolute(projectPath) && fs.existsSync(projectPath)) {
        const { toYaml } = require('../lib/yaml.js');
        const handoffsDir = path.join(projectPath, '.planning', 'handoffs');
        fs.mkdirSync(handoffsDir, { recursive: true });
        fs.writeFileSync(path.join(handoffsDir, `${sessionId}.yaml`), toYaml(handoff), 'utf8');
      }
    } catch (_) { /* fail-soft */ }
  }

  // Log metrics (fail-soft)
  try {
    const db = require('../lib/db.js');
    db.initDb();
    const durationMs = Date.now() - startTime;
    const project = parsedInput.cwd || parsedInput.project_path || 'unknown';
    db.logEvent(eventName, project, durationMs, responseString.length);
  } catch (_) { /* fail-soft */ }
}

// ---------------------------------------------------------------------------
// Resume — read a handoff from SQLite and emit a compact resume context
// ---------------------------------------------------------------------------
function handleResume(handoffId) {
  if (!handoffId) {
    process.exit(0);
    return;
  }

  // Early DB health check — before any stdout (fail-soft, mirrors handleEvent)
  let db;
  try {
    db = require('../lib/db.js');
    db.initDb();
  } catch (err) {
    handleGlobalError(err);
    return;
  }

  let contextStr;
  try {
    const handoff = db.getHandoff(handoffId);

    if (!handoff || !handoff.data) {
      contextStr = `AMOS: no handoff found for session ${handoffId}`;
    } else {
      const d = handoff.data;
      const lines = [`AMOS Resume: ${handoffId}`];
      if (d.task) lines.push(`Task: ${d.task}`);
      if (d.phase) lines.push(`Phase: ${d.phase}`);
      if (d.project) lines.push(`Project: ${d.project}`);
      if (Array.isArray(d.changed_files) && d.changed_files.length > 0) {
        lines.push(`Changed files (${d.changed_files.length}): ${d.changed_files.slice(0, 10).join(', ')}`);
      }
      if (Array.isArray(d.open_steps) && d.open_steps.length > 0) {
        lines.push('Open steps:');
        for (const step of d.open_steps.slice(0, 10)) {
          lines.push(`  - ${step}`);
        }
      }
      if (d.resume_cmd) lines.push(`Resume: ${d.resume_cmd}`);
      if (d.timestamp) lines.push(`Last updated: ${d.timestamp}`);
      contextStr = lines.join('\n');
    }
  } catch (err) {
    contextStr = `AMOS: resume failed for session ${handoffId}`;
  }

  let responseString = JSON.stringify({ hookSpecificOutput: { additionalContext: contextStr } });

  // ── 1.5KB HARD BUDGET ────────────────────────────────────────────────────
  if (Buffer.byteLength(responseString, 'utf8') > RESUME_BUDGET_BYTES) {
    const truncated = contextStr.slice(0, 1300) + '\n…[AMOS: truncated to 1.5KB budget]';
    responseString = JSON.stringify({ hookSpecificOutput: { additionalContext: truncated } });
  }
  // ─────────────────────────────────────────────────────────────────────────

  console.log(responseString);
}

// ---------------------------------------------------------------------------
// Other commands
// ---------------------------------------------------------------------------
function handleStatus(rest) {
  if (Array.isArray(rest) && rest.includes('--markdown')) {
    handleStatusMarkdown();
    return;
  }

  const profile = getProfile();
  if (profile === 'minimal') {
    console.log('AMOS Status: OK');
  } else if (profile === 'strict') {
    console.log('AMOS CLI Status: OK\nProfile: strict\nVersion: 0.1.0\nRules: Enforced');
  } else {
    console.log('AMOS CLI Status: OK\nProfile: standard\nVersion: 0.1.0');
  }
}

// ---------------------------------------------------------------------------
// Status (markdown) — portable snapshot of the latest handoff for this project
// ---------------------------------------------------------------------------
function handleStatusMarkdown() {
  let db;
  try {
    db = require('../lib/db.js');
    db.initDb();
  } catch (err) {
    handleGlobalError(err);
    return;
  }

  const projectPath = process.cwd();

  let handoff = null;
  try {
    handoff = db.getLatestHandoffForProject(projectPath);
  } catch (e) { /* fail-soft — no handoff */ }

  // git diff --stat — fail-soft when not a git repo or git unavailable
  let diffStat = '';
  try {
    diffStat = require('child_process')
      .execSync('git diff --stat', { cwd: projectPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
  } catch (e) { /* not a git repo, no diff, or git missing */ }

  const d = handoff ? handoff.data : null;

  const lines = ['# AMOS Status', ''];
  lines.push(`**Project:** ${projectPath}`);
  lines.push(`**Task:** ${d && d.task ? d.task : '(none)'}`);
  lines.push(`**Phase:** ${d && d.phase ? d.phase : '(none)'}`);
  lines.push(`**Last updated:** ${d && d.timestamp ? d.timestamp : '(no handoff)'}`);
  lines.push('');
  lines.push('## Changed files');
  lines.push('```');
  lines.push(diffStat || '(none)');
  lines.push('```');
  lines.push('');
  lines.push('## Open steps');
  if (d && Array.isArray(d.open_steps) && d.open_steps.length > 0) {
    for (const step of d.open_steps) {
      lines.push(`- ${step}`);
    }
  } else {
    lines.push('(none)');
  }
  lines.push('');
  lines.push(`**Resume:** \`${d && d.resume_cmd ? d.resume_cmd : 'amos resume <sessionId>'}\``);

  let output = lines.join('\n');

  // ── 2KB HARD BUDGET ──────────────────────────────────────────────────
  if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
    output = output.slice(0, 1900) + '\n…[AMOS: truncated to 2KB budget]';
  }
  // ─────────────────────────────────────────────────────────────────────

  console.log(output);
}

function handleReport() {
  try {
    const db = require('../lib/db.js');
    db.initDb();
    const summary = db.getMetricsSummary();

    console.log('[AMOS DATABASE METRICS REPORT]');
    console.log('----------------------------------------------------------------------');
    console.log('Event            | Count | Avg Duration | Max Duration | Total Chars | Avg Chars');
    console.log('----------------------------------------------------------------------');

    let totalCount = 0;
    if (summary && summary.length > 0) {
      summary.forEach(row => {
        const event    = (row.event || '').padEnd(16);
        const count    = String(row.count || 0).padStart(5);
        const avgDur   = `${Math.round(row.avg_duration_ms || 0)}ms`.padStart(12);
        const maxDur   = `${row.max_duration_ms || 0}ms`.padStart(12);
        const totChars = String(row.total_output_chars || 0).padStart(11);
        const avgChars = `${Math.round(row.avg_output_chars || 0)}`.padStart(9);
        console.log(`${event} | ${count} | ${avgDur} | ${maxDur} | ${totChars} | ${avgChars}`);
        totalCount += row.count || 0;
      });
    } else {
      console.log('No event metrics recorded yet.');
    }
    console.log('----------------------------------------------------------------------');
    console.log(`Total Events: ${totalCount}`);
  } catch (err) {
    throw new Error(`Report generation failed: ${err.message}`);
  }
}

function handleDoctor() {
  console.log('[AMOS DOCTOR DIAGNOSTIC REPORT]');
  console.log('------------------------------------');

  // Node.js version
  const versionString = process.version;
  const majorVersion = parseInt(versionString.slice(1).split('.')[0], 10);
  console.log(majorVersion >= 22
    ? `[PASS] Node.js Version: ${versionString} (>= 22.0.0)`
    : `[FAIL] Node.js Version: ${versionString} (< 22.0.0 is not compatible)`);

  // Profile / disable
  const profile = getProfile();
  const disabled = process.env.AMOS_DISABLE === '1';
  console.log(`[PASS] Environment: AMOS_PROFILE=${profile}, AMOS_DISABLE=${disabled ? '1 (Bypass Active)' : 'not set'}`);

  // AMOS_DIR existence (portable)
  if (fs.existsSync(AMOS_DIR)) {
    console.log(`[PASS] Workspace Directory: ${AMOS_DIR}`);
  } else {
    console.log(`[FAIL] Workspace Directory: ${AMOS_DIR} does not exist`);
  }

  // Write permissions
  try {
    const tempFile = path.join(AMOS_DIR, '.doctor_write_test');
    fs.writeFileSync(tempFile, 'test', 'utf8');
    fs.unlinkSync(tempFile);
    console.log('[PASS] Write Permissions: Verified');
  } catch (e) {
    console.log(`[FAIL] Write Permissions: Failed (${e.message})`);
  }

  // Git repo
  if (fs.existsSync(path.join(AMOS_DIR, '.git'))) {
    console.log('[PASS] Git Repository: Initialized');
  } else {
    console.log('[FAIL] Git Repository: Not initialized');
  }

  // DB connection
  const dbPath = path.join(AMOS_DIR, 'state.sqlite');
  if (fs.existsSync(dbPath)) {
    console.log(`[PASS] Database File: ${dbPath}`);
    try {
      const db = require('../lib/db.js');
      db.initDb();
      console.log(`[PASS] Database Connection: Verified (${db.isNodeSqlite() ? 'node:sqlite' : 'better-sqlite3'})`);
    } catch (e) {
      console.log(`[FAIL] Database Connection: Failed (${e.message})`);
    }
  } else {
    console.log(`[FAIL] Database File: ${dbPath} does not exist`);
  }

  // Error log
  if (fs.existsSync(ERRORS_LOG)) {
    const stats = fs.statSync(ERRORS_LOG);
    console.log(`[INFO] Error Log: Present (${stats.size} bytes)`);
  } else {
    console.log('[INFO] Error Log: Not present / empty');
  }

  // Hook integration — SessionStart + Stop wiring across clients
  console.log('------------------------------------');
  console.log('AMOS Hook Integration:');
  checkAmosHook('claude', 'Claude', 'SessionStart', 'event session-start');
  checkAmosHook('codex', 'Codex', 'SessionStart', 'event session-start');
  checkAmosHook('gemini', 'Gemini', 'SessionStart', 'event session-start');
  checkAmosHook('claude', 'Claude', 'Stop', 'event stop');
  checkAmosHook('codex', 'Codex', 'Stop', 'event stop');
  checkAmosHook('gemini', 'Gemini', 'Stop', 'event stop');

  console.log('------------------------------------');
  console.log('AMOS Kernel diagnostic complete.');
}

function handleVersion() {
  console.log('0.1.0');
}

// ---------------------------------------------------------------------------
// Hook integration checks — SessionStart wiring across clients (S2.3)
// ---------------------------------------------------------------------------
function getClientConfigPath(client) {
  const home = os.homedir();
  switch (client) {
    case 'claude': return process.env.AMOS_CLAUDE_SETTINGS || path.join(home, '.claude', 'settings.json');
    case 'codex':  return process.env.AMOS_CODEX_HOOKS || path.join(home, '.codex', 'hooks.json');
    case 'gemini': return process.env.AMOS_GEMINI_SETTINGS || path.join(home, '.gemini', 'settings.json');
    default: return null;
  }
}

function checkAmosHook(client, label, hookEvent, amosEventArg) {
  const configPath = getClientConfigPath(client);
  if (!configPath || !fs.existsSync(configPath)) {
    console.log(`[INFO] ${label} ${hookEvent} Hook: config not found (${configPath})`);
    return;
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const groups = (config.hooks && Array.isArray(config.hooks[hookEvent])) ? config.hooks[hookEvent] : [];
    const found = groups.some(group =>
      Array.isArray(group.hooks) && group.hooks.some(h =>
        typeof h.command === 'string' && h.command.includes('amos.js') && h.command.includes(amosEventArg)
      )
    );
    console.log(found
      ? `[PASS] ${label} ${hookEvent} Hook: amos ${amosEventArg} configured`
      : `[WARN] ${label} ${hookEvent} Hook: amos ${amosEventArg} not found`);
  } catch (e) {
    console.log(`[WARN] ${label} ${hookEvent} Hook: failed to parse ${configPath} (${e.message})`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getProfile() {
  const raw = (process.env.AMOS_PROFILE || 'standard').toLowerCase();
  return ['minimal', 'standard', 'strict'].includes(raw) ? raw : 'standard';
}
