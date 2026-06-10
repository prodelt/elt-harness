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
  getMetricsSummary,
  closeDb,
  isNodeSqlite: () => isNodeSqlite
};
