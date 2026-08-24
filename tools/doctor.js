#!/usr/bin/env node
'use strict';

const { parseArgs, runDoctor, formatText } = require('./doctor-core');

function main() {
  const parsed = parseArgs(process.argv);
  if (!parsed.ok) {
    process.stderr.write(`doctor: ${parsed.error}\n`);
    process.stderr.write('Usage: node tools/doctor.js [--root PATH] [--register] [--json] [--no-graphify]\n');
    process.exit(2);
  }

  try {
    const report = runDoctor(parsed.value);
    if (parsed.value.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      process.stdout.write(formatText(report));
    }
    process.exit(report.summary.fail ? 2 : 0);
  } catch (error) {
    process.stderr.write(`doctor failed: ${error.message}\n`);
    process.exit(1);
  }
}

main();
