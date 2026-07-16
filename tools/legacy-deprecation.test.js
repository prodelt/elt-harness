#!/usr/bin/env node
'use strict';
// legacy-deprecation.test.js — spec 005 T018. Every retired route's CLI must
// fail-closed with an actionable message pointing at /elt and the migration
// plan; the modules' exports stay live (doctor-core / git-workflow-audit still
// import helpers), so we invoke the file as a process, not require() it.

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// [file, needle proving the message is actionable — the canonical route or plan]
const DEPRECATED = [
  ['tools/pipeline-state.js', /\/elt/],
  ['tools/harness-runner.js', /\/elt/],
  ['tools/harness-gates.js', /\/elt/],
  ['tools/install-harness-teeth.js', /project-bootstrap|\/elt/],
];

function testDeprecatedClisFailClosed() {
  for (const [rel, needle] of DEPRECATED) {
    const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, `${rel} must exit nonzero when run as a CLI`);
    assert.match(r.stderr, /DEPRECATED/, `${rel} must announce deprecation`);
    assert.match(r.stderr, needle, `${rel} must point at the active route`);
    assert.match(r.stderr, /005-elt-control-plane-convergence/, `${rel} must cite the migration plan`);
  }
}

function testExportsStayLive() {
  // T019/T020 delete these; until then their exports back doctor/audit.
  assert.equal(typeof require('./pipeline-state').normalizePath, 'function');
  assert.equal(typeof require('./harness-gates').checkArtifact, 'function');
}

function main() {
  testDeprecatedClisFailClosed();
  testExportsStayLive();
  process.stdout.write('legacy deprecation tests: PASS\n');
}

main();
