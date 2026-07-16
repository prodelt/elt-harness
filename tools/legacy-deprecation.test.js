#!/usr/bin/env node
'use strict';
// legacy-deprecation.test.js — spec 005 T018/T019. A retired route whose file is
// not yet deleted must fail-closed with an actionable message pointing at the
// active route and the migration plan. harness-runner/harness-gates/pipeline-state
// were deleted in T019; install-harness-teeth is deleted in T020, so it stays here
// until then.

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// [file, needle proving the message is actionable — the canonical route or plan]
const DEPRECATED = [
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

function main() {
  testDeprecatedClisFailClosed();
  process.stdout.write('legacy deprecation tests: PASS\n');
}

main();
