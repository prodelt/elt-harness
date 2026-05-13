#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  checkGraphifyIgnoreConfig,
  checkGraphScope,
  checkGraphStaleness,
  checkRelevance,
  ensureGraphifyIgnoreConfig,
  summarizeGraph,
} = require('./codemap-core');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function graph(nodes) {
  return JSON.stringify({ directed: true, multigraph: false, graph: {}, nodes, links: [] });
}

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function testGraphScopePassesForProjectSources() {
  const root = tempRoot('codemap-pass');
  write(path.join(root, '.graphifyignore'), 'tools/red-team\naudit/1c-dev-pilot\ngraphify-out/cache\n');
  write(path.join(root, 'graphify-out', 'graph.json'), graph([
    { label: 'doctor-core.js', source_file: 'tools/doctor-core.js' },
    { label: 'runDoctor()', source_file: 'tools/doctor-core.js' },
    { label: 'AGENTS.md', source_file: 'AGENTS.md' },
  ]));
  const check = checkGraphScope(root);
  assert.equal(check.status, 'pass');
}

function testGraphifyIgnoreConfigRequiresNoisyExcludes() {
  const missingRoot = tempRoot('codemap-ignore-missing');
  const missing = checkGraphifyIgnoreConfig(missingRoot);
  assert.equal(missing.status, 'warn');

  const incompleteRoot = tempRoot('codemap-ignore-incomplete');
  write(path.join(incompleteRoot, '.graphifyignore'), 'tools/red-team\n');
  const incomplete = checkGraphifyIgnoreConfig(incompleteRoot);
  assert.equal(incomplete.status, 'warn');
  assert.match(incomplete.detail, /audit\/1c-dev-pilot/);

  const completeRoot = tempRoot('codemap-ignore-complete');
  write(path.join(completeRoot, '.graphifyignore'), [
    'tools/red-team/**',
    'audit/1c-dev-pilot/**',
    'graphify-out/cache/**',
  ].join('\n'));
  const complete = checkGraphifyIgnoreConfig(completeRoot);
  assert.equal(complete.status, 'pass');
}

function testEnsureGraphifyIgnoreConfigAddsMissingExcludes() {
  const root = tempRoot('codemap-ignore-ensure');
  write(path.join(root, '.graphifyignore'), '# local keep\n.tmp\n');
  const setup = ensureGraphifyIgnoreConfig(root);
  const text = fs.readFileSync(path.join(root, '.graphifyignore'), 'utf8');
  assert.equal(setup.changed, true);
  assert.match(text, /^# local keep/m);
  assert.match(text, /^\.tmp$/m);
  assert.match(text, /^tools\/red-team$/m);
  assert.match(text, /^audit\/1c-dev-pilot$/m);
  assert.match(text, /^graphify-out\/cache$/m);
}

function testGraphScopeWarnsForNoisyGraph() {
  const root = tempRoot('codemap-noisy');
  write(path.join(root, 'graphify-out', 'graph.json'), graph([
    { label: 'x', source_file: 'tools/red-team/vendor.js' },
    { label: 'y', source_file: 'tools/red-team/vendor.js' },
    { label: 'z', source_file: 'tools/doctor-core.js' },
  ]));
  const check = checkGraphScope(root);
  assert.equal(check.status, 'warn');
  assert.match(check.title, /dominated/);
}

function testGraphScopeFailsForOutsideAbsoluteSource() {
  const root = tempRoot('codemap-outside');
  write(path.join(root, 'graphify-out', 'graph.json'), graph([
    { label: 'outside', source_file: 'D:/other/project/file.js' },
  ]));
  const check = checkGraphScope(root);
  assert.equal(check.status, 'fail');
}

function testGraphStalenessWarnsForSemanticRationaleNodes() {
  const root = tempRoot('codemap-stale');
  write(path.join(root, 'graphify-out', 'graph.json'), graph([
    { label: 'doctor-core.js', source_file: 'tools/doctor-core.js' },
    { id: 'doctor_rationale_1', label: 'rationale', file_type: 'rationale' },
    { id: 'semantic:summary', label: 'semantic summary', file_type: 'semantic' },
  ]));
  const check = checkGraphStaleness(root);
  assert.equal(check.status, 'warn');
  assert.match(check.detail, /rationale/i);
  assert.match(check.repair, /graphify-out\/graph\.json/);
  assert.match(check.repair, /graphify update/);
}

function testRelevanceRequiresCurrentFileCitation() {
  const root = tempRoot('codemap-relevance');
  write(path.join(root, 'tools', 'project-docs-core.js'), 'module.exports = {};');
  const pass = checkRelevance(root, () => ({
    status: 0,
    output: 'tools\\project-docs-core.js exposes initOrSyncProjectDocs and registerProject.',
  }));
  const warn = checkRelevance(root, () => ({
    status: 0,
    output: 'red-team vendor output about something else',
  }));
  assert.equal(pass.status, 'pass');
  assert.equal(warn.status, 'warn');
}

function testSummarizeGraphCountsSources() {
  const root = tempRoot('codemap-summary');
  write(path.join(root, 'graphify-out', 'graph.json'), graph([
    { label: 'a', source_file: 'a.js' },
    { label: 'b', source_file: 'a.js' },
    { label: 'c', source_file: 'b.js' },
  ]));
  const summary = summarizeGraph(root);
  assert.equal(summary.ok, true);
  assert.equal(summary.nodes, 3);
  assert.equal(summary.uniqueSources, 2);
}

function main() {
  testGraphScopePassesForProjectSources();
  testGraphifyIgnoreConfigRequiresNoisyExcludes();
  testEnsureGraphifyIgnoreConfigAddsMissingExcludes();
  testGraphScopeWarnsForNoisyGraph();
  testGraphScopeFailsForOutsideAbsoluteSource();
  testGraphStalenessWarnsForSemanticRationaleNodes();
  testRelevanceRequiresCurrentFileCitation();
  testSummarizeGraphCountsSources();
  process.stdout.write('codemap tests: PASS\n');
}

main();
