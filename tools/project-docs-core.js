#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CANONICAL_DOC = 'AGENTS.md';
const DOC_FILES = [CANONICAL_DOC, 'CLAUDE.md', path.join('.gemini', 'GEMINI.md')];
// 9 канонических секций (spec 005 AC10). Порядок = порядок рендера.
const CORE_SECTIONS = ['Overview', 'Stack', 'Structure', 'Commands', 'Code style', 'Testing', 'Commit & PR', 'Gotchas', 'Memory'];
const MEMORY_LEAK_RE = /^-\s*\d{4}-\d{2}-\d{2}/m;
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

// Заголовки `## X`, которые не входят в 9 канонических секций И не лежат внутри
// protected-блока = «unknown» контент. verify обязан их репортить (fail-closed),
// но sync их НЕ удаляет молча — миграция явная (обернуть в protected-блок).
function unknownSectionTitles(text) {
  const ranges = [...text.matchAll(PROTECTED_RE)].map((match) => [match.index, match.index + match[0].length]);
  const insideProtected = (index) => ranges.some(([start, end]) => index >= start && index < end);
  return [...text.matchAll(/^##\s+(.+?)\s*$/gm)]
    .filter((match) => !insideProtected(match.index))
    .map((match) => match[1].trim())
    .filter((title) => !CORE_SECTIONS.includes(canonicalSectionTitle(title)));
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
  const fallback = {
    Overview: 'One-paragraph description of what this project is and the problem it solves.\n',
    Stack: 'Languages, runtimes and key dependencies this project builds on.\n',
    Structure: 'Where the important code lives; key directories and entry points.\n',
    Commands: 'Run project-specific tests or doctor commands listed in this repository.\n',
    'Code style': 'Match the existing conventions in the codebase; keep changes small and local.\n',
    Testing: 'Run the test suite before committing and keep it green; add a test for new behavior.\n',
    'Commit & PR': 'One task per feature branch; conventional commit messages; small reviewable PRs.\n',
    Gotchas: 'Preserve local rules and Windows path handling when syncing docs.\n',
    Memory: 'Long-lived state lives in .planning/STATE.md (spine) + .planning/PROJECT-HISTORY.md ' +
      '(archive). This section is a pointer, not a log — do not write dated entries here.\n',
  };
  return CORE_SECTIONS.reduce((acc, section) => ({
    ...acc,
    [section]: source.parsed.sections[section] || fallback[section],
  }), {});
}

function toolPreamble(relative, root) {
  const name = path.basename(root);
  // Эталон (Черни/Карпаты/стандарт agents.md): заголовок называет файл, не инструмент;
  // AGENTS.md — источник, CLAUDE.md/GEMINI.md — его зеркала (один файл, все агенты).
  if (relative === 'AGENTS.md') return `# AGENTS.md — ${name}\n\n`;
  return `# ${name} — Project Instructions\n\n`;
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
  if (verification.ok && requestedMode === 'init') return 'noop';
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
    ...ensurePlanning(root),
    ...registerProject(root, home, now),
  ];
  const verification = verifyProjectDocs(root);
  return { success: verification.ok, mode, docs: docChanges, artifacts: artifactChanges, verification };
}

function verifyProjectDocs(root) {
  const rawDocs = readDocs(root);
  const docs = rawDocs.map((doc) => ({
    relative: doc.relative,
    exists: doc.exists,
    sections: CORE_SECTIONS.map((section) => ({ section, exists: Boolean(doc.parsed.sections[section]) })),
    coreText: CORE_SECTIONS.map((section) => `${section}\n${(doc.parsed.sections[section] || '').trim()}`).join('\n---\n'),
  }));
  const missing = docs.flatMap((doc) => doc.exists
    ? doc.sections.filter((item) => !item.exists).map((item) => `${doc.relative}:${item.section}`)
    : [`${doc.relative}:missing`]);
  const existingCore = docs.filter((doc) => doc.exists && doc.sections.every((item) => item.exists)).map((doc) => doc.coreText);
  const coreIdentical = existingCore.length === DOC_FILES.length && new Set(existingCore).size === 1;
  const unknownSections = rawDocs.flatMap((doc) => doc.exists
    ? unknownSectionTitles(doc.text).map((title) => `${doc.relative}:${title}`)
    : []);
  // Fail-closed: verify зелёный ТОЛЬКО когда все 9 секций есть, core идентичен по 3 файлам,
  // и нет unprotected non-core секций (spec 005 AC10).
  return {
    ok: missing.length === 0 && coreIdentical && unknownSections.length === 0,
    missing,
    coreIdentical,
    unknownSections,
    docs,
  };
}

const BLOAT_WARN = 150;
const BLOAT_FAIL = 250;
const SKIP_DIRS = new Set(['node_modules', 'vendor', '.git', '.worktrees', '.next', 'dist', 'build', '.cache', '.rag']);

function countLines(text) {
  return text ? text.split(/\r?\n/).length : 0;
}

function globalRuleLines(home) {
  const file = path.join(home || require('node:os').homedir(), '.claude', 'CLAUDE.md');
  return new Set(
    readText(file)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 40 && /^[-*]/.test(line)),
  );
}

function looksLikeLocalPath(ref) {
  if (!ref || /\s/.test(ref)) return false;
  if (/^(https?:|mailto:|#|\$|%|~|@)/.test(ref)) return false;
  if (/[<>*?|]/.test(ref)) return false;
  if (/^\.(planning|rag)\//.test(ref) || /^\.\//.test(ref)) return true;
  return ref.includes('/') && /\.[a-z0-9]{1,5}$/i.test(ref);
}

function extractDeadRefs(root, docs) {
  const refs = new Set();
  for (const doc of docs) {
    if (!doc.exists) continue;
    for (const match of doc.text.matchAll(/\]\(([^)\s]+)\)/g)) refs.add(match[1]);
    for (const match of doc.text.matchAll(/`([^`]+)`/g)) refs.add(match[1]);
  }
  return [...refs]
    .map((ref) => ref.split('#')[0].trim())
    .filter(looksLikeLocalPath)
    .filter((ref) => !fs.existsSync(path.join(root, ref)))
    .slice(0, 20);
}

function extractMemoryLeaks(docs) {
  return docs
    .filter((doc) => doc.exists && MEMORY_LEAK_RE.test(doc.parsed.sections.Memory || ''))
    .map((doc) => doc.relative);
}

function auditProjectDocs(root, options = {}) {
  const resolved = path.resolve(root);
  const docs = readDocs(resolved);
  const verification = verifyProjectDocs(resolved);
  const present = docs.filter((doc) => doc.exists);
  const findings = [];

  const missingDocs = docs.filter((doc) => !doc.exists).map((doc) => doc.relative);
  if (missingDocs.length) findings.push({ severity: 'fail', code: 'missing-doc', detail: missingDocs.join(', ') });

  if (fs.existsSync(path.join(resolved, 'GEMINI.md')) && fs.existsSync(path.join(resolved, '.gemini', 'GEMINI.md'))) {
    findings.push({ severity: 'warn', code: 'dup-gemini', detail: 'root GEMINI.md and .gemini/GEMINI.md both exist' });
  }

  const sizes = present.map((doc) => ({ relative: doc.relative, lines: countLines(doc.text) }));
  for (const size of sizes) {
    if (size.lines > BLOAT_FAIL) findings.push({ severity: 'fail', code: 'bloat', detail: `${size.relative} ${size.lines}>${BLOAT_FAIL}` });
    else if (size.lines > BLOAT_WARN) findings.push({ severity: 'warn', code: 'bloat', detail: `${size.relative} ${size.lines}>${BLOAT_WARN}` });
  }

  if (present.length > 1 && !verification.coreIdentical) {
    findings.push({ severity: 'warn', code: 'drift', detail: 'core sections not identical across docs' });
  }
  if (verification.missing.length) {
    findings.push({ severity: 'warn', code: 'missing-section', detail: verification.missing.slice(0, 8).join(', ') });
  }

  const deadRefs = extractDeadRefs(resolved, docs);
  if (deadRefs.length) findings.push({ severity: 'warn', code: 'dead-ref', detail: deadRefs.join(', ') });

  const memoryLeaks = extractMemoryLeaks(docs);
  if (memoryLeaks.length) {
    findings.push({
      severity: 'warn',
      code: 'memory-leak',
      detail: `${memoryLeaks.join(', ')} — dated journal entries in Memory section; move to .planning/STATE.md / PROJECT-HISTORY.md`,
    });
  }

  const globalRules = globalRuleLines(options.home);
  const claude = docs.find((doc) => doc.relative === 'CLAUDE.md');
  if (claude && claude.exists && globalRules.size) {
    const dup = claude.text.split(/\r?\n/).map((line) => line.trim()).filter((line) => globalRules.has(line));
    if (dup.length) findings.push({ severity: 'warn', code: 'global-dup', detail: `${dup.length} rule line(s) duplicate ~/.claude/CLAUDE.md` });
  }

  const status = findings.some((finding) => finding.severity === 'fail') ? 'FAIL'
    : findings.some((finding) => finding.severity === 'warn') ? 'WARN' : 'PASS';
  return {
    root: resolved,
    name: path.basename(resolved),
    label: resolved.split(/[\\/]/).slice(-2).join('/'),
    status,
    findings,
    sizes,
    maxLines: sizes.reduce((max, size) => Math.max(max, size.lines), 0),
    coreIdentical: verification.coreIdentical,
  };
}

function isProjectRoot(dir) {
  return DOC_FILES.some((relative) => fs.existsSync(path.join(dir, relative))) || fs.existsSync(path.join(dir, 'GEMINI.md'));
}

function findProjectRoots(start, maxDepth, excludes) {
  const roots = [];
  const walk = (dir, depth) => {
    if (isProjectRoot(dir)) roots.push(dir);
    if (depth >= maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_error) { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      if (excludes.some((needle) => entry.name.toLowerCase().includes(needle))) continue;
      walk(path.join(dir, entry.name), depth + 1);
    }
  };
  walk(start, 0);
  return roots;
}

function auditAllProjects(dirs, options = {}) {
  const excludes = (options.exclude || []).map((needle) => needle.toLowerCase());
  const maxDepth = options.maxDepth || 3;
  const roots = new Set();
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) continue;
    findProjectRoots(resolved, maxDepth, excludes).forEach((root) => roots.add(root));
  }
  const rank = { FAIL: 0, WARN: 1, PASS: 2 };
  const results = [...roots]
    .filter((root) => !excludes.some((needle) => root.toLowerCase().includes(needle)))
    .map((root) => auditProjectDocs(root, options))
    .sort((left, right) => rank[left.status] - rank[right.status] || right.maxLines - left.maxLines);
  const summary = results.reduce(
    (acc, result) => ({ ...acc, [result.status]: acc[result.status] + 1 }),
    { FAIL: 0, WARN: 0, PASS: 0 },
  );
  return { results, summary, scanned: results.length, success: summary.FAIL === 0 };
}

module.exports = {
  CANONICAL_DOC,
  CORE_SECTIONS,
  DOC_FILES,
  parseMarkdownSections,
  initOrSyncProjectDocs,
  verifyProjectDocs,
  auditProjectDocs,
  auditAllProjects,
  projectKey,
};
