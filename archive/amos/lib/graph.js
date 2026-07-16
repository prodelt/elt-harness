'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * hasGraph(cwd) → boolean
 * Returns true if .codegraph or codemap.json exists in cwd.
 * Fail-soft: any error → false.
 */
function hasGraph(cwd) {
  try {
    const codegraphPath = path.join(cwd, '.codegraph');
    const codemapPath = path.join(cwd, 'codemap.json');
    return fs.existsSync(codegraphPath) || fs.existsSync(codemapPath);
  } catch (err) {
    return false;
  }
}

/**
 * ensureGraph(cwd, opts = {}) → result object
 *
 * Bootstrap a code graph in a project that lacks one.
 *
 * Options:
 *  - runner: injectable function (cmd, options) => string
 *    defaults to execSync with timeout 60s
 *
 * Returns:
 *  - { status: 'present', ran: false }             if graph already exists
 *  - { status: 'created', ran: true, output: string } on success
 *  - { status: 'error', ran: true, error: string }  if runner throws
 *  - { status: 'error', ran: false, error: string } on unexpected error
 */
function ensureGraph(cwd, opts = {}) {
  try {
    // If graph already present, return early
    if (hasGraph(cwd)) {
      return { status: 'present', ran: false };
    }

    // Prepare runner (injectable for testing)
    const runner = opts.runner || defaultRunner;

    // Run the bootstrap command
    try {
      const output = runner('graphify update .', { cwd });
      return {
        status: 'created',
        ran: true,
        output,
      };
    } catch (err) {
      return {
        status: 'error',
        ran: true,
        error: err.message || String(err),
      };
    }
  } catch (err) {
    return {
      status: 'error',
      ran: false,
      error: err.message || String(err),
    };
  }
}

/**
 * defaultRunner(cmd, options) → string
 * Executes a command synchronously with safe defaults.
 * Throws on error (caller catches and wraps in result).
 */
function defaultRunner(cmd, options = {}) {
  return execSync(cmd, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60000,
  });
}

module.exports = {
  hasGraph,
  ensureGraph,
};
