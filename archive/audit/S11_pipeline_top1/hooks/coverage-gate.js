#!/usr/bin/env node
'use strict';

// S11 Task 20 - PreToolUse[Bash] deny git commit when recorded line coverage is below threshold.
const fs = require('fs');
const path = require('path');

const DEFAULT_MIN_COVERAGE = 80;

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (_) {
    return null;
  }
}

function shouldCheckCommand(command) {
  return /\bgit\s+commit\b/.test(command) && !/--amend\b/.test(command);
}

function thresholdFromEnv(env = process.env) {
  const parsed = Number(env.COVERAGE_GATE_MIN);
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
    return parsed;
  }
  return DEFAULT_MIN_COVERAGE;
}

function parseCoverageSummary(content) {
  try {
    const parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
    const pct = Number(parsed && parsed.total && parsed.total.lines && parsed.total.lines.pct);
    return Number.isFinite(pct) ? pct : null;
  } catch (_) {
    return null;
  }
}

function parseLcov(content) {
  const totals = content.split(/\r?\n/).reduce(
    (state, line) => {
      const found = /^LF:(\d+)$/.exec(line);
      const hit = /^LH:(\d+)$/.exec(line);
      return {
        found: found ? state.found + Number(found[1]) : state.found,
        hit: hit ? state.hit + Number(hit[1]) : state.hit,
      };
    },
    { found: 0, hit: 0 }
  );

  if (totals.found <= 0) {
    return null;
  }
  return Number(((totals.hit / totals.found) * 100).toFixed(2));
}

function readCoverage(cwd) {
  const summaryPath = path.join(cwd, 'coverage', 'coverage-summary.json');
  if (fs.existsSync(summaryPath)) {
    const pct = parseCoverageSummary(fs.readFileSync(summaryPath, 'utf8'));
    return pct === null ? null : { source: 'coverage-summary.json', pct };
  }

  const lcovPath = path.join(cwd, 'coverage', 'lcov.info');
  if (fs.existsSync(lcovPath)) {
    const pct = parseLcov(fs.readFileSync(lcovPath, 'utf8'));
    return pct === null ? null : { source: 'lcov.info', pct };
  }

  return null;
}

function denyResponse(coverage, threshold) {
  const reason = [
    `Coverage gate failed: line coverage is ${coverage.pct}% from ${coverage.source}.`,
    `Required minimum is ${threshold}%.`,
    'Run the project coverage command, add meaningful tests, and retry git commit.',
  ].join('\n');

  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function handleInput(input, options = {}) {
  if (!input) {
    return '';
  }

  const command = (input.tool_input && input.tool_input.command) || '';
  if (!shouldCheckCommand(command)) {
    return '';
  }

  const cwd = input.cwd || process.cwd();
  const threshold = Object.prototype.hasOwnProperty.call(options, 'threshold')
    ? options.threshold
    : thresholdFromEnv(options.env);
  const coverage = readCoverage(cwd);
  if (!coverage || coverage.pct >= threshold) {
    return '';
  }

  return denyResponse(coverage, threshold);
}

if (require.main === module) {
  try {
    process.stdout.write(handleInput(readInput()));
  } catch (_) {}
  process.exit(0);
}

module.exports = {
  handleInput,
  parseCoverageSummary,
  parseLcov,
  readCoverage,
  shouldCheckCommand,
  thresholdFromEnv,
};
