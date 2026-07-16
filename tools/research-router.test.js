#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildResearchRouterBlock } = require('./research-router');

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'research-router-'));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Project docs\n', 'utf8');
  return root;
}

function runnerWithFailures() {
  return (command, args) => {
    if (command === 'gh') return { status: 1, stdout: '', stderr: 'token invalid' };
    return { status: 1, stdout: '', stderr: `${command} ${args.join(' ')} unavailable` };
  };
}

function runnerWithGithubAuth() {
  return (command) => {
    if (command === 'gh') return { status: 0, stdout: 'Logged in\n', stderr: '' };
    return { status: 1, stdout: '', stderr: 'ctx7 unavailable' };
  };
}

function testInvalidProvidersAreSkippedAndResearchContinues() {
  const block = buildResearchRouterBlock({
    question: 'How should we design a router?',
    root: tempProject(),
    library: 'next',
    github: true,
    architecture: true,
  }, { runner: runnerWithFailures(), now: '2026-05-20T10:00:00Z' });

  assert.equal(block.kind, 'research-router');
  assert.equal(block.skipped_sources.length, 2);
  assert.match(block.skipped_sources[0].attemptedCommand, /ctx7 library next|cmd.exe \/c ctx7 library next/);
  assert.match(block.skipped_sources[1].attemptedCommand, /gh auth status/);
  assert.ok(block.sources_used.some((source) => source.name === 'project-docs'));
}

function testEvidenceBlockStaysBounded() {
  const block = buildResearchRouterBlock({
    question: 'Find similar implementations',
    root: tempProject(),
    github: true,
    architecture: true,
  }, { runner: runnerWithGithubAuth(), now: '2026-05-20T10:00:00Z' });

  assert.ok(block.top_findings.length <= 5);
  assert.equal(block.token_budget.max_findings, 5);
  assert.ok(block.sources_used.every((source) => source.tokenBudget <= 1000));
  assert.ok(block.sources_used.some((source) => /--limit 5/.test(source.command || '')));
}

function testLedgerWriteShape() {
  const root = tempProject();
  const ledger = path.join(root, 'ledger.jsonl');
  const block = buildResearchRouterBlock({
    question: 'Route research',
    root,
  }, { runner: runnerWithFailures(), now: '2026-05-20T10:00:00Z' });

  fs.appendFileSync(ledger, JSON.stringify(block) + '\n', 'utf8');
  const saved = JSON.parse(fs.readFileSync(ledger, 'utf8'));
  assert.equal(saved.kind, 'research-router');
  assert.equal(saved.question, 'Route research');
}

function main() {
  testInvalidProvidersAreSkippedAndResearchContinues();
  testEvidenceBlockStaysBounded();
  testLedgerWriteShape();
  process.stdout.write('research-router tests: PASS\n');
}

main();
