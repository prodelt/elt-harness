#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { runCodemapDoctor } = require('./codemap-core');
const { runCommand: runMemoryProviderCommand } = require('./memory-provider');
const { checkArtifact: checkGitArtifact } = require('./git-workflow-audit');
const { checkArtifact: checkDocsGateArtifact } = require('./docs-gate');
const { checkArtifact: checkHarnessChecklistArtifact } = require('./harness-checklist');
const { checkArtifact: checkHarnessRunArtifact } = require('./harness-gates');
const { CORE_SECTIONS } = require('./project-docs-core');
const {
  legacyStatePath,
  normalizePath,
  projectKey,
  projectStatePath,
} = require('./pipeline-state');

const DOCS = ['AGENTS.md', 'CLAUDE.md', path.join('.gemini', 'GEMINI.md')];
const SECTIONS = CORE_SECTIONS;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'runtime', 'sources']);
const RISK_EXTS = new Set(['.exe', '.dll', '.pdb', '.bat', '.cmd', '.ps1', '.asm', '.cpp', '.c', '.bin']);
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const STATE_CLOCK_SKEW_MS = 60 * 1000;
const AGENT_SURFACE_AUDIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SETTINGS_SECRET_PATTERNS = [
  { name: 'Google API key', pattern: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'Context7 API key', pattern: /ctx7sk-[0-9A-Za-z-]{20,}/ },
  { name: 'OpenAI-style API key', pattern: /sk-[0-9A-Za-z_-]{20,}/ },
  { name: 'GitHub token', pattern: /(?:ghp|github_pat)_[0-9A-Za-z_]{20,}/ },
  { name: 'Bearer token', pattern: /Bearer\s+[0-9A-Za-z._-]{20,}/ },
  { name: 'literal --api-key', pattern: /--api-key\s+(?![$%{])[^\s")']{12,}/ },
];

function result(status, id, title, detail, repair, data = {}) {
  return { status, id, title, detail, repair, data };
}

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

function findProjectRoot(start) {
  const current = path.resolve(start || process.cwd());
  const parent = path.dirname(current);
  const markers = ['AGENTS.md', 'CLAUDE.md', '.git', '.rag'];
  const found = markers.some((marker) => fs.existsSync(path.join(current, marker)));
  if (found || parent === current) return current;
  return findProjectRoot(parent);
}

function parseArgs(argv) {
  const defaults = { root: process.cwd(), json: false, register: false, graphify: true, fleet: false, memoryProvider: process.env.MEMORY_PROVIDER || 'project-rag' };
  const parseNext = (index, state) => {
    if (index >= argv.length) return { ok: true, value: state };
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--register') return parseNext(index + 1, { ...state, register: true });
    if (arg === '--fleet') return parseNext(index + 1, { ...state, fleet: true });
    if (arg === '--no-graphify') return parseNext(index + 1, { ...state, graphify: false });
    if (arg === '--memory-provider') return parseNext(index + 2, { ...state, memoryProvider: argv[index + 1] || state.memoryProvider });
    if (arg === '--root') {
      const root = argv[index + 1];
      if (!root) return { ok: false, error: '--root requires a path' };
      return parseNext(index + 2, { ...state, root });
    }
    return { ok: false, error: `Unknown argument: ${arg}` };
  };
  return parseNext(2, defaults);
}

function sectionStatus(text) {
  return SECTIONS.map((name) => ({ name, exists: new RegExp(`^##\\s+${name}\\b`, 'mi').test(text) }));
}

function checkDocs(root) {
  const checks = DOCS.map((relative) => {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) {
      return result('fail', `docs:${relative}`, `${relative} missing`, 'Required AI project doc is absent.', `Run init-project or create ${relative}.`);
    }
    const text = readText(file);
    if (!text.ok) {
      return result('fail', `docs:${relative}`, `${relative} unreadable`, text.error, `Fix permissions for ${relative}.`);
    }
    const missing = sectionStatus(text.value).filter((entry) => !entry.exists).map((entry) => entry.name);
    if (missing.length > 0) {
      return result('warn', `docs:${relative}`, `${relative} incomplete`, `Missing sections: ${missing.join(', ')}.`, 'Run sync-docs v2 after Sprint 3.');
    }
    return result('pass', `docs:${relative}`, `${relative} OK`, 'All core sections are present.', '');
  });
  const agents = readText(path.join(root, 'AGENTS.md'));
  const hasLocalRules = agents.ok && (/--- project-doc ---/i.test(agents.value) || /## Gotchas/i.test(agents.value));
  const localRules = hasLocalRules
    ? result('pass', 'docs:local-rules', 'Local rules detectable', 'AGENTS.md contains project-specific doc content.', '')
    : result('warn', 'docs:local-rules', 'Local rules not obvious', 'Could not detect project-specific protected content.', 'Add project-specific sections before automated doc sync.');
  return [...checks, localRules];
}

function registryPath(home) {
  return path.join(home, '.claude', 'projects-registry.json');
}

function registryEntry(root) {
  const key = projectKey(root);
  return { key, name: path.basename(root), path: normalizePath(root), lastSeenAt: new Date().toISOString() };
}

function registerProject(root, home) {
  const file = registryPath(home);
  const existing = readJson(file);
  const base = existing.ok && existing.value && typeof existing.value === 'object'
    ? existing.value
    : { version: 1, projects: {} };
  const entry = registryEntry(root);
  const previous = base.projects && base.projects[entry.key] ? base.projects[entry.key] : {};
  const nextEntry = { ...previous, ...entry, registeredAt: previous.registeredAt || entry.lastSeenAt };
  const next = {
    ...base,
    version: 1,
    updatedAt: entry.lastSeenAt,
    projects: { ...(base.projects || {}), [entry.key]: nextEntry },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return nextEntry;
}

function checkRegistry(root, home, shouldRegister) {
  const file = registryPath(home);
  if (shouldRegister) {
    const entry = registerProject(root, home);
    return [result('pass', 'registry:project', 'Project registered', `Registry key: ${entry.key}.`, '', { file, entry })];
  }
  const registry = readJson(file);
  if (!registry.ok) {
    return [result('warn', 'registry:project', 'Project registry missing', registry.error, 'Run doctor --register.')];
  }
  const key = projectKey(root);
  const entry = registry.value.projects && registry.value.projects[key];
  if (!entry) {
    return [result('warn', 'registry:project', 'Project not registered', `Missing registry key: ${key}.`, 'Run doctor --register.')];
  }
  return [result('pass', 'registry:project', 'Project registered', `Registry key: ${key}.`, '')];
}

function parseJsonl(file) {
  const text = readText(file);
  if (!text.ok) return { ok: false, error: text.error, count: 0 };
  const lines = text.value.split(/\r?\n/).filter(Boolean);
  const parsed = lines.map((line) => {
    try {
      return { ok: true, value: JSON.parse(line) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  const invalid = parsed.filter((entry) => !entry.ok);
  return { ok: invalid.length === 0, error: invalid[0] && invalid[0].error, count: parsed.length };
}

function checkSkillRegistry(home) {
  const file = path.join(home, '.claude', 'skill-registry', 'digests.jsonl');
  const parsed = parseJsonl(file);
  if (!parsed.ok) {
    return [result('fail', 'skills:registry', 'Skill registry invalid', parsed.error, 'Run skill distiller / registry rebuild.')];
  }
  if (parsed.count === 0) {
    return [result('fail', 'skills:registry', 'Skill registry empty', file, 'Rebuild ~/.claude/skill-registry/digests.jsonl.')];
  }
  return [result('pass', 'skills:registry', 'Skill registry OK', `${parsed.count} digest rows parsed.`, '')];
}

function walk(root, predicate) {
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(full, predicate);
    return predicate(full, entry) ? [full] : [];
  });
}

function parseSkillFrontmatter(file) {
  const text = readText(file);
  if (!text.ok) return { ok: false, error: text.error };
  const match = text.value.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { ok: false, error: 'Missing YAML frontmatter fence.' };
  const invalidLine = match[1].split(/\r?\n/).find((line) => {
    const trimmed = line.trim();
    return trimmed
      && !trimmed.startsWith('#')
      && !trimmed.startsWith('- ')
      && !/^\s+\S/.test(line)
      && !/^[A-Za-z0-9_-]+:\s*.*$/.test(trimmed);
  });
  if (invalidLine) return { ok: false, error: `Suspicious YAML line: ${invalidLine}` };
  return { ok: true };
}

function checkSkillYaml(home) {
  const roots = [path.join(home, '.claude', 'skills'), path.join(home, '.codex', 'skills'), path.join(home, '.agents', 'skills')];
  const files = roots.flatMap((root) => walk(root, (file) => path.basename(file).toLowerCase() === 'skill.md'));
  const invalid = files.map((file) => ({ file, parsed: parseSkillFrontmatter(file) })).filter((entry) => !entry.parsed.ok);
  if (invalid.length > 0) {
    const detail = invalid.slice(0, 5).map((entry) => `${entry.file}: ${entry.parsed.error}`).join('; ');
    return [result('fail', 'skills:yaml', 'Invalid SKILL.md YAML detected', detail, 'Fix listed SKILL.md frontmatter.')];
  }
  return [result('pass', 'skills:yaml', 'SKILL.md YAML OK', `${files.length} skill files checked.`, '')];
}

function run(command, args, cwd, timeout = 8000) {
  const completed = spawnSync(command, args, { cwd, encoding: 'utf8', timeout, windowsHide: true });
  const stdout = completed.stdout || '';
  const stderr = completed.stderr || '';
  return { status: completed.status, error: completed.error && completed.error.message, output: `${stdout}${stderr}`.trim() };
}

function checkHooks(home) {
  const settings = path.join(home, '.claude', 'settings.json');
  const hooksDir = path.join(home, '.claude', 'hooks');
  const hookFiles = fs.existsSync(hooksDir) ? fs.readdirSync(hooksDir).filter((name) => name.endsWith('.js')) : [];
  const settingsCheck = fs.existsSync(settings)
    ? result('pass', 'hooks:settings', 'Claude settings reachable', settings, '')
    : result('fail', 'hooks:settings', 'Claude settings missing', settings, 'Restore ~/.claude/settings.json.');
  const hooksCheck = hookFiles.length > 0
    ? result('pass', 'hooks:files', 'Hook files reachable', `${hookFiles.length} JS hook files found.`, '')
    : result('fail', 'hooks:files', 'Hook files missing', hooksDir, 'Restore ~/.claude/hooks.');
  return [settingsCheck, hooksCheck];
}

function listSettingsFiles(root, home) {
  const projectClaude = path.join(root, '.claude');
  const projectFiles = fs.existsSync(projectClaude)
    ? fs.readdirSync(projectClaude)
      .filter((name) => /^settings.*\.json$/i.test(name))
      .map((name) => path.join(projectClaude, name))
    : [];
  return [
    ...projectFiles,
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'settings.local.json'),
    path.join(home, '.codex', 'config.toml'),
  ].filter((file, index, files) => fs.existsSync(file) && files.indexOf(file) === index);
}

function checkSettingsSecrets(root, home) {
  const files = listSettingsFiles(root, home);
  const findings = files.flatMap((file) => {
    const text = readText(file);
    if (!text.ok) return [{ file, lineNumber: 0, kind: 'unreadable', line: text.error }];
    return text.value.split(/\r?\n/).flatMap((line, index) => {
      const match = SETTINGS_SECRET_PATTERNS.find((entry) => entry.pattern.test(line));
      return match ? [{ file, lineNumber: index + 1, kind: match.name, line: line.trim() }] : [];
    });
  });
  if (findings.length > 0) {
    const detail = findings.slice(0, 5)
      .map((entry) => `${entry.file}:${entry.lineNumber} ${entry.kind}`)
      .join('; ');
    return [result('fail', 'settings:secrets', 'Secret-like settings entries detected', detail, 'Remove literal credentials from settings allowlists; use env placeholders.')];
  }
  return [result('pass', 'settings:secrets', 'No secret-like settings entries detected', `${files.length} settings/config files scanned.`, '')];
}

function checkCodexDefaults(home) {
  const file = path.join(home, '.codex', 'config.toml');
  const text = readText(file);
  if (!text.ok) {
    return [result('warn', 'codex:defaults', 'Codex config missing', text.error, 'Create ~/.codex/config.toml with model and model_reasoning_effort defaults.')];
  }
  const model = (text.value.match(/^model\s*=\s*"([^"]+)"/m) || [])[1] || '';
  const effort = (text.value.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m) || [])[1] || '';
  // gpt-5.5 is the current flagship — not considered expensive legacy
  const legacyExpensiveModel = model && !['gpt-5.5', 'gpt-4o', 'gpt-4.1'].includes(model) && /gpt-[34]/i.test(model) && model !== 'gpt-4o-mini';
  if (legacyExpensiveModel) {
    return [result('warn', 'codex:defaults', 'Codex defaults are expensive', `model=${model || '<unset>'}, effort=${effort || '<unset>'}`, 'Consider upgrading to gpt-5.5 for best results.')];
  }
  return [result('pass', 'codex:defaults', 'Codex defaults OK', `model=${model || '<unset>'}, effort=${effort || '<unset>'}`, '')];
}

function checkGraphify(root, enabled) {
  if (!enabled) return [result('warn', 'graphify:skipped', 'Graphify check skipped', '--no-graphify was provided.', 'Run without --no-graphify.')];
  const help = run('cmd.exe', ['/c', 'graphify', '--help'], root, 8000);
  if (help.status !== 0) {
    return [result('fail', 'graphify:cli', 'Graphify unavailable', help.error || help.output, 'Ensure graphify is installed and on PATH.')];
  }
  const cliCheck = result('pass', 'graphify:cli', 'Graphify CLI available', 'cmd /c graphify --help completed.', '');
  const codemap = runCodemapDoctor({ root }).checks;
  return [cliCheck, ...codemap];
}

function checkCodeGraph(root) {
  const dbPath = path.join(root, '.codegraph', 'codegraph.db');
  if (!fs.existsSync(dbPath)) return [];
  const status = run('cmd.exe', ['/c', 'codegraph', 'status', root], root, 10000);
  if (status.status !== 0) {
    return [result('warn', 'codegraph:status', 'CodeGraph index status failed', status.error || status.output, 'Run: cmd /c codegraph sync .')];
  }
  const lines = status.output || '';
  const filesMatch = lines.match(/Files:\s+(\d+)/);
  const nodesMatch = lines.match(/Nodes:\s+([\d\s]+)/);
  const backendMatch = lines.match(/Backend:\s+(.+)/);
  const detail = [
    filesMatch ? `files=${filesMatch[1].trim()}` : '',
    nodesMatch ? `nodes=${nodesMatch[1].trim()}` : '',
    backendMatch ? `backend=${backendMatch[1].trim()}` : '',
  ].filter(Boolean).join(', ');
  const indexCheck = result('pass', 'codegraph:status', 'CodeGraph MCP/index healthy', detail || 'codegraph status completed.', '');
  const providerChecks = runCodemapDoctor({ root, provider: 'codegraph' }).checks;
  return [indexCheck, ...providerChecks];
}

function checkRag(root) {
  const manifest = path.join(root, '.rag', 'manifest.json');
  const parsed = readJson(manifest);
  if (!parsed.ok) {
    return [result('warn', 'rag:manifest', 'RAG manifest missing/invalid', parsed.error, 'Create .rag/manifest.json via init-project v2.')];
  }
  const indexDir = path.join(root, parsed.value.index_dir || '.rag/index');
  const queue = readJson(path.join(root, '.rag', 'queue.json'));
  const indexExists = fs.existsSync(indexDir);
  const manifestCheck = result('pass', 'rag:manifest', 'RAG manifest OK', manifest, '');
  const indexCheck = indexExists
    ? result('pass', 'rag:index', 'RAG index directory exists', indexDir, '')
    : result('warn', 'rag:index', 'RAG index directory missing', indexDir, 'Run python tools/rag-ingest.py --project <name> --process-queue.');
  const queueCheck = queue.ok
    ? result('pass', 'rag:queue', 'RAG queue readable', path.join(root, '.rag', 'queue.json'), '')
    : result('warn', 'rag:queue', 'RAG queue missing/invalid', queue.error, 'Run python tools/rag-ingest.py --project <name> --queue-stats.');
  return [manifestCheck, indexCheck, queueCheck];
}

function checkMemoryProvider(root, provider) {
  const report = runMemoryProviderCommand({ root, provider, command: 'status' });
  if (report.provider === 'project-rag') {
    return [result(report.status === 'ready' ? 'pass' : 'warn', 'memory:project-rag', 'Project RAG memory provider', report.status, 'Run init-project/RAG setup if degraded.', report)];
  }
  if (report.provider === 'agentmemory') {
    const status = report.status === 'ready' ? 'pass' : 'warn';
    return [result(status, 'memory:agentmemory', 'agentmemory provider health', report.cli.detail, 'Keep MEMORY_PROVIDER=project-rag until agentmemory CLI/server health passes.', report)];
  }
  return [result('warn', 'memory:provider', 'Memory provider invalid', report.reason || String(provider), 'Use project-rag or agentmemory.', report)];
}

function checkSurfaceSync(root) {
  const script = path.join(root, 'tools', 'sync-agent-surface.js');
  if (!fs.existsSync(script)) {
    return [result('warn', 'surface:sync', 'Surface sync tool missing', script, 'Run node tools/sync-agent-surface.js --dry-run --json to audit skill parity.')];
  }
  const proc = spawnSync(process.execPath, [script, '--dry-run', '--json', '--target', 'all'], {
    encoding: 'utf8', timeout: 30000, cwd: root,
  });
  if (proc.status !== 0 || !proc.stdout) {
    return [result('warn', 'surface:sync', 'Surface sync check failed', proc.stderr || 'no output', 'Run node tools/sync-agent-surface.js --dry-run --json manually.')];
  }
  let data;
  try { data = JSON.parse(proc.stdout); } catch (e) {
    return [result('warn', 'surface:sync', 'Surface sync output invalid JSON', e.message, 'Run node tools/sync-agent-surface.js --dry-run --json manually.')];
  }
  const targets = Object.entries(data.results || {});
  const missingTotal = targets.reduce((sum, [, r]) => sum + (r.missing ? r.missing.length : 0), 0);
  const conflictTotal = targets.reduce((sum, [, r]) => sum + (r.conflicts ? r.conflicts.length : 0), 0);
  if (missingTotal > 0) {
    const details = targets.map(([t, r]) => r.missing.length ? `${t}:${r.missing.length}` : null).filter(Boolean).join(', ');
    return [result('warn', 'surface:sync', `Skill sync gap — ${missingTotal} missing`, details, 'Run node tools/sync-agent-surface.js --apply --target all')];
  }
  // Step F (elt-system upgrade 2026-07-02): a conflict means the skill's
  // content (incl. `version:` frontmatter) diverged from source across
  // claude/codex/gemini — surface it, don't bury it as a "pass" detail.
  if (conflictTotal > 0) {
    const details = targets.map(([t, r]) => r.conflicts && r.conflicts.length ? `${t}:${r.conflicts.map((c) => c.skill).join(',')}` : null).filter(Boolean).join(' | ');
    return [result('warn', 'surface:sync', `Skill versions diverge across claude/codex/gemini — ${conflictTotal} conflict(s)`, details, 'Compare version: frontmatter, then node tools/sync-agent-surface.js --apply --target all --force to re-sync intentionally.')];
  }
  return [result('pass', 'surface:sync', 'Skill surface sync OK', 'all targets in sync')];
}

function supplyChainTargets(manifest, audit) {
  const configured = manifest.policy && Array.isArray(manifest.policy.targetClients) ? manifest.policy.targetClients : [];
  const detected = Object.keys(audit.clients || {});
  return configured.length ? configured : detected;
}

function summarizeSupplyChainDrift(audit, targetClients) {
  const approved = (audit.skills || []).filter((skill) => skill.status === 'approved');
  const missingSource = approved.filter((skill) => !skill.sourceExists);
  const missingInstalls = approved.flatMap((skill) => targetClients
    .filter((client) => !(skill.clients && skill.clients[client] && skill.clients[client].installed))
    .map((client) => `${client}/${skill.name}`));
  const driftedInstalls = approved.flatMap((skill) => targetClients
    .filter((client) => skill.clients && skill.clients[client] && skill.clients[client].installed && !skill.clients[client].matchesSource)
    .map((client) => `${client}/${skill.name}`));
  const missingProjects = (audit.projects || []).filter((project) => !project.archived && !project.exists);
  const missingControlPlane = (audit.projects || []).filter((project) => project.exists && !project.controlPlane);
  const missingClientRoots = targetClients.filter((client) => !(audit.clients && audit.clients[client] && audit.clients[client].exists));
  return { approved, missingSource, missingInstalls, driftedInstalls, missingProjects, missingControlPlane, missingClientRoots };
}

function checkAgentSkillSupplyChain(root, home, auditRunner) {
  const script = path.join(root, 'tools', 'agent-skill-supply-chain.js');
  const manifestFile = path.join(root, 'config', 'agent-skill-sources.json');
  const registry = path.join(home, '.claude', 'projects-registry.json');
  if (!fs.existsSync(script)) return [result('fail', 'agent-skills:supply-chain', 'Agent skill supply-chain tool missing', script, 'Restore tools\\agent-skill-supply-chain.js.')];
  let audit;
  try {
    const runner = auditRunner || require(script).run;
    audit = runner({ command: 'audit', manifest: manifestFile, registry, home, target: 'all', apply: false, json: true });
  } catch (error) {
    return [result('fail', 'agent-skills:supply-chain', 'Agent skill supply-chain audit crashed', error.message, 'Run node tools\\agent-skill-supply-chain.js audit --json manually.')];
  }
  if (!audit || typeof audit !== 'object') {
    return [result('fail', 'agent-skills:supply-chain', 'Agent skill supply-chain audit invalid', 'No audit object returned.', 'Fix tools\\agent-skill-supply-chain.js audit output.')];
  }
  if (!audit.validation || !audit.validation.ok) {
    const errors = audit.validation && Array.isArray(audit.validation.errors) ? audit.validation.errors : ['missing validation result'];
    return [result('fail', 'agent-skills:supply-chain', 'Agent skill supply-chain manifest invalid', errors.slice(0, 5).join('; '), 'Fix config\\agent-skill-sources.json.')];
  }
  const manifest = readJson(manifestFile);
  if (!manifest.ok) return [result('fail', 'agent-skills:supply-chain', 'Agent skill supply-chain manifest unreadable', manifest.error, 'Fix config\\agent-skill-sources.json.')];
  const targetClients = supplyChainTargets(manifest.value, audit);
  const drift = summarizeSupplyChainDrift(audit, targetClients);
  const warnCount = drift.missingSource.length + drift.missingInstalls.length + drift.driftedInstalls.length + drift.missingProjects.length + drift.missingControlPlane.length + drift.missingClientRoots.length;
  if (warnCount > 0) {
    const detail = [
      `missingSource=${drift.missingSource.length}`,
      `missingInstalls=${drift.missingInstalls.length}`,
      `driftedInstalls=${drift.driftedInstalls.length}`,
      `missingProjects=${drift.missingProjects.length}`,
      `missingControlPlane=${drift.missingControlPlane.length}`,
      `missingClientRoots=${drift.missingClientRoots.length}`,
    ].join(' ');
    return [result('warn', 'agent-skills:supply-chain', 'Agent skill supply chain has drift', detail, 'Run node tools\\agent-skill-supply-chain.js install-skills --target all --json, then rollout-projects as needed.')];
  }
  return [result('pass', 'agent-skills:supply-chain', 'Agent skill supply chain OK', `${drift.approved.length} approved skills current across ${targetClients.length} client(s); ${(audit.projects || []).length} project(s) audited.`, '')];
}

function checkAgentSkillsWrapper(root, home, commandRunner = run) {
  const pipelineDir = pipelineDirFromRegistry(home, root);
  const scripts = [
    path.join(pipelineDir, 'tools', 'agent-skill-supply-chain.js'),
    path.join(pipelineDir, 'tools', 'install-agent-skills-wrapper.js'),
  ];
  const wrappers = [
    path.join(home, '.claude', 'bin', 'agent-skills.cmd'),
  ];
  const missingScripts = scripts.filter((file) => !fs.existsSync(file));
  const missingWrappers = wrappers.filter((file) => !fs.existsSync(file));
  if (missingScripts.length || missingWrappers.length) {
    const detail = [
      missingScripts.length ? `scripts=${missingScripts.map((file) => path.basename(file)).join(',')}` : '',
      missingWrappers.length ? `wrappers=${missingWrappers.map((file) => path.basename(file)).join(',')}` : '',
    ].filter(Boolean).join(' ');
    return [result('warn', 'agent-skills:wrapper', 'Agent skills wrapper incomplete', detail, 'Run node tools\\install-agent-skills-wrapper.js --apply.')];
  }
  const located = commandRunner('cmd.exe', ['/c', 'where', 'agent-skills.cmd'], root, 5000);
  if (located.status !== 0) {
    return [result('warn', 'agent-skills:wrapper', 'Agent skills wrapper not on PATH', located.output || located.error || 'where failed', 'Add ~/.claude/bin to PATH or call agent-skills.cmd by full path.')];
  }
  const expectedWrapper = wrappers[0];
  const expectedScript = scripts[0];
  const wrapperText = readText(expectedWrapper);
  if (!wrapperText.ok || !wrapperText.value.toLowerCase().includes(expectedScript.toLowerCase())) {
    return [result('warn', 'agent-skills:wrapper', 'Agent skills wrapper target mismatch', expectedWrapper, 'Run node tools\\install-agent-skills-wrapper.js --apply.')];
  }
  const resolved = (located.output || '').split(/\r?\n/).find(Boolean) || '';
  if (normalizePath(resolved).toLowerCase() !== normalizePath(expectedWrapper).toLowerCase()) {
    return [result('warn', 'agent-skills:wrapper', 'Agent skills wrapper PATH mismatch', `resolved=${resolved} expected=${expectedWrapper}`, 'Move ~/.claude/bin earlier on PATH or remove stale agent-skills.cmd.')];
  }
  return [result('pass', 'agent-skills:wrapper', 'Agent skills wrapper available', `agent-skills.cmd resolves to ${expectedWrapper} and targets ${expectedScript}.`, '')];
}

function checkAgentSurfaceAudit(root, now = new Date()) {
  const file = path.join(root, '.planning', 'agent-surface-audit-latest.json');
  const parsed = readJson(file);
  if (!parsed.ok) {
    return [result('warn', 'agent-surface:audit', 'Agent surface audit missing', parsed.error, 'Run node tools\\agent-surface-audit.js --json.')];
  }
  const generatedAt = typeof parsed.value.generatedAt === 'string' ? new Date(parsed.value.generatedAt) : null;
  const invalidDate = !generatedAt || Number.isNaN(generatedAt.getTime());
  if (invalidDate) {
    return [result('warn', 'agent-surface:audit', 'Agent surface audit timestamp invalid', String(parsed.value.generatedAt), 'Rerun node tools\\agent-surface-audit.js --json.')];
  }
  const stale = now.getTime() - generatedAt.getTime() > AGENT_SURFACE_AUDIT_TTL_MS;
  const summaryStatus = parsed.value.summary && parsed.value.summary.status ? parsed.value.summary.status : 'unknown';
  if (stale) {
    return [result('warn', 'agent-surface:audit', 'Agent surface audit stale', parsed.value.generatedAt, 'Rerun node tools\\agent-surface-audit.js --json.', { file })];
  }
  const status = summaryStatus === 'pass' ? 'pass' : 'warn';
  const title = status === 'pass' ? 'Agent surface audit current' : 'Agent surface audit has gaps';
  const gaps = parsed.value.summary && Array.isArray(parsed.value.summary.unexplainedGaps)
    ? parsed.value.summary.unexplainedGaps
    : [];
  const detail = gaps.length ? gaps.slice(0, 5).join(', ') : file;
  return [result(status, 'agent-surface:audit', title, detail, status === 'pass' ? '' : 'Review .planning\\agent-surface-audit-latest.md.', { file })];
}

function checkGit(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return [result('warn', 'git:repo', 'Git repo not found', root, 'Run doctor from a git project root.')];
  const refs = run('git', ['for-each-ref', '--format=%(refname)'], root, 8000);
  const invalidRefs = walk(path.join(root, '.git', 'refs', 'heads'), (file) => /[\s()]/.test(path.basename(file)));
  if (refs.error && /EPERM/i.test(refs.error)) {
    return [result('warn', 'git:refs', 'Git refs blocked by sandbox', refs.error, 'Run doctor outside sandbox for definitive git health.')];
  }
  if (refs.status !== 0) {
    return [result('fail', 'git:refs', 'Git refs invalid', refs.output || refs.error, 'Inspect .git/refs and fix invalid refs after approval.')];
  }
  if (invalidRefs.length > 0) {
    return [result('warn', 'git:refs', 'Suspicious git ref names', invalidRefs.slice(0, 5).join('; '), 'Fix invalid refs only after explicit approval.')];
  }
  return [result('pass', 'git:refs', 'Git refs OK', 'git for-each-ref completed.', '')];
}

function checkGitHubCli(root, runner = run) {
  const version = runner('gh', ['--version'], root, 8000);
  if (version.status !== 0) {
    return [result('warn', 'github:cli', 'GitHub CLI unavailable', version.error || version.output, 'Install gh or keep GitHub research optional.')];
  }
  const versionLine = version.output.split(/\r?\n/).find(Boolean) || 'gh available';
  const auth = runner('gh', ['auth', 'status'], root, 8000);
  if (auth.status !== 0) {
    return [
      result('pass', 'github:cli', 'GitHub CLI available', versionLine, ''),
      result('warn', 'github:auth', 'GitHub auth invalid or missing', auth.output || auth.error, 'Run gh auth login before research-router uses authenticated code search.'),
      result('warn', 'github:code-search', 'GitHub code search skipped', 'Auth is invalid or missing.', 'Re-authenticate gh, then rerun doctor.'),
    ];
  }
  const codeSearch = runner('gh', ['search', 'code', 'package.json', '--limit', '1'], root, 8000);
  const codeCheck = codeSearch.status === 0
    ? result('pass', 'github:code-search', 'GitHub code search available', 'gh search code completed.', '')
    : result('warn', 'github:code-search', 'GitHub code search unavailable', codeSearch.output || codeSearch.error, 'Re-authenticate gh before research-router uses code search.');
  return [
    result('pass', 'github:cli', 'GitHub CLI available', versionLine, ''),
    result('pass', 'github:auth', 'GitHub auth available', 'gh auth status completed.', ''),
    codeCheck,
  ];
}

function validatePipelineState(state, root, now) {
  if (!state || typeof state !== 'object') {
    return { status: 'warn', title: 'Pipeline state invalid', detail: 'State JSON must be an object.', repair: 'Rewrite state via /pipeline.' };
  }
  const phase = typeof state.phase === 'string' ? state.phase : '';
  const closedAt = typeof state.closedAt === 'string' ? new Date(state.closedAt) : null;
  const closedTsInvalid = closedAt && Number.isNaN(closedAt.getTime());
  if (['closed', 'shipped'].includes(phase)) {
    if (closedTsInvalid || !closedAt) {
      return { status: 'warn', title: 'Pipeline state close timestamp invalid', detail: String(state.closedAt), repair: 'Rewrite closed state with a valid closedAt timestamp.' };
    }
    return { status: 'pass', title: 'Pipeline state closed', detail: state.closedAt, repair: '' };
  }
  const stateCwd = state && typeof state.cwd === 'string' ? normalizePath(state.cwd) : '';
  const expected = normalizePath(root);
  const ts = state && typeof state.ts === 'string' ? new Date(state.ts) : null;
  const invalidTs = !ts || Number.isNaN(ts.getTime());
  const future = !invalidTs && ts.getTime() > now.getTime() + STATE_CLOCK_SKEW_MS;
  const stale = !invalidTs && now.getTime() - ts.getTime() > STATE_TTL_MS;
  if (stateCwd && stateCwd.toLowerCase() !== expected.toLowerCase()) {
    return { status: 'warn', title: 'Pipeline state points to another project', detail: `${stateCwd} != ${expected}`, repair: 'Ignore this state and create project-local pipeline state.' };
  }
  if (!stateCwd) {
    return { status: 'warn', title: 'Pipeline state cwd missing', detail: 'Missing cwd field.', repair: 'Rewrite state via /pipeline.' };
  }
  if (invalidTs) {
    return { status: 'warn', title: 'Pipeline state timestamp invalid', detail: String(state && state.ts), repair: 'Rewrite state with a valid ISO timestamp.' };
  }
  if (future) {
    return { status: 'warn', title: 'Pipeline state timestamp is in the future', detail: state.ts, repair: 'Reject future state and rewrite via project-local state.' };
  }
  if (stale) {
    return { status: 'warn', title: 'Pipeline state is stale', detail: state.ts, repair: 'Refresh state after current sprint checkpoint.' };
  }
  return { status: 'pass', title: 'Pipeline state acceptable', detail: state.ts, repair: '' };
}

function checkProjectPipelineState(root, home, now) {
  const file = projectStatePath(root, home);
  if (!fs.existsSync(file)) {
    return result('warn', 'state:pipeline', 'Project pipeline state missing', file, 'Run /pipeline to create project-local state.');
  }
  const parsed = readJson(file);
  if (!parsed.ok) {
    return result('warn', 'state:pipeline', 'Project pipeline state invalid', parsed.error, 'Rewrite project-local pipeline state.');
  }
  const checked = validatePipelineState(parsed.value, root, now);
  return result(checked.status, 'state:pipeline', `Project ${checked.title}`, checked.status === 'pass' ? file : checked.detail, checked.repair, { file });
}

function checkLegacyPipelineState(root, home, now) {
  const file = legacyStatePath(home);
  if (!fs.existsSync(file)) {
    return result('pass', 'state:pipeline:legacy', 'Legacy global pipeline state absent', file, '');
  }
  const parsed = readJson(file);
  if (!parsed.ok) {
    return result('warn', 'state:pipeline:legacy', 'Legacy global pipeline state invalid', parsed.error, 'Keep legacy state read-only; rewrite only project-local state.');
  }
  // Recognized tombstone — migration complete, no active state here.
  if (parsed.value._legacy === true) {
    return result('pass', 'state:pipeline:legacy', 'Legacy global pipeline state is tombstone', file, '');
  }
  const checked = validatePipelineState(parsed.value, root, now);
  if (checked.status !== 'pass') {
    return result('warn', 'state:pipeline:legacy', `Legacy global ${checked.title}`, checked.detail, 'Use only project-local state; keep legacy fallback read-only.', { file });
  }
  return result('warn', 'state:pipeline:legacy', 'Legacy global pipeline state present', file, 'Migrate active state to the project capsule and keep this file read-only.', { file });
}

function checkPipelineState(root, home, now = new Date()) {
  return [
    checkProjectPipelineState(root, home, now),
    checkLegacyPipelineState(root, home, now),
  ];
}

function countRiskFiles(root) {
  if (!fs.existsSync(root)) return { total: 0, byExt: {} };
  const files = walk(root, (file) => RISK_EXTS.has(path.extname(file).toLowerCase()));
  return files.reduce((acc, file) => {
    const ext = path.extname(file).toLowerCase() || '<none>';
    const byExt = { ...acc.byExt, [ext]: (acc.byExt[ext] || 0) + 1 };
    return { total: acc.total + 1, byExt };
  }, { total: 0, byExt: {} });
}

function checkDocsGate(root, now = new Date()) {
  const result_ = checkDocsGateArtifact(root, now);
  if (!result_.ok) {
    return [result('warn', 'docs:gate', 'Docs gate report missing', result_.error, 'Run node tools\\docs-gate.js --root . --write.')];
  }
  if (result_.stale) {
    return [result('warn', 'docs:gate', 'Docs gate report stale', result_.value.generatedAt, 'Rerun node tools\\docs-gate.js --root . --write.', { file: result_.file })];
  }
  const gate = result_.value;
  const status = gate.summary && gate.summary.status ? gate.summary.status : 'unknown';
  const complexity = gate.complexity || 'unknown';
  const docCount = Array.isArray(gate.docsChanged) ? gate.docsChanged.length : 0;
  const codeCount = Array.isArray(gate.codeChanged) ? gate.codeChanged.length : 0;
  const title = status === 'pass' ? 'Docs gate OK' : status === 'warn' ? 'Docs gate: docs recommended' : 'Docs gate: docs required';
  const detail = `complexity=${complexity}  code=${codeCount}  docs=${docCount}`;
  const repair = status === 'fail' ? 'Update AGENTS.md (Memory section — pointer only, no dates). Run /sync-docs.' : '';
  return [result(status === 'fail' ? 'warn' : status, 'docs:gate', title, detail, repair, { file: result_.file })];
}

function checkHarnessChecklist(root, now = new Date()) {
  const result_ = checkHarnessChecklistArtifact(root, now);
  if (!result_.ok) {
    return [result('warn', 'harness:checklist', 'Harness checklist report missing', result_.error, 'Run node tools\\harness-checklist.js --root . --write.')];
  }
  if (result_.stale) {
    return [result('warn', 'harness:checklist', 'Harness checklist report stale', result_.value.generatedAt, 'Rerun node tools\\harness-checklist.js --root . --write.', { file: result_.file })];
  }
  const report = result_.value;
  const status = report.summary && report.summary.status ? report.summary.status : 'unknown';
  const c = (report.summary && report.summary.counts) || {};
  const title = status === 'pass' ? 'Harness self-audit OK' : status === 'warn' ? 'Harness self-audit: items need justification' : 'Harness self-audit: blockers';
  const detail = `${c.pass || 0} pass / ${c.warn || 0} warn / ${c.fail || 0} fail / ${c.needsJustification || 0} needs-justification`;
  const repair = status === 'fail' ? 'Resolve failing harness checklist items, then rerun node tools\\harness-checklist.js --root . --write.' : '';
  return [result(status === 'fail' ? 'warn' : status, 'harness:checklist', title, detail, repair, { file: result_.file })];
}

function checkHarnessRun(root, now = new Date()) {
  const result_ = checkHarnessRunArtifact(root, now);
  if (!result_.ok) {
    return [result('warn', 'harness:run', 'Harness run report missing', result_.error, 'Run node tools\\harness-gates.js run-gate <runId> --root .')];
  }
  const report = result_.value;
  const status = (report.summary && report.summary.status) || 'unknown';
  const phase = report.phase || 'unknown';
  if (result_.stale) {
    if (status === 'pass' || phase === 'complete' || report.status === 'complete') {
      return [result('pass', 'harness:run', 'Harness run history complete', `phase=${phase}  status=${report.status || status}`, '', { file: result_.file })];
    }
    return [result('warn', 'harness:run', 'Harness run report stale', result_.value.generatedAt, 'Rerun node tools\\harness-gates.js run-gate <runId> --root .', { file: result_.file })];
  }
  const title  = status === 'pass' ? 'Harness run complete' : status === 'fail' ? 'Harness run failed' : 'Harness run in progress';
  const detail = `phase=${phase}  status=${report.status || status}`;
  return [result(status === 'fail' ? 'warn' : status === 'running' ? 'pass' : status, 'harness:run', title, detail, '', { file: result_.file })];
}

function pipelineDirFromRegistry(home, fallbackRoot) {
  const parsed = readJson(path.join(home, '.claude', 'projects-registry.json'));
  if (parsed.ok && parsed.value && typeof parsed.value.pipelineDir === 'string' && parsed.value.pipelineDir.trim()) {
    return parsed.value.pipelineDir;
  }
  return fallbackRoot;
}

function checkHarnessGlobal(root, home, commandRunner = run) {
  const pipelineDir = pipelineDirFromRegistry(home, root);
  const scripts = [
    path.join(pipelineDir, 'tools', 'harness-runner.js'),
    path.join(pipelineDir, 'tools', 'harness-gates.js'),
  ];
  const wrappers = [
    path.join(home, '.claude', 'bin', 'harness-runner.cmd'),
    path.join(home, '.claude', 'bin', 'harness-runner.ps1'),
    path.join(home, '.claude', 'bin', 'harness-gates.cmd'),
    path.join(home, '.claude', 'bin', 'harness-gates.ps1'),
  ];
  const missingScripts = scripts.filter((file) => !fs.existsSync(file));
  const missingWrappers = wrappers.filter((file) => !fs.existsSync(file));
  if (missingScripts.length || missingWrappers.length) {
    const detail = [
      missingScripts.length ? `scripts=${missingScripts.map((file) => path.basename(file)).join(',')}` : '',
      missingWrappers.length ? `wrappers=${missingWrappers.map((file) => path.basename(file)).join(',')}` : '',
    ].filter(Boolean).join(' ');
    return [result('warn', 'harness:global-cli', 'Global harness CLI incomplete', detail, 'Install harness-runner/harness-gates wrappers in ~/.claude/bin.')];
  }
  const runner = commandRunner('cmd.exe', ['/c', 'where', 'harness-runner.cmd'], root, 5000);
  const gates = commandRunner('cmd.exe', ['/c', 'where', 'harness-gates.cmd'], root, 5000);
  if (runner.status !== 0 || gates.status !== 0) {
    return [result('warn', 'harness:global-cli', 'Global harness wrappers not on PATH', runner.output || gates.output || runner.error || gates.error || 'where failed', 'Add ~/.claude/bin to PATH or call wrappers by full path.')];
  }
  return [result('pass', 'harness:global-cli', 'Global harness CLI available', 'harness-runner.cmd and harness-gates.cmd resolve on PATH.', '')];
}

function checkGitWorkflowAudit(root, now = new Date()) {
  const result_ = checkGitArtifact(root, now);
  if (!result_.ok) {
    return [result('warn', 'git-workflow:audit', 'Git workflow audit missing', result_.error, 'Run node tools\\git-workflow-audit.js --root .')];
  }
  if (result_.stale) {
    return [result('warn', 'git-workflow:audit', 'Git workflow audit stale', result_.value.generatedAt, 'Rerun node tools\\git-workflow-audit.js --root .', { file: result_.file })];
  }
  const audit = result_.value;
  const overallStatus = audit.summary && audit.summary.status ? audit.summary.status : 'unknown';
  const gitRootIsDisk = Array.isArray(audit.checks) && audit.checks.some((c) => c.id === 'git:root-is-disk');
  const status = gitRootIsDisk ? 'warn' : overallStatus === 'pass' ? 'pass' : 'warn';
  const title = gitRootIsDisk
    ? 'Git root is disk root — scope all git commands with -- .'
    : status === 'pass' ? 'Git workflow OK' : 'Git workflow has issues';
  const detail = gitRootIsDisk
    ? `gitRoot=${audit.gitRoot || 'unknown'}  projectRoot=${audit.projectRoot || 'unknown'}`
    : result_.file;
  const repair = gitRootIsDisk ? 'All git status/log/diff commands must append "-- ." to scope to project.' : '';
  return [result(status, 'git-workflow:audit', title, detail, repair, { file: result_.file, gitRoot: audit.gitRoot })];
}

function checkRedTeam(root, home) {
  const roots = [path.join(root, 'tools', 'red-team'), path.join(home, '.claude', 'skills', 'red-team')];
  const quarantined = roots.filter((r) => fs.existsSync(path.join(r, '.quarantined')));
  const active = roots.filter((r) => fs.existsSync(r) && !fs.existsSync(path.join(r, '.quarantined')));
  const counts = active.map((candidate) => ({ root: candidate, counts: countRiskFiles(candidate) }));
  const total = counts.reduce((sum, entry) => sum + entry.counts.total, 0);
  if (total === 0) {
    const msg = quarantined.length > 0
      ? `Quarantined: ${quarantined.map((r) => path.basename(path.dirname(r)) + '/' + path.basename(r)).join(', ')}`
      : 'Scanned known red-team locations.';
    return [result('pass', 'red-team:risk', 'No Defender-risk files found', msg, '')];
  }
  const detail = counts.filter((entry) => entry.counts.total > 0)
    .map((entry) => `${entry.root}: ${entry.counts.total} ${JSON.stringify(entry.counts.byExt)}`)
    .join('; ');
  return [result('warn', 'red-team:risk', 'Defender-risk files present', detail, 'Place a .quarantined marker file in the directory to suppress after review.')];
}

// Step F (elt-system upgrade 2026-07-02): mini "Loop Ready" score — 10 yes/no
// checks against elt-loop's own SKILL.md text, grounded in the dimensions the
// 2026-07-02 audit used to grade this system L2 (state, kill-switch, hard-cap,
// self-heal cap, mechanical oracle, run-log, prune, fresh-context, isolated
// judge, judge-not-a-slice-gate). Informational scorecard, not a gate.
const LOOP_READY_ITEMS = [
  ['STATE.md хребет в проекте', /\.planning\/STATE\.md/],
  ['Kill-switch (loop: PAUSED)', /PAUSED/],
  ['Hard-cap на слайсы', /[Hh]ard-cap/],
  ['Self-heal с capped retries', /self-heal[^\n]{0,30}(≤\s*\d|<=\s*\d)/i],
  ['Оракул = механика (тесты), не LLM-судья', /[Оо]ракул\s*=\s*(механика|тесты)/],
  ['Run-log / наблюдаемость петли', /loop-run-log\.md/],
  ['Prune памяти на завершении', /[Pp]rune/],
  ['Fresh-context правило на длинных прогонах', /[Ff]resh context/],
  ['Судья изолирован (не inline self-judge)', /отдельный субагент|изолирован|sidechain/],
  ['Судья не гейт слайса (не может простить красный оракул)', /не гейт|не закрывает/],
];

// Fleet mode (Задача C, ELT v2 2026-07-08): iterate ~/.claude/projects-registry.json
// (written by `doctor --register`) and report per-project git/harness/stale-gate health.
// Reuses the existing registry instead of a new harness-projects.json.
function checkFleetProject(entry, runner = run) {
  const root = entry.path;
  if (!fs.existsSync(root)) {
    return result('warn', `fleet:${entry.key}`, `${entry.name}: path missing`, root, 'Project moved or deleted — update or drop the registry entry.');
  }
  const notes = [];
  let warn = false;

  const isRepo = fs.existsSync(path.join(root, '.git'));
  if (!isRepo) {
    notes.push('not a git repo');
    warn = true;
  } else {
    const status = runner('git', ['status', '--porcelain'], root, 8000);
    notes.push(status.status === 0 && status.output.trim() ? `dirty (${status.output.trim().split(/\r?\n/).length} files)` : 'clean');
  }

  const hasHarness = fs.existsSync(path.join(root, '.harness', 'harness.json'));
  if (!hasHarness) {
    notes.push('no oracle (.harness/harness.json missing)');
    warn = true;
  } else {
    notes.push('oracle configured');
  }

  const settingsFile = path.join(root, '.claude', 'settings.json');
  const settingsText = readText(settingsFile);
  if (settingsText.ok && /judge-closeout-gate/.test(settingsText.value)) {
    notes.push('stale judge-closeout-gate wiring');
    warn = true;
  }

  return result(warn ? 'warn' : 'pass', `fleet:${entry.key}`, `${entry.name}`, notes.join(' | '), warn ? 'See project-bootstrap SKILL.md for retrofit steps.' : '', { path: root });
}

function checkFleet(home, options = {}) {
  const registry = readJson(registryPath(home));
  if (!registry.ok) {
    return [result('warn', 'fleet:registry', 'Project registry missing', registry.error, 'Run doctor --register in each project first.')];
  }
  const projects = registry.value.projects || {};
  const entries = Object.values(projects);
  if (entries.length === 0) {
    return [result('warn', 'fleet:registry', 'Project registry empty', registryPath(home), 'Run doctor --register in each project first.')];
  }
  return entries.map((entry) => checkFleetProject(entry, options.runner));
}

function checkLoopReady(home) {
  const skillFile = path.join(home, '.claude', 'skills', 'elt-loop', 'SKILL.md');
  let text;
  try { text = fs.readFileSync(skillFile, 'utf8'); } catch {
    return [result('warn', 'loop:ready', 'Loop Ready score unavailable', `elt-loop SKILL.md not found at ${skillFile}`, 'Install/restore elt-loop skill.')];
  }
  const hits = LOOP_READY_ITEMS.map(([label, re]) => ({ label, ok: re.test(text) }));
  const score = hits.filter((h) => h.ok).length;
  const detail = hits.map((h) => `${h.ok ? '✓' : '✗'} ${h.label}`).join(' | ');
  const status = score === LOOP_READY_ITEMS.length ? 'pass' : 'warn';
  return [result(status, 'loop:ready', `Loop Ready score: ${score}/${LOOP_READY_ITEMS.length}`, detail, score < LOOP_READY_ITEMS.length ? 'Missing items are informational — see elt-loop SKILL.md.' : '')];
}

function runDoctor(options) {
  const home = os.homedir();
  const root = findProjectRoot(options.root);
  const checks = [
    ...checkRegistry(root, home, options.register),
    ...checkDocs(root),
    ...checkSkillRegistry(home),
    ...checkSkillYaml(home),
    ...checkSettingsSecrets(root, home),
    ...checkCodexDefaults(home),
    ...checkHooks(home),
    ...checkGraphify(root, options.graphify),
    ...checkCodeGraph(root),
    ...checkRag(root),
    ...checkMemoryProvider(root, options.memoryProvider),
    ...checkSurfaceSync(root),
    ...checkAgentSkillSupplyChain(root, home),
    ...checkAgentSkillsWrapper(root, home),
    ...checkAgentSurfaceAudit(root),
    ...checkDocsGate(root),
    ...checkHarnessChecklist(root),
    ...checkHarnessRun(root),
    ...checkHarnessGlobal(root, home),
    ...checkGitWorkflowAudit(root),
    ...checkGit(root),
    ...checkGitHubCli(root),
    ...checkPipelineState(root, home),
    ...checkRedTeam(root, home),
    ...checkLoopReady(home),
  ];
  const summary = checks.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  return { root: normalizePath(root), projectKey: projectKey(root), summary, checks };
}

function runFleet(options = {}) {
  const home = options.home || os.homedir();
  const checks = checkFleet(home, options);
  const summary = checks.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  return { root: 'fleet', projectKey: 'all', summary, checks };
}

function formatText(report) {
  const header = [
    `Doctor root: ${report.root}`,
    `Project key: ${report.projectKey}`,
    `Summary: PASS=${report.summary.pass || 0} WARN=${report.summary.warn || 0} FAIL=${report.summary.fail || 0}`,
    '',
  ].join('\n');
  const lines = report.checks.map((check) => {
    const repair = check.repair ? `\n  repair: ${check.repair}` : '';
    return `[${check.status.toUpperCase()}] ${check.title}\n  ${check.detail}${repair}`;
  });
  return `${header}${lines.join('\n')}\n`;
}

module.exports = {
  parseArgs,
  projectKey,
  projectStatePath,
  parseSkillFrontmatter,
  checkSettingsSecrets,
  checkCodexDefaults,
  checkGitHubCli,
  checkPipelineState,
  checkSurfaceSync,
  checkAgentSkillSupplyChain,
  checkAgentSkillsWrapper,
  checkAgentSurfaceAudit,
  checkDocsGate,
  checkHarnessChecklist,
  checkHarnessRun,
  checkHarnessGlobal,
  checkGitWorkflowAudit,
  checkFleet,
  runFleet,
  runDoctor,
  formatText,
};
