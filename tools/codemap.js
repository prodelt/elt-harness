#!/usr/bin/env node
'use strict';

const { runCodemapDoctor, setupCodemapProject, formatCodemapReport } = require('./codemap-core');

function parseArgs(argv) {
  const command = argv[2] === 'setup' ? 'setup' : 'doctor';
  const startIndex = command === 'setup' ? 3 : 2;
  const defaults = { command, root: process.cwd(), json: false, relevance: true, provider: process.env.CODEMAP_PROVIDER || 'graphify' };
  const parseNext = (index, state) => {
    if (index >= argv.length) return { ok: true, value: state };
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--no-relevance') return parseNext(index + 1, { ...state, relevance: false });
    if (arg === '--provider') {
      const provider = argv[index + 1];
      if (!provider) return { ok: false, error: '--provider requires graphify or codegraph' };
      return parseNext(index + 2, { ...state, provider });
    }
    if (arg === '--root') {
      const root = argv[index + 1];
      if (!root) return { ok: false, error: '--root requires a path' };
      return parseNext(index + 2, { ...state, root });
    }
    return { ok: false, error: `Unknown argument: ${arg}` };
  };
  return parseNext(startIndex, defaults);
}

function usage() {
  return 'Usage: node tools/codemap.js [setup] [--root PATH] [--provider graphify|codegraph] [--json] [--no-relevance]\n';
}

function formatSetupReport(result) {
  const action = result.graphifyignore.changed
    ? `Updated .graphifyignore: added ${result.graphifyignore.added.join(', ')}`
    : '.graphifyignore already has required excludes';
  return `${action}\n\n${formatCodemapReport(result.report)}`;
}

function main() {
  const parsed = parseArgs(process.argv);
  if (!parsed.ok) {
    process.stderr.write(`codemap: ${parsed.error}\n`);
    process.stderr.write(usage());
    process.exit(2);
  }
  try {
    const report = parsed.value.command === 'setup'
      ? setupCodemapProject(parsed.value)
      : runCodemapDoctor(parsed.value);
    if (parsed.value.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else if (parsed.value.command === 'setup') {
      process.stdout.write(formatSetupReport(report));
    } else {
      process.stdout.write(formatCodemapReport(report));
    }
    const summary = parsed.value.command === 'setup' ? report.report.summary : report.summary;
    process.exit(summary.fail ? 2 : 0);
  } catch (error) {
    process.stderr.write(`codemap failed: ${error.message}\n`);
    process.exit(1);
  }
}

main();
