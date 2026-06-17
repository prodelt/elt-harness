#!/usr/bin/env node
'use strict';

const {
  initOrSyncProjectDocs,
  verifyProjectDocs,
  auditProjectDocs,
  auditAllProjects,
} = require('./project-docs-core');

const COMMANDS = ['init', 'sync', 'verify', 'audit', 'audit-all'];

function usage() {
  return [
    'Usage: node tools/project-docs.js init [--root PATH] [--home PATH] [--json]',
    '       node tools/project-docs.js sync [--root PATH] [--home PATH] [--json]',
    '       node tools/project-docs.js verify [--root PATH] [--json]',
    '       node tools/project-docs.js audit [--root PATH] [--home PATH] [--json]',
    '       node tools/project-docs.js audit-all --dirs PATH [PATH...] [--exclude SUBSTR]... [--json]',
  ].join('\n');
}

function parseArgs(argv) {
  const command = argv[2] || 'verify';
  if (!COMMANDS.includes(command)) return { ok: false, error: `Unknown command: ${command}` };
  const state = { command, root: process.cwd(), home: undefined, json: false, dirs: [], exclude: [] };
  let index = 3;
  while (index < argv.length) {
    const arg = argv[index];
    if (arg === '--json') { state.json = true; index += 1; continue; }
    if (arg === '--root') {
      if (!argv[index + 1]) return { ok: false, error: '--root requires a path' };
      state.root = argv[index + 1]; index += 2; continue;
    }
    if (arg === '--home') {
      if (!argv[index + 1]) return { ok: false, error: '--home requires a path' };
      state.home = argv[index + 1]; index += 2; continue;
    }
    if (arg === '--exclude') {
      if (!argv[index + 1]) return { ok: false, error: '--exclude requires a value' };
      state.exclude.push(argv[index + 1]); index += 2; continue;
    }
    if (arg === '--dirs') {
      index += 1;
      while (index < argv.length && !argv[index].startsWith('--')) { state.dirs.push(argv[index]); index += 1; }
      continue;
    }
    return { ok: false, error: `Unknown argument: ${arg}` };
  }
  return { ok: true, value: state };
}

function formatAudit(result) {
  const lines = [
    `doc-audit ${result.label}: ${result.status}`,
    `  sizes: ${result.sizes.map((size) => `${size.relative}=${size.lines}`).join(', ') || 'none'}`,
  ];
  for (const finding of result.findings) lines.push(`  [${finding.severity.toUpperCase()}] ${finding.code}: ${finding.detail}`);
  if (!result.findings.length) lines.push('  no issues');
  return lines.join('\n') + '\n';
}

function formatAuditAll(report) {
  const rows = report.results.map((result) => {
    const codes = [...new Set(result.findings.map((finding) => finding.code))];
    return `${result.status.padEnd(4)} ${String(result.maxLines).padStart(4)}  ${result.label}${codes.length ? '  — ' + codes.join(',') : ''}`;
  });
  return [
    'doc-audit (cross-project)',
    '='.repeat(48),
    ...rows,
    '',
    `Summary: FAIL=${report.summary.FAIL} WARN=${report.summary.WARN} PASS=${report.summary.PASS} (scanned ${report.scanned})`,
    '',
  ].join('\n');
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
    const { command, root, home, json, dirs, exclude } = parsed.value;
    if (command === 'audit') {
      const result = auditProjectDocs(root, { home });
      process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n' : formatAudit(result));
      process.exit(result.status === 'FAIL' ? 1 : 0);
    }
    if (command === 'audit-all') {
      const report = auditAllProjects(dirs.length ? dirs : [root], { home, exclude });
      process.stdout.write(json ? JSON.stringify(report, null, 2) + '\n' : formatAuditAll(report));
      process.exit(report.success ? 0 : 1);
    }
    const verification = command === 'verify' ? verifyProjectDocs(root) : null;
    const report = verification
      ? { success: verification.ok, verification }
      : initOrSyncProjectDocs({ root, home, mode: command });
    if (json) {
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
