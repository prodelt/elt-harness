#!/usr/bin/env node

/**
 * PreToolUse hook: Graphify Read Gate
 * Matcher: Read
 *
 * If graphify graph exists in CWD AND file is large (>80 lines) →
 * DENY the Read and suggest: cmd /c graphify query "..."
 *
 * Whitelist: CLAUDE.md, AGENTS.md, MEMORY.md, config files, small files.
 * Bypass: if user explicitly named the file in their last message (intent signal).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const metrics = require('./lib/metrics');
const logger = require('./lib/logger');
const { normCwd } = require('./lib/pathnorm');

metrics.inc('graphify-read-gate', 'fired');

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const filePath = (input.tool_input && input.tool_input.file_path) || '';
if (!filePath) process.exit(0);

// Use CWD from hook input (actual project dir), not process.cwd() (hooks dir)
const cwd = normCwd((input && input.cwd) ? input.cwd : process.cwd());

// Allow partial reads — any explicit limit means agent is being intentional
const readLimit = input.tool_input && input.tool_input.limit;
if (readLimit != null) process.exit(0);

// Check if graphify graph exists in this project
const GRAPH_PATHS = [
  path.join(cwd, 'graphify-out', 'graph.json'),
  path.join(cwd, 'graph.json'),
];
const graphExists = GRAPH_PATHS.some(p => { try { return fs.existsSync(p); } catch { return false; } });
if (!graphExists) process.exit(0);

// Whitelist: always allow small config/doc files
const basename = path.basename(filePath).toLowerCase();
const WHITELIST_NAMES = new Set([
  'claude.md', 'agents.md', 'gemini.md', 'memory.md', 'readme.md',
  'package.json', 'pyproject.toml', 'setup.cfg', 'requirements.txt',
  'tsconfig.json', '.env.example', 'dockerfile', '.gitignore', '.claudeignore',
  'config.json', 'config.js', 'metrics.js', 'logger.js',
]);
if (WHITELIST_NAMES.has(basename)) process.exit(0);

// Whitelist: file extensions that are never graphified
const ext = path.extname(filePath).toLowerCase();
const WHITELIST_EXT = new Set(['.json', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.md', '.txt', '.log', '.csv', '.lock']);
if (WHITELIST_EXT.has(ext)) process.exit(0);

// Only intercept source code files
const CODE_EXT = new Set(['.py', '.js', '.ts', '.tsx', '.jsx', '.go', '.java', '.cs', '.rb', '.php', '.rs']);
if (!CODE_EXT.has(ext)) process.exit(0);

// Check file size (skip if small — < 80 lines)
const LINE_THRESHOLD = 80;
const SIZE_CACHE_FILE = path.join(os.tmpdir(), 'claude-graphify-sizes.json');
let sizeCache = {};
try { sizeCache = JSON.parse(fs.readFileSync(SIZE_CACHE_FILE, 'utf8')); } catch {}

let lineCount = sizeCache[filePath];
if (!lineCount) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    lineCount = content.split('\n').length;
    sizeCache[filePath] = lineCount;
    try { fs.writeFileSync(SIZE_CACHE_FILE, JSON.stringify(sizeCache)); } catch {}
  } catch {
    process.exit(0); // Can't read = not our problem
  }
}

if (lineCount < LINE_THRESHOLD) process.exit(0);

// File is large and graphify exists — suggest query instead
metrics.inc('graphify-read-gate', 'blocked');
try { logger.warn('graphify-read-gate', 'BLOCK ' + path.basename(filePath), { lines: lineCount }); } catch (_) {}

const rel = path.relative(cwd, filePath).replace(/\\/g, '/');
const suggestion = `cmd /c graphify query "${rel} architecture and key functions"`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      `GRAPHIFY: ${rel} is ${lineCount} lines. Use graphify instead of reading raw:\n` +
      `  ${suggestion}\n` +
      `Or query by concept: cmd /c graphify query "what does <class/function> do"`
  }
}));
process.exit(0);
