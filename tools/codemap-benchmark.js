#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { checkCodeGraphStatus } = require('./codemap-core');

const QUESTIONS = [
  { question: 'what does project-docs-core do?', expected: ['project-docs-core', 'initOrSyncProjectDocs'] },
  { question: 'what does doctor-core do?', expected: ['doctor-core', 'runDoctor'] },
  { question: 'what does codemap-core do?', expected: ['codemap-core', 'runCodemapDoctor'] },
  { question: 'what does pipeline-state do?', expected: ['pipeline-state', 'createClassifiedState'] },
  { question: 'what does skill-search do?', expected: ['skill-search', 'searchSkills'] },
  { question: 'what does research-router do?', expected: ['research-router', 'buildResearchRouterBlock'] },
  { question: 'what calls runCodemapDoctor?', expected: ['doctor-core', 'codemap'] },
  { question: 'what checks Graphify scope?', expected: ['codemap-core', 'checkGraphScope'] },
  { question: 'what verifies project docs?', expected: ['project-docs', 'verify'] },
  { question: 'what records pipeline state?', expected: ['pipeline-state', 'closeState'] },
];

function parseArgs(argv) {
  const defaults = { root: process.cwd(), provider: 'graphify', json: false, limit: QUESTIONS.length };
  const parseNext = (index, state) => {
    if (index >= argv.length) return state;
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--root') return parseNext(index + 2, { ...state, root: argv[index + 1] || state.root });
    if (arg === '--provider') return parseNext(index + 2, { ...state, provider: argv[index + 1] || state.provider });
    if (arg === '--limit') return parseNext(index + 2, { ...state, limit: Number(argv[index + 1]) || state.limit });
    return parseNext(index + 1, state);
  };
  return parseNext(2, defaults);
}

function runGraphifyQuestion(root, item, runner = spawnSync) {
  const completed = runner('cmd.exe', ['/c', 'graphify', 'query', item.question], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  const output = `${completed.stdout || ''}${completed.stderr || ''}`.trim();
  const matched = item.expected.filter((term) => new RegExp(term, 'i').test(output));
  return {
    question: item.question,
    status: completed.status !== 0 ? 'fail' : matched.length ? 'pass' : 'warn',
    provider: 'graphify',
    attemptedCommand: `cmd.exe /c graphify query ${item.question}`,
    expected: item.expected,
    matched,
    excerpt: output.slice(0, 300),
  };
}

function runCodeGraphQuestion(root, item, runner) {
  const status = checkCodeGraphStatus(root, runner);
  return {
    question: item.question,
    status: status.status === 'pass' ? 'pass' : 'blocked',
    provider: 'codegraph',
    attemptedCommand: status.data.attemptedCommand,
    excerpt: status.detail.slice(0, 300),
  };
}

function runBenchmark(options, deps = {}) {
  const items = QUESTIONS.slice(0, Math.max(1, Math.min(options.limit || QUESTIONS.length, QUESTIONS.length)));
  const results = items.map((item) => (
    options.provider === 'codegraph'
      ? runCodeGraphQuestion(options.root, item, deps.codegraphRunner)
      : runGraphifyQuestion(options.root, item, deps.runner || spawnSync)
  ));
  const summary = results.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  return {
    kind: 'codemap-benchmark',
    provider: options.provider === 'codegraph' ? 'codegraph' : 'graphify',
    root: options.root,
    question_count: items.length,
    summary,
    results,
  };
}

function main() {
  const options = parseArgs(process.argv);
  const report = runBenchmark(options);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${report.provider} benchmark: ${JSON.stringify(report.summary)}\n`);
  process.exit(report.summary.fail ? 1 : 0);
}

if (require.main === module) main();

module.exports = {
  QUESTIONS,
  runBenchmark,
};
