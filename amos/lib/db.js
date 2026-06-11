const path = require('path');
const fs = require('fs');
const os = require('os');

const AMOS_DIR = process.env.AMOS_HOME || path.join(os.homedir(), '.amos');
const DB_PATH = path.join(AMOS_DIR, 'state.sqlite');

let db = null;
let isNodeSqlite = false;

function initDb() {
  if (process.env.TRIGGER_DB_ERROR === '1') {
    throw new Error('Simulated database corruption error');
  }

  if (db) return db;

  // Make sure AMOS_DIR exists
  if (!fs.existsSync(AMOS_DIR)) {
    fs.mkdirSync(AMOS_DIR, { recursive: true });
  }

  // Try node:sqlite first
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(DB_PATH);
    isNodeSqlite = true;
  } catch (err) {
    // Fallback to better-sqlite3
    try {
      const Database = require('better-sqlite3');
      db = new Database(DB_PATH);
      isNodeSqlite = false;
    } catch (fallbackErr) {
      throw new Error(`Failed to load SQLite module: ${err.message} -> ${fallbackErr.message}`);
    }
  }

  // Create tables if they don't exist
  createTables();

  return db;
}

function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_path TEXT,
      active BOOLEAN,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS events_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT,
      project TEXT,
      fired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      duration_ms INTEGER,
      output_chars INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      path TEXT PRIMARY KEY,
      key TEXT,
      last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS handoffs (
      session_id TEXT PRIMARY KEY,
      data TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cost_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      client TEXT,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      turns INTEGER,
      partial INTEGER DEFAULT 0,
      ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS policy_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      kind TEXT,
      detail TEXT,
      ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS instincts (
      pattern TEXT PRIMARY KEY,
      uses INTEGER DEFAULT 0,
      confidence REAL DEFAULT 0,
      first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function logEvent(event, project, durationMs, outputChars) {
  initDb();
  const firedAt = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT INTO events_metrics (event, project, fired_at, duration_ms, output_chars)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    event,
    project || null,
    firedAt,
    durationMs !== undefined && durationMs !== null ? durationMs : null,
    outputChars !== undefined && outputChars !== null ? outputChars : null
  );
}

function saveSession(id, projectPath, active) {
  initDb();
  const firedAt = new Date().toISOString();
  try {
    const stmt = db.prepare(`
      INSERT INTO sessions (id, project_path, active, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_path = excluded.project_path,
        active = excluded.active
    `);
    stmt.run(id, projectPath || null, active ? 1 : 0, firedAt);
  } catch (e) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO sessions (id, project_path, active, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, projectPath || null, active ? 1 : 0, firedAt);
  }
}

function saveProject(projectPath, key) {
  initDb();
  const firedAt = new Date().toISOString();
  try {
    const stmt = db.prepare(`
      INSERT INTO projects (path, key, last_active)
      VALUES (?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        key = excluded.key,
        last_active = excluded.last_active
    `);
    stmt.run(projectPath, key || null, firedAt);
  } catch (e) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO projects (path, key, last_active)
      VALUES (?, ?, ?)
    `);
    stmt.run(projectPath, key || null, firedAt);
  }
}

function saveHandoff(sessionId, data) {
  initDb();
  const firedAt = new Date().toISOString();
  const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
  try {
    const stmt = db.prepare(`
      INSERT INTO handoffs (session_id, data, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        data = excluded.data,
        created_at = excluded.created_at
    `);
    stmt.run(sessionId, dataStr, firedAt);
  } catch (e) {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO handoffs (session_id, data, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(sessionId, dataStr, firedAt);
  }
}

function getHandoff(sessionId) {
  initDb();
  const row = db.prepare('SELECT * FROM handoffs WHERE session_id = ?').get(sessionId);
  if (!row) return null;
  let data;
  try {
    data = JSON.parse(row.data);
  } catch (e) {
    data = row.data;
  }
  return { session_id: row.session_id, data, created_at: row.created_at };
}

function normalizeProjectPath(p) {
  if (!p) return '';
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function getLatestHandoffForProject(projectPath) {
  initDb();
  const target = normalizeProjectPath(projectPath);
  const rows = db.prepare('SELECT * FROM handoffs ORDER BY created_at DESC').all();
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch (e) {
      continue;
    }
    if (data && normalizeProjectPath(data.project) === target) {
      return { session_id: row.session_id, data, created_at: row.created_at };
    }
  }
  return null;
}

function getMetricsSummary() {
  initDb();
  const query = `
    SELECT 
      event,
      COUNT(*) as count,
      SUM(duration_ms) as total_duration_ms,
      AVG(duration_ms) as avg_duration_ms,
      MAX(duration_ms) as max_duration_ms,
      SUM(output_chars) as total_output_chars,
      AVG(output_chars) as avg_output_chars
    FROM events_metrics
    GROUP BY event
  `;
  
  const rows = db.prepare(query).all();
  return rows;
}

// One ledger row per finished session (upsert-free append; sessions can have
// several Stop events — the report aggregates by MAX per session).
function logCost(entry) {
  initDb();
  const stmt = db.prepare(`
    INSERT INTO cost_ledger (session_id, client, model, input_tokens, output_tokens,
                             cache_read_tokens, cache_creation_tokens, turns, partial, ts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    entry.session_id || null,
    entry.client || 'unknown',
    entry.model || '',
    entry.input_tokens || 0,
    entry.output_tokens || 0,
    entry.cache_read_tokens || 0,
    entry.cache_creation_tokens || 0,
    entry.turns || 0,
    entry.partial ? 1 : 0,
    new Date().toISOString()
  );
}

// Aggregated view for `amos cost`. Stop can fire several times per session, so
// take the MAX cumulative counters per session first, then group.
function getCostSummary(opts) {
  initDb();
  const days = (opts && opts.days) || 7;
  const sessionId = opts && opts.sessionId;
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const base = `
    SELECT session_id, client, model,
           MAX(input_tokens) AS input_tokens,
           MAX(output_tokens) AS output_tokens,
           MAX(cache_read_tokens) AS cache_read_tokens,
           MAX(cache_creation_tokens) AS cache_creation_tokens,
           MAX(turns) AS turns,
           MAX(partial) AS partial,
           MAX(ts) AS ts
    FROM cost_ledger
    WHERE ts >= ? ${sessionId ? 'AND session_id = ?' : ''}
    GROUP BY session_id, client, model
  `;
  const params = sessionId ? [sinceIso, sessionId] : [sinceIso];
  const perSession = db.prepare(base).all(...params);

  const byModel = {};
  for (const row of perSession) {
    const key = `${row.client}/${row.model || '(unknown)'}`;
    if (!byModel[key]) {
      byModel[key] = { client: row.client, model: row.model || '(unknown)', sessions: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 };
    }
    const agg = byModel[key];
    agg.sessions += 1;
    agg.input_tokens += row.input_tokens || 0;
    agg.output_tokens += row.output_tokens || 0;
    agg.cache_read_tokens += row.cache_read_tokens || 0;
    agg.cache_creation_tokens += row.cache_creation_tokens || 0;
  }

  return { days, sinceIso, perSession, byModel: Object.values(byModel) };
}

function logPolicyEvent(sessionId, kind, detail) {
  initDb();
  db.prepare('INSERT INTO policy_events (session_id, kind, detail, ts) VALUES (?, ?, ?, ?)')
    .run(sessionId || null, kind || '', detail || '', new Date().toISOString());
}

function countPolicyEvents(sessionId, kind) {
  initDb();
  const row = db.prepare('SELECT COUNT(*) AS n FROM policy_events WHERE session_id = ? AND kind = ?')
    .get(sessionId || '', kind || '');
  return row ? row.n : 0;
}

// Instinct ledger (S7) — upsert a pattern, bump its use count, recompute
// confidence = min(1, uses/5). Append-only semantics via ON CONFLICT.
function recordInstinct(pattern, inc) {
  initDb();
  if (typeof pattern !== 'string' || !pattern.trim()) return;
  const step = (typeof inc === 'number' && inc > 0) ? inc : 1;
  const now = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO instincts (pattern, uses, confidence, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(pattern) DO UPDATE SET
        uses = uses + excluded.uses,
        confidence = MIN(1.0, (uses + excluded.uses) / 5.0),
        last_seen = excluded.last_seen
    `).run(pattern.trim(), step, Math.min(1, step / 5), now, now);
  } catch (e) {
    const existing = db.prepare('SELECT uses FROM instincts WHERE pattern = ?').get(pattern.trim());
    const uses = (existing ? existing.uses : 0) + step;
    db.prepare(`
      INSERT OR REPLACE INTO instincts (pattern, uses, confidence, first_seen, last_seen)
      VALUES (?, ?, ?, COALESCE((SELECT first_seen FROM instincts WHERE pattern = ?), ?), ?)
    `).run(pattern.trim(), uses, Math.min(1, uses / 5), pattern.trim(), now, now);
  }
}

// Read instincts, optionally filtered by minimum uses/confidence, sorted by uses desc.
function getInstincts(opts) {
  initDb();
  const o = opts || {};
  const minUses = typeof o.minUses === 'number' ? o.minUses : 0;
  const minConfidence = typeof o.minConfidence === 'number' ? o.minConfidence : 0;
  return db.prepare(`
    SELECT pattern, uses, confidence, first_seen, last_seen
    FROM instincts
    WHERE uses >= ? AND confidence >= ?
    ORDER BY uses DESC, pattern ASC
  `).all(minUses, minConfidence);
}

function closeDb() {
  if (db && typeof db.close === 'function') {
    db.close();
    db = null;
  }
}

module.exports = {
  initDb,
  logEvent,
  saveSession,
  saveProject,
  saveHandoff,
  getHandoff,
  getLatestHandoffForProject,
  getMetricsSummary,
  logCost,
  getCostSummary,
  logPolicyEvent,
  countPolicyEvents,
  recordInstinct,
  getInstincts,
  closeDb,
  isNodeSqlite: () => isNodeSqlite
};
