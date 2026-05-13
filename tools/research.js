#!/usr/bin/env node
// Context7+ fallback: when ctx7 has no/poor docs, try npm + GitHub issues.
// Usage: node tools/research.js <library-name>
'use strict';

const { spawnSync } = require('child_process');

const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('Usage: node tools/research.js <library-name>');
  process.exit(1);
}

function stripAnsi(s) {
  return s.replace(/\x1B\[[0-9;]*m/g, '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

function ctx7Search(q) {
  const [ctx7Prog, ctx7Args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'ctx7', 'library', q]]
    : ['ctx7', ['library', q]];
  const r = spawnSync(ctx7Prog, ctx7Args, {
    encoding: 'utf8',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    timeout: 10000
  });
  if (r.error || r.status !== 0) return null;
  const out = stripAnsi(r.stdout || '');
  const lines = out.split('\n');
  // Parse top-3 results
  const results = [];
  let cur = null;
  for (const line of lines) {
    const titleM = line.match(/^\s*\d+\.\s+Title:\s*(.+)/);
    if (titleM) { if (cur) results.push(cur); cur = { title: titleM[1].trim(), id: null, snippets: 0, rep: 'Unknown' }; }
    if (!cur) continue;
    const idM = line.match(/Context7-compatible library ID:\s*(\S+)/);
    if (idM) cur.id = idM[1];
    const snM = line.match(/Code Snippets:\s*(\d+)/);
    if (snM) cur.snippets = parseInt(snM[1]);
    const repM = line.match(/Source Reputation:\s*(\w+)/);
    if (repM) cur.rep = repM[1];
  }
  if (cur) results.push(cur);
  return results.length ? results : null;
}

function isGoodCtx7Match(entry, q) {
  if (!entry || !entry.id) return false;
  const t = entry.title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const s = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nameMatch = t.includes(s) || t === s || s.startsWith(t) || (t.length > 4 && t.startsWith(s.slice(0, 5)));
  return nameMatch && entry.snippets > 20;
}

async function npmLookup(pkg) {
  try {
    const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) return null;
    const d = await r.json();
    return { name: d.name, version: d.version, description: d.description, homepage: d.homepage };
  } catch { return null; }
}

async function githubIssues(q) {
  try {
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=reactions&per_page=5`;
    const r = await fetch(url, {
      headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'pipeline-research/1.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.status === 403) return { rateLimited: true };
    if (!r.ok) return null;
    const d = await r.json();
    return d.items || [];
  } catch { return null; }
}

async function main() {
  console.log(`\n=== Research: "${query}" ===\n`);

  // 1. ctx7
  console.log('--- Context7 ---');
  const ctx7Results = ctx7Search(query);
  let ctx7IsGood = false;
  if (!ctx7Results) {
    console.log('  ctx7 unavailable or returned no results');
  } else {
    const top = ctx7Results[0];
    ctx7IsGood = isGoodCtx7Match(top, query);
    ctx7Results.slice(0, 3).forEach((e, i) => {
      const mark = i === 0 && ctx7IsGood ? ' ✓' : '';
      console.log(`  ${i + 1}. ${e.title}${mark} | ID: ${e.id} | Snippets: ${e.snippets} | Rep: ${e.rep}`);
    });
    if (ctx7IsGood) {
      console.log(`\n  [Good docs found] Run: MSYS_NO_PATHCONV=1 ctx7 docs ${top.id} "<question>"`);
    } else {
      console.log('\n  [No confident ctx7 match — checking fallbacks]');
    }
  }

  console.log('');

  // 2. npm registry
  console.log('--- npm registry ---');
  const npm = await npmLookup(query);
  if (npm) {
    console.log(`  ${npm.name}@${npm.version}`);
    if (npm.description) console.log(`  ${npm.description}`);
    if (npm.homepage) console.log(`  Docs: ${npm.homepage}`);
  } else {
    console.log('  Not found on npm (may not be an npm package)');
  }

  console.log('');

  // 3. GitHub issues
  console.log('--- GitHub Issues (top reactions) ---');
  const issues = await githubIssues(query);
  if (!issues) {
    console.log('  GitHub request failed');
  } else if (issues.rateLimited) {
    console.log('  Rate limited (10 req/min unauthenticated). Wait 60s and retry.');
  } else if (issues.length === 0) {
    console.log('  No matching issues found');
  } else {
    issues.slice(0, 3).forEach((item, i) => {
      const title = item.title.length > 75 ? item.title.slice(0, 72) + '...' : item.title;
      console.log(`  ${i + 1}. [${item.state}] ${title}`);
      console.log(`     👍 ${item.reactions.total_count} | ${item.html_url}`);
    });
  }

  console.log('');
  console.log('--- Sourcegraph ---');
  console.log(`  https://sourcegraph.com/search?q=${encodeURIComponent(query)}`);
  console.log('  (Configure SOURCEGRAPH_TOKEN for API access — deferred)');
  console.log('');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
