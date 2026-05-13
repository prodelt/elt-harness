#!/usr/bin/env node
'use strict';
// S11 Task 35 — SessionStart advisory for branch-per-session discipline.
const fs = require('fs');
const { execSync } = require('child_process');

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = input.cwd || process.cwd();

function git(command) {
  try {
    return execSync(command, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000
    }).trim();
  } catch {
    return '';
  }
}

const root = git('git rev-parse --show-toplevel');
if (!root) process.exit(0);

const branch = git('git branch --show-current') || git('git rev-parse --abbrev-ref HEAD');
const protectedBranches = new Set(['main', 'master', 'production', 'release']);
if (!protectedBranches.has(branch)) process.exit(0);

const message = [
  `GIT BRANCH ADVISORY: current branch is "${branch}".`,
  'Start task work in a feature branch before editing or committing.',
  'Suggested command: /git-flow start feature <short-kebab-name>'
].join('\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: message
  }
}));
process.exit(0);
