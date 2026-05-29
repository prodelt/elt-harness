#!/usr/bin/env node
'use strict';

/**
 * tools/docs-gate.test.js — unit tests for docs-gate.js
 *
 * Tests pure classification logic (classifyFile, classifyComplexity, analyzeChanges, buildChecks)
 * without needing a real git repo.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  classifyFile,
  classifyComplexity,
  analyzeChanges,
  buildChecks,
  checkArtifact,
  toMarkdown,
} = require('./docs-gate');

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  PASS  ${name}\n`);
  } catch (err) {
    failed++;
    process.stderr.write(`  FAIL  ${name}\n    ${err.message}\n`);
  }
}

// ── classifyFile ─────────────────────────────────────────────────────────────

run('classifyFile: AGENTS.md → docs', () => {
  assert.equal(classifyFile('AGENTS.md'), 'docs');
});

run('classifyFile: CLAUDE.md → docs', () => {
  assert.equal(classifyFile('CLAUDE.md'), 'docs');
});

run('classifyFile: .gemini/GEMINI.md → docs', () => {
  assert.equal(classifyFile('.gemini/GEMINI.md'), 'docs');
});

run('classifyFile: .planning/ARCHITECTURE-2026-01-01-foo.md → docs', () => {
  assert.equal(classifyFile('.planning/ARCHITECTURE-2026-01-01-foo.md'), 'docs');
});

run('classifyFile: ADR-001-foo.md → docs', () => {
  assert.equal(classifyFile('ADR-001-foo.md'), 'docs');
});

run('classifyFile: MEMORY.md → docs', () => {
  assert.equal(classifyFile('MEMORY.md'), 'docs');
});

run('classifyFile: foo.test.js → test', () => {
  assert.equal(classifyFile('foo.test.js'), 'test');
});

run('classifyFile: foo.spec.ts → test', () => {
  assert.equal(classifyFile('foo.spec.ts'), 'test');
});

run('classifyFile: __tests__/bar.js → test', () => {
  assert.equal(classifyFile('__tests__/bar.js'), 'test');
});

run('classifyFile: hooks/ship-gate.js → hook', () => {
  assert.equal(classifyFile('hooks/ship-gate.js'), 'hook');
});

run('classifyFile: tools/docs-gate.js → tool', () => {
  assert.equal(classifyFile('tools/docs-gate.js'), 'tool');
});

run('classifyFile: src/index.ts → code', () => {
  assert.equal(classifyFile('src/index.ts'), 'code');
});

run('classifyFile: package.json → other', () => {
  assert.equal(classifyFile('package.json'), 'other');
});

// ── classifyComplexity ────────────────────────────────────────────────────────

run('classifyComplexity: 0 code → TRIVIAL', () => {
  assert.equal(classifyComplexity({ code: 0, tool: 0, hook: 0 }), 'TRIVIAL');
});

run('classifyComplexity: 1 code → TRIVIAL', () => {
  assert.equal(classifyComplexity({ code: 1, tool: 0, hook: 0 }), 'TRIVIAL');
});

run('classifyComplexity: 2 code → MEDIUM', () => {
  assert.equal(classifyComplexity({ code: 2, tool: 0, hook: 0 }), 'MEDIUM');
});

run('classifyComplexity: 6 code → MEDIUM', () => {
  assert.equal(classifyComplexity({ code: 6, tool: 0, hook: 0 }), 'MEDIUM');
});

run('classifyComplexity: 7 code → COMPLEX', () => {
  assert.equal(classifyComplexity({ code: 7, tool: 0, hook: 0 }), 'COMPLEX');
});

run('classifyComplexity: 1 tool → MEDIUM', () => {
  assert.equal(classifyComplexity({ code: 0, tool: 1, hook: 0 }), 'MEDIUM');
});

run('classifyComplexity: 3 tools → COMPLEX', () => {
  assert.equal(classifyComplexity({ code: 0, tool: 3, hook: 0 }), 'COMPLEX');
});

run('classifyComplexity: 2 hooks → COMPLEX', () => {
  assert.equal(classifyComplexity({ code: 0, tool: 0, hook: 2 }), 'COMPLEX');
});

// ── analyzeChanges ────────────────────────────────────────────────────────────

run('analyzeChanges: empty → TRIVIAL, no docs, no code', () => {
  const a = analyzeChanges([], true);
  assert.equal(a.complexity, 'TRIVIAL');
  assert.equal(a.codeFiles.length, 0);
  assert.equal(a.docsFiles.length, 0);
  assert.equal(a.noChanges, true);
});

run('analyzeChanges: 1 code file, no docs → TRIVIAL', () => {
  const a = analyzeChanges([{ file: 'src/index.js', status: 'M' }], true);
  assert.equal(a.complexity, 'TRIVIAL');
  assert.equal(a.hasDocsDelta, false);
});

run('analyzeChanges: 5 code files, no docs → MEDIUM', () => {
  const files = [1, 2, 3, 4, 5].map((n) => ({ file: `src/module${n}.js`, status: 'M' }));
  const a = analyzeChanges(files, true);
  assert.equal(a.complexity, 'MEDIUM');
  assert.equal(a.hasDocsDelta, false);
});

run('analyzeChanges: 7+ code files, no docs → COMPLEX', () => {
  const files = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ file: `src/mod${n}.js`, status: 'M' }));
  const a = analyzeChanges(files, true);
  assert.equal(a.complexity, 'COMPLEX');
  assert.equal(a.hasDocsDelta, false);
});

run('analyzeChanges: 5 code + AGENTS.md → MEDIUM + hasDocsDelta', () => {
  const files = [
    ...([1, 2, 3, 4, 5].map((n) => ({ file: `src/mod${n}.js`, status: 'M' }))),
    { file: 'AGENTS.md', status: 'M' },
  ];
  const a = analyzeChanges(files, true);
  assert.equal(a.complexity, 'MEDIUM');
  assert.equal(a.hasDocsDelta, true);
  assert.deepEqual(a.docsFiles, ['AGENTS.md']);
});

run('analyzeChanges: only test files → testOnly=true', () => {
  const files = [
    { file: 'tools/docs-gate.test.js', status: 'M' },
    { file: 'src/foo.spec.ts', status: 'M' },
  ];
  const a = analyzeChanges(files, true);
  assert.equal(a.testOnly, true);
  assert.equal(a.complexity, 'TRIVIAL');
});

run('analyzeChanges: tools/*.js file → MEDIUM threshold', () => {
  const a = analyzeChanges([{ file: 'tools/docs-gate.js', status: 'M' }], true);
  assert.equal(a.complexity, 'MEDIUM');
});

run('analyzeChanges: 3+ tools/*.js → COMPLEX', () => {
  const files = ['tools/a.js', 'tools/b.js', 'tools/c.js'].map((f) => ({ file: f, status: 'M' }));
  const a = analyzeChanges(files, true);
  assert.equal(a.complexity, 'COMPLEX');
});

// ── buildChecks ───────────────────────────────────────────────────────────────

run('buildChecks: no changes → pass', () => {
  const a = analyzeChanges([], true);
  const { summary } = buildChecks(a);
  assert.equal(summary.status, 'pass');
});

run('buildChecks: test-only → pass', () => {
  const a = analyzeChanges([{ file: 'foo.test.js', status: 'M' }], true);
  const { checks, summary } = buildChecks(a);
  assert.equal(summary.status, 'pass');
  assert.ok(checks.some((c) => c.id === 'docs:test-only'));
});

run('buildChecks: TRIVIAL, no docs → pass', () => {
  const a = analyzeChanges([{ file: 'src/index.js', status: 'M' }], true);
  const { summary } = buildChecks(a);
  assert.equal(summary.status, 'pass');
});

run('buildChecks: MEDIUM, no docs → warn', () => {
  const files = [1, 2, 3].map((n) => ({ file: `src/mod${n}.js`, status: 'M' }));
  const a = analyzeChanges(files, true);
  const { checks, summary } = buildChecks(a);
  assert.equal(summary.status, 'warn');
  assert.ok(checks.some((c) => c.id === 'docs:delta' && c.status === 'warn'));
});

run('buildChecks: COMPLEX, no docs → fail', () => {
  const files = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ file: `src/mod${n}.js`, status: 'M' }));
  const a = analyzeChanges(files, true);
  const { checks, summary } = buildChecks(a);
  assert.equal(summary.status, 'fail');
  assert.ok(checks.some((c) => c.id === 'docs:delta' && c.status === 'fail'));
});

run('buildChecks: COMPLEX + AGENTS.md → pass', () => {
  const files = [
    ...([1, 2, 3, 4, 5, 6, 7].map((n) => ({ file: `src/mod${n}.js`, status: 'M' }))),
    { file: 'AGENTS.md', status: 'M' },
  ];
  const a = analyzeChanges(files, true);
  const { summary } = buildChecks(a);
  assert.equal(summary.status, 'pass');
});

run('buildChecks: AGENTS.md missing → warns docs:canonical', () => {
  const a = analyzeChanges([{ file: 'src/index.js', status: 'M' }], false);
  const { checks } = buildChecks(a);
  assert.ok(checks.some((c) => c.id === 'docs:canonical' && c.status === 'warn'));
});

run('buildChecks: tools/*.js changed, no docs → MEDIUM warn', () => {
  const a = analyzeChanges([{ file: 'tools/docs-gate.js', status: 'A' }], true);
  const { summary } = buildChecks(a);
  assert.equal(summary.status, 'warn');
});

run('buildChecks: .planning/ARCHITECTURE-*.md counts as docs delta', () => {
  const files = [
    ...([1, 2, 3, 4, 5, 6, 7].map((n) => ({ file: `src/mod${n}.js`, status: 'M' }))),
    { file: '.planning/ARCHITECTURE-2026-05-27-docs-gate.md', status: 'A' },
  ];
  const a = analyzeChanges(files, true);
  const { summary } = buildChecks(a);
  assert.equal(summary.status, 'pass');
});

// ── checkArtifact ─────────────────────────────────────────────────────────────

run('checkArtifact: missing file → ok=false', () => {
  const result = checkArtifact(path.join(os.tmpdir(), 'nonexistent-' + Date.now()));
  assert.equal(result.ok, false);
});

run('checkArtifact: valid fresh file → ok=true, stale=false', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-gate-test-'));
  const planDir = path.join(dir, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  const report = { generatedAt: new Date().toISOString(), summary: { status: 'pass' }, checks: [] };
  fs.writeFileSync(path.join(planDir, 'docs-gate-latest.json'), JSON.stringify(report));
  const result = checkArtifact(dir);
  assert.equal(result.ok, true);
  assert.equal(result.stale, false);
  fs.rmSync(dir, { recursive: true });
});

run('checkArtifact: stale file (>24h) → ok=true, stale=true', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-gate-stale-'));
  const planDir = path.join(dir, '.planning');
  fs.mkdirSync(planDir, { recursive: true });
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const report = { generatedAt: old, summary: { status: 'pass' }, checks: [] };
  fs.writeFileSync(path.join(planDir, 'docs-gate-latest.json'), JSON.stringify(report));
  const result = checkArtifact(dir);
  assert.equal(result.ok, true);
  assert.equal(result.stale, true);
  fs.rmSync(dir, { recursive: true });
});

// ── toMarkdown ────────────────────────────────────────────────────────────────

run('toMarkdown: renders summary and checks', () => {
  const report = {
    generatedAt: '2026-05-27T10:00:00.000Z',
    projectRoot: '/project',
    complexity: 'COMPLEX',
    codeChanged: ['src/a.js', 'src/b.js'],
    docsChanged: [],
    summary: { status: 'fail', pass: 1, warn: 0, fail: 1 },
    checks: [
      { id: 'docs:delta', status: 'fail', detail: 'COMPLEX change but no docs delta', repair: 'Update AGENTS.md' },
      { id: 'docs:canonical', status: 'pass', detail: 'AGENTS.md exists', repair: '' },
    ],
  };
  const md = toMarkdown(report);
  assert.ok(md.includes('# Docs Gate'));
  assert.ok(md.includes('**FAIL**'));
  assert.ok(md.includes('docs:delta'));
  assert.ok(md.includes('docs:canonical'));
});

// ── Summary ───────────────────────────────────────────────────────────────────

process.stdout.write('\n');
process.stdout.write(`docs-gate tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
