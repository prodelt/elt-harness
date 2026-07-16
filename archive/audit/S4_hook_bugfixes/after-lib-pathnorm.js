/**
 * Path normalization for Claude Code hooks.
 *
 * Windows drive-letter case can differ between invocation contexts:
 *   cmd:   `cd d:\...` → cwd = "d:/..."
 *   pwsh:  `cd D:\...` → cwd = "D:/..."
 * Claude Code encodes these as different project dirs (`d--...` vs `D--...`),
 * breaking per-project state keyed by cwd string. This helper normalizes.
 *
 * Usage:
 *   const { normCwd, encodeProjectDir } = require('./lib/pathnorm');
 *   const cwd = normCwd(input.cwd);
 *   const projDir = encodeProjectDir(cwd);
 */

const path = require('path');

/**
 * Normalize cwd: uppercase drive letter (Windows), forward slashes.
 * Safe on POSIX (no drive letter → pass-through).
 */
function normCwd(cwd) {
  if (!cwd || typeof cwd !== 'string') return '';
  let p = cwd.replace(/\\/g, '/');
  // Uppercase drive letter if Windows-style absolute path
  if (/^[a-z]:/.test(p)) p = p[0].toUpperCase() + p.slice(1);
  // Strip trailing slash (except root "C:/")
  if (p.length > 3 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/**
 * Encode cwd → Claude Code project dir name (mirrors harness behavior).
 * "C:/Users/espad/foo" → "C--Users-espad-foo"
 */
function encodeProjectDir(cwd) {
  const norm = normCwd(cwd);
  return norm.replace(/:/g, '-').replace(/\//g, '-');
}

/**
 * Case-insensitive cwd equality (Windows path aware).
 */
function sameCwd(a, b) {
  return normCwd(a).toLowerCase() === normCwd(b).toLowerCase();
}

module.exports = { normCwd, encodeProjectDir, sameCwd };
