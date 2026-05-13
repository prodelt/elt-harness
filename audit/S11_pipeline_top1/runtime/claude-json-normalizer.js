// claude-json-normalizer.js — dry-run by default, --apply to write
// Usage: node claude-json-normalizer.js [--apply] [--json]
// Normalizes C:\Users\<user>\.claude.json:
//   - finds duplicate project path keys inside the "projects" sub-object
//     (same path, different case or slash direction)
//   - removes duplicate entries, keeps the first (canonical) occurrence
'use strict';
const fs = require('fs');
const path = require('path');

const CLAUDE_JSON = path.join(process.env.USERPROFILE || process.env.HOME, '.claude.json');

/** Normalize a key for duplicate detection */
function normKey(k) {
  return k.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '');
}

/**
 * Parse the raw text of a JSON object block (the content between outermost { })
 * and return an array of { key, rawValue } preserving order and duplicates.
 *
 * Works on the content of "projects": { ... } without external parsers.
 */
function parseObjectEntries(raw) {
  // Locate the root { } bounds
  const rootOpen = raw.indexOf('{');
  const rootClose = raw.lastIndexOf('}');
  if (rootOpen < 0 || rootClose < 0) return [];

  const entries = [];
  let i = rootOpen + 1;

  while (i <= rootClose) {
    // Skip whitespace + commas
    while (i < rootClose && /[\s,]/.test(raw[i])) i++;
    if (i >= rootClose) break;
    if (raw[i] !== '"') { i++; continue; }

    // Read key string
    i++; // skip opening quote
    let key = '';
    while (i < raw.length && raw[i] !== '"') {
      if (raw[i] === '\\') { key += raw[i]; i++; }
      key += raw[i];
      i++;
    }
    i++; // skip closing quote

    // Skip whitespace then ':'
    while (i < raw.length && /\s/.test(raw[i])) i++;
    if (raw[i] !== ':') continue;
    i++; // skip ':'
    while (i < raw.length && /\s/.test(raw[i])) i++;

    // Read value
    const valueStart = i;
    let depth = 0;
    let inStr = false;
    while (i < raw.length) {
      const ch = raw[i];
      if (ch === '\\' && inStr) { i += 2; continue; }
      if (ch === '"') inStr = !inStr;
      if (!inStr) {
        if (ch === '{' || ch === '[') depth++;
        else if (ch === '}' || ch === ']') {
          if (depth === 0) break;
          depth--;
        } else if ((ch === ',' || ch === '}') && depth === 0) break;
      }
      i++;
    }

    entries.push({ key, rawValue: raw.slice(valueStart, i) });
  }
  return entries;
}

/**
 * Extract the raw text of the "projects" value from .claude.json raw text.
 * Returns { projectsRaw, start, end } — start/end are byte offsets in `raw`.
 */
function extractProjectsBlock(raw) {
  const marker = '"projects"';
  const mIdx = raw.indexOf(marker);
  if (mIdx < 0) return null;

  let i = mIdx + marker.length;
  while (i < raw.length && /[\s:]/.test(raw[i])) i++;
  if (raw[i] !== '{') return null;

  const blockStart = i;
  let depth = 0;
  let inStr = false;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '\\' && inStr) { i += 2; continue; }
    if (ch === '"') inStr = !inStr;
    if (!inStr) {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    i++;
  }

  return { projectsRaw: raw.slice(blockStart, i), start: blockStart, end: i };
}

/**
 * Find groups of duplicate project path keys within the "projects" object.
 * Returns [{canonical, duplicates}].
 */
function findDuplicateProjectKeys(raw) {
  const block = extractProjectsBlock(raw);
  if (!block) return [];

  const entries = parseObjectEntries(block.projectsRaw);
  const seen = {}; // norm -> first key
  const groups = {}; // norm -> {canonical, duplicates[]}

  for (const { key } of entries) {
    const n = normKey(key);
    if (seen[n] !== undefined && seen[n] !== key) {
      if (!groups[n]) groups[n] = { canonical: seen[n], duplicates: [] };
      groups[n].duplicates.push(key);
    } else if (seen[n] === undefined) {
      seen[n] = key;
    }
  }

  return Object.values(groups).filter(g => g.duplicates.length > 0);
}

/**
 * Build normalized JSON raw text — removes duplicate project keys.
 * Returns { normalizedRaw, removed }.
 */
function buildNormalizedJson(raw) {
  const dups = findDuplicateProjectKeys(raw);
  const toRemove = new Set(dups.flatMap(g => g.duplicates));
  if (toRemove.size === 0) return { normalizedRaw: raw, removed: [] };

  const block = extractProjectsBlock(raw);
  const entries = parseObjectEntries(block.projectsRaw);
  const removed = [];

  // Rebuild the projects block without duplicate entries
  let newBlock = '{';
  let first = true;
  for (const { key, rawValue } of entries) {
    if (toRemove.has(key)) { removed.push(key); continue; }
    if (!first) newBlock += ',';
    newBlock += '\n    ' + JSON.stringify(key) + ': ' + rawValue;
    first = false;
  }
  newBlock += '\n  }';

  const normalizedRaw = raw.slice(0, block.start) + newBlock + raw.slice(block.end);
  return { normalizedRaw, removed };
}

/**
 * Analyze drift in .claude.json.
 */
function analyzeDrift(raw) {
  const block = extractProjectsBlock(raw);
  const entries = block ? parseObjectEntries(block.projectsRaw) : [];
  const dups = findDuplicateProjectKeys(raw);
  const removable = dups.flatMap(g => g.duplicates);

  return {
    projectCount: entries.length,
    duplicateGroups: dups.length,
    removableKeys: removable.length,
    duplicates: dups,
    removableList: removable,
  };
}

// --- CLI ---
if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const jsonOutput = args.includes('--json');
  const filePath = args.find(a => !a.startsWith('--')) || CLAUDE_JSON;

  const raw = fs.readFileSync(filePath, 'utf8');
  const report = analyzeDrift(raw);

  if (!jsonOutput) {
    process.stderr.write('[claude-json-normalizer] ' + filePath + '\n');
    process.stderr.write('  Project entries: ' + report.projectCount + '\n');
    process.stderr.write('  Duplicate groups: ' + report.duplicateGroups + '\n');
    process.stderr.write('  Removable keys: ' + report.removableKeys + '\n');
    for (const g of report.duplicates) {
      process.stderr.write('  KEEP: "' + g.canonical + '"\n');
      g.duplicates.forEach(d => process.stderr.write('  DROP: "' + d + '"\n'));
    }
  }

  if (apply && report.removableKeys > 0) {
    const backupPath = filePath + '.' + Date.now() + '.bak';
    fs.copyFileSync(filePath, backupPath);
    process.stderr.write('  Backup: ' + backupPath + '\n');
    const { normalizedRaw, removed } = buildNormalizedJson(raw);
    fs.writeFileSync(filePath, normalizedRaw, 'utf8');
    process.stderr.write('  Applied: removed ' + removed.length + ' keys\n');
    removed.forEach(k => process.stderr.write('    - "' + k + '"\n'));
  } else if (apply) {
    process.stderr.write('  Already clean — nothing to remove.\n');
  } else if (report.removableKeys > 0) {
    process.stderr.write('  Dry-run mode. Use --apply to remove duplicates.\n');
  }

  if (jsonOutput) {
    process.stdout.write(JSON.stringify({ success: true, ...report }, null, 2) + '\n');
  }

  process.exit(report.removableKeys > 0 && !apply ? 1 : 0);
}

module.exports = { findDuplicateProjectKeys, buildNormalizedJson, analyzeDrift };
