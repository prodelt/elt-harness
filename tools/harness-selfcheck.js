#!/usr/bin/env node
'use strict';

/**
 * T010 (004-elt-selfdrive): watchdog for the harness's own oracle.
 *
 * Precedent is real (`3e73423` — the harness caught and fixed its own bug).
 * Runs the project's own oracle (`.harness/harness.json` `oracle` — on this
 * repo that already IS "doctor.test.js + fleet tests", no need to hardcode
 * paths that only make sense here). Red oracle → mechanically opens a
 * self-heal slice (`specs/NNN-selfheal/tasks.md`) and logs a marker in
 * run-log, same append mechanism as `elt.js`'s red-stop. Green → no-op.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const runLog = require('./run-log');

function loadHarnessConfig(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, '.harness', 'harness.json'), 'utf8')); }
  catch (_) { return null; }
}

// 024 T001: четвёртая копия диспетчера снята — запуск идёт через общий `tools/shell-run.js`.
function defaultRunner(cmd, shell, cwd) {
  return require('./shell-run').runShell(cmd, shell, { cwd }).code;
}

function nextSelfhealDir(root) {
  const specsDir = path.join(root, 'specs');
  let max = 0;
  let existing = null;
  try {
    for (const d of fs.readdirSync(specsDir)) {
      const m = d.match(/^(\d+)-/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
      if (d.endsWith('-selfheal')) existing = d;
    }
  } catch (_) { /* no specs/ yet — start at 001 */ }
  // Reuse the existing self-heal spec (keeps piling T00X slices into one
  // file) instead of minting a fresh NNN-selfheal dir on every red run.
  if (existing) return path.join(specsDir, existing);
  return path.join(specsDir, String(max + 1).padStart(3, '0') + '-selfheal');
}

function writeSelfhealSlice(root, oracleCmd) {
  const dir = nextSelfhealDir(root);
  const tasksFile = path.join(dir, 'tasks.md');
  fs.mkdirSync(dir, { recursive: true });

  let body = '';
  let nextNum = 1;
  if (fs.existsSync(tasksFile)) {
    body = fs.readFileSync(tasksFile, 'utf8');
    const ids = [...body.matchAll(/\*\*T(\d+)\*\*/g)].map((m) => parseInt(m[1], 10));
    if (ids.length) nextNum = Math.max(...ids) + 1;
  } else {
    body = `# ${path.basename(dir)} — Self-heal · tasks\n\n> Автосоздано \`harness-selfcheck.js\` (T010) — харнесс сам себя чинит.\n\n`;
  }

  const id = 'T' + String(nextNum).padStart(3, '0');
  const date = new Date().toISOString().slice(0, 10);
  body += `- [ ] **${id}** Харнесс-оракул красный (${date}): почини \`${oracleCmd}\`.\n`;
  fs.writeFileSync(tasksFile, body, 'utf8');
  return { dir, tasksFile, id };
}

function appendRunLog(root, entry) {
  runLog.appendRunLog(root, entry);
}

function selfcheck(root, runner) {
  const run = runner || defaultRunner;
  const cfg = loadHarnessConfig(root);
  if (!cfg || !cfg.oracle) return { ok: true, reason: 'no-harness-config' };

  const exit = run(cfg.oracle, cfg.shell, root);
  if (exit === 0) return { ok: true, exit };

  const slice = writeSelfhealSlice(root, cfg.oracle);
  appendRunLog(root, {
    task: null,
    status: 'harness-selfcheck-red',
    oracle: { cmd: cfg.oracle, exit },
    selfheal: slice.id,
    selfhealFile: path.relative(root, slice.tasksFile).replace(/\\/g, '/'),
  });
  return { ok: false, exit, slice };
}

if (require.main === module) {
  const r = selfcheck(process.cwd());
  if (!r.ok) {
    console.error(`harness-selfcheck: оракул харнесса красный (exit ${r.exit}) — заведён слайс ${r.slice.id} в ${path.relative(process.cwd(), r.slice.tasksFile)}`);
    process.exit(1);
  }
  console.error(`harness-selfcheck: ${r.reason === 'no-harness-config' ? 'нет harness.json — no-op' : 'оракул харнесса зелёный'}`);
  process.exit(0);
}

module.exports = { selfcheck, writeSelfhealSlice, nextSelfhealDir, appendRunLog };
