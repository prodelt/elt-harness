/**
 * AMOS Instincts — self-learning engine.
 * Pure functions to extract, cluster, and draft skills from session events.
 * No I/O, no side effects, deterministic.
 */

/**
 * Extract usage patterns from an array of events.
 * @param {(string | {kind: string, detail: string})[]} events
 * @returns {{pattern: string, uses: number, confidence: number}[]}
 */
function extractInstincts(events) {
  if (!Array.isArray(events)) {
    return [];
  }

  const tally = {};

  for (const evt of events) {
    let displayText = '';

    if (typeof evt === 'string') {
      displayText = evt;
    } else if (evt && typeof evt === 'object' && evt.kind && evt.detail) {
      displayText = `${evt.kind}:${evt.detail}`;
    } else {
      continue;
    }

    const normalized = displayText.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (!tally[key]) {
      tally[key] = { pattern: normalized, uses: 0 };
    }
    tally[key].uses += 1;
  }

  const result = Object.values(tally).map(row => ({
    pattern: row.pattern,
    uses: row.uses,
    confidence: Math.min(1, row.uses / 5)
  }));

  result.sort((a, b) => b.uses - a.uses);
  return result;
}

/**
 * Cluster instincts by normalized pattern, summing uses and recomputing confidence.
 * @param {{pattern: string, uses: number, confidence: number}[]} rows
 * @returns {{pattern: string, uses: number, confidence: number}[]}
 */
function clusterInstincts(rows) {
  if (!Array.isArray(rows)) {
    return [];
  }

  const clusters = {};

  for (const row of rows) {
    if (!row || typeof row !== 'object' || !row.pattern || typeof row.uses !== 'number') {
      continue;
    }

    const normalized = row.pattern.trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    if (!clusters[normalized]) {
      clusters[normalized] = { pattern: row.pattern, uses: 0 };
    }
    clusters[normalized].uses += row.uses;
  }

  const result = Object.values(clusters).map(cluster => ({
    pattern: cluster.pattern,
    uses: cluster.uses,
    confidence: Math.min(1, cluster.uses / 5)
  }));

  result.sort((a, b) => b.uses - a.uses);
  return result;
}

/**
 * Select evolvable instincts: confidence >= minConfidence AND uses >= minUses.
 * @param {{pattern: string, uses: number, confidence: number}[]} rows
 * @param {{minConfidence?: number, minUses?: number}} opts
 * @returns {{pattern: string, uses: number, confidence: number}[]}
 */
function selectEvolvable(rows, opts = {}) {
  const minConfidence = opts.minConfidence !== undefined ? opts.minConfidence : 0.8;
  const minUses = opts.minUses !== undefined ? opts.minUses : 5;

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.filter(row => row.confidence >= minConfidence && row.uses >= minUses);
}

/**
 * Draft a deterministic SKILL.md from a cluster.
 * @param {{pattern: string, uses: number, confidence: number}} cluster
 * @returns {string}
 */
function draftSkillMarkdown(cluster) {
  if (!cluster || typeof cluster !== 'object' || !cluster.pattern) {
    return '';
  }

  const slug = slugify(cluster.pattern);
  const pattern = cluster.pattern;
  const uses = cluster.uses;

  return (
`---
name: ${slug}
description: Observed pattern '${pattern}' across ${uses} invocations.
---

## Pattern

\`\`\`
${pattern}
\`\`\`

## When to apply

This pattern emerged from ${uses} repeated command(s) in the session. Automate when the same sequence appears.
`
  );
}

/**
 * Convert a pattern string to a kebab-case slug (max ~40 chars).
 * @param {string} text
 * @returns {string}
 */
function slugify(text) {
  if (!text || typeof text !== 'string') {
    return 'unnamed-skill';
  }

  let slug = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s\-_:]/g, '')
    .replace(/\s+/g, '-')
    .replace(/(-)+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    slug = 'unnamed-skill';
  }

  if (slug.length > 40) {
    slug = slug.substring(0, 40);
    const lastDash = slug.lastIndexOf('-');
    if (lastDash > 10) {
      slug = slug.substring(0, lastDash);
    }
  }

  return slug;
}

module.exports = {
  extractInstincts,
  clusterInstincts,
  selectEvolvable,
  draftSkillMarkdown
};
