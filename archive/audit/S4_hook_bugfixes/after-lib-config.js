/**
 * Config loader for Claude Code hooks.
 * Reads ~/.claude/hooks/config.json with hardcoded fallback defaults.
 * Usage: const cfg = require('./lib/config');
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
  session: { ttlHours: 4, scopeGuardTtlHours: 8 },
  inlineReview: { warnAt: 7, blockAt: 15 },
  context7: { warnAtReminders: 1, blockAtReminders: 3, gracePeriodMs: 600000 },
  pipeline: { warnAtEdits: 5 },
  loopGuardian: { historyWindow: 10, repeatWarn: 3, blockAt: 6, sameFileWarn: 5, toolResultsTtlDays: 7 },
  scopeGuard: { warnAtTasks: 5, blockAtTasks: 8 },
  contextBudget: { thresholdTokens: 80000, repeatIntervalTokens: 20000, singlePromptWarnTokens: 40000, charsPerToken: 6 },
  editEnforcer: {
    skipExtensions: ['.md', '.txt', '.json', '.yml', '.yaml', '.toml', '.cfg', '.ini', '.env', '.lock', '.log', '.csv', '.svg', '.png', '.jpg'],
    skipPaths: ['/.claude/', '/.gsd/', 'node_modules']
  },
  secretScanner: { patterns: ['AKIA', 'sk-', 'sk_live', 'ghp_', 'glpat-', 'xox'] },
  qualityGate: {
    codeExtensions: ['.js', '.ts', '.tsx', '.jsx', '.mjs', '.mts', '.go', '.py', '.rs', '.java', '.cs', '.rb', '.php', '.swift', '.kt', '.vue', '.svelte'],
    tscTimeoutMs: 60000, lintTimeoutMs: 60000, goVetTimeoutMs: 30000,
    pythonCheckTimeoutMs: 15000, stagedFileScanLimit: 20
  }
};

let _cached = null;

function load() {
  if (_cached) return _cached;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Deep merge: parsed overrides defaults
    _cached = deepMerge(DEFAULTS, parsed);
  } catch (_) {
    _cached = DEFAULTS;
  }
  return _cached;
}

function deepMerge(base, override) {
  const result = Object.assign({}, base);
  for (const key of Object.keys(override)) {
    if (key.startsWith('_')) continue; // skip comment fields
    if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = deepMerge(base[key] || {}, override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

module.exports = load();
