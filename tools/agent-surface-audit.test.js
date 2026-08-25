#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  browserProbe,
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
  const bin = path.join(home, '.claude', 'bin');
  write(path.join(bin, 'agent-browser.cmd'), '@echo agent-browser 0.0.0-test\n');
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH || ''}`;
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
  write(path.join(home, '.claude', 'skills', 'agent-browser', 'SKILL.md'), '---\nname: agent-browser\ndescription: Browser automation\n---\n');
  write(path.join(home, '.codex', 'skills', 'agent-browser', 'SKILL.md'), '---\nname: agent-browser\ndescription: Browser automation\n---\n');
  write(path.join(home, '.gemini', 'skills', 'agent-browser', 'SKILL.md'), '---\nname: agent-browser\ndescription: Browser automation\n---\n');
  return home;
}

// Проба agent-browser ЗАДАНА фикстурой, а не берётся с машины: иначе тест утверждал бы
// «браузерная поверхность в порядке» только там, где CLI установлен, и краснел в CI по
// причине, не имеющей отношения к проверяемому коду.
const BROWSER_AVAILABLE = () => ({ status: 'available', version: 'agent-browser 0.33.2 (fixture)' });
const BROWSER_MISSING = () => ({ status: 'missing', error: 'agent-browser not installed (fixture)' });

function runFastAudit(root, home, browserProbe = BROWSER_AVAILABLE) {
  return runAudit({ root, home, browserProbe });
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
  const report = runFastAudit(root, home);
  assert.equal(report.clients.length, 3);
  assert.equal(report.clients.find((client) => client.client === 'claude').skillCount, 2);
  assert.equal(report.browser.status, 'pass');
  assert.equal(report.browser.browserSkillCount, 3);
  assert.equal(report.parity.find((client) => client.client === 'codex').unsupportedConfiguredEvents.length, 0);
  assert.equal(report.summary.unexplainedGaps.length, 0);
}

// Вторая ветка того же контракта: без CLI поверхность обязана быть `warn` и попасть в
// незакрытые пробелы. Раньше проверялась ровно одна ветка — та, что случайно совпадала со
// средой разработчика.
function testAuditReportsWarnWhenBrowserCliMissing() {
  const root = tempRoot('agent-surface-root');
  const home = createHome();
  const report = runFastAudit(root, home, BROWSER_MISSING);
  assert.equal(report.browser.status, 'warn', 'без CLI браузерная поверхность не может быть pass');
  assert.equal(report.browser.browserSkillCount, 3, 'скилы на месте — отличается только CLI');
  assert.ok(report.summary.unexplainedGaps.includes('browser:agent-browser'),
    'пробел обязан быть назван, а не растворён в общем отчёте');
}

function testBrowserProbeUsesPlatformNativeInvocation() {
  const calls = [];
  const commandStatusFn = (command, args, cwd) => {
    calls.push({ command, args, cwd });
    return { status: 'available' };
  };
  browserProbe('C:\\repo', { platform: 'win32', commandStatusFn })(['--version']);
  browserProbe('/repo', { platform: 'linux', commandStatusFn })(['skills', 'list']);
  assert.deepEqual(calls, [
    { command: 'cmd.exe', args: ['/c', 'agent-browser', '--version'], cwd: 'C:\\repo' },
    { command: 'agent-browser', args: ['skills', 'list'], cwd: '/repo' },
  ], 'Linux обязан вызывать agent-browser напрямую, Windows — через cmd.exe shim');
}

function testAuditTreatsDeclaredUnsupportedEventsAsFallbacks() {
  const root = tempRoot('agent-surface-root');
  const home = createHome();
  write(path.join(home, '.codex', 'hooks.json'), JSON.stringify({
    Notification: [{ command: 'node unsupported.js' }],
  }));
  const report = runFastAudit(root, home);
  assert.equal(report.summary.status, 'pass');
  assert.equal(report.summary.unexplainedGaps.includes('codex:Notification'), false);
}

function testReportsWriteJsonAndMarkdown() {
  const root = tempRoot('agent-surface-write');
  const home = createHome();
  const report = runFastAudit(root, home);
  const files = writeReports(report, root);
  assert.equal(fs.existsSync(files.jsonFile), true);
  assert.equal(fs.existsSync(files.mdFile), true);
  assert.match(fs.readFileSync(files.mdFile, 'utf8'), /Agent Surface Audit/);
}

function testMarkdownListsFallbackContracts() {
  const root = tempRoot('agent-surface-markdown');
  const home = createHome();
  const report = runFastAudit(root, home);
  const markdown = formatMarkdown(report);
  assert.match(markdown, /Fallback Contracts/);
  assert.match(markdown, /Codex\/Gemini unsupported Notification\/FileChanged/);
  assert.match(markdown, /agent-browser/);
}

function main() {
  testParseArgs();
  testExtractHookCommandsHandlesNestedHooks();
  testAuditReportsClientSurface();
  testAuditReportsWarnWhenBrowserCliMissing();
  testBrowserProbeUsesPlatformNativeInvocation();
  testAuditTreatsDeclaredUnsupportedEventsAsFallbacks();
  testReportsWriteJsonAndMarkdown();
  testMarkdownListsFallbackContracts();
  process.stdout.write('agent-surface-audit tests: PASS\n');
}

main();
