#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const defaults = { root: process.cwd(), json: false };
  const parseNext = (index, state) => {
    if (index >= argv.length) return state;
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--root') return parseNext(index + 2, { ...state, root: argv[index + 1] || state.root });
    return parseNext(index + 1, state);
  };
  return parseNext(2, defaults);
}

function fileExists(root, file) {
  return fs.existsSync(path.join(root, file));
}

function buildMeasurement(root) {
  const tasks = [
    {
      runner: 'Claude',
      task: 'codemap doctor with Graphify relevance smoke',
      command: 'node tools/doctor.js --root "<project>"',
      tool_calls: 1,
      file_reads: 0,
      status: fileExists(root, 'tools/doctor.js') ? 'measurable' : 'missing',
    },
    {
      runner: 'Codex',
      task: 'codemap provider and benchmark tests',
      command: 'node tools/codemap.test.js; node tools/codemap-benchmark.test.js',
      tool_calls: 2,
      file_reads: 0,
      status: fileExists(root, 'tools/codemap.test.js') ? 'measurable' : 'missing',
    },
  ];
  return {
    kind: 'codemap-measurement',
    root,
    metrics: ['tool_calls', 'file_reads'],
    tasks,
    note: 'Counts are command-level harness measurements; detailed agent-side file-read telemetry requires Claude/Codex runtime logs.',
  };
}

function main() {
  const options = parseArgs(process.argv);
  const report = buildMeasurement(options.root);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${report.kind}: ${report.tasks.length} tasks\n`);
}

if (require.main === module) main();

module.exports = {
  buildMeasurement,
};
