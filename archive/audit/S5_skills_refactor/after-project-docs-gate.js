#!/usr/bin/env node

/**
 * SessionStart hook: Project Docs Gate v3
 *
 * Detects CLAUDE.md / AGENTS.md / .gemini/GEMINI.md state.
 * Handles all edge cases:
 *   - None exist → block (exit 2)
 *   - Only one exists → advisory (missing others)
 *   - Two/three exist but Stack versions differ → conflict warning
 *   - All exist but sections incomplete → advisory
 * Also detects Graphify state: graph exists? claude install done?
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const metrics = require('./lib/metrics');
const logger = require('./lib/logger');
const { normCwd } = require('./lib/pathnorm');

metrics.inc('project-docs-gate', 'fired');
let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = normCwd((input && input.cwd) || process.cwd());

// ── 1. Is this a real project? ────────────────────────────────────────────────
const PROJECT_INDICATORS = [
  'package.json', 'go.mod', 'pyproject.toml', 'Cargo.toml',
  'requirements.txt', 'pom.xml', 'Makefile', 'docker-compose.yml', '.git'
];
const foundIndicators = PROJECT_INDICATORS.filter(f => {
  try { return fs.existsSync(path.join(cwd, f)); } catch { return false; }
});

// Fallback: source files present in common code dirs (src/app/lib/pages/etc)
// Avoids false-positive on $HOME / Documents style folders.
const CODE_EXTS = /\.(js|jsx|ts|tsx|py|go|rs|java|rb|php|cs|cpp|c|h|swift|kt|vue|svelte)$/;
const CODE_DIRS = ['src', 'app', 'lib', 'pages', 'components', 'server', 'api'];
function hasSourceFilesIn(dir) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (CODE_EXTS.test(name)) return true;
    }
  } catch {}
  return false;
}
let sourceFilesFound = false;
if (foundIndicators.length === 0) {
  if (hasSourceFilesIn(cwd)) sourceFilesFound = true;
  else {
    for (const sub of CODE_DIRS) {
      if (hasSourceFilesIn(path.join(cwd, sub))) { sourceFilesFound = true; break; }
    }
  }
}
const isProject = foundIndicators.length > 0 || sourceFilesFound;
if (!isProject) process.exit(0);

// ── 2. Detect which docs exist ────────────────────────────────────────────────
const CLAUDE_PATH  = path.join(cwd, 'CLAUDE.md');
const AGENTS_PATH  = path.join(cwd, 'AGENTS.md');
const GEMINI_PATH  = path.join(cwd, '.gemini', 'GEMINI.md');

const hasClaude  = fs.existsSync(CLAUDE_PATH);
const hasAgents  = fs.existsSync(AGENTS_PATH);
const hasGemini  = fs.existsSync(GEMINI_PATH);
const docsCount  = [hasClaude, hasAgents, hasGemini].filter(Boolean).length;

const REQUIRED_SECTIONS = [
  '## Overview', '## Stack', '## Commands',
  '## Architecture', '## Gotchas', '## Current State'
];

function readSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function missingSections(content) {
  return REQUIRED_SECTIONS.filter(s => !content.includes(s));
}

function extractStack(content) {
  const m = content.match(/## Stack[\s\S]*?(?=\n##|$)/);
  return m ? m[0].slice(0, 300).trim() : '';
}

const advisories = [];
const warnings   = [];

// ── 3. None exist → hard block ────────────────────────────────────────────────
if (docsCount === 0) {
  metrics.inc('project-docs-gate', 'blocked');
  logger.warn('project-docs-gate', 'BLOCK no docs in ' + cwd);
  const detectedBy = foundIndicators.length > 0
    ? 'Project indicators found: ' + foundIndicators.join(', ')
    : 'Project detected via file count: >10 source files present';
  process.stderr.write([
    '╔══════════════════════════════════════════════════════╗',
    '║  PROJECT DOCS MISSING — CANNOT START WORK            ║',
    '╚══════════════════════════════════════════════════════╝',
    '',
    'Location: ' + cwd,
    detectedBy,
    'Missing:   CLAUDE.md, AGENTS.md, .gemini/GEMINI.md (none present)',
    '',
    'REQUIRED NEXT ACTION — invoke the Skill tool now:',
    '    Skill(skill="init-project")',
    '',
    'This is the only valid next step. Do not:',
    '  • answer the user request before docs exist',
    '  • create docs manually (the skill gathers real data)',
    '  • bypass with another tool call',
    '',
    'After init-project completes, resume the original user request.',
  ].join('\n') + '\n');
  process.exit(2);
}

// ── 4. Conflict detection: multiple docs with differing Stack sections ─────────
if (docsCount >= 2) {
  const sources = [];
  if (hasClaude) sources.push({ name: 'CLAUDE.md',        content: readSafe(CLAUDE_PATH) });
  if (hasAgents) sources.push({ name: 'AGENTS.md',        content: readSafe(AGENTS_PATH) });
  if (hasGemini) sources.push({ name: '.gemini/GEMINI.md', content: readSafe(GEMINI_PATH) });

  // Extract Stack sections and compare
  const stacks = sources.map(s => ({ name: s.name, stack: extractStack(s.content) }))
                        .filter(s => s.stack.length > 20);

  if (stacks.length >= 2) {
    // Simple diff: check if top 3 lines of Stack section match
    const normalize = s => s.replace(/\s+/g, ' ').toLowerCase().slice(0, 150);
    const base = normalize(stacks[0].stack);
    const diffs = stacks.slice(1).filter(s => normalize(s.stack) !== base);
    if (diffs.length > 0) {
      warnings.push(
        'DOCS CONFLICT: Stack sections differ between files. Run /sync-docs to fix.\n' +
        '  Source of truth: CLAUDE.md → syncs to AGENTS.md + .gemini/GEMINI.md'
      );
    }
  }

  // Check each file for missing sections
  for (const { name, content } of sources) {
    const missing = missingSections(content);
    if (missing.length > 0) {
      advisories.push(`${name} missing sections: ${missing.join(', ')}`);
    }
  }
}

// ── 5. Partial coverage advisory ─────────────────────────────────────────────
if (docsCount === 1 || docsCount === 2) {
  const missing = [];
  if (!hasClaude)  missing.push('CLAUDE.md (Claude Code)');
  if (!hasAgents)  missing.push('AGENTS.md (Codex)');
  if (!hasGemini)  missing.push('.gemini/GEMINI.md (Antigravity)');
  advisories.push('Run /sync-docs to create: ' + missing.join(', '));
}

// ── 6. Freshness check on primary doc ────────────────────────────────────────
const primaryPath = hasClaude ? CLAUDE_PATH : (hasAgents ? AGENTS_PATH : GEMINI_PATH);
try {
  const stat = fs.statSync(primaryPath);
  const daysSince = (Date.now() - stat.mtimeMs) / 86400000;
  if (daysSince > 14) {
    advisories.push(
      path.basename(primaryPath) + ' not updated in ' +
      Math.floor(daysSince) + ' days — refresh Current State section'
    );
  }
} catch {}

// ── 7. Graphify state detection ───────────────────────────────────────────────
const graphPath    = path.join(cwd, 'graphify-out', 'graph.json');
const graphExists  = fs.existsSync(graphPath);

// Check if graphify claude install was run (CLAUDE.md has graphify section)
let graphifyInstalled = false;
if (hasClaude) {
  const claudeContent = readSafe(CLAUDE_PATH);
  graphifyInstalled = claudeContent.includes('graphify') || claudeContent.includes('Graphify');
}

// Graphify stats are handled by graphify-session-init.js — skip here to avoid duplication
if (!graphExists && !graphifyInstalled) {
  advisories.push(
    'GRAPHIFY: No graph. Run: pip install graphifyy && cmd /c graphify update .\n' +
    '  (NEVER run graphify claude install on Windows — use node graphify-preuse.js)'
  );
}

// ── 8. Output ─────────────────────────────────────────────────────────────────
if (warnings.length === 0 && advisories.length === 0) process.exit(0);

const lines = [];
if (warnings.length > 0) {
  lines.push('⚠ DOCS WARNINGS:');
  warnings.forEach(w => lines.push('  • ' + w));
}
if (advisories.length > 0) {
  lines.push('ℹ DOCS ADVISORIES:');
  advisories.forEach(a => lines.push('  • ' + a));
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: lines.join('\n')
  }
}));
