#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MAX_FINDINGS = 5;
const DEFAULT_TOKEN_BUDGET = 1000;

function parseArgs(argv) {
  const defaults = { question: [], root: process.cwd(), json: false, ledger: '', library: '', github: false, architecture: false };
  const parseNext = (index, state) => {
    if (index >= argv.length) return { ...state, question: state.question.join(' ').trim() };
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--github') return parseNext(index + 1, { ...state, github: true });
    if (arg === '--architecture') return parseNext(index + 1, { ...state, architecture: true });
    if (arg === '--root') return parseNext(index + 2, { ...state, root: argv[index + 1] || state.root });
    if (arg === '--ledger') return parseNext(index + 2, { ...state, ledger: argv[index + 1] || '' });
    if (arg === '--library') return parseNext(index + 2, { ...state, library: argv[index + 1] || '' });
    return parseNext(index + 1, { ...state, question: [...state.question, arg] });
  };
  return parseNext(2, defaults);
}

function attemptedCommand(command, args) {
  return [command, ...args].join(' ');
}

function runBounded(runner, command, args, timeout) {
  const completed = runner(command, args, { encoding: 'utf8', timeout, windowsHide: true });
  return {
    attemptedCommand: attemptedCommand(command, args),
    ok: !!completed && completed.status === 0,
    output: ((completed && (completed.stdout || completed.stderr)) || '').trim().slice(0, 500),
    error: completed && completed.error ? completed.error.message : '',
  };
}

function context7Probe(library, runner) {
  if (!library) return { source: null, skipped: null };
  const command = process.platform === 'win32' ? 'cmd.exe' : 'ctx7';
  const args = process.platform === 'win32' ? ['/c', 'ctx7', 'library', library] : ['library', library];
  const result = runBounded(runner, command, args, 5000);
  if (!result.ok) {
    return { source: null, skipped: { source: 'Context7', reason: result.error || result.output || 'unavailable', attemptedCommand: result.attemptedCommand } };
  }
  return { source: { name: 'Context7', command: result.attemptedCommand, tokenBudget: 1000 }, skipped: null };
}

function githubProbe(enabled, question, runner) {
  if (!enabled) return { source: null, skipped: null };
  const auth = runBounded(runner, 'gh', ['auth', 'status'], 5000);
  if (!auth.ok) {
    return { source: null, skipped: { source: 'GitHub CLI', reason: auth.error || auth.output || 'auth invalid', attemptedCommand: auth.attemptedCommand } };
  }
  const command = attemptedCommand('gh', ['search', 'repos', question, '--limit', '5', '--json', 'fullName,description,url']);
  return { source: { name: 'GitHub CLI', command, tokenBudget: 1000 }, skipped: null };
}

function projectDocsSource(root) {
  const candidates = ['AGENTS.md', 'CLAUDE.md', path.join('.gemini', 'GEMINI.md')];
  const existing = candidates.filter((file) => fs.existsSync(path.join(root, file)));
  return existing.length ? { name: 'project-docs', files: existing, tokenBudget: 1000 } : null;
}

function codemapSource(root, enabled) {
  if (!enabled) return null;
  return {
    name: 'codemap:graphify',
    command: `node tools/codemap.js --root ${root} --json --no-relevance`,
    tokenBudget: 1000,
  };
}

function ragSource(root) {
  if (!fs.existsSync(path.join(root, '.rag', 'queue.json'))) return null;
  return {
    name: 'project-rag',
    command: 'python tools/rag-ingest.py --project pipeline-setupper --query "<question>"',
    tokenBudget: 1000,
  };
}

function compactFindings(sourcesUsed, skippedSources) {
  const findings = [
    sourcesUsed.some((source) => source.name === 'project-docs') ? 'Use AGENTS/CLAUDE/GEMINI as stable project truth before broader search.' : '',
    sourcesUsed.some((source) => source.name === 'codemap:graphify') ? 'Use codemap for local structure; keep output JSON and relevance queries bounded.' : '',
    sourcesUsed.some((source) => source.name === 'project-rag') ? 'Use project RAG only on demand; do not inject session-history dumps by default.' : '',
    skippedSources.length ? `Skipped unavailable providers: ${skippedSources.map((source) => source.source).join(', ')}.` : '',
    sourcesUsed.some((source) => source.name === 'GitHub CLI') ? 'GitHub search is allowed only through limited repo/code commands.' : '',
  ].filter(Boolean);
  return findings.slice(0, MAX_FINDINGS);
}

function buildResearchRouterBlock(options, deps = {}) {
  const runner = deps.runner || spawnSync;
  const root = path.resolve(options.root || process.cwd());
  const nowValue = typeof deps.now === 'function' ? deps.now() : deps.now;
  const context7 = context7Probe(options.library || '', runner);
  const github = githubProbe(!!options.github, options.question || '', runner);
  const sourcesUsed = [
    projectDocsSource(root),
    codemapSource(root, !!options.architecture),
    ragSource(root),
    context7.source,
    github.source,
  ].filter(Boolean);
  const skippedSources = [context7.skipped, github.skipped].filter(Boolean);

  return {
    kind: 'research-router',
    question: options.question || '',
    sources_used: sourcesUsed,
    top_findings: compactFindings(sourcesUsed, skippedSources),
    keep_change_decisions: [
      { keep: 'bounded evidence block', change: 'avoid unbounded command output in the main session' },
      { keep: 'Graphify/RAG fallbacks', change: 'record unavailable Context7/GitHub providers instead of failing' },
    ],
    skipped_sources: skippedSources,
    token_budget: { max_findings: MAX_FINDINGS, per_source_tokens: DEFAULT_TOKEN_BUDGET },
    ts: nowValue ? new Date(nowValue).toISOString() : new Date().toISOString(),
  };
}

function writeLedgerEvent(ledgerPath, event) {
  if (!ledgerPath) return;
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify(event) + '\n', 'utf8');
}

function usage() {
  return 'Usage: node tools/research-router.js "question" [--root PATH] [--library NAME] [--github] [--architecture] [--json] [--ledger PATH]\n';
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.question) {
    process.stderr.write(usage());
    process.exit(2);
  }
  const block = buildResearchRouterBlock(args);
  writeLedgerEvent(args.ledger, block);
  process.stdout.write(args.json ? `${JSON.stringify(block, null, 2)}\n` : `${JSON.stringify(block)}\n`);
}

if (require.main === module) main();

module.exports = {
  buildResearchRouterBlock,
  context7Probe,
  githubProbe,
};
