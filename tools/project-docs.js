#!/usr/bin/env node
'use strict';

const { initOrSyncProjectDocs, verifyProjectDocs } = require('./project-docs-core');

function usage() {
  return [
    'Usage: node tools/project-docs.js init [--root PATH] [--home PATH] [--json]',
    '       node tools/project-docs.js sync [--root PATH] [--home PATH] [--json]',
    '       node tools/project-docs.js verify [--root PATH] [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const command = argv[2] || 'verify';
  const parseNext = (index, state) => {
    if (index >= argv.length) return { ok: true, value: state };
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--root') return argv[index + 1]
      ? parseNext(index + 2, { ...state, root: argv[index + 1] })
      : { ok: false, error: '--root requires a path' };
    if (arg === '--home') return argv[index + 1]
      ? parseNext(index + 2, { ...state, home: argv[index + 1] })
      : { ok: false, error: '--home requires a path' };
    return { ok: false, error: `Unknown argument: ${arg}` };
  };
  if (!['init', 'sync', 'verify'].includes(command)) return { ok: false, error: `Unknown command: ${command}` };
  return parseNext(3, { command, root: process.cwd(), home: undefined, json: false });
}

function formatReport(report) {
  const docLines = (report.docs || []).map((item) => `- ${item.file}: ${item.action}`);
  const artifactLines = (report.artifacts || []).map((item) => `- ${item.file}: ${item.action}`);
  const missing = report.verification.missing.length ? report.verification.missing.join(', ') : 'none';
  return [
    `project-docs ${report.mode || 'verify'}: ${report.success ? 'PASS' : 'FAIL'}`,
    `core sections identical: ${report.verification.coreIdentical}`,
    `missing: ${missing}`,
    docLines.length ? 'docs:' : '',
    ...docLines,
    artifactLines.length ? 'artifacts:' : '',
    ...artifactLines,
    '',
  ].filter((line) => line !== '').join('\n');
}

function main() {
  const parsed = parseArgs(process.argv);
  if (!parsed.ok) {
    process.stderr.write(`project-docs: ${parsed.error}\n${usage()}\n`);
    process.exit(2);
  }
  try {
    const verification = parsed.value.command === 'verify' ? verifyProjectDocs(parsed.value.root) : null;
    const report = verification
      ? { success: verification.ok, verification }
      : initOrSyncProjectDocs({ root: parsed.value.root, home: parsed.value.home, mode: parsed.value.command });
    if (parsed.value.json) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } else {
      process.stdout.write(formatReport(report));
    }
    process.exit(report.success ? 0 : 1);
  } catch (error) {
    process.stderr.write(`project-docs failed: ${error.message}\n`);
    process.exit(1);
  }
}

main();
