#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { messageFor, projectRoot } = require('./project-bootstrap-advisor');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function testMessageIncludesSafeBootstrapAndProbes() {
  const message = messageFor({
    kind: 'project-bootstrap',
    root: 'C:/project',
    strategy: 'project-docs-codemap-first',
    stack: { name: 'Next.js App Router' },
    actions: [{ id: 'project-docs', safe: true }, { id: 'rag-manifest', safe: false }],
    recommended_probes: ['rg --files src/app src/lib | Select-Object -First 80'],
  });
  assert.match(message, /Project strategy: project-docs-codemap-first/);
  assert.match(message, /Safe bootstrap pending: project-docs/);
  assert.doesNotMatch(message, /rag-manifest/);
  assert.match(message, /Use bounded probes/);
}

function testMessageCanBeSilent() {
  const message = messageFor({
    kind: 'project-bootstrap',
    strategy: 'bounded-grep-first',
    actions: [],
    recommended_probes: [],
  });
  assert.equal(message, '');
}

function testProjectRootAvoidsGlobalGitRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-advisor-root-'));
  const nested = path.join(root, 'src', 'app');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n', 'utf8');
  assert.equal(projectRoot(nested), root);
}

function main() {
  testMessageIncludesSafeBootstrapAndProbes();
  testMessageCanBeSilent();
  testProjectRootAvoidsGlobalGitRoot();
  process.stdout.write('project-bootstrap-advisor tests: PASS\n');
}

main();
