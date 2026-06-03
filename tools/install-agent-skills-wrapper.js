#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WRAPPER_BASENAME = 'agent-skills';
const TARGET_SCRIPT = path.join('tools', 'agent-skill-supply-chain.js');

function normalizeForReport(file) {
  return path.resolve(file);
}

function quotePowerShellSingle(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function cmdWrapper(script) {
  return [
    '@echo off',
    'setlocal',
    `set "SCRIPT=${script}"`,
    'node "%SCRIPT%" %*',
    '',
  ].join('\r\n');
}

function ps1Wrapper(script) {
  return [
    `$Script = ${quotePowerShellSingle(script)}`,
    'node $Script @args',
    '',
  ].join('\n');
}

function wrapperTargets(home, repoRoot, includePs1 = false) {
  const bin = path.join(home, '.claude', 'bin');
  const script = path.join(repoRoot, TARGET_SCRIPT);
  const targets = [
    {
      name: `${WRAPPER_BASENAME}.cmd`,
      path: path.join(bin, `${WRAPPER_BASENAME}.cmd`),
      content: cmdWrapper(script),
    },
  ];
  if (includePs1) {
    targets.push({
      name: `${WRAPPER_BASENAME}.ps1`,
      path: path.join(bin, `${WRAPPER_BASENAME}.ps1`),
      content: ps1Wrapper(script),
    });
  }
  return targets;
}

function existingContent(file) {
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

function plannedAction(target, apply) {
  const current = existingContent(target.path);
  if (current === target.content) return 'up-to-date';
  if (current === null) return apply ? 'written' : 'would-write';
  return apply ? 'updated' : 'would-update';
}

function install(options = {}) {
  const home = path.resolve(options.home || os.homedir());
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
  const apply = options.apply === true;
  const includePs1 = options.withPs1 === true;
  const script = path.join(repoRoot, TARGET_SCRIPT);

  if (!fs.existsSync(script)) {
    throw new Error(`Cannot install wrappers; target script is missing: ${script}`);
  }

  const targets = wrapperTargets(home, repoRoot, includePs1).map((target) => ({
    target,
    result: {
      name: target.name,
      path: normalizeForReport(target.path),
      action: plannedAction(target, apply),
    },
  }));
  const ps1Path = path.join(home, '.claude', 'bin', `${WRAPPER_BASENAME}.ps1`);
  const generatedPs1 = ps1Wrapper(script);
  const stalePs1 = !includePs1 && existingContent(ps1Path) === generatedPs1
    ? [{
      target: { path: ps1Path },
      result: {
        name: `${WRAPPER_BASENAME}.ps1`,
        path: normalizeForReport(ps1Path),
        action: apply ? 'removed' : 'would-remove',
      },
    }]
    : [];

  if (apply) {
    fs.mkdirSync(path.join(home, '.claude', 'bin'), { recursive: true });
    for (const entry of targets) {
      if (entry.result.action !== 'up-to-date') {
        fs.writeFileSync(entry.target.path, entry.target.content, 'utf8');
      }
    }
    for (const entry of stalePs1) {
      fs.unlinkSync(entry.target.path);
    }
  }

  return {
    applied: apply,
    repoRoot: normalizeForReport(repoRoot),
    targetScript: normalizeForReport(script),
    wrappers: [...targets, ...stalePs1].map((entry) => entry.result),
  };
}

function parseArgs(argv) {
  const defaults = {
    apply: false,
    home: os.homedir(),
    repoRoot: path.join(__dirname, '..'),
    json: false,
    withPs1: false,
  };
  const parseNext = (index, state) => {
    if (index >= argv.length) return state;
    const arg = argv[index];
    if (arg === '--apply') return parseNext(index + 1, { ...state, apply: true });
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--with-ps1') return parseNext(index + 1, { ...state, withPs1: true });
    if (arg === '--home') {
      const home = argv[index + 1];
      if (!home) throw new Error('--home requires a path');
      return parseNext(index + 2, { ...state, home });
    }
    if (arg === '--root') {
      const repoRoot = argv[index + 1];
      if (!repoRoot) throw new Error('--root requires a path');
      return parseNext(index + 2, { ...state, repoRoot });
    }
    throw new Error(`Unknown argument: ${arg}`);
  };
  return parseNext(2, defaults);
}

function printHuman(result) {
  process.stdout.write(`agent-skills wrapper installer (${result.applied ? 'apply' : 'dry-run'})\n`);
  process.stdout.write(`target: ${result.targetScript}\n`);
  for (const wrapper of result.wrappers) {
    process.stdout.write(`${wrapper.action}: ${wrapper.path}\n`);
  }
}

function main() {
  try {
    const options = parseArgs(process.argv);
    const result = install(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else printHuman(result);
  } catch (error) {
    process.stderr.write(`install-agent-skills-wrapper failed: ${error.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  cmdWrapper,
  install,
  parseArgs,
  ps1Wrapper,
  wrapperTargets,
};
