#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const rankerPath      = path.join(os.homedir(), '.claude', 'hooks', 'skill-ranker.js');
const digestPath      = path.join(os.homedir(), '.claude', 'skill-registry', 'digests.jsonl');
const historyPath     = path.join(os.homedir(), '.claude', 'skill-registry', 'history.jsonl');
const installsPath    = path.join(os.homedir(), '.claude', 'skill-registry', 'skillsh-installs.json');
const searchCachePath = path.join(os.homedir(), '.claude', 'skill-registry', 'skillsh-search-cache.json');

const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MARKETPLACE_SCORE_THRESHOLD = 0.3;

function usage() {
  return [
    'Usage: node tools/skill-search.js "query" [--top N] [--json]',
    '       tools/skill.cmd "query"',
    '       bash tools/skill.sh "query"',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { query: [], top: 8, json: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--top') args.top = Number(argv[++i] || 8);
    else args.query.push(arg);
  }
  return { query: args.query.join(' ').trim(), top: args.top, json: args.json };
}

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
}

function loadInstallCountMap() {
  try {
    if (!fs.existsSync(installsPath)) return {};
    return JSON.parse(fs.readFileSync(installsPath, 'utf8')).counts || {};
  } catch { return {}; }
}

function searchSkillsSh(query, top) {
  // Cache-first
  try {
    if (fs.existsSync(searchCachePath)) {
      const cache = JSON.parse(fs.readFileSync(searchCachePath, 'utf8'));
      const entry = cache[query];
      if (entry && (Date.now() - entry.ts) < SEARCH_CACHE_TTL_MS) {
        return entry.results.slice(0, top);
      }
    }
  } catch {}

  const r = spawnSync('skills-sh', ['search', query, '--json'],
    { timeout: 5000, encoding: 'utf8', env: process.env });
  if (r.status !== 0 || !r.stdout) return [];

  try {
    const data = JSON.parse(r.stdout);
    const results = (data.skills || []).slice(0, top).map(s => ({
      name:        s.skillId || s.name,
      installs:    s.installs,
      source:      s.source,
      marketplace: true,
    }));

    // Persist to cache
    try {
      const cache = fs.existsSync(searchCachePath)
        ? JSON.parse(fs.readFileSync(searchCachePath, 'utf8'))
        : {};
      cache[query] = { ts: Date.now(), results };
      fs.writeFileSync(searchCachePath, JSON.stringify(cache), 'utf8');
    } catch {}

    return results;
  } catch { return []; }
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.query) {
    process.stderr.write(usage() + '\n');
    process.exit(2);
  }
  if (!fs.existsSync(rankerPath)) {
    process.stderr.write('Missing skill ranker: ' + rankerPath + '\n');
    process.exit(1);
  }
  if (!fs.existsSync(digestPath)) {
    process.stderr.write('Missing skill registry: ' + digestPath + '\n');
    process.exit(1);
  }

  const ranker         = require(rankerPath);
  const digests        = loadJsonl(digestPath);
  const history        = loadJsonl(historyPath);
  const installCountMap = loadInstallCountMap();
  const ranked         = ranker.rankSkills(digests, args.query, history, {}, installCountMap).slice(0, args.top);

  // Fallback to marketplace if local results are weak
  const needsMarketplace = ranked.length === 0 || ranked[0].score < MARKETPLACE_SCORE_THRESHOLD;
  const marketplace = needsMarketplace ? searchSkillsSh(args.query, args.top) : [];

  if (args.json) {
    process.stdout.write(JSON.stringify({
      query: args.query,
      total: digests.length,
      ranked,
      marketplace,
    }, null, 2) + '\n');
    return;
  }

  process.stdout.write(`Query: "${args.query}" (${digests.length} local skills, top ${ranked.length})\n\n`);
  ranked.forEach((skill, i) => {
    process.stdout.write(
      `${i + 1}. ${skill.name} score=${skill.score} risk=${skill.risk_level || 'low'} tokens~${skill.token_estimate || '?'}\n`
    );
  });

  if (marketplace.length > 0) {
    process.stdout.write(`\nMARKETPLACE (skills.sh) — "${args.query}":\n`);
    marketplace.forEach((s, i) => {
      process.stdout.write(`  ${i + 1}. ${s.name} installs=${s.installs ?? '?'} source=${s.source || '?'}\n`);
    });
  }
}

main();
