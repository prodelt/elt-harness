#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CANONICAL_DOC,
  CORE_SECTIONS,
  DOC_FILES,
  parseMarkdownSections,
  initOrSyncProjectDocs,
  verifyProjectDocs,
  auditProjectDocs,
} = require('./project-docs-core');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function tempProject(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  write(path.join(root, 'README.md'), '# Demo Tool\n\nSmall CLI utility.\n');
  return root;
}

function coreDoc(extra = '') {
  const body = CORE_SECTIONS
    .map((section) => `## ${section}\n${section} content.\n`)
    .join('\n');
  return `# Demo\n\n${body}${extra}`;
}

function testParseMarkdownSections() {
  const parsed = parseMarkdownSections('# Title\n\nIntro\n\n## Overview\nA\n\n## Stack\nB\n');
  assert.equal(parsed.preamble.trim(), '# Title\n\nIntro');
  assert.equal(parsed.sections.Overview.trim(), 'A');
  assert.equal(parsed.sections.Stack.trim(), 'B');
}

function testCreateModeBootstrapsProject() {
  const root = tempProject('project-docs-create');
  const home = path.join(root, 'home');
  const result = initOrSyncProjectDocs({ root, home, mode: 'init', now: new Date('2026-05-08T12:00:00Z') });
  assert.equal(result.mode, 'create');
  assert.equal(result.success, true);
  DOC_FILES.forEach((relative) => assert.equal(fs.existsSync(path.join(root, relative)), true));
  assert.equal(fs.existsSync(path.join(root, '.rag', 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(root, '.planning')), true);
  assert.equal(fs.existsSync(path.join(home, '.claude', 'projects-registry.json')), true);
  assert.equal(verifyProjectDocs(root).ok, true);
}

function testNoopModeDoesNotRewrite() {
  const root = tempProject('project-docs-noop');
  DOC_FILES.forEach((relative) => write(path.join(root, relative), coreDoc()));
  const before = DOC_FILES.map((relative) => read(path.join(root, relative)));
  const result = initOrSyncProjectDocs({ root, home: path.join(root, 'home'), mode: 'init' });
  const after = DOC_FILES.map((relative) => read(path.join(root, relative)));
  assert.equal(result.mode, 'noop');
  assert.deepEqual(after, before);
}

function testUpgradePreservesProtectedBlocks() {
  const root = tempProject('project-docs-upgrade');
  write(path.join(root, 'AGENTS.md'), coreDoc('\n<!-- project-docs:protected:start local -->\nLocal gotcha.\n<!-- project-docs:protected:end local -->\n'));
  write(path.join(root, 'CLAUDE.md'), '# Old\n\n## Overview\nDifferent.\n');
  const result = initOrSyncProjectDocs({ root, home: path.join(root, 'home'), mode: 'sync' });
  const agents = read(path.join(root, 'AGENTS.md'));
  const gemini = read(path.join(root, '.gemini', 'GEMINI.md'));
  assert.equal(result.mode, 'upgrade');
  assert.match(agents, /Local gotcha\./);
  assert.match(gemini, /Local gotcha\./);
  assert.equal(verifyProjectDocs(root).ok, true);
}

function testSyncMakesCoreSectionsIdentical() {
  const root = tempProject('project-docs-sync');
  write(path.join(root, 'AGENTS.md'), coreDoc('\n## Codex Notes\nKeep me.\n'));
  write(path.join(root, 'CLAUDE.md'), coreDoc().replace('Stack content.', 'Wrong stack.'));
  write(path.join(root, '.gemini', 'GEMINI.md'), coreDoc());
  const result = initOrSyncProjectDocs({ root, home: path.join(root, 'home'), mode: 'sync' });
  const verification = verifyProjectDocs(root);
  assert.equal(result.success, true);
  assert.equal(verification.ok, true);
  assert.equal(verification.coreIdentical, true);
  assert.match(read(path.join(root, 'AGENTS.md')), /Keep me\./);
}

function testAgentsMdWinsWhenSectionCoverageTies() {
  const root = tempProject('project-docs-canonical');
  write(path.join(root, CANONICAL_DOC), coreDoc().replace('Stack content.', 'Canonical stack.'));
  write(path.join(root, 'CLAUDE.md'), coreDoc().replace('Stack content.', 'Stale stack.'));
  write(path.join(root, '.gemini', 'GEMINI.md'), coreDoc().replace('Stack content.', 'Other stack.'));
  const result = initOrSyncProjectDocs({ root, home: path.join(root, 'home'), mode: 'sync' });
  assert.equal(result.success, true);
  DOC_FILES.forEach((relative) => {
    assert.match(read(path.join(root, relative)), /Canonical stack\./);
  });
}

function testSyncPreservesPreambleRules() {
  const root = tempProject('project-docs-preamble');
  write(path.join(root, 'AGENTS.md'), `# Local Agent Rules\n\nDo not erase this.\n\n${coreDoc()}`);
  write(path.join(root, 'CLAUDE.md'), coreDoc().replace('Stack content.', 'Different stack.'));
  write(path.join(root, '.gemini', 'GEMINI.md'), coreDoc());
  const result = initOrSyncProjectDocs({ root, home: path.join(root, 'home'), mode: 'sync' });
  assert.equal(result.success, true);
  assert.match(read(path.join(root, 'AGENTS.md')), /Do not erase this\./);
}

function testAuditFlagsMemoryLeak() {
  const root = tempProject('project-docs-audit-memory-leak');
  write(path.join(root, 'CLAUDE.md'), coreDoc().replace('Memory content.', 'Memory content.\n- 2026-01-01: did something'));
  const result = auditProjectDocs(root, { home: path.join(root, 'home') });
  assert.ok(result.findings.some((f) => f.code === 'memory-leak'));
}

function testAuditFlagsBloatAndMissingDoc() {
  const root = tempProject('project-docs-audit');
  write(path.join(root, 'CLAUDE.md'), coreDoc('\n' + 'extra line\n'.repeat(260)));
  const result = auditProjectDocs(root, { home: path.join(root, 'home') });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.findings.some((f) => f.code === 'bloat' && f.severity === 'fail'));
  assert.ok(result.findings.some((f) => f.code === 'missing-doc'));
}

function testAuditPassesCleanSyncedProject() {
  const root = tempProject('project-docs-audit-clean');
  initOrSyncProjectDocs({ root, home: path.join(root, 'home'), mode: 'init' });
  const result = auditProjectDocs(root, { home: path.join(root, 'home') });
  assert.equal(result.status, 'PASS');
  assert.equal(result.findings.length, 0);
}

function main() {
  testParseMarkdownSections();
  testCreateModeBootstrapsProject();
  testNoopModeDoesNotRewrite();
  testUpgradePreservesProtectedBlocks();
  testSyncMakesCoreSectionsIdentical();
  testAgentsMdWinsWhenSectionCoverageTies();
  testSyncPreservesPreambleRules();
  testAuditFlagsBloatAndMissingDoc();
  testAuditPassesCleanSyncedProject();
  testAuditFlagsMemoryLeak();
  process.stdout.write('project-docs tests: PASS\n');
}

main();
