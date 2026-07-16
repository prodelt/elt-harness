const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ROOT = path.join(os.homedir(), '.claude', 'ctx7-cache');

function normalizeCommand(command) {
  return String(command || '').replace(/\s+/g, ' ').trim();
}

function isCtx7Command(command) {
  const normalized = normalizeCommand(command).toLowerCase();
  return /\bctx7(\.cmd)?\s+(docs|library)\b/.test(normalized);
}

function hashCommand(command) {
  return crypto.createHash('sha256').update(normalizeCommand(command)).digest('hex').slice(0, 24);
}

function pathsFor(root, command) {
  const hash = hashCommand(command);
  return {
    root,
    hash,
    entriesDir: path.join(root, 'entries'),
    entryFile: path.join(root, 'entries', `${hash}.json`),
    accessLog: path.join(root, 'access.log'),
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendAccess(root, event) {
  const line = JSON.stringify({
    ...event,
    ts: new Date().toISOString(),
  });
  const { accessLog } = pathsFor(root, event.command || '');
  ensureDir(path.dirname(accessLog));
  fs.appendFileSync(accessLog, `${line}\n`, 'utf8');
}

function readEntry(command, options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const cachePaths = pathsFor(root, command);

  try {
    const entry = JSON.parse(fs.readFileSync(cachePaths.entryFile, 'utf8'));
    const ageMs = Date.now() - Date.parse(entry.createdAt || 0);
    if (ageMs >= 0 && ageMs <= ttlMs) {
      return {
        hit: true,
        entry,
        path: cachePaths.entryFile,
        hash: cachePaths.hash,
      };
    }
  } catch (_) {}

  return {
    hit: false,
    path: cachePaths.entryFile,
    hash: cachePaths.hash,
  };
}

function writeEntry(command, response, options = {}) {
  const root = options.root || DEFAULT_ROOT;
  const cachePaths = pathsFor(root, command);
  const preview = String(response || '').slice(0, 4000);
  const entry = {
    command: normalizeCommand(command),
    hash: cachePaths.hash,
    createdAt: new Date().toISOString(),
    preview,
    responseBytes: Buffer.byteLength(String(response || ''), 'utf8'),
  };

  ensureDir(cachePaths.entriesDir);
  fs.writeFileSync(cachePaths.entryFile, JSON.stringify(entry, null, 2), 'utf8');
  return {
    entry,
    path: cachePaths.entryFile,
    hash: cachePaths.hash,
  };
}

module.exports = {
  DEFAULT_ROOT,
  DEFAULT_TTL_MS,
  appendAccess,
  hashCommand,
  isCtx7Command,
  normalizeCommand,
  readEntry,
  writeEntry,
};
