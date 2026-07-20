#!/usr/bin/env node
'use strict';

/**
 * 006 T004: pre-run approval guard for autonomous drivers (elt-loop.ps1,
 * fleet). Same opt-in + loud-stop shape as codegraph-guard.js. Delegates
 * spec-approval status to `elt.js spec status` (T001/T002's own source of
 * truth) rather than re-deriving hash/approval logic here — one gate, no
 * drift between the CLI's per-task check and this pre-run check.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readCfg(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8')); }
  catch { return null; }
}

// specDir: explicit plan dir (fleet already knows its tasksPath — pass
// path.dirname(tasksPath)). Omit to auto-detect via `elt status` (elt-loop.ps1
// doesn't know in advance which specs/*/tasks.md `slice next` will land on).
// eltCli: override for which elt.js to shell out to — fleet.js already tracks
// its own ELT_CLI (the global deployed copy) and passes it explicitly rather
// than relying on an env var side effect.
function guard(root, specDir, eltCli) {
  const cli = eltCli || process.env.ELT_CLI || path.join(__dirname, 'elt.js');
  const cfg = readCfg(root);
  if (!cfg || !cfg.specApproval) return { ok: true, reason: cfg ? 'disabled' : 'no-config' };

  let dir = specDir;
  if (!dir) {
    const statusRun = spawnSync(process.execPath, [cli, 'status'], { cwd: root, encoding: 'utf8' });
    let status;
    try { status = JSON.parse(statusRun.stdout); } catch { return { ok: true, reason: 'no-plan' }; }
    const planFile = status.plan && status.plan.file;
    if (!planFile) return { ok: true, reason: 'no-plan' };
    dir = path.dirname(path.join(root, planFile));
  }
  if (!fs.existsSync(path.join(dir, 'spec.md'))) return { ok: true, reason: 'micro-plan' };

  const specStatusRun = spawnSync(process.execPath, [cli, 'spec', 'status', '--spec', path.relative(root, dir)], { cwd: root, encoding: 'utf8' });
  let specStatus;
  try { specStatus = JSON.parse(specStatusRun.stdout); } catch { return { ok: false, reason: 'spec-status-unreadable', specDir: dir }; }
  if (specStatus.status === 'approved') return { ok: true, reason: 'approved' };
  return { ok: false, reason: specStatus.status, specDir: dir };
}

if (require.main === module) {
  const root = process.argv[2] || process.cwd();
  const specDirArg = process.argv[3] ? path.resolve(root, process.argv[3]) : null;
  const eltCliArg = process.argv[4] || null;
  const r = guard(root, specDirArg, eltCliArg);
  if (!r.ok) {
    console.error(`approval-guard: спека не утверждена (${r.reason}${r.specDir ? ', ' + path.relative(root, r.specDir) : ''}) — elt spec approve перед автономным прогоном.`);
    process.exit(1);
  }
  process.exit(0);
}

module.exports = { guard };
