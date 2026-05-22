#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch (_) {
    return {};
  }
}

function projectRoot(cwd) {
  let current = path.resolve(cwd);
  while (current && current !== path.dirname(current)) {
    if (['package.json', 'AGENTS.md', 'CLAUDE.md', 'pyproject.toml', 'go.mod', 'Cargo.toml'].some((file) => fs.existsSync(path.join(current, file)))) {
      return current;
    }
    current = path.dirname(current);
  }
  return path.resolve(cwd);
}

function bootstrapScript() {
  const local = path.join(__dirname, 'project-bootstrap.js');
  if (fs.existsSync(local)) return local;
  const configured = process.env.PROJECT_BOOTSTRAP_SCRIPT;
  if (configured && fs.existsSync(configured)) return configured;
  return 'C:\\Claude playground\\Pipiline setupper\\tools\\project-bootstrap.js';
}

function runBootstrap(root) {
  const script = bootstrapScript();
  const completed = spawnSync(process.execPath, [script, '--root', root, '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
  });
  if (completed.status !== 0) return null;
  try {
    return JSON.parse(completed.stdout);
  } catch (_) {
    return null;
  }
}

function messageFor(report) {
  if (!report || !report.kind) return '';
  const missing = (report.actions || []).filter((action) => action.safe).map((action) => action.id);
  const probes = (report.recommended_probes || []).slice(0, 3);
  if (missing.length === 0 && probes.length === 0) return '';
  const lines = [
    `Project strategy: ${report.strategy}${report.stack && report.stack.name ? ` (${report.stack.name})` : ''}.`,
  ];
  if (missing.length) {
    lines.push(`Safe bootstrap pending: ${missing.join(', ')}.`);
    lines.push(`Run: node "${path.join(__dirname, 'project-bootstrap.js')}" --root "${report.root}" --apply --json`);
  }
  if (probes.length) {
    lines.push('Use bounded probes before file reads:');
    probes.forEach((probe, index) => lines.push(`${index + 1}. ${probe}`));
  }
  return lines.join('\n');
}

function main() {
  const input = readInput();
  const cwd = input.cwd || process.cwd();
  const root = projectRoot(cwd);
  const report = runBootstrap(root);
  const message = messageFor(report);
  if (!message) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: message,
    },
  }));
}

if (require.main === module) main();

module.exports = {
  messageFor,
  projectRoot,
};
