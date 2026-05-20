#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CANONICAL_DOC = 'AGENTS.md';
const DOC_FILES = [CANONICAL_DOC, 'CLAUDE.md', path.join('.gemini', 'GEMINI.md')];
const CORE_SECTIONS = ['Overview', 'Stack', 'Commands', 'Architecture', 'Gotchas', 'Current State'];
const PROTECTED_RE = /<!--\s*project-docs:protected:start\s+([A-Za-z0-9_.-]+)\s*-->[\s\S]*?<!--\s*project-docs:protected:end\s+\1\s*-->/g;

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, '/');
}

function projectKey(root) {
  const normalized = normalizePath(root).toLowerCase();
  const base = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const hash = crypto.createHash('sha1').update(normalized).digest('hex').slice(0, 8);
  return `${base || 'project'}-${hash}`;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_error) {
    return '';
  }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function parseMarkdownSections(text) {
  const matches = [...text.matchAll(/^##\s+(.+?)\s*$/gm)];
  const ranges = matches.map((match, index) => ({
    title: match[1].trim(),
    start: match.index,
    bodyStart: match.index + match[0].length,
    end: matches[index + 1] ? matches[index + 1].index : text.length,
  }));
  const sections = ranges.reduce((acc, item) => ({
    ...acc,
    [canonicalSectionTitle(item.title)]: text.slice(item.bodyStart, item.end).trim() + '\n',
  }), {});
  return { preamble: text.slice(0, ranges[0] ? ranges[0].start : text.length), sections };
}

function canonicalSectionTitle(title) {
  return CORE_SECTIONS.find((section) => new RegExp(`^${section}\\b`, 'i').test(title)) || title;
}

function extractProtectedBlocks(text) {
  return [...text.matchAll(PROTECTED_RE)].map((match) => match[0].trim());
}

function uniqueItems(items) {
  return [...new Set(items.filter(Boolean))];
}

function readDocs(root) {
  return DOC_FILES.map((relative) => {
    const file = path.join(root, relative);
    const text = readText(file);
    return { relative, file, exists: fs.existsSync(file), text, parsed: parseMarkdownSections(text) };
  });
}

function sectionScore(doc) {
  return CORE_SECTIONS.filter((section) => doc.parsed.sections[section]).length;
}

function selectSourceDoc(docs) {
  const priority = [CANONICAL_DOC, 'CLAUDE.md', path.join('.gemini', 'GEMINI.md')];
  return docs
    .map((doc) => ({ ...doc, score: sectionScore(doc), priority: priority.indexOf(doc.relative) }))
    .sort((left, right) => right.score - left.score || left.priority - right.priority)[0];
}

function inferCoreSections(root, docs) {
  const source = selectSourceDoc(docs);
  const readme = readText(path.join(root, 'README.md')).split(/\r?\n/).find((line) => line.trim()) || '# Project';
  const fallback = {
    Overview: `${readme.replace(/^#\s*/, '').trim()}.\n`,
    Stack: 'Detected from repository files; no package manifest was required for this bootstrap.\n',
    Commands: 'Run project-specific tests or doctor commands listed in this repository.\n',
    Architecture: 'Project documentation, hooks, skills, and tools live in this repository.\n',
    Gotchas: 'Preserve local rules and Windows path handling when syncing docs.\n',
    'Current State': `Docs initialized by project-docs v2 for ${path.basename(root)}.\n`,
  };
  return CORE_SECTIONS.reduce((acc, section) => ({
    ...acc,
    [section]: source.parsed.sections[section] || fallback[section],
  }), {});
}

function toolPreamble(relative, root) {
  const name = path.basename(root);
  if (relative === 'AGENTS.md') return `# ${name} - Codex Agent Instructions\n\n`;
  if (relative === 'CLAUDE.md') return `# ${name} - Claude Code Instructions\n\n`;
  return `# ${name} - Gemini Instructions\n\n`;
}

function nonCoreSections(doc) {
  return Object.entries(doc.parsed.sections)
    .filter(([title]) => !CORE_SECTIONS.includes(title))
    .map(([title, body]) => `## ${title}\n${body.trim()}\n`)
    .join('\n');
}

function mergeProtectedBlocks(text, blocks) {
  const existing = extractProtectedBlocks(text);
  const missing = blocks.filter((block) => !existing.includes(block));
  return missing.length === 0 ? text : `${text.trim()}\n\n${missing.join('\n\n')}\n`;
}

function renderDoc(root, doc, coreSections, protectedBlocks) {
  const core = CORE_SECTIONS.map((section) => `## ${section}\n${coreSections[section].trim()}\n`).join('\n');
  const localTail = nonCoreSections(doc);
  const preamble = doc.preamble || doc.parsed.preamble || toolPreamble(doc.relative, root);
  const base = `${preamble.trim()}\n\n${core}${localTail ? `\n${localTail}` : ''}`;
  return mergeProtectedBlocks(`${base.trim()}\n`, protectedBlocks);
}

function diffSummary(relative, before, after) {
  if (!before) return { file: relative, action: 'created', beforeLines: 0, afterLines: after.split(/\r?\n/).length };
  if (before === after) return { file: relative, action: 'unchanged', beforeLines: before.split(/\r?\n/).length, afterLines: before.split(/\r?\n/).length };
  return { file: relative, action: 'updated', beforeLines: before.split(/\r?\n/).length, afterLines: after.split(/\r?\n/).length };
}

function writeChanged(file, text) {
  const before = readText(file);
  if (before === text) return false;
  writeText(file, text);
  return true;
}

function ensureRagManifest(root, now) {
  const file = path.join(root, '.rag', 'manifest.json');
  const existing = readText(file);
  const createdAt = now.toISOString();
  const manifest = existing ? existing : JSON.stringify({
    version: 1,
    project: path.basename(root),
    root: normalizePath(root),
    index_dir: '.rag/index',
    queue_file: '.rag/queue.json',
    createdAt,
  }, null, 2) + '\n';
  return writeChanged(file, manifest) ? [{ file: normalizePath(file), action: existing ? 'kept' : 'created' }] : [];
}

function ensurePlanning(root) {
  const dir = path.join(root, '.planning');
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  return existed ? [] : [{ file: normalizePath(dir), action: 'created' }];
}

function registerProject(root, home, now) {
  const file = path.join(home, '.claude', 'projects-registry.json');
  const existingText = readText(file);
  const existing = safeJson(existingText, { version: 1, projects: {} });
  const key = projectKey(root);
  const previous = existing.projects && existing.projects[key] ? existing.projects[key] : {};
  const entry = {
    ...previous,
    key,
    name: path.basename(root),
    path: normalizePath(root),
    registeredAt: previous.registeredAt || now.toISOString(),
    lastSeenAt: now.toISOString(),
  };
  const next = { ...existing, version: 1, updatedAt: now.toISOString(), projects: { ...(existing.projects || {}), [key]: entry } };
  const nextText = JSON.stringify(next, null, 2) + '\n';
  return writeChanged(file, nextText) ? [{ file: normalizePath(file), action: existingText ? 'updated' : 'created' }] : [];
}

function safeJson(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function docsMode(docs, requestedMode, verification) {
  const existingCount = docs.filter((doc) => doc.exists).length;
  if (existingCount === 0) return 'create';
  if (verification.ok && verification.coreIdentical && requestedMode === 'init') return 'noop';
  return 'upgrade';
}

function initOrSyncProjectDocs(options) {
  const root = path.resolve(options.root || process.cwd());
  const home = path.resolve(options.home || require('node:os').homedir());
  const now = options.now || new Date();
  const docs = readDocs(root);
  const beforeVerification = verifyProjectDocs(root);
  const mode = docsMode(docs, options.mode || 'init', beforeVerification);
  const protectedBlocks = uniqueItems(docs.flatMap((doc) => extractProtectedBlocks(doc.text)));
  const coreSections = inferCoreSections(root, docs);
  const rendered = docs.map((doc) => ({ ...doc, next: mode === 'noop' ? doc.text : renderDoc(root, doc, coreSections, protectedBlocks) }));
  const docChanges = rendered.flatMap((doc) => {
    const changed = writeChanged(doc.file, doc.next);
    const summary = diffSummary(doc.relative, doc.text, doc.next);
    return changed ? [summary] : [{ ...summary, action: 'unchanged' }];
  });
  const artifactChanges = [
    ...ensureRagManifest(root, now),
    ...ensurePlanning(root),
    ...registerProject(root, home, now),
  ];
  const verification = verifyProjectDocs(root);
  return { success: verification.ok && verification.coreIdentical, mode, docs: docChanges, artifacts: artifactChanges, verification };
}

function sectionsForVerification(root) {
  return readDocs(root).map((doc) => ({
    relative: doc.relative,
    exists: doc.exists,
    sections: CORE_SECTIONS.map((section) => ({ section, exists: Boolean(doc.parsed.sections[section]) })),
    coreText: CORE_SECTIONS.map((section) => `${section}\n${(doc.parsed.sections[section] || '').trim()}`).join('\n---\n'),
  }));
}

function verifyProjectDocs(root) {
  const docs = sectionsForVerification(root);
  const missing = docs.flatMap((doc) => doc.exists ? doc.sections.filter((item) => !item.exists).map((item) => `${doc.relative}:${item.section}`) : [`${doc.relative}:missing`]);
  const existingCore = docs.filter((doc) => doc.exists && doc.sections.every((item) => item.exists)).map((doc) => doc.coreText);
  const coreIdentical = existingCore.length === DOC_FILES.length && new Set(existingCore).size === 1;
  return { ok: missing.length === 0, missing, coreIdentical, docs };
}

module.exports = {
  CANONICAL_DOC,
  CORE_SECTIONS,
  DOC_FILES,
  parseMarkdownSections,
  initOrSyncProjectDocs,
  verifyProjectDocs,
  projectKey,
};
