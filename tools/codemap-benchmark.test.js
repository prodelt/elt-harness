#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { QUESTIONS, runBenchmark } = require('./codemap-benchmark');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codemap-benchmark-'));
}

function testBenchmarkDefinesTenQuestions() {
  assert.equal(QUESTIONS.length, 10);
}

function testGraphifyBenchmarkUsesBoundedQueries() {
  const report = runBenchmark({
    root: tempRoot(),
    provider: 'graphify',
    limit: 2,
  }, {
    runner: (command, args) => ({ status: 0, stdout: args.includes('what does project-docs-core do?') ? 'project-docs-core initOrSyncProjectDocs' : 'doctor-core runDoctor', stderr: '' }),
  });
  assert.equal(report.provider, 'graphify');
  assert.equal(report.question_count, 2);
  assert.equal(report.summary.pass, 2);
  assert.match(report.results[0].attemptedCommand, /graphify query/);
}

function testGraphifyBenchmarkWarnsOnWeakRelevance() {
  const report = runBenchmark({
    root: tempRoot(),
    provider: 'graphify',
    limit: 1,
  }, {
    runner: () => ({ status: 0, stdout: 'No matching nodes found.', stderr: '' }),
  });
  assert.equal(report.summary.warn, 1);
  assert.deepEqual(report.results[0].matched, []);
}

function testCodeGraphBenchmarkRecordsBlockedProvider() {
  const report = runBenchmark({
    root: tempRoot(),
    provider: 'codegraph',
    limit: 1,
  }, {
    codegraphRunner: () => ({ status: 1, output: 'not installed', attemptedCommand: 'codegraph status' }),
  });
  assert.equal(report.provider, 'codegraph');
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.results[0].attemptedCommand, 'codegraph status');
}

function main() {
  testBenchmarkDefinesTenQuestions();
  testGraphifyBenchmarkUsesBoundedQueries();
  testGraphifyBenchmarkWarnsOnWeakRelevance();
  testCodeGraphBenchmarkRecordsBlockedProvider();
  process.stdout.write('codemap-benchmark tests: PASS\n');
}

main();
