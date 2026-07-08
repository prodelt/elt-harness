#!/usr/bin/env node
'use strict';
// Stop hook: dirty-exit gate (ELT v2). Replaces judge-closeout-gate (0 executions in
// two audits — it guarded a /pipeline state that never existed).
// Blocks ending a session that EDITED files in a harness project and left the git
// tree dirty. Deterministic, opt-in per project via .harness/harness.json.
// Escape hatches: stop_hook_active (never loops), no harness.json, no repo, no edits
// made by THIS session, clean tree.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
if (input.stop_hook_active) process.exit(0); // anti-loop: one block per stop chain

const cwd = input.cwd || process.cwd();
if (!fs.existsSync(path.join(cwd, '.harness', 'harness.json'))) process.exit(0); // opt-in only

const git = (args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
if (git(['rev-parse', '--is-inside-work-tree']).status !== 0) process.exit(0);
// .harness/ is harness metadata (run-log written post-commit) — never a reason to block
const dirty = (git(['status', '--porcelain']).stdout || '')
  .split('\n').filter((l) => l.trim() && !/^..\s+"?\.harness\//.test(l)).join('\n');
if (!dirty) process.exit(0);

// Did THIS session actually edit files under cwd? (otherwise pre-existing dirt — don't nag)
let editedHere = false;
try {
  const lines = fs.readFileSync(input.transcript_path, 'utf8').split('\n');
  const cwdNorm = cwd.replace(/\\/g, '/').toLowerCase();
  for (const line of lines) {
    if (!line.includes('"tool_use"')) continue;
    if (!/"name":\s*"(Edit|Write|MultiEdit|NotebookEdit)"/.test(line)) continue;
    const m = line.match(/"(?:file_path|notebook_path)":\s*"((?:[^"\\]|\\.)*)"/);
    if (m && m[1].replace(/\\\\/g, '/').replace(/\\/g, '/').toLowerCase().startsWith(cwdNorm)) {
      editedHere = true; break;
    }
  }
} catch { process.exit(0); } // can't read transcript → fail-open
if (!editedHere) process.exit(0);

const files = dirty.split('\n').slice(0, 10).join('\n');
process.stdout.write(JSON.stringify({
  decision: 'block',
  reason:
    `DIRTY-EXIT GATE: в этой сессии правились файлы, а дерево git осталось грязным:\n${files}\n` +
    `Закрой работу: прогони оракул и закоммить — \`node ~/.claude/bin/elt.js commit [--task Txxx]\` ` +
    `(или git add + commit вручную). Если коммитить нельзя (работа не завершена / красные тесты) — ` +
    `скажи это пользователю ЯВНО одной строкой и заверши ход снова.`,
}));
process.exit(0);
