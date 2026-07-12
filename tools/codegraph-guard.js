#!/usr/bin/env node
'use strict';

/**
 * T009 (004-elt-selfdrive): opt-in pre-slice codegraph guard for elt-loop.ps1.
 *
 * checkCodeGraph (doctor-core, T008) already knows what a dead/stale index
 * looks like — reused here instead of re-deriving it. Opt-in via
 * .harness/harness.json `"codegraphGuard": true`; absent/false = no-op
 * (exit 0), so projects that don't lean on codegraph are unaffected.
 */

const fs = require('fs');
const path = require('path');
const { checkCodeGraph } = require('./doctor-core');

function guard(root, runner) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8')); }
  catch (_) { /* no config → treated as disabled */ }
  if (!cfg.codegraphGuard) return { ok: true, reason: 'disabled' };

  const status = checkCodeGraph(root, runner).find((c) => c.id === 'codegraph:status');
  if (!status || status.status === 'pass') return { ok: true, reason: 'healthy' };
  return { ok: false, reason: status.detail, repair: status.repair };
}

if (require.main === module) {
  const r = guard(process.cwd());
  if (!r.ok) {
    console.error(`codegraph-guard: индекс мёртв/устарел (${r.reason}) — драйвер требует живой codegraph, не тихий Read.`);
    if (r.repair) console.error(`codegraph-guard: ${r.repair}`);
    process.exit(1);
  }
  process.exit(0);
}

module.exports = { guard };
