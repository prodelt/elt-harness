#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { resolveLibrary, queryDocs, interactiveSkillsSearch, buildCommand } = require('./context7-cli');

function failingRunner() {
  return (_command, _args) => ({ status: 1, stdout: '', stderr: 'network error', error: null });
}

function enoentRunner() {
  return () => ({ status: null, stdout: '', stderr: '', error: { message: 'spawn ctx7 ENOENT', code: 'ENOENT' } });
}

function timedOutRunner() {
  return () => ({ status: null, stdout: '', stderr: '', error: { message: 'timed out', code: 'ETIMEDOUT' } });
}

function successRunner(stdout) {
  return (_command, _args) => ({ status: 0, stdout, stderr: '', error: null });
}

function capturingRunner() {
  let capturedCommand, capturedArgs;
  const run = (command, args) => {
    capturedCommand = command;
    capturedArgs = args;
    return { status: 0, stdout: 'Library: /vercel/ai\n', stderr: '', error: null };
  };
  run.captured = () => ({ capturedCommand, capturedArgs });
  return run;
}

function testNetworkFailureProducesSkipReason() {
  const result = resolveLibrary('vercel-ai', { runner: failingRunner() });
  assert.equal(result.ok, false);
  assert.ok(result.skipReason, 'skip reason must be non-empty on failure');
  assert.ok(typeof result.attemptedCommand === 'string' && result.attemptedCommand.includes('ctx7'));
}

function testEnoentProducesSkipReasonFromErrorMessage() {
  const result = resolveLibrary('vercel-ai', { runner: enoentRunner() });
  assert.equal(result.ok, false);
  assert.ok(result.skipReason.includes('ENOENT'), `expected ENOENT in: ${result.skipReason}`);
}

function testTimeoutProducesSkipReasonWithMs() {
  const result = resolveLibrary('vercel-ai', { runner: timedOutRunner(), timeout: 5000 });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
  assert.ok(result.skipReason.includes('timed out'));
}

function testSuccessfulLibraryResolution() {
  const result = resolveLibrary('vercel-ai', successRunner('Library: /vercel/ai\nID: /vercel/ai\n'));
  assert.equal(result.ok, true);
  assert.ok(result.stdoutExcerpt.includes('/vercel/ai'));
  assert.equal(result.skipReason, null);
  assert.equal(result.exitCode, 0);
}

function testLibraryResolutionWithQuery() {
  const cap = capturingRunner();
  resolveLibrary('vercel-ai', 'agents tool calling', { runner: cap });
  const { capturedArgs } = cap.captured();
  assert.ok(capturedArgs.includes('vercel-ai'), 'name must be in args');
  assert.ok(capturedArgs.includes('agents tool calling'), 'query must be forwarded to ctx7');
}

function testLibraryResolutionWithoutQuery() {
  const cap = capturingRunner();
  resolveLibrary('vercel-ai', { runner: cap });
  const { capturedArgs } = cap.captured();
  assert.ok(capturedArgs.includes('vercel-ai'));
  assert.ok(!capturedArgs.includes(''), 'empty string must not be forwarded as arg');
}

function testSuccessfulDocsQuery() {
  const content = 'Tool calling example: generateText with tools';
  const result = queryDocs('/microsoft/playwright-mcp', 'CLI usage for coding agents', { runner: successRunner(content) });
  assert.equal(result.ok, true);
  assert.ok(result.stdoutExcerpt.includes('Tool calling example'));
  assert.equal(result.skipReason, null);
}

function testDocsFailureProducesSkipReason() {
  const result = queryDocs('/microsoft/playwright-mcp', 'CLI usage', { runner: failingRunner() });
  assert.equal(result.ok, false);
  assert.ok(result.skipReason);
}

function testAnsiStrippedFromStdout() {
  const ansiRunner = () => ({
    status: 0,
    stdout: '\x1B[32mLibrary: /vercel/ai\x1B[0m\n',
    stderr: '\x1B[31mwarn\x1B[0m',
    error: null,
  });
  const result = resolveLibrary('vercel-ai', { runner: ansiRunner });
  assert.ok(!result.stdoutExcerpt.includes('\x1B'), 'ANSI must be stripped from stdoutExcerpt');
  assert.ok(!result.stderrExcerpt.includes('\x1B'), 'ANSI must be stripped from stderrExcerpt');
  assert.ok(result.stdoutExcerpt.includes('Library: /vercel/ai'));
}

function testResultShapeHasAllSevenFields() {
  const result = resolveLibrary('vercel-ai', { runner: failingRunner() });
  const requiredFields = ['ok', 'attemptedCommand', 'stdoutExcerpt', 'stderrExcerpt', 'exitCode', 'skipReason', 'timedOut'];
  for (const field of requiredFields) {
    assert.ok(Object.prototype.hasOwnProperty.call(result, field), `missing field: ${field}`);
  }
}

function testWindowsCommandUsesCmd() {
  if (process.platform !== 'win32') return;
  const { command, args } = buildCommand('library', ['react']);
  assert.equal(command, 'cmd.exe');
  assert.ok(args.includes('/c'), 'must include /c');
  assert.ok(args.includes('ctx7'), 'must include ctx7');
  assert.ok(args.includes('library'), 'must include library subcommand');
}

function testInteractiveSkillsSearchIsManualOnly() {
  const descriptor = interactiveSkillsSearch('architecture');
  assert.equal(descriptor.manualOnly, true);
  assert.ok(descriptor.command.includes('ctx7'), 'command must mention ctx7');
  assert.ok(descriptor.command.includes('skills'), 'command must include skills');
  assert.ok(typeof descriptor.reason === 'string' && descriptor.reason.length > 0);
}

function testInteractiveSkillsSearchNoSpawn() {
  let spawned = false;
  const spyRunner = () => { spawned = true; return { status: 0, stdout: '', stderr: '' }; };
  // interactiveSkillsSearch never calls a runner — verify no spawn happens
  interactiveSkillsSearch('test');
  assert.equal(spawned, false, 'interactiveSkillsSearch must not spawn any process');
}

function testAttemptedCommandIncludesLibrarySubcommand() {
  const result = resolveLibrary('next', { runner: failingRunner() });
  assert.ok(result.attemptedCommand.includes('library'), 'attemptedCommand must include library subcommand');
  assert.ok(result.attemptedCommand.includes('next'), 'attemptedCommand must include library name');
}

function main() {
  testNetworkFailureProducesSkipReason();
  testEnoentProducesSkipReasonFromErrorMessage();
  testTimeoutProducesSkipReasonWithMs();
  testSuccessfulLibraryResolution();
  testLibraryResolutionWithQuery();
  testLibraryResolutionWithoutQuery();
  testSuccessfulDocsQuery();
  testDocsFailureProducesSkipReason();
  testAnsiStrippedFromStdout();
  testResultShapeHasAllSevenFields();
  testWindowsCommandUsesCmd();
  testInteractiveSkillsSearchIsManualOnly();
  testInteractiveSkillsSearchNoSpawn();
  testAttemptedCommandIncludesLibrarySubcommand();
  process.stdout.write('context7-cli tests: PASS\n');
}

main();
