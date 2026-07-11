#!/usr/bin/env node
'use strict';

/**
 * T014 (004-elt-selfdrive) — verify-first spike.
 *
 * Confirms native Claude Code primitives against the INSTALLED runtime
 * (not changelog text) so F-rotate (T006/T007) builds on what actually
 * exists. Two sources:
 *  - `claude --help` / `claude agents --help` — CLI flags, cheap and fast.
 *  - a minimal ASCII-string scan of the resolved claude.exe — hook event
 *    names and Notification subtypes aren't in --help output at all, but
 *    the binary embeds its own hook-name validator error text ("Not a
 *    recognized hook event. Common events: ...") plus every event name as
 *    a literal string, so scanning it is a legitimate live-runtime check.
 *
 * Writes specs/004-elt-selfdrive/primitives.md. Re-run after CLI upgrades
 * — the doc is a snapshot, not a live gate (claude install location/version
 * varies per machine, so this script is NOT wired into doctor.test.js;
 * only its pure parsing functions are, via synthetic fixtures).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { claudeExe } = require('./fleet/providers');

const FLAG_CHECKS = [
  { id: '--session-id', re: /--session-id\s*<uuid>/ },
  { id: '-r/--resume', re: /-r,\s*--resume/ },
  { id: '-c/--continue', re: /-c,\s*--continue/ },
  { id: '--fork-session', re: /--fork-session/ },
  { id: '--bg/--background', re: /--bg,\s*--background/ },
  { id: '--effort', re: /--effort\s*<level>/ },
  { id: '--fallback-model', re: /--fallback-model\s*<model>/ },
];

const AGENTS_SUBCOMMAND_CHECK = { id: 'claude agents (--json)', re: /--json\s+Print active sessions/ };

const HOOK_EVENT_CHECKS = [
  'PreToolUse', 'PostToolUse', 'Notification', 'UserPromptSubmit',
  'SessionStart', 'SessionEnd', 'Stop', 'SubagentStop', 'PreCompact',
];
const NOTIFICATION_SUBTYPE_CHECKS = ['agent_needs_input', 'agent_completed'];
const ENV_CHECKS = ['MAX_THINKING_TOKENS'];

function parseHelpFlags(helpText, checks) {
  const out = {};
  for (const c of checks) out[c.id] = c.re.test(helpText);
  return out;
}

// Minimal `strings` reimplementation: printable ASCII runs of length >= minLen.
function extractStrings(buf, minLen = 4) {
  const out = [];
  let cur = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 32 && b < 127) cur.push(b);
    else { if (cur.length >= minLen) out.push(Buffer.from(cur).toString('ascii')); cur = []; }
  }
  if (cur.length >= minLen) out.push(Buffer.from(cur).toString('ascii'));
  return out;
}

function scanTokens(strings, tokens) {
  const set = new Set(strings);
  const out = {};
  for (const t of tokens) out[t] = set.has(t);
  return out;
}

function renderPrimitivesMd(results) {
  const lines = [
    '# 004-elt-selfdrive — verified native primitives (T014)',
    '',
    '> Live probe against the installed Claude Code CLI — see `tools/probe-primitives.js`.',
    '> Snapshot, not a gate: re-run after CLI upgrades (`node tools/probe-primitives.js`).',
    '',
    `Version: ${results.version || 'unknown'}`,
    '',
    '| primitive | confirmed | source |',
    '|---|---|---|',
  ];
  for (const row of results.rows) {
    const mark = row.confirmed === null ? 'unknown' : row.confirmed ? 'confirmed' : 'absent';
    lines.push(`| ${row.id} | ${mark} | ${row.source} |`);
  }
  return lines.join('\n') + '\n';
}

function probe({ helpText, agentsHelpText, exeStrings, version } = {}) {
  const flags = parseHelpFlags(helpText || '', FLAG_CHECKS);
  const agentsOk = AGENTS_SUBCOMMAND_CHECK.re.test(agentsHelpText || '');
  const hooks = exeStrings ? scanTokens(exeStrings, HOOK_EVENT_CHECKS) : null;
  const notif = exeStrings ? scanTokens(exeStrings, NOTIFICATION_SUBTYPE_CHECKS) : null;
  const env = exeStrings ? scanTokens(exeStrings, ENV_CHECKS) : null;

  const rows = [];
  for (const c of FLAG_CHECKS) rows.push({ id: c.id, confirmed: flags[c.id], source: '`claude --help`' });
  rows.push({ id: AGENTS_SUBCOMMAND_CHECK.id, confirmed: agentsOk, source: '`claude agents --help`' });
  for (const k of HOOK_EVENT_CHECKS) {
    rows.push({ id: `hook: ${k}`, confirmed: hooks ? hooks[k] : null, source: hooks ? 'binary string scan' : 'binary unresolved' });
  }
  for (const k of NOTIFICATION_SUBTYPE_CHECKS) {
    rows.push({ id: `Notification.notification_type: ${k}`, confirmed: notif ? notif[k] : null, source: notif ? 'binary string scan' : 'binary unresolved' });
  }
  for (const k of ENV_CHECKS) {
    rows.push({ id: `env: ${k}`, confirmed: env ? env[k] : null, source: env ? 'binary string scan' : 'binary unresolved' });
  }
  return { version, rows };
}

function main() {
  // claude on PATH is a .cmd shim on Windows (execFileSync needs shell:true for
  // it, which mangles quoting elsewhere in this codebase — bug #10). claudeExe()
  // resolves the shim to the real .exe next to it, spawnable without a shell.
  const bin = claudeExe();
  const run = (args) => execFileSync(bin || 'claude', args, { encoding: 'utf8', shell: !bin });

  let helpText = '', agentsHelpText = '', version = '';
  try { helpText = run(['--help']); } catch (_) {}
  try { agentsHelpText = run(['agents', '--help']); } catch (_) {}
  try { version = run(['--version']).trim(); } catch (_) {}

  let exeStrings = null;
  if (bin) { try { exeStrings = extractStrings(fs.readFileSync(bin)); } catch (_) {} }

  const results = probe({ helpText, agentsHelpText, exeStrings, version });
  const md = renderPrimitivesMd(results);
  const outPath = path.join(__dirname, '..', 'specs', '004-elt-selfdrive', 'primitives.md');
  fs.writeFileSync(outPath, md);
  console.log('wrote ' + path.relative(process.cwd(), outPath));
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  parseHelpFlags, extractStrings, scanTokens, renderPrimitivesMd, probe,
  FLAG_CHECKS, AGENTS_SUBCOMMAND_CHECK, HOOK_EVENT_CHECKS, NOTIFICATION_SUBTYPE_CHECKS, ENV_CHECKS,
};
