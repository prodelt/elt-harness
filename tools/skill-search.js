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
const MARKETPLACE_RELEVANCE_THRESHOLD = 0.3;
const OUTPUT_SKILL_LIMIT = 3;

function usage() {
  return [
    'Usage: node tools/skill-search.js "query" [--top N] [--json]',
    '       tools/skill.cmd "query"',
    '       bash tools/skill.sh "query"',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { query: [], top: OUTPUT_SKILL_LIMIT, json: false, ledger: '' };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--top') args.top = Math.min(Number(argv[++i] || OUTPUT_SKILL_LIMIT), OUTPUT_SKILL_LIMIT);
    else if (arg === '--ledger') args.ledger = argv[++i] || '';
    else args.query.push(arg);
  }
  return { query: args.query.join(' ').trim(), top: args.top, json: args.json, ledger: args.ledger };
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

function readCache(cachePath) {
  try {
    return fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
  } catch {
    return {};
  }
}

function writeCache(cachePath, query, entry) {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ ...readCache(cachePath), [query]: entry }, null, 2), 'utf8');
  } catch {}
}

function marketplaceCommands() {
  if (process.platform === 'win32') {
    return [
      { command: 'skills-sh.cmd', args: [] },
      { command: 'cmd.exe', args: ['/c', 'npx', 'skills-sh'] },
    ];
  }
  return [
    { command: 'skills-sh', args: [] },
    { command: 'npx', args: ['skills-sh'] },
  ];
}

function attemptedCommand(command, args) {
  return [command, ...args].join(' ');
}

function runSkillsSh(query, runner) {
  let lastAttempt = null;
  for (const { command, args } of marketplaceCommands()) {
    const completed = runner(command, [...args, 'search', query, '--json'], {
      timeout: 5000,
      encoding: 'utf8',
      env: process.env,
      windowsHide: true,
    });
    lastAttempt = {
      command,
      attemptedCommand: attemptedCommand(command, [...args, 'search', query, '--json']),
      completed,
    };
    if (completed && completed.status === 0 && completed.stdout) return lastAttempt;
  }
  return lastAttempt;
}

function parseMarketplace(stdout, top) {
  const data = JSON.parse(stdout);
  return (data.skills || []).slice(0, top).map(s => ({
    name:        s.skillId || s.name,
    installs:    s.installs,
    source:      s.source,
    marketplace: true,
  }));
}

function marketplaceError(result) {
  const completed = result && result.completed;
  const prefix = result && result.attemptedCommand ? `${result.attemptedCommand}: ` : '';
  if (!completed) return `${prefix}skills.sh did not run`;
  if (completed.error) return `${prefix}${completed.error.message}`;
  return `${prefix}${(completed.stderr || completed.stdout || `exit ${completed.status || 'unknown'}`).trim()}`;
}

function searchSkillsSh(query, top, options = {}) {
  const cachePath = options.cachePath || searchCachePath;
  const now = options.now || Date.now;
  const cached = readCache(cachePath)[query];
  if (cached && (now() - cached.ts) < SEARCH_CACHE_TTL_MS) {
    return { ...cached, results: (cached.results || []).slice(0, top) };
  }

  try {
    const result = runSkillsSh(query, options.runner || spawnSync);
    if (!result || !result.completed || result.completed.status !== 0 || !result.completed.stdout) {
      const entry = {
        status: 'error',
        error: marketplaceError(result),
        attemptedCommand: result && result.attemptedCommand,
        results: [],
        ts: now(),
        ttl: SEARCH_CACHE_TTL_MS,
      };
      writeCache(cachePath, query, entry);
      return entry;
    }
    const entry = {
      status: 'ok',
      attemptedCommand: result.attemptedCommand,
      results: parseMarketplace(result.completed.stdout, top),
      ts: now(),
      ttl: SEARCH_CACHE_TTL_MS,
    };
    writeCache(cachePath, query, entry);
    return entry;
  } catch (error) {
    const entry = { status: 'error', error: error.message, results: [], ts: now(), ttl: SEARCH_CACHE_TTL_MS };
    writeCache(cachePath, query, entry);
    return entry;
  }
}

function relevanceOf(skill) {
  return skill && skill.breakdown && typeof skill.breakdown.relevance === 'number'
    ? skill.breakdown.relevance
    : 0;
}

function shouldSearchMarketplace(ranked) {
  if (ranked.length === 0) return true;
  const relevances = ranked.map(relevanceOf);
  return relevances[0] < MARKETPLACE_RELEVANCE_THRESHOLD || relevances.every(score => score === 0);
}

function oneLineReason(skill) {
  const relevance = relevanceOf(skill);
  if (relevance >= MARKETPLACE_RELEVANCE_THRESHOLD) return `matches query with relevance ${relevance}`;
  return 'low local relevance; treat as weak candidate';
}

function skillCandidate(skill) {
  return {
    name: skill.name,
    reason: oneLineReason(skill),
    relevanceScore: relevanceOf(skill),
    totalScore: skill.score || 0,
    tokenEstimate: skill.token_estimate || null,
    riskLabel: skill.risk_level || 'low',
    source: 'local',
  };
}

function marketplaceCandidate(skill) {
  return {
    name: skill.name,
    reason: 'marketplace fallback candidate',
    relevanceScore: null,
    totalScore: null,
    tokenEstimate: null,
    riskLabel: 'unknown',
    source: skill.source || 'marketplace',
  };
}

function buildSkillRouterRecord(query, ranked, marketplaceResult, options = {}) {
  const localCandidates = ranked.slice(0, OUTPUT_SKILL_LIMIT).map(skillCandidate);
  const localRelevant = localCandidates.filter(skill => skill.relevanceScore >= MARKETPLACE_RELEVANCE_THRESHOLD);
  const marketplaceCandidates = (marketplaceResult.results || [])
    .slice(0, OUTPUT_SKILL_LIMIT)
    .map(marketplaceCandidate);
  const selected = localRelevant[0] || marketplaceCandidates[0] || {
    name: 'no skill',
    reason: 'direct work is cheaper than loading an unrelated or unavailable skill',
  };

  return {
    kind: 'skill-router',
    query,
    selected: selected.name,
    mode: selected.name === 'no skill' ? 'direct' : 'skill',
    recommendations: [...localRelevant, ...marketplaceCandidates].slice(0, OUTPUT_SKILL_LIMIT),
    rejected: localCandidates
      .filter(skill => skill.relevanceScore < MARKETPLACE_RELEVANCE_THRESHOLD)
      .map(skill => ({ name: skill.name, reason: 'below relevance gate', relevanceScore: skill.relevanceScore })),
    noSkillOption: {
      name: 'no skill',
      reason: 'use direct implementation when top relevance is weak or the task is cheaper than loading a skill body',
      tokenEstimate: 0,
    },
    marketplace: {
      status: marketplaceResult.status,
      error: marketplaceResult.error,
      attemptedCommand: marketplaceResult.attemptedCommand,
    },
    tokenBudget: { maxSkills: OUTPUT_SKILL_LIMIT },
    ts: options.now ? new Date(options.now()).toISOString() : new Date().toISOString(),
  };
}

function writeLedgerEvent(ledgerPath, event) {
  if (!ledgerPath) return;
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, JSON.stringify(event) + '\n', 'utf8');
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

  // Fallback to marketplace if local relevance is weak.
  const marketplaceResult = shouldSearchMarketplace(ranked)
    ? searchSkillsSh(args.query, args.top)
    : { status: 'skipped', results: [], ts: Date.now(), ttl: SEARCH_CACHE_TTL_MS };
  const router = buildSkillRouterRecord(args.query, ranked, marketplaceResult);
  writeLedgerEvent(args.ledger, router);

  if (args.json) {
    process.stdout.write(JSON.stringify({
      query: args.query,
      total: digests.length,
      ranked,
      marketplace: marketplaceResult.results,
      marketplaceStatus: marketplaceResult.status,
      marketplaceError: marketplaceResult.error,
      router,
    }, null, 2) + '\n');
    return;
  }

  process.stdout.write(`Query: "${args.query}" (${digests.length} local skills, top ${ranked.length})\n\n`);
  ranked.forEach((skill, i) => {
    process.stdout.write(
      `${i + 1}. ${skill.name} score=${skill.score} risk=${skill.risk_level || 'low'} tokens~${skill.token_estimate || '?'}\n`
    );
  });

  if (marketplaceResult.results.length > 0) {
    process.stdout.write(`\nMARKETPLACE (skills.sh) — "${args.query}":\n`);
    marketplaceResult.results.forEach((s, i) => {
      process.stdout.write(`  ${i + 1}. ${s.name} installs=${s.installs ?? '?'} source=${s.source || '?'}\n`);
    });
  } else if (marketplaceResult.status === 'error') {
    process.stdout.write(`\nMARKETPLACE unavailable: ${marketplaceResult.error}\n`);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildSkillRouterRecord,
  searchSkillsSh,
  shouldSearchMarketplace,
};
