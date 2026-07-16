#!/usr/bin/env node
// install-harness-teeth.js — drop the harness "teeth" into a target project and
// wire its .claude/settings.json. Idempotent and merge-safe (never clobbers
// existing hooks/plugins). Run FROM Pipeline Setupper (source of the hooks).
//
//   node tools/install-harness-teeth.js --root "<project>" [--gate] [--gitguard]
//   (no --gate/--gitguard flag => install both)
//
// Hooks are copied byte-identical and reference $CLAUDE_PROJECT_DIR, so no
// machine-specific path is baked into the target. ponytail: copy + JSON merge,
// no template engine, no per-repo edits.

// ponytail: deprecated (spec 005 T018). judge-closeout-gate teeth are retired;
// the ELT control plane installs its harness via project-bootstrap. Full file
// removed in T020 — the body below is dead-on-invocation.
if (require.main === module) {
  console.error(
    'DEPRECATED: install-harness-teeth.js is not an active route. The judge-closeout teeth are retired.\n' +
    '  Project setup: node tools/project-bootstrap.js apply   Code work: /elt (tools/elt.js)\n' +
    '  Migration & removal plan: specs/005-elt-control-plane-convergence/spec.md §9'
  );
  process.exit(1);
}

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '.claude', 'hooks');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const root = arg('--root');
if (!root) {
  console.error('usage: install-harness-teeth.js --root "<project>" [--gate] [--gitguard]');
  process.exit(1);
}
if (!fs.existsSync(root)) {
  console.error(`root does not exist: ${root}`);
  process.exit(1);
}

const both = !process.argv.includes('--gate') && !process.argv.includes('--gitguard');
const doGate = both || process.argv.includes('--gate');
const doGuard = both || process.argv.includes('--gitguard');

const hooksDir = path.join(root, '.claude', 'hooks');
fs.mkdirSync(hooksDir, { recursive: true });

const copied = [];
function copy(name) {
  fs.copyFileSync(path.join(SRC, name), path.join(hooksDir, name));
  copied.push(name);
}
if (doGate) copy('judge-closeout-gate.js');
if (doGuard) copy('block-dangerous-git.js');

const setPath = path.join(root, '.claude', 'settings.json');
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(setPath, 'utf8').replace(/^﻿/, ''));
} catch {
  settings = {};
}
settings.hooks = settings.hooks || {};

const wired = [];
function alreadyHas(entries, cmd) {
  // structural check — JSON.stringify(...).includes() misfires on escaped quotes
  return (entries || []).some(
    (e) => Array.isArray(e.hooks) && e.hooks.some((h) => h && h.command === cmd)
  );
}
function ensure(event, matcher, cmd) {
  settings.hooks[event] = settings.hooks[event] || [];
  if (alreadyHas(settings.hooks[event], cmd)) return; // already wired
  settings.hooks[event].push(
    matcher
      ? { matcher, hooks: [{ type: 'command', command: cmd }] }
      : { hooks: [{ type: 'command', command: cmd }] }
  );
  wired.push(matcher ? `${event}/${matcher}` : event);
}

if (doGuard) ensure('PreToolUse', 'Bash', 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-dangerous-git.js"');
if (doGate) ensure('Stop', null, 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/judge-closeout-gate.js"');

fs.writeFileSync(setPath, JSON.stringify(settings, null, 2) + '\n');

console.log(`teeth installed -> ${root}`);
console.log(`  copied: ${copied.join(', ') || '(none)'}`);
console.log(`  wired : ${wired.join(', ') || '(already present)'}`);
