#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MEMORY_PROVIDERS = new Set(['project-rag', 'agentmemory']);
const AGENTMEMORY_PORTS = [
  { name: 'server', port: 3111 },
  { name: 'viewer', port: 3113 },
];

const RECALL_PROMPTS = [
  'What is the Pipeline Setupper project responsible for?',
  'Which command verifies project AI docs?',
  'Which command runs the global doctor?',
  'Where is canonical pipeline state stored?',
  'What is the default memory provider?',
  'What are the current RAG queue commands?',
  'Which hooks are Claude-only?',
  'Why is graphify claude install forbidden?',
  'What does research-router record when GitHub auth is invalid?',
  'What is the current Graphify fallback policy?',
  'Which command checks Codex hooks?',
  'Which command checks Claude hook behavior?',
  'What blocks real CodeGraph promotion?',
  'What is the current Graphify benchmark baseline?',
  'What should happen before using authenticated GitHub code search?',
  'What is the memory injection budget for agentmemory pilot?',
  'Which duplicate memory injections must be avoided under agentmemory?',
  'What ports should agentmemory use by default?',
  'What rollback restores current memory behavior?',
  'Where is shared Claude/Codex memory stored?',
];

function selectedMemoryProvider(options = {}) {
  const provider = String(options.provider || process.env.MEMORY_PROVIDER || 'project-rag').toLowerCase();
  return MEMORY_PROVIDERS.has(provider) ? provider : '';
}

function run(command, args, cwd, timeout = 5000) {
  const completed = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, windowsHide: true });
  return {
    status: completed.status,
    error: completed.error && completed.error.message,
    output: `${completed.stdout || ''}${completed.stderr || ''}`.trim(),
    attemptedCommand: [command, ...args].join(' '),
  };
}

function defaultCliStatus(root) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  return run(command, ['agentmemory'], root);
}

function defaultPortStatus(root, port) {
  if (process.platform !== 'win32') return { open: false, attemptedCommand: `port-check ${port}`, detail: 'non-Windows port check not configured' };
  const script = `if ((Test-NetConnection -ComputerName 127.0.0.1 -Port ${port} -InformationLevel Quiet)) { 'open' } else { 'closed' }`;
  const completed = run('powershell.exe', ['-NoProfile', '-Command', script], root, 8000);
  return {
    open: completed.status === 0 && /open/i.test(completed.output),
    attemptedCommand: completed.attemptedCommand,
    detail: completed.error || completed.output || 'no output',
  };
}

function checkAgentMemoryStatus(root, deps = {}) {
  const cliStatus = (deps.cliStatus || defaultCliStatus)(root);
  const portStatus = deps.portStatus || defaultPortStatus;
  const ports = AGENTMEMORY_PORTS.map((item) => ({ ...item, ...portStatus(root, item.port) }));
  const cliAvailable = cliStatus.status === 0;
  const serverOpen = ports.some((item) => item.name === 'server' && item.open);
  return {
    provider: 'agentmemory',
    status: cliAvailable && serverOpen ? 'ready' : 'blocked',
    cli: {
      available: cliAvailable,
      attemptedCommand: cliStatus.attemptedCommand,
      detail: cliStatus.error || cliStatus.output || 'not found',
    },
    ports,
    constraints: {
      auto_compress: false,
      injection_budget_tokens: [1000, 2000],
      duplicate_rag_injection: false,
      post_tool_llm_compression: false,
    },
  };
}

function projectRagStatus(root) {
  const queue = path.join(root, '.rag', 'queue.json');
  const manifest = path.join(root, '.rag', 'manifest.json');
  return {
    provider: 'project-rag',
    status: fs.existsSync(queue) && fs.existsSync(manifest) ? 'ready' : 'degraded',
    files: { queue, manifest },
  };
}

function buildRecallPromptSet() {
  return {
    kind: 'agentmemory-recall-prompts',
    count: RECALL_PROMPTS.length,
    prompts: RECALL_PROMPTS,
  };
}

function buildComparisonReport(root, deps = {}) {
  const rag = projectRagStatus(root);
  const agent = checkAgentMemoryStatus(root, deps);
  return {
    kind: 'memory-provider-comparison',
    root,
    providers: [rag, agent],
    promotion: {
      eligible: agent.status === 'ready',
      reason: agent.status === 'ready' ? 'agentmemory health check passed' : 'agentmemory CLI/server health is blocked',
    },
    startup_budget: {
      current_provider: rag.provider,
      candidate_provider: agent.provider,
      injection_budget_tokens: agent.constraints.injection_budget_tokens,
    },
  };
}

function buildGovernanceSmoke(root, deps = {}) {
  const agent = checkAgentMemoryStatus(root, deps);
  return {
    kind: 'agentmemory-governance-smoke',
    root,
    status: agent.status === 'ready' ? 'ready-to-run' : 'blocked',
    checks: [
      { name: 'export', status: agent.status === 'ready' ? 'manual-required' : 'blocked' },
      { name: 'delete', status: agent.status === 'ready' ? 'manual-required' : 'blocked' },
    ],
    reason: agent.status === 'ready' ? 'CLI docs still required before destructive governance commands' : agent.cli.detail,
  };
}

function parseArgs(argv) {
  const defaults = { command: 'status', root: process.cwd(), provider: process.env.MEMORY_PROVIDER || 'project-rag', json: false };
  const command = ['status', 'recall', 'compare', 'governance'].includes(argv[2]) ? argv[2] : defaults.command;
  const start = command === defaults.command ? 2 : 3;
  const parseNext = (index, state) => {
    if (index >= argv.length) return { ...state, command };
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--root') return parseNext(index + 2, { ...state, root: argv[index + 1] || state.root });
    if (arg === '--provider') return parseNext(index + 2, { ...state, provider: argv[index + 1] || state.provider });
    return parseNext(index + 1, state);
  };
  return parseNext(start, defaults);
}

function runCommand(options, deps = {}) {
  const root = path.resolve(options.root || process.cwd());
  const provider = selectedMemoryProvider(options);
  if (options.command === 'recall') return buildRecallPromptSet();
  if (options.command === 'compare') return buildComparisonReport(root, deps);
  if (options.command === 'governance') return buildGovernanceSmoke(root, deps);
  if (provider === 'agentmemory') return checkAgentMemoryStatus(root, deps);
  if (provider === 'project-rag') return projectRagStatus(root);
  return { provider: options.provider, status: 'invalid', reason: 'Use project-rag or agentmemory.' };
}

function main() {
  const options = parseArgs(process.argv);
  const report = runCommand(options);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${report.provider || report.kind}: ${report.status || report.count}\n`);
}

if (require.main === module) main();

module.exports = {
  AGENTMEMORY_PORTS,
  RECALL_PROMPTS,
  buildComparisonReport,
  buildGovernanceSmoke,
  buildRecallPromptSet,
  checkAgentMemoryStatus,
  projectRagStatus,
  runCommand,
  selectedMemoryProvider,
};
