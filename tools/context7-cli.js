#!/usr/bin/env node
'use strict';

// Context7 CLI wrapper — Windows-first, scriptable, explicit skip reasons on failure.
// ctx7 is available as a PATH binary; cmd.exe /c ctx7 is used on Windows (not npx.cmd)
// because ctx7 is already resolved in PATH and npx adds unnecessary overhead.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const STDOUT_LIMIT = 2000;
const STDERR_LIMIT = 500;
const DEFAULT_TIMEOUT_MS = 12000;
// 011 T009: след УСПЕШНОГО обращения к ctx7. По нему L0 отличает «сверился с документацией»
// от «вспомнил API» — без записи новый внешний импорт в диффе даёт block. Файл рантайм-ный
// (как run-log): его пишет инструмент, а не человек, и в дифф слайса он попадать не должен.
const CTX7_PROOF = path.join('.harness', 'ctx7-proof.jsonl');
function appendCtx7Proof(subcommand, subargs, cwd = process.cwd()) {
  try {
    const file = path.join(cwd, CTX7_PROOF);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({
      subcommand, library: subargs[0] || '', query: subargs.slice(1).join(' '), ts: new Date().toISOString(),
    }) + '\n');
  } catch { /* пруф — не цель вызова: не пишется, значит L0 позовёт судью, а не упадёт CLI */ }
}

// ctx7 --help exits 255; actual subcommands exit 0 on success
function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

function buildCommand(subcommand, subargs) {
  if (process.platform === 'win32') {
    return { command: 'cmd.exe', args: ['/c', 'ctx7', subcommand, ...subargs] };
  }
  return { command: 'ctx7', args: [subcommand, ...subargs] };
}

function runCtx7(subcommand, subargs, options = {}) {
  const { runner = spawnSync, timeout = DEFAULT_TIMEOUT_MS } = options;
  const { command, args } = buildCommand(subcommand, subargs);
  const attemptedCommand = [command, ...args].join(' ');
  const result = runner(command, args, { encoding: 'utf8', timeout, windowsHide: true });

  const timedOut = !!(result && result.error && result.error.code === 'ETIMEDOUT');
  const exitCode = result ? result.status : null;
  const stdoutExcerpt = stripAnsi((result && result.stdout) || '').trim().slice(0, STDOUT_LIMIT);
  const stderrExcerpt = stripAnsi((result && result.stderr) || '').trim().slice(0, STDERR_LIMIT);
  const ok = !!result && result.status === 0 && !result.error;

  let skipReason = null;
  if (!ok) {
    if (timedOut) {
      skipReason = `timed out after ${timeout}ms`;
    } else if (result && result.error) {
      skipReason = result.error.message;
    } else {
      skipReason = stderrExcerpt || stdoutExcerpt || 'ctx7 unavailable';
    }
  }

  // Пишем ТОЛЬКО на успех: пруф означает «документация реально получена», а не «попытались».
  if (ok && options.proofCwd !== false) appendCtx7Proof(subcommand, subargs, options.proofCwd || process.cwd());

  return { ok, attemptedCommand, stdoutExcerpt, stderrExcerpt, exitCode, skipReason, timedOut };
}

// Resolve library name to Context7 library ID.
// query is optional — passed to ctx7 for relevance ranking when provided.
function resolveLibrary(name, query, options) {
  if (typeof query === 'object' && query !== null && !Array.isArray(query)) {
    options = query;
    query = '';
  }
  const subargs = query ? [name, query] : [name];
  return runCtx7('library', subargs, options);
}

// Query documentation for a library ID.
function queryDocs(libraryId, query, options) {
  return runCtx7('docs', [libraryId, query], options);
}

// ctx7 skills search is interactive — never spawn it from automation.
// Returns a descriptor that callers can use for manual-only guidance.
function interactiveSkillsSearch(query) {
  const { command, args } = buildCommand('skills', ['search', ...(query ? [query] : [])]);
  return {
    manualOnly: true,
    command: [command, ...args].join(' '),
    reason: 'ctx7 skills search is interactive and cannot be used in scripted or agent contexts',
  };
}

function usage() {
  return [
    'Usage: node tools/context7-cli.js <subcommand> [args...]',
    '  library <name> [query]           Resolve library name to Context7 ID',
    '  docs <libraryId> <query>         Query docs for a library',
    '  skills-search [query]            Show manual-only command (non-interactive note)',
  ].join('\n') + '\n';
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length) {
    process.stderr.write(usage());
    process.exit(2);
  }
  const [sub, ...rest] = argv;

  if (sub === 'library') {
    const [name, query] = rest;
    if (!name) { process.stderr.write('Error: library name required\n'); process.exit(2); }
    const result = resolveLibrary(name, query || '');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.ok ? 0 : 1);
  }

  if (sub === 'docs') {
    const [libraryId, query] = rest;
    if (!libraryId || !query) { process.stderr.write('Error: libraryId and query required\n'); process.exit(2); }
    const result = queryDocs(libraryId, query);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.ok ? 0 : 1);
  }

  if (sub === 'skills-search') {
    const descriptor = interactiveSkillsSearch(rest.join(' '));
    process.stdout.write(JSON.stringify(descriptor, null, 2) + '\n');
    process.exit(0);
  }

  process.stderr.write(`Unknown subcommand: ${sub}\n${usage()}`);
  process.exit(2);
}

if (require.main === module) main();

module.exports = { resolveLibrary, queryDocs, interactiveSkillsSearch, runCtx7, buildCommand, appendCtx7Proof, CTX7_PROOF };
