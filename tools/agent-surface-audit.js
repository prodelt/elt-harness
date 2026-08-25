#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLIENTS = {
  claude: {
    settings: ['.claude', 'settings.json'],
    skills: ['.claude', 'skills'],
    supportedEvents: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Notification', 'FileChanged'],
    unsupportedEvents: [],
  },
  codex: {
    settings: ['.codex', 'hooks.json'],
    skills: ['.codex', 'skills'],
    supportedEvents: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'],
    unsupportedEvents: ['Notification', 'FileChanged'],
  },
  gemini: {
    settings: ['.gemini', 'settings.json'],
    skills: ['.gemini', 'skills'],
    supportedEvents: ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'],
    unsupportedEvents: ['Notification', 'FileChanged'],
  },
};

const DEFAULT_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Notification', 'FileChanged'];

function readText(file) {
  try {
    return { ok: true, value: fs.readFileSync(file, 'utf8') };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function readJson(file) {
  const text = readText(file);
  if (!text.ok) return { ok: false, error: text.error };
  try {
    return { ok: true, value: JSON.parse(text.value) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function parseArgs(argv) {
  const initial = { root: process.cwd(), home: os.homedir(), json: false, markdown: false, write: true };
  const parseNext = (index, state) => {
    if (index >= argv.length) return { ok: true, value: state };
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--markdown') return parseNext(index + 1, { ...state, markdown: true });
    if (arg === '--no-write') return parseNext(index + 1, { ...state, write: false });
    if (arg === '--root') {
      if (!argv[index + 1]) return { ok: false, error: '--root requires a path' };
      return parseNext(index + 2, { ...state, root: argv[index + 1] });
    }
    if (arg === '--home') {
      if (!argv[index + 1]) return { ok: false, error: '--home requires a path' };
      return parseNext(index + 2, { ...state, home: argv[index + 1] });
    }
    return { ok: false, error: `Unknown argument: ${arg}` };
  };
  return parseNext(2, initial);
}

function normalizeHookEntries(value) {
  if (Array.isArray(value)) return value.flatMap(normalizeHookEntries);
  if (value && typeof value === 'object' && Array.isArray(value.hooks)) return normalizeHookEntries(value.hooks);
  if (value && typeof value === 'object') return Object.values(value).flatMap(normalizeHookEntries);
  if (typeof value === 'string') return [value];
  return [];
}

function extractHookCommands(parsed) {
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') return {};
  const hooks = parsed.value.hooks && typeof parsed.value.hooks === 'object' ? parsed.value.hooks : parsed.value;
  return DEFAULT_EVENTS.reduce((acc, event) => {
    const entries = normalizeHookEntries(hooks[event]);
    const commands = entries.map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry.command === 'string') return entry.command;
      return JSON.stringify(entry);
    }).filter(Boolean);
    return commands.length ? { ...acc, [event]: commands } : acc;
  }, {});
}

function walkSkillFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return walkSkillFiles(full);
    return entry.name.toLowerCase() === 'skill.md' ? [full] : [];
  });
}

function parseSkill(file) {
  const text = readText(file);
  if (!text.ok) return { name: path.basename(path.dirname(file)), aliases: [], error: text.error };
  const fm = text.value.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  const body = fm ? fm[1] : '';
  const name = (body.match(/^name:\s*(.+)$/m) || [])[1] || path.basename(path.dirname(file));
  const aliasesLine = (body.match(/^aliases:\s*(.+)$/m) || [])[1] || '';
  const aliases = aliasesLine.replace(/[[\]'"]/g, '').split(',').map((item) => item.trim()).filter(Boolean);
  return { name: name.trim(), aliases, file };
}

function auditClient(clientName, home) {
  const spec = CLIENTS[clientName];
  const settingsFile = path.join(home, ...spec.settings);
  const parsed = readJson(settingsFile);
  const hookCommands = extractHookCommands(parsed);
  const eventRows = DEFAULT_EVENTS.map((event) => ({
    event,
    supported: spec.supportedEvents.includes(event),
    fallback: spec.unsupportedEvents.includes(event) ? 'unsupported-by-client' : '',
    commands: hookCommands[event] || [],
  }));
  const skillRoot = path.join(home, ...spec.skills);
  const skills = walkSkillFiles(skillRoot).map(parseSkill).sort((a, b) => a.name.localeCompare(b.name));
  return {
    client: clientName,
    settingsFile,
    settingsStatus: parsed.ok ? 'present' : 'missing-or-invalid',
    settingsError: parsed.ok ? '' : parsed.error,
    events: eventRows,
    hookCommandCount: eventRows.reduce((sum, row) => sum + row.commands.length, 0),
    skillRoot,
    skillCount: skills.length,
    skills,
  };
}

function commandStatus(command, args, cwd) {
  const completed = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 5000, windowsHide: true });
  return {
    command: [command, ...args].join(' '),
    status: completed.status === 0 ? 'available' : 'missing-or-failed',
    exitCode: completed.status,
    detail: (completed.stdout || completed.stderr || completed.error?.message || '').split(/\r?\n/).find(Boolean) || '',
  };
}

function auditCommandShims(home, root) {
  const bin = path.join(home, '.claude', 'bin');
  const files = [
    'doctor.cmd',
    'doctor.ps1',
    'skill.cmd',
    'skill.ps1',
  ];
  return {
    files: files.map((name) => ({ name, path: path.join(bin, name), exists: fs.existsSync(path.join(bin, name)) })),
    commands: [
      commandStatus('cmd.exe', ['/c', 'where', 'doctor.cmd'], root),
      commandStatus('cmd.exe', ['/c', 'where', 'skill.cmd'], root),
    ],
  };
}

function auditContext7(root) {
  return {
    npx: commandStatus('cmd.exe', ['/c', 'where', 'npx.cmd'], root),
    fallbackContract: 'Use cmd /c npx.cmd ctx7 docs <library> <query>; network failures are skip reasons, not silent success.',
  };
}

function auditMemory(home) {
  const candidates = [
    path.join(home, '.claude', 'projects', 'C--', 'memory', 'memory_summary.md'),
    path.join(home, '.claude', 'projects', 'C--', 'memory', 'MEMORY.md'),
    path.join(home, '.codex', 'memories', 'memory_summary.md'),
    path.join(home, '.codex', 'memories', 'MEMORY.md'),
  ];
  return candidates.map((file) => ({ file, exists: fs.existsSync(file) }));
}

// `cmd.exe` существует только на Windows: на Linux этот вызов проваливался ВСЕГДА, и аудит
// сообщал `warn` даже там, где agent-browser установлен. Оболочка выбирается по платформе, а
// сама проба инъектируется — иначе тест проверяет не контракт функции, а то, что стоит на
// машине разработчика, и в CI краснеет без единого дефекта в коде.
function browserProbe(root, { platform = process.platform, commandStatusFn = commandStatus } = {}) {
  return platform === 'win32'
    ? (args) => commandStatusFn('cmd.exe', ['/c', 'agent-browser', ...args], root)
    : (args) => commandStatusFn('agent-browser', args, root);
}

function auditBrowser(home, root, { probe = null } = {}) {
  const skillRoots = [path.join(home, '.claude', 'skills'), path.join(home, '.codex', 'skills'), path.join(home, '.gemini', 'skills')];
  const browserSkills = skillRoots.flatMap((skillRoot) => walkSkillFiles(skillRoot))
    .map(parseSkill)
    .filter((skill) => skill.name === 'agent-browser');
  const run = probe || browserProbe(root);
  const agentBrowser = run(['--version']);
  const skillCatalog = run(['skills', 'list']);
  const status = agentBrowser.status === 'available' && browserSkills.length > 0 ? 'pass' : 'warn';
  return {
    agentBrowser,
    skillCatalog,
    browserSkillCount: browserSkills.length,
    browserSkills: browserSkills.map((skill) => skill.file),
    status,
    fallbackContract: 'Browser tooling default is agent-browser. Agents must use the agent-browser skill and cmd /c agent-browser for browser QA/testing unless the user explicitly requires another tool.',
  };
}

function compareClients(clients) {
  const [base] = clients;
  const baseSkills = new Set((base?.skills || []).map((skill) => skill.name));
  return clients.map((client) => {
    const missingFromBase = [...baseSkills].filter((name) => !client.skills.some((skill) => skill.name === name));
    const unsupportedConfigured = client.events.filter((row) => !row.supported && row.commands.length > 0);
    return {
      client: client.client,
      skillCount: client.skillCount,
      hookCommandCount: client.hookCommandCount,
      missingSkillsComparedToClaude: client.client === 'claude' ? [] : missingFromBase,
      unsupportedConfiguredEvents: unsupportedConfigured.map((row) => row.event),
    };
  });
}

function summarize(report) {
  // Events in a client's declared unsupportedEvents are "explained" fallbacks — not gaps.
  // Only flag events that are configured AND unsupported AND NOT declared as unsupported-by-design.
  const unexplained = report.parity.flatMap((client) => {
    const spec = CLIENTS[client.client];
    const declaredUnsupported = spec ? spec.unsupportedEvents : [];
    return client.unsupportedConfiguredEvents
      .filter((event) => !declaredUnsupported.includes(event))
      .map((event) => `${client.client}:${event}`);
  });
  const missingAuditInputs = report.clients
    .filter((client) => client.settingsStatus !== 'present')
    .map((client) => `${client.client}:settings`);
  const browserGaps = report.browser && report.browser.status !== 'pass'
    ? ['browser:agent-browser']
    : [];
  const status = unexplained.length || missingAuditInputs.length || browserGaps.length ? 'warn' : 'pass';
  return {
    status,
    unexplainedGaps: [...unexplained, ...missingAuditInputs, ...browserGaps],
    generatedAt: report.generatedAt,
  };
}

function runAudit(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const home = path.resolve(options.home || os.homedir());
  const clients = Object.keys(CLIENTS).map((client) => auditClient(client, home));
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    root,
    home,
    clients,
    parity: compareClients(clients),
    commandShims: auditCommandShims(home, root),
    context7: auditContext7(root),
    memory: auditMemory(home),
    browser: auditBrowser(home, root, { probe: options.browserProbe || null }),
  };
  return { ...report, summary: summarize(report) };
}

function formatMarkdown(report) {
  const clientSections = report.clients.flatMap((client) => [
    `### ${client.client}`,
    `- settings: ${client.settingsStatus} (${client.settingsFile})`,
    `- hook commands: ${client.hookCommandCount}`,
    `- skills: ${client.skillCount} (${client.skillRoot})`,
    `- unsupported events: ${client.events.filter((row) => !row.supported).map((row) => row.event).join(', ') || 'none'}`,
    '',
  ]);
  const parityRows = report.parity.map((client) => (
    `| ${client.client} | ${client.hookCommandCount} | ${client.skillCount} | ${client.unsupportedConfiguredEvents.join(', ') || 'none'} | ${client.missingSkillsComparedToClaude.length} |`
  ));
  return [
    '# Agent Surface Audit',
    '',
    `Generated: ${report.generatedAt}`,
    `Root: ${report.root}`,
    `Status: ${report.summary.status}`,
    '',
    '## Parity',
    '',
    '| Client | Hook commands | Skills | Unsupported configured events | Missing skills vs Claude |',
    '|---|---:|---:|---|---:|',
    ...parityRows,
    '',
    '## Clients',
    '',
    ...clientSections,
    '## Tooling',
    '',
    `- Context7 npx: ${report.context7.npx.status} (${report.context7.npx.command})`,
    `- Command shims: ${report.commandShims.files.filter((item) => item.exists).length}/${report.commandShims.files.length} present`,
    `- Browser tooling: ${report.browser.status}`,
    '',
    '## Fallback Contracts',
    '',
    '- Codex/Gemini unsupported Notification/FileChanged events are expected; parity requires documented fallback, not fake support.',
    `- Context7: ${report.context7.fallbackContract}`,
    `- Browser: ${report.browser.fallbackContract}`,
    '',
    '## Unexplained Gaps',
    '',
    ...(report.summary.unexplainedGaps.length ? report.summary.unexplainedGaps.map((gap) => `- ${gap}`) : ['- none']),
    '',
  ].join('\n');
}

function writeReports(report, root) {
  const planning = path.join(root, '.planning');
  fs.mkdirSync(planning, { recursive: true });
  const jsonFile = path.join(planning, 'agent-surface-audit-latest.json');
  const mdFile = path.join(planning, 'agent-surface-audit-latest.md');
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(mdFile, formatMarkdown(report), 'utf8');
  return { jsonFile, mdFile };
}

function main() {
  const parsed = parseArgs(process.argv);
  if (!parsed.ok) {
    process.stderr.write(`agent-surface-audit: ${parsed.error}\n`);
    process.exit(2);
  }
  const report = runAudit(parsed.value);
  if (parsed.value.write) writeReports(report, path.resolve(parsed.value.root));
  const output = parsed.value.markdown && !parsed.value.json
    ? formatMarkdown(report)
    : JSON.stringify(report, null, 2) + '\n';
  process.stdout.write(output);
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  browserProbe,
  parseArgs,
  runAudit,
  formatMarkdown,
  writeReports,
  extractHookCommands,
};
