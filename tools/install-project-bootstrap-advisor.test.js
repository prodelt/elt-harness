#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { install } = require('./install-project-bootstrap-advisor');

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-install-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [] }] } }), 'utf8');
  fs.writeFileSync(path.join(home, '.codex', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [] }] } }), 'utf8');
  return home;
}

function testInstallIsIdempotent() {
  const home = tempHome();
  const first = install({ home });
  const second = install({ home });
  assert.equal(first.claudeChanged, true);
  assert.equal(first.codexChanged, true);
  assert.equal(second.claudeChanged, false);
  assert.equal(second.codexChanged, false);
  assert.equal(fs.existsSync(first.target), true);
  const claude = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(claude.hooks.SessionStart[0].hooks.length, 1);
}

function main() {
  testInstallIsIdempotent();
  process.stdout.write('install-project-bootstrap-advisor tests: PASS\n');
}

main();
