#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  extractHookCommands,
  formatMarkdown,
  parseArgs,
  runAudit,
  writeReports,
} = require('./agent-surface-audit');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function tempRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function createHome() {
  const home = tempRoot('agent-surface-home');
  write(path.join(home, '.claude', 'settings.json'), JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ command: 'node session-start.js' }] }],
      Notification: [{ command: 'node notify.js' }],
    },
  }));
  write(path.join(home, '.codex', 'hooks.json'), JSON.stringify({
    SessionStart: [{ command: 'node session-start.js' }],
    Stop: [{ command: 'node stop.js' }],
  }));
  write(path.join(home, '.gemini', 'settings.json'), JSON.stringify({
    hooks: {
      SessionStart: [{ command: 'node session-start.js' }],
    },
  }));
  write(path.join(home, '.claude', 'skills', 'pipeline', 'SKILL.md'), '---\nname: pipeline\naliases: [pipe]\n---\n');
  write(path.join(home, '.codex', 'skills', 'pipeline', 'SKILL.md'), '---\nname: pipeline\n---\n');
  write(path.join(home, '.gemini', 'skills', 'pipeline', 'SKILL.md'), '---\nname: pipeline\n---\n');
  return home;
}

function testParseArgs() {
  const parsed = parseArgs(['node', 'agent-surface-audit.js', '--root', 'C:\\x', '--home', 'C:\\h', '--markdown', '--no-write']);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.root, 'C:\\x');
  assert.equal(parsed.value.home, 'C:\\h');
  assert.equal(parsed.value.markdown, true);
  assert.equal(parsed.value.write, false);
}

function testExtractHookCommandsHandlesNestedHooks() {
  const parsed = {
    ok: true,
    value: {
      hooks: {
        PreToolUse: {
          Bash: [{ hooks: [{ command: 'node guard.js' }] }],
        },
      },
    },
  };
  const commands = extractHookCommands(parsed);
  assert.deepEqual(commands.PreToolUse, ['node guard.js']);
}

function testAuditReportsClientSurface() {
  const root = tempRoot('agent-surface-root');
  const home = createHome();
  write(path.join(root, '.graphifyignore'), '.planning\n.rag\n.tmp\ngraphify-out\ntools/__pycache__\ntools/red-team\naudit/1c-dev-pilot\n');
  const report = runAudit({ root, home });
  assert.equal(report.clients.length, 3);
  assert.equal(report.clients.find((client) => client.client === 'claude').skillCount, 1);
  assert.equal(report.parity.find((client) => client.client === 'codex').unsupportedConfiguredEvents.length, 0);
  assert.equal(report.summary.unexplainedGaps.length, 0);
}

function testAuditFlagsUnsupportedConfiguredEvents() {
  const root = tempRoot('agent-surface-root');
  const home = createHome();
  write(path.join(home, '.codex', 'hooks.json'), JSON.stringify({
    Notification: [{ command: 'node unsupported.js' }],
  }));
  const report = runAudit({ root, home });
  assert.equal(report.summary.status, 'warn');
  assert.match(report.summary.unexplainedGaps.join(','), /codex:Notification/);
}

function testReportsWriteJsonAndMarkdown() {
  const root = tempRoot('agent-surface-write');
  const home = createHome();
  const report = runAudit({ root, home });
  const files = writeReports(report, root);
  assert.equal(fs.existsSync(files.jsonFile), true);
  assert.equal(fs.existsSync(files.mdFile), true);
  assert.match(fs.readFileSync(files.mdFile, 'utf8'), /Agent Surface Audit/);
}

function testMarkdownListsFallbackContracts() {
  const root = tempRoot('agent-surface-markdown');
  const home = createHome();
  const report = runAudit({ root, home });
  const markdown = formatMarkdown(report);
  assert.match(markdown, /Fallback Contracts/);
  assert.match(markdown, /Codex\/Gemini unsupported Notification\/FileChanged/);
}

function main() {
  testParseArgs();
  testExtractHookCommandsHandlesNestedHooks();
  testAuditReportsClientSurface();
  testAuditFlagsUnsupportedConfiguredEvents();
  testReportsWriteJsonAndMarkdown();
  testMarkdownListsFallbackContracts();
  process.stdout.write('agent-surface-audit tests: PASS\n');
}

main();
