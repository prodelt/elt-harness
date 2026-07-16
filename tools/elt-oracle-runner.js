#!/usr/bin/env node
'use strict';
// elt-oracle-runner — full control-plane test oracle: discovers every
// tools/**/*.test.js (both node:test-based and plain-script suites; the repo
// mixes both styles) and runs each with a plain `node <file>`, honest exit
// code from each file, no framework needed. Replaces the old doctor+Fleet-only
// oracle (spec 005 T007) which silently skipped ELT/bootstrap/project-docs
// coverage.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Denylist for known-broken tests (reason required). Empty since 005 T020
// removed the codemap suite that was the only entry.
const SKIP = new Set();

function discover(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(discover(full));
    else if (entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

function main() {
  const files = discover(path.join(ROOT, 'tools'))
    .map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    .sort();
  const run = files.filter((f) => !SKIP.has(f));
  const skipped = files.filter((f) => SKIP.has(f));

  console.error(`elt-oracle-runner: ${run.length} test files (${skipped.length} skipped: ${skipped.join(', ') || 'none'})`);
  let failed = 0;
  for (const file of run) {
    console.error(`\n── ${file} ──`);
    const r = spawnSync(process.execPath, [file], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) { failed++; console.error(`FAIL: ${file} (exit ${r.status})`); }
  }
  console.error(`\nelt-oracle-runner: ${run.length - failed}/${run.length} passed`);
  process.exit(failed ? 1 : 0);
}

if (require.main === module) main();

module.exports = { discover, SKIP };
