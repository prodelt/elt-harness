#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { checkArtifact: checkGitArtifact } = require('./git-workflow-audit');
const { checkArtifact: checkDocsGateArtifact } = require('./docs-gate');
const { checkArtifact: checkHarnessChecklistArtifact } = require('./harness-checklist');
const { readHarnessConfig } = require('./elt-config');
const runLog = require('./run-log');
const { slicesSinceFull } = require('./elt-oracle-runner');
const { CLOSURE: JUDGE_BRIDGE_CLOSURE } = require('./sync-bin');
const { CORE_SECTIONS } = require('./project-docs-core');
const { inspectProject } = require('./project-bootstrap');
const fleetClaims = require('./fleet/claims');
const fleetWorktree = require('./fleet/worktree');
const fleetRouter = require('./fleet/router');
// ponytail: normalizePath/projectKey were the only live imports from the retired
// pipeline-state module (spec 005 T019) — inlined; the module is deleted.
function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/');
}
function projectKey(root) {
  const normalized = normalizePath(root).toLowerCase();
  const base = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  return `${base || 'project'}-${hash}`;
}

const DOCS = ['AGENTS.md', 'CLAUDE.md', path.join('.gemini', 'GEMINI.md')];
const SECTIONS = CORE_SECTIONS;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'runtime', 'sources']);
const RISK_EXTS = new Set(['.exe', '.dll', '.pdb', '.bat', '.cmd', '.ps1', '.asm', '.cpp', '.c', '.bin']);
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
  const markers = ['AGENTS.md', 'CLAUDE.md', '.git'];
  const found = markers.some((marker) => fs.existsSync(path.join(current, marker)));
  if (found || parent === current) return current;
  return findProjectRoot(parent);
}

function parseArgs(argv) {
  const defaults = { root: process.cwd(), json: false, register: false, fleet: false };
  const parseNext = (index, state) => {
    if (index >= argv.length) return { ok: true, value: state };
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--register') return parseNext(index + 1, { ...state, register: true });
    if (arg === '--fleet') return parseNext(index + 1, { ...state, fleet: true });
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

// Codex sandbox/approval safety (spec 005 AC13). Reads only — never writes config.toml.
// danger-full-access + approval=never = no sandbox AND no approvals → high-risk signal.
function checkCodexSandbox(configText) {
  const sandbox = (configText.match(/^\s*sandbox_mode\s*=\s*"([^"]+)"/m) || [])[1] || '';
  const approval = (configText.match(/^\s*approval_policy\s*=\s*"([^"]+)"/m) || [])[1] || '';
  const detail = `sandbox_mode=${sandbox || '<unset>'}, approval_policy=${approval || '<unset>'}`;
  if (sandbox === 'danger-full-access' && approval === 'never') {
    return result('fail', 'codex:sandbox', 'Codex runs with NO sandbox and NO approvals (high-risk)', detail,
      'danger-full-access + approval=never is a privileged emergency profile, never a default — see docs/CODEX-PROFILES.md. Change ~/.codex/config.toml only after explicit confirmation.');
  }
  if (sandbox === 'danger-full-access') {
    return result('warn', 'codex:sandbox', 'Codex sandbox disabled (full access)', detail,
      'danger-full-access grants full disk/network access; keep it a scoped, temporary exception, not a default — see docs/CODEX-PROFILES.md.');
  }
  return result('pass', 'codex:sandbox', 'Codex sandbox profile OK', detail, '');
}

function checkCodexDefaults(home) {
  const file = path.join(home, '.codex', 'config.toml');
  const text = readText(file);
  if (!text.ok) {
    return [result('warn', 'codex:defaults', 'Codex config missing', text.error, 'Create ~/.codex/config.toml with model, effort and a safe sandbox profile — see docs/CODEX-PROFILES.md.')];
  }
  const model = (text.value.match(/^model\s*=\s*"([^"]+)"/m) || [])[1] || '';
  const effort = (text.value.match(/^model_reasoning_effort\s*=\s*"([^"]+)"/m) || [])[1] || '';
  // gpt-5.5 is the current flagship — not considered expensive legacy
  const legacyExpensiveModel = model && !['gpt-5.5', 'gpt-4o', 'gpt-4.1'].includes(model) && /gpt-[34]/i.test(model) && model !== 'gpt-4o-mini';
  const modelFinding = legacyExpensiveModel
    ? result('warn', 'codex:defaults', 'Codex defaults are expensive', `model=${model || '<unset>'}, effort=${effort || '<unset>'}`, 'Consider upgrading to gpt-5.5 for best results.')
    : result('pass', 'codex:defaults', 'Codex defaults OK', `model=${model || '<unset>'}, effort=${effort || '<unset>'}`, '');
  return [modelFinding, checkCodexSandbox(text.value)];
}

// T008 (004-elt-selfdrive): mandate is "codegraph первым" — this must be a
// real check, not silently skipped, so a project that's supposed to use
// codegraph but has a dead index actually shows up in doctor.
function checkCodeGraphMcp(home) {
  const parsed = readJson(path.join(home, '.claude.json'));
  const configured = parsed.ok && parsed.value && parsed.value.mcpServers && parsed.value.mcpServers.codegraph;
  return configured
    ? result('pass', 'codegraph:mcp', 'CodeGraph MCP configured', 'mcpServers.codegraph present in ~/.claude.json.', '')
    : result('warn', 'codegraph:mcp', 'CodeGraph MCP not configured', '~/.claude.json has no mcpServers.codegraph entry.', 'Run: cmd /c codegraph install (select Claude Code).');
}

function checkCodeGraph(root, runner = run) {
  const dbPath = path.join(root, '.codegraph', 'codegraph.db');
  if (!fs.existsSync(dbPath)) {
    return [result('warn', 'codegraph:status', 'CodeGraph index missing', dbPath, 'Run: cmd /c codegraph init . && codegraph index .')];
  }
  const status = runner('cmd.exe', ['/c', 'codegraph', 'status', root], root, 10000);
  if (status.status !== 0) {
    return [result('warn', 'codegraph:status', 'CodeGraph index status failed', status.error || status.output, 'Run: cmd /c codegraph sync .')];
  }
  const output = status.output || '';
  const filesMatch = output.match(/Files:\s+(\d+)/);
  const nodesMatch = output.match(/Nodes:\s+([\d\s]+)/);
  const backendMatch = output.match(/Backend:\s+(.+)/);
  const detail = [
    filesMatch ? `files=${filesMatch[1].trim()}` : '',
    nodesMatch ? `nodes=${nodesMatch[1].trim()}` : '',
    backendMatch ? `backend=${backendMatch[1].trim()}` : '',
  ].filter(Boolean).join(', ');
  // ponytail: "watcher жив" has no separate liveness API — `codegraph status`
  // is the one signal the CLI exposes. Pending changes with no user-run sync
  // between edits and this doctor call is what a dead watcher looks like.
  const stale = /Pending Changes:/.test(output) || !/up to date/i.test(output);
  const indexCheck = stale
    ? result('warn', 'codegraph:status', 'CodeGraph index stale (watcher may be dead)', detail || output.slice(0, 200), 'Run: cmd /c codegraph sync . (repeats after edits settle → watcher not syncing, restart the client).')
    : result('pass', 'codegraph:status', 'CodeGraph MCP/index healthy', detail || 'codegraph status completed.', '');
  return [indexCheck];
}

const CODEGRAPH_TOOL_USE_RE = /"name"\s*:\s*"mcp__codegraph__/;
const ANY_TOOL_USE_RE = /"type"\s*:\s*"tool_use"/;

// Claude Code's own project→session-dir naming: every non-alnum char of the
// absolute path becomes '-' (observed convention, not a documented API).
function claudeSessionDirName(root) {
  return normalizePath(root).replace(/[^A-Za-z0-9]/g, '-');
}

// T008: telemetry for the "codegraph первым" mandate (audit found 10
// codegraph_context calls across 278 sessions — adoption ≈0). Samples the
// most recent session logs only — a full-history scan is the one-off
// scratch audit in spec.md, not a per-`doctor`-run cost.
function checkCodeGraphAdoption(root, home, options = {}) {
  const sessionsDir = path.join(home, '.claude', 'projects', claudeSessionDirName(root));
  if (!fs.existsSync(sessionsDir)) {
    return [result('warn', 'codegraph:adoption', 'CodeGraph adoption telemetry unavailable', sessionsDir, 'No session logs found yet for this project.')];
  }
  const sampleSize = options.sampleSize || 20;
  const files = fs.readdirSync(sessionsDir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => ({ name, mtime: fs.statSync(path.join(sessionsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, sampleSize);
  let toolUseTotal = 0;
  let codegraphTotal = 0;
  for (const file of files) {
    const text = readText(path.join(sessionsDir, file.name));
    if (!text.ok) continue;
    for (const line of text.value.split('\n')) {
      if (ANY_TOOL_USE_RE.test(line)) toolUseTotal += 1;
      if (CODEGRAPH_TOOL_USE_RE.test(line)) codegraphTotal += 1;
    }
  }
  const detail = `${codegraphTotal} codegraph_* calls / ${toolUseTotal} tool calls across last ${files.length} session(s).`;
  if (toolUseTotal === 0) {
    return [result('warn', 'codegraph:adoption', 'CodeGraph adoption unmeasured', detail, 'No tool_use events found in sampled sessions.')];
  }
  const status = codegraphTotal > 0 ? 'pass' : 'warn';
  return [result(status, 'codegraph:adoption', `CodeGraph adoption: ${codegraphTotal} call(s) in sample`, detail, status === 'warn' ? 'Mandate "codegraph первым" (CLAUDE.md) is being ignored in recent sessions.' : '')];
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

function sha256File(file) {
  try {
    return { ok: true, value: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// T013: mandatory-parity gate for the critical control-plane skill set (elt +
// aliases + project-bootstrap), driven by agent-skills.lock.json — separate
// from checkAgentSkillSupplyChain (config/agent-skill-sources.json, broader
// non-critical set, warns on drift). Every entry here is critical: invalid
// YAML, a missing mirror, or content drift is a fail, not a warn.
function checkAgentSkillsLock(root, home) {
  const lockFile = path.join(root, 'agent-skills.lock.json');
  const lock = readJson(lockFile);
  if (!lock.ok) return [result('fail', 'agent-skills:lock', 'agent-skills.lock.json missing/invalid', lock.error, 'Restore agent-skills.lock.json (T013, specs/005-elt-control-plane-convergence).')];
  const skills = (lock.value && lock.value.skills) || {};
  const names = Object.keys(skills);
  if (names.length === 0) return [result('fail', 'agent-skills:lock', 'agent-skills.lock.json has no critical skills', lockFile, 'Add elt/elt-code/elt-loop/project-bootstrap entries.')];

  const problems = [];
  for (const name of names) {
    const entry = skills[name];
    const sourceBase = entry.sourceKind === 'home' ? home : root;
    const sourcePath = path.join(sourceBase, entry.source || '');
    if (!fs.existsSync(sourcePath)) {
      problems.push(`${name}: source missing (${entry.source})`);
      continue;
    }
    const frontmatter = parseSkillFrontmatter(sourcePath);
    if (!frontmatter.ok) {
      problems.push(`${name}: invalid YAML frontmatter — ${frontmatter.error}`);
      continue;
    }
    const sourceHash = sha256File(sourcePath);
    if (!sourceHash.ok) {
      problems.push(`${name}: cannot hash source — ${sourceHash.error}`);
      continue;
    }
    const targets = entry.targets || {};
    for (const [client, relTarget] of Object.entries(targets)) {
      const targetPath = path.join(home, relTarget);
      if (!fs.existsSync(targetPath)) {
        problems.push(`${name}/${client}: mirror missing (${relTarget})`);
        continue;
      }
      const targetHash = sha256File(targetPath);
      if (!targetHash.ok || targetHash.value !== sourceHash.value) {
        problems.push(`${name}/${client}: content drift`);
      }
    }
  }

  if (problems.length > 0) {
    return [result('fail', 'agent-skills:lock', 'Critical skill lock has drift/missing/invalid entries', problems.slice(0, 10).join('; '), 'Fix the source and re-run node tools/sync-agent-surface.js --apply --target all.')];
  }
  return [result('pass', 'agent-skills:lock', 'Critical skill lock OK', `${names.length} critical skill(s) verified across mirrors.`, '')];
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
  // ponytail: возраст отчёта не WARN-им — генераторы не гоняются авто, TTL давал вечный шум (P2-1). Сигнал = summary.status; missing/invalid остаются WARN.
  const summaryStatus = parsed.value.summary && parsed.value.summary.status ? parsed.value.summary.status : 'unknown';
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
  // ponytail: stale-возраст не WARN-им (P2-1) — сигнал берём из summary.status ниже.
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
  // ponytail: stale-возраст не WARN-им (P2-1) — сигнал берём из summary.status ниже.
  const report = result_.value;
  const status = report.summary && report.summary.status ? report.summary.status : 'unknown';
  const c = (report.summary && report.summary.counts) || {};
  const title = status === 'pass' ? 'Harness self-audit OK' : status === 'warn' ? 'Harness self-audit: items need justification' : 'Harness self-audit: blockers';
  const detail = `${c.pass || 0} pass / ${c.warn || 0} warn / ${c.fail || 0} fail / ${c.needsJustification || 0} needs-justification`;
  const repair = status === 'fail' ? 'Resolve failing harness checklist items, then rerun node tools\\harness-checklist.js --root . --write.' : '';
  return [result(status === 'fail' ? 'warn' : status, 'harness:checklist', title, detail, repair, { file: result_.file })];
}

function checkHarnessConfig(root) {
  const harness = readHarnessConfig(root);
  if (!harness.ok) {
    return result('fail', 'harness:config', 'Harness config invalid', harness.errors.join('; '), 'Run elt init for code projects or provide a valid kind, verifier, and judge config.', { file: harness.file });
  }
  return result('pass', 'harness:config', 'Harness config valid', `kind=${harness.config.kind}`, '', { file: harness.file });
}

// 011 T005 (R4): очередь `inconclusive` неблокирующая по решению пользователя — значит
// единственное, что мешает ей стать свалкой, это видимость. Доктор её ПОКАЗЫВАЕТ, но никогда
// не роняет прогон: накопление — сигнал, а не отказ.
// ponytail: порог константой, а не полем конфига — цифру никто ещё не подбирал; станет
// поводом для спора — переедет в harness.json.
const REVIEW_QUEUE_WARN = 10;
function checkReviewQueue(root) {
  const file = path.join(root, '.harness', 'review-queue.jsonl');
  const text = readText(file);
  if (!text.ok) return []; // очереди нет — проекту нечего показывать, а не «всё плохо»
  const open = text.value.split(/\r?\n/).filter(Boolean).reduce((acc, line) => {
    try { return JSON.parse(line).closedAt ? acc : acc + 1; } catch { return acc; }
  }, 0);
  const detail = `${open} на разборе (порог ${REVIEW_QUEUE_WARN})`;
  return [open > REVIEW_QUEUE_WARN
    ? result('warn', 'elt:review-queue', 'Очередь ревью растёт', detail, 'Разбери пачкой: elt review, затем elt review close --task Txxx.', { open, file })
    : result('pass', 'elt:review-queue', 'Очередь ревью', detail, '', { open, file })];
}

// 011 T020 (R4): impact-выборка (`oracleSelect:impact`) экономит время на КАЖДОМ слайсе, но
// платит за это слепотой к дефектам вне 2-хопового обратного скана диффа — единственная сеть
// под ней (fleet-merge всегда full, T020) не покрывает соло-путь без fleet вовсе. Счётчик —
// не стоп: накопление сигнализирует, а не роняет прогон (то же решение R4, что и review-queue).
// ponytail: порог константой — цифру никто ещё не подбирал.
const ORACLE_FULL_STALE_WARN = 15;
function checkOracleFullStale(root) {
  const harness = readHarnessConfig(root);
  if (!harness.ok || harness.config.oracleSelect !== 'impact') return []; // impact не включён — концепция не применима
  const file = runLog.runtimeRunLog(root);
  if (!file) return [];
  const text = readText(file);
  if (!text.ok) return [];
  const entries = text.value.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  const count = slicesSinceFull(entries);
  const detail = `${count} слайсов с последнего полного прогона (порог ${ORACLE_FULL_STALE_WARN})`;
  return [count > ORACLE_FULL_STALE_WARN
    ? result('warn', 'elt:oracle-full-stale', 'Полный оракул давно не гонялся', detail, 'elt oracle --full (или дождись merge через fleet — там он идёт всегда).', { count, file })
    : result('pass', 'elt:oracle-full-stale', 'Полный оракул', detail, '', { count, file })];
}

// R1 (спека 010): глобальная копия моста судьи — вторая копия кода, она разъезжается с репо
// молча, как `tools/elt.js` ≡ `~/.claude/bin/elt.js`. Механический сигнал: при judge.enabled
// нет копии → WARN (`elt judge run` в чужом проекте упадёт), копия ≠ репо → WARN с именами.
function checkJudgeBridge(root, home) {
  const harness = readHarnessConfig(root);
  if (!harness.ok || !harness.config.judge || !harness.config.judge.enabled) return [];
  const globalDir = path.join(home, '.claude', 'bin', 'judge');
  const toolsDir = path.join(root, 'tools');
  const missing = JUDGE_BRIDGE_CLOSURE.filter((rel) => !fs.existsSync(path.join(globalDir, rel)));
  if (missing.length) {
    return [result('warn', 'judge:bridge', 'Global judge bridge missing', `${globalDir}: ${missing.join(', ')}`, 'Run node tools\\sync-bin.js to install the judge bridge in ~/.claude/bin/judge.', { dest: globalDir, missing })];
  }
  // Дрейф меряется только там, где есть источник — в репо-разработчике. В чужом проекте
  // сравнивать не с чем, и присутствие замыкания это всё, что доктор может утверждать.
  if (!fs.existsSync(path.join(toolsDir, 'judge-invoke.js'))) {
    return [result('pass', 'judge:bridge', 'Global judge bridge installed', globalDir, '', { dest: globalDir })];
  }
  const drift = JUDGE_BRIDGE_CLOSURE.filter((rel) => {
    const src = sha256File(path.join(toolsDir, rel));
    const copy = sha256File(path.join(globalDir, rel));
    return !src.ok || !copy.ok || src.value !== copy.value;
  });
  if (drift.length) {
    return [result('warn', 'judge:bridge', 'Global judge bridge drifted from repo', drift.join(', '), 'Run node tools\\sync-bin.js to refresh the global copy.', { dest: globalDir, drift })];
  }
  return [result('pass', 'judge:bridge', 'Global judge bridge in sync', `${JUDGE_BRIDGE_CLOSURE.length} files match ${globalDir}`, '', { dest: globalDir })];
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
  // ponytail: stale-возраст не WARN-им (P2-1) — сигнал берём из summary.status ниже.
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

// T013 (004-elt-selfdrive): единый self-drive-обзор — effort-эскалация (T004) и
// judge-liveness-инвариант (T002) раньше были проверяемы только юнит-тестами fleet-модулей,
// не видны в обычном `node tools/doctor.js`. Статическая проверка "на месте" (файл несёт
// ожидаемый контракт), не рантайм-вызов — те же fleet/effort-policy.js и fleet/gate.js,
// которыми реально пользуются driver'ы, требовать require заново было бы дублированием.
function checkSelfDriveInvariants() {
  const checks = [];

  let effortOk = false;
  try { effortOk = typeof require('./fleet/effort-policy').effortFor === 'function'; } catch { effortOk = false; }
  checks.push(effortOk
    ? result('pass', 'selfdrive:effort', 'Self-drive: effort-политика активна',
      'fleet/effort-policy.js: effortFor(phase) — impl=high, heal=max')
    : result('warn', 'selfdrive:effort', 'Self-drive: effort-policy сломан/отсутствует',
      'tools/fleet/effort-policy.js', 'T004 (specs/004-elt-selfdrive) — эскалация self-heal на max'));

  const gateRead = readText(path.join(__dirname, 'fleet', 'gate.js'));
  const gateSrc = gateRead.ok ? gateRead.value : '';
  const judgeLivenessOk = /runOk\s*:\s*false/.test(gateSrc) && /judge_pending|judge-unavailable/.test(gateSrc);
  checks.push(judgeLivenessOk
    ? result('pass', 'selfdrive:judge-liveness', 'Self-drive: judge-liveness-инвариант на месте',
      'fleet/gate.js: runOk различает dead-judge (park) от реального block')
    : result('warn', 'selfdrive:judge-liveness', 'Self-drive: judge-liveness-инвариант не найден',
      'tools/fleet/gate.js', 'T002 (specs/004-elt-selfdrive) — пустой/timeout судья не должен маскироваться под block'));

  return checks;
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

// Fleet mode: iterate ~/.claude/projects-registry.json (written by `doctor --register`)
// and report per-project DOMAIN-AWARE readiness (spec 005 AC11). Effective kind = the
// explicitly declared harness kind when the config is valid, else the classifyKind
// heuristic. PASS only when the FULL contract for that kind is met — a harness.json that
// merely EXISTS is not enough: T001 validity already requires a non-empty oracle/verifier,
// so an invalid/placeholder harness keeps the project not-ready (no false green by file).
// Distinguishes: missing, non-git, code, docs/office, unknown, invalid-harness, ready.
function checkFleetProject(entry) {
  const root = entry.path;
  if (!fs.existsSync(root)) {
    return result('warn', `fleet:${entry.key}`, `${entry.name} [missing]`, root,
      'Project moved or deleted — update or drop the registry entry.', { path: root, klass: 'missing' });
  }
  const inspected = inspectProject(root);
  const isRepo = fs.existsSync(path.join(root, '.git'));
  const declaredKind = inspected.harness.ok && inspected.harness.config ? inspected.harness.config.kind : null;
  const kind = declaredKind || inspected.classification.kind;

  // Unknown = no managed contract to check. Explicit, not a false PASS and not a hard fail.
  if (kind === 'unknown') {
    return result('warn', `fleet:${entry.key}`, `${entry.name} [unknown]`,
      `kind=unknown (${inspected.classification.confidence}) — classify explicitly (code/docs/office); no oracle invented`,
      'Add a code manifest or docs and declare .harness/harness.json kind, then re-run doctor --register.',
      { path: root, klass: 'unknown' });
  }

  const reasons = [];
  if (!isRepo) reasons.push('not a git repo');
  // AI docs contract — code AND docs/office both carry managed AGENTS/CLAUDE/GEMINI docs.
  if (!(inspected.docs.ok && inspected.docs.coreIdentical)) {
    reasons.push(`docs missing/drifted (${(inspected.docs.missing || []).slice(0, 3).join(', ') || 'core not identical'})`);
  }
  // Harness config schema + real oracle/verifier (harness.ok ⇒ non-empty command per T001).
  let invalidHarness = false;
  if (!inspected.harness.exists) {
    reasons.push(`no harness (.harness/harness.json missing — kind=${kind} needs a mechanical ${kind === 'code' ? 'oracle' : 'artifactVerifier'})`);
  } else if (!inspected.harness.ok) {
    reasons.push(`invalid harness (${(inspected.harness.errors || []).join('; ')})`);
    invalidHarness = true;
  }
  // Git gate — code only; docs/office are NOT forced to carry a code gate (guard AC11).
  if (kind === 'code' && !inspected.gitGate.managedHookInstalled) {
    reasons.push('no managed gate (.githooks/pre-commit missing)');
  }

  const ready = reasons.length === 0;
  const klass = invalidHarness ? 'invalid-harness' : !isRepo ? 'non-git' : ready ? 'ready' : kind;
  // Signals — informational; never block readiness (idle specs / no index are legitimate).
  const hasSpecs = fs.existsSync(path.join(root, 'specs'));
  const notes = [
    `kind=${kind} (${declaredKind ? 'declared' : 'heuristic'})`,
    `codegraph=${inspected.codegraph.indexed ? 'indexed' : 'none'}`,
    `specs=${hasSpecs ? 'present' : 'none'}`,
    `state=${fs.existsSync(path.join(root, '.planning', 'STATE.md')) ? 'present' : 'none'}`,
  ];
  if (kind === 'code' && inspected.harness.exists && !hasSpecs) notes.push('front-half unused (no specs/ — run /elt план-шаг)');
  const settingsText = readText(path.join(root, '.claude', 'settings.json'));
  if (settingsText.ok && /judge-closeout-gate/.test(settingsText.value)) notes.push('stale judge-closeout-gate wiring');

  return result(ready ? 'pass' : 'warn', `fleet:${entry.key}`, `${entry.name} [${klass}]`,
    [...notes, ...reasons].join(' | '),
    ready ? '' : 'Run project-bootstrap verify / apply to close the missing contract.',
    { path: root, klass, kind });
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
  return entries.map((entry) => checkFleetProject(entry));
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

// Здоровье fleet-воркеров текущего проекта: залежавшиеся claims, брошенные worktrees,
// доступность CLI провайдеров из политики. НЕ путать с runFleet/--fleet (тот = здоровье
// парка ЗАРЕГИСТРИРОВАННЫХ проектов, 549f15a). Тихо, если проект не использует fleet.
function checkFleetWorkers(root, runner = run) {
  const fleetDir = path.join(root, '.harness', 'fleet');
  const hasPolicy = fs.existsSync(path.join(fleetDir, 'fleet.json'));
  const claimsDir = path.join(fleetDir, 'claims');
  // по claim-ФАЙЛАМ, не по пустой папке: сам read-чек (claims.stale) делает mkdir,
  // так что пустая .fleet/claims/ не должна считаться признаком использования fleet.
  const hasClaims = fs.existsSync(claimsDir) && fs.readdirSync(claimsDir).some((f) => f.endsWith('.json'));
  const usesFleet = hasPolicy || hasClaims || fs.existsSync(path.join(fleetDir, 'events.jsonl'));
  if (!usesFleet) return [];

  const checks = [];
  // 1. залежавшиеся claims (pid воркера мёртв) — T013: doctor сам метёт (sweep — то же
  // release, что делает resume-sweep перед fleet run), не только предупреждает; идемпотентно
  // (второй прогон подряд не находит уже снятых claims).
  let swept = [];
  try { swept = fleetClaims.sweep({ cwd: root }); } catch { swept = []; }
  checks.push(swept.length
    ? result('pass', 'fleet:claims', `Fleet: ${swept.length} залежавшихся claim(ов) подметено`,
      `мёртвые воркеры (claim снят): ${swept.join(', ')}`)
    : result('pass', 'fleet:claims', 'Fleet: claims чисты', 'нет залежавшихся claims'));

  // 2. брошенные worktrees (.fleet-wt без активного воркера)
  let wts = [];
  try { wts = fleetWorktree.list({ cwd: root }); } catch { wts = []; }
  let active = new Set();
  try { active = new Set(fleetClaims.list({ cwd: root }).filter((c) => !c.stale).map((c) => c.tid)); } catch { /* пусто */ }
  const orphan = wts.filter((w) => !active.has(w.tid));
  if (orphan.length) {
    checks.push(result('warn', 'fleet:worktrees', `Fleet: ${orphan.length} брошенных worktree`,
      orphan.map((w) => w.tid).join(', '), 'git worktree remove .fleet-wt/<Tid> --force (или fleet run приберёт)'));
  } else if (wts.length) {
    checks.push(result('pass', 'fleet:worktrees', 'Fleet: worktrees', 'брошенных нет'));
  }

  // 3. CLI pre-flight — только при явной политике (fleet.json), чтобы не шуметь зря
  if (hasPolicy) {
    let policy;
    try { policy = fleetRouter.loadPolicy(root); } catch { policy = fleetRouter.DEFAULT_POLICY; }
    const provs = [...new Set([...(policy.default || []), ...Object.values(policy.policy || {}).flat()])];
    for (const p of provs) {
      const r = runner(p, ['--version'], root, 4000);
      checks.push(r && r.status === 0 && !r.error
        ? result('pass', `fleet:cli:${p}`, `Fleet CLI ${p} доступен`, (r.output || '').split('\n')[0] || '')
        : result('warn', `fleet:cli:${p}`, `Fleet CLI ${p} недоступен`,
          `провайдер в политике, но '${p} --version' не отвечает`,
          `установить/залогинить ${p} или убрать из .harness/fleet/fleet.json`));
    }
  }
  return checks;
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
    ...checkCodeGraph(root),
    checkCodeGraphMcp(home),
    ...checkCodeGraphAdoption(root, home),
    ...checkSurfaceSync(root),
    ...checkAgentSkillSupplyChain(root, home),
    ...checkAgentSkillsLock(root, home),
    ...checkAgentSkillsWrapper(root, home),
    ...checkAgentSurfaceAudit(root),
    ...checkDocsGate(root),
    ...checkHarnessChecklist(root),
    checkHarnessConfig(root),
    ...checkReviewQueue(root),
    ...checkOracleFullStale(root),
    ...checkJudgeBridge(root, home),
    ...checkHarnessGlobal(root, home),
    ...checkGitWorkflowAudit(root),
    ...checkGit(root),
    ...checkFleetWorkers(root),
    ...checkSelfDriveInvariants(),
    ...checkGitHubCli(root),
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
  parseSkillFrontmatter,
  checkSettingsSecrets,
  checkCodexDefaults,
  checkGitHubCli,
  checkSurfaceSync,
  checkCodeGraph,
  checkCodeGraphMcp,
  checkCodeGraphAdoption,
  checkAgentSkillSupplyChain,
  checkAgentSkillsLock,
  checkAgentSkillsWrapper,
  checkAgentSurfaceAudit,
  checkDocsGate,
  checkHarnessChecklist,
  checkHarnessConfig,
  checkReviewQueue,
  checkOracleFullStale,
  checkJudgeBridge,
  checkHarnessGlobal,
  checkGitWorkflowAudit,
  checkFleet,
  checkFleetWorkers,
  checkSelfDriveInvariants,
  runFleet,
  runDoctor,
  formatText,
};
