#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const DEFAULT_MANIFEST = path.resolve(__dirname, '..', 'config', 'agent-skill-sources.json');
const DEFAULT_REGISTRY = path.join(os.homedir(), '.claude', 'projects-registry.json');

const CLIENT_ROOTS = {
  claude: (home) => path.join(home, '.claude', 'skills'),
  codex: (home) => path.join(home, '.codex', 'skills'),
  gemini: (home) => path.join(home, '.gemini', 'skills'),
};

const VALID_STATUS = new Set(['approved', 'review-required', 'pattern-only', 'blocked']);
const VALID_SOURCE_TYPES = new Set(['local-client', 'github']);
const VALID_CLIENTS = new Set(Object.keys(CLIENT_ROOTS));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read JSON ${file}: ${error.message}`);
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const state = {
    command: args.find((arg) => !arg.startsWith('--')) || 'audit',
    manifest: DEFAULT_MANIFEST,
    registry: DEFAULT_REGISTRY,
    home: os.homedir(),
    target: 'all',
    apply: false,
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--manifest') state.manifest = path.resolve(args[index += 1] || state.manifest);
    else if (arg === '--registry') state.registry = path.resolve(args[index += 1] || state.registry);
    else if (arg === '--home') state.home = path.resolve(args[index += 1] || state.home);
    else if (arg === '--target') state.target = args[index += 1] || state.target;
    else if (arg === '--apply') state.apply = true;
    else if (arg === '--json') state.json = true;
  }
  return state;
}

function isSafeRelative(value) {
  if (!value || typeof value !== 'string') return false;
  if (path.isAbsolute(value)) return false;
  const normalized = value.replace(/\\/g, '/');
  return !normalized.split('/').includes('..');
}

function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') errors.push('manifest must be an object');
  if (!Array.isArray(manifest.skills)) errors.push('skills must be an array');
  if (!Array.isArray(manifest.externalCandidates)) errors.push('externalCandidates must be an array');

  for (const [index, skill] of (manifest.skills || []).entries()) {
    const prefix = `skills[${index}]`;
    if (!skill.id || typeof skill.id !== 'string') errors.push(`${prefix}.id is required`);
    if (!skill.name || typeof skill.name !== 'string') errors.push(`${prefix}.name is required`);
    if (!VALID_STATUS.has(skill.status)) errors.push(`${prefix}.status is invalid`);
    if (!skill.source || typeof skill.source !== 'object') errors.push(`${prefix}.source is required`);
    if (skill.source && !VALID_SOURCE_TYPES.has(skill.source.type)) errors.push(`${prefix}.source.type is invalid`);
    if (skill.source && skill.source.type === 'local-client') {
      if (!VALID_CLIENTS.has(skill.source.client)) errors.push(`${prefix}.source.client is invalid`);
      if (!isSafeRelative(skill.source.path)) errors.push(`${prefix}.source.path must be safe relative path`);
    }
  }

  for (const [index, candidate] of (manifest.externalCandidates || []).entries()) {
    const prefix = `externalCandidates[${index}]`;
    if (!candidate.repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(candidate.repo)) {
      errors.push(`${prefix}.repo must be owner/repo`);
    }
    if (!VALID_STATUS.has(candidate.status)) errors.push(`${prefix}.status is invalid`);
  }
  return { ok: errors.length === 0, errors };
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hashDir(dir) {
  const entries = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === '.git') continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    entries.push(stat.isDirectory() ? `d:${name}:${hashDir(full)}` : `f:${name}:${hashFile(full)}`);
  }
  return crypto.createHash('sha256').update(entries.join('|')).digest('hex');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (name === '.git') continue;
    const srcPath = path.join(src, name);
    const dstPath = path.join(dst, name);
    if (fs.statSync(srcPath).isDirectory()) copyDir(srcPath, dstPath);
    else fs.copyFileSync(srcPath, dstPath);
  }
}

function assertInside(parent, child) {
  const root = path.resolve(parent);
  const target = path.resolve(child);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside ${root}: ${target}`);
  }
}

function clientRoots(home) {
  return Object.fromEntries(Object.entries(CLIENT_ROOTS).map(([client, resolve]) => [client, resolve(home)]));
}

function targetClients(target) {
  if (target === 'all') return Object.keys(CLIENT_ROOTS);
  if (!VALID_CLIENTS.has(target)) throw new Error(`Unknown target client: ${target}`);
  return [target];
}

function skillSourcePath(skill, roots) {
  if (!skill.source || skill.source.type !== 'local-client') return null;
  return path.join(roots[skill.source.client], skill.source.path);
}

function auditSkills(manifest, roots) {
  return manifest.skills.map((skill) => {
    const sourcePath = skillSourcePath(skill, roots);
    const sourceExists = sourcePath ? fs.existsSync(sourcePath) : false;
    const sourceHash = sourceExists ? hashDir(sourcePath) : null;
    const clients = Object.fromEntries(Object.entries(roots).map(([client, root]) => {
      const installedPath = path.join(root, skill.name);
      const installed = fs.existsSync(installedPath);
      return [client, {
        installed,
        hash: installed ? hashDir(installedPath) : null,
        matchesSource: installed && sourceHash ? hashDir(installedPath) === sourceHash : false,
      }];
    }));
    return { id: skill.id, name: skill.name, tier: skill.tier, status: skill.status, sourceExists, sourceHash, clients };
  });
}

function readRegistry(file) {
  if (!fs.existsSync(file)) return { version: 1, projects: {} };
  return readJson(file);
}

function auditProjects(registry) {
  return Object.values(registry.projects || {}).map((project) => {
    const root = project.path || '';
    const planning = path.join(root, '.planning');
    return {
      key: project.key,
      name: project.name,
      path: root,
      exists: root ? fs.existsSync(root) : false,
      docs: {
        agents: fs.existsSync(path.join(root, 'AGENTS.md')),
        claude: fs.existsSync(path.join(root, 'CLAUDE.md')),
        gemini: fs.existsSync(path.join(root, '.gemini', 'GEMINI.md')),
      },
      planning: fs.existsSync(planning),
      controlPlane: fs.existsSync(path.join(planning, 'agent-control-plane.json')),
    };
  });
}

function installApprovedSkills(manifest, options) {
  const roots = clientRoots(options.home);
  const targets = targetClients(options.target);
  const actions = [];
  const errors = [];

  for (const skill of manifest.skills.filter((item) => item.status === 'approved')) {
    const src = skillSourcePath(skill, roots);
    if (!src || !fs.existsSync(src)) {
      errors.push({ skill: skill.name, error: 'approved source missing' });
      continue;
    }
    for (const target of targets) {
      const dst = path.join(roots[target], skill.name);
      const alreadyCurrent = fs.existsSync(dst) && hashDir(dst) === hashDir(src);
      if (alreadyCurrent) {
        actions.push({ skill: skill.name, target, action: 'up-to-date' });
        continue;
      }
      actions.push({ skill: skill.name, target, action: options.apply ? 'copied' : 'would-copy' });
      if (options.apply) {
        assertInside(roots[target], dst);
        fs.rmSync(dst, { recursive: true, force: true });
        copyDir(src, dst);
      }
    }
  }
  return { applied: options.apply, actions, errors };
}

function rolloutProjects(manifest, registry, options) {
  const projects = auditProjects(registry);
  const actions = [];
  const errors = [];
  for (const project of projects) {
    if (!project.exists) {
      actions.push({ key: project.key, path: project.path, action: 'missing-project' });
      continue;
    }
    const pointer = path.join(project.path, '.planning', 'agent-control-plane.json');
    actions.push({ key: project.key, path: project.path, action: project.controlPlane ? 'up-to-date' : (options.apply ? 'written' : 'would-write') });
    if (options.apply && !project.controlPlane) {
      try {
        writeJson(pointer, {
          version: 1,
          managedBy: 'Pipeline Setupper',
          manifestVersion: manifest.version,
          manifest: path.resolve(options.manifest),
          updatedAt: new Date().toISOString(),
          requiredClients: manifest.policy && manifest.policy.targetClients || ['claude', 'codex', 'gemini'],
        });
      } catch (error) {
        errors.push({ key: project.key, error: error.message });
      }
    }
  }
  return { applied: options.apply, actions, errors };
}

function buildAudit(options) {
  const manifest = readJson(options.manifest);
  const validation = validateManifest(manifest);
  const registry = readRegistry(options.registry);
  const roots = clientRoots(options.home);
  return {
    kind: 'agent-skill-supply-chain',
    generatedAt: new Date().toISOString(),
    manifest: options.manifest,
    registry: options.registry,
    validation,
    clients: Object.fromEntries(Object.entries(roots).map(([client, root]) => [client, { root, exists: fs.existsSync(root) }])),
    skills: validation.ok ? auditSkills(manifest, roots) : [],
    externalCandidates: manifest.externalCandidates || [],
    projects: auditProjects(registry),
  };
}

function printHuman(result) {
  if (result.kind === 'agent-skill-supply-chain') {
    const missing = result.skills.flatMap((skill) => Object.entries(skill.clients)
      .filter(([, state]) => !state.installed)
      .map(([client]) => `${client}/${skill.name}`));
    console.log('Agent Skill Supply Chain Audit');
    console.log(`validation: ${result.validation.ok ? 'PASS' : 'FAIL'}`);
    console.log(`skills: ${result.skills.length}`);
    console.log(`missing installs: ${missing.length ? missing.join(', ') : 'none'}`);
    console.log(`projects: ${result.projects.length}`);
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

function run(options) {
  const manifest = readJson(options.manifest);
  const validation = validateManifest(manifest);
  if (!validation.ok) return { kind: 'agent-skill-supply-chain-error', validation };

  if (options.command === 'install-skills') return installApprovedSkills(manifest, options);
  if (options.command === 'rollout-projects') return rolloutProjects(manifest, readRegistry(options.registry), options);
  return buildAudit(options);
}

function main() {
  try {
    const options = parseArgs(process.argv);
    const result = run(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else printHuman(result);
    if (result.validation && !result.validation.ok) process.exit(2);
    if (result.errors && result.errors.length) process.exit(1);
  } catch (error) {
    process.stderr.write(`agent-skill-supply-chain failed: ${error.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  auditProjects,
  auditSkills,
  buildAudit,
  installApprovedSkills,
  parseArgs,
  rolloutProjects,
  run,
  validateManifest,
};
