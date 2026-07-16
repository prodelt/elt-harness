#!/usr/bin/env node
'use strict';
// Task 39 — Skill Ranker: score skills by relevance/trust/token efficiency

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DIGEST_PATH = path.join(os.homedir(), '.claude', 'skill-registry', 'digests.jsonl');
const DEFAULT_HISTORY_PATH = path.join(os.homedir(), '.claude', 'skill-registry', 'history.jsonl');

// Score weights (sum to 1.0)
const WEIGHTS = {
  relevance:    0.35,
  sourceTrust:  0.20,
  verified:     0.15,
  tokenCost:    0.15, // inverted — lower tokens = higher score
  risk:         0.10, // inverted — lower risk = higher score
  successRate:  0.05,
};

const RISK_PENALTY  = { low: 0, medium: 0.3, high: 0.7 };
const TRUST_SCORE   = { high: 1.0, medium: 0.6, low: 0.3, unknown: 0.2 };

// Token budget thresholds (tokens)
const TOKEN_CHEAP    = 500;
const TOKEN_MODERATE = 2000;
const TOKEN_EXPENSIVE = 8000;

// ─── Scoring ─────────────────────────────────────────────────────────────

function tokenScore(estimate) {
  if (estimate <= TOKEN_CHEAP)    return 1.0;
  if (estimate <= TOKEN_MODERATE) return 0.7;
  if (estimate <= TOKEN_EXPENSIVE) return 0.4;
  return 0.1;
}

function riskScore(risk) {
  return 1 - (RISK_PENALTY[risk] || 0);
}

function relevanceScore(query, digest) {
  if (!query) return 0.5;
  const q = query.toLowerCase();
  const fields = [
    digest.name || '',
    digest.use_when || '',
    digest.description || '',
  ].join(' ').toLowerCase();

  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0.5;
  const matched = words.filter(w => fields.includes(w)).length;
  return matched / words.length;
}

function successRateScore(history, name) {
  if (!history || history.length === 0) return 0.5;
  const entries = history.filter(h => h.name === name);
  if (entries.length === 0) return 0.5;
  const successes = entries.filter(h => h.success).length;
  return successes / entries.length;
}

function scoreSkill(digest, query, history, sourceTrust) {
  const rel   = relevanceScore(query, digest);
  const trust = TRUST_SCORE[sourceTrust || 'unknown'] || 0.2;
  const ver   = digest.verified ? 1.0 : 0.4;
  const tok   = tokenScore(digest.token_estimate || 1000);
  const risk  = riskScore(digest.risk || 'low');
  const succ  = successRateScore(history, digest.name);

  const total =
    WEIGHTS.relevance   * rel   +
    WEIGHTS.sourceTrust * trust +
    WEIGHTS.verified    * ver   +
    WEIGHTS.tokenCost   * tok   +
    WEIGHTS.risk        * risk  +
    WEIGHTS.successRate * succ;

  return {
    name:        digest.name,
    category:    digest.category,
    score:       Math.round(total * 1000) / 1000,
    breakdown: { relevance: rel, sourceTrust: trust, verified: ver, tokenCost: tok, risk, successRate: succ },
    token_estimate: digest.token_estimate,
    risk_level:  digest.risk,
    verified:    digest.verified,
  };
}

function rankSkills(digests, query, history, trustMap) {
  return digests
    .map(d => scoreSkill(d, query, history, (trustMap || {})[d.name]))
    .sort((a, b) => b.score - a.score);
}

// ─── History helpers ──────────────────────────────────────────────────────

function loadHistory(historyPath) {
  if (!fs.existsSync(historyPath)) return [];
  const lines = fs.readFileSync(historyPath, 'utf8').split('\n').filter(Boolean);
  return lines.flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function recordOutcome(historyPath, name, success, durationMs) {
  const entry = { name, success, durationMs, ts: new Date().toISOString() };
  const dir = path.dirname(historyPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(historyPath, JSON.stringify(entry) + '\n', 'utf8');
}

// ─── Digest loader ────────────────────────────────────────────────────────

function loadDigests(digestPath) {
  if (!fs.existsSync(digestPath)) return [];
  const lines = fs.readFileSync(digestPath, 'utf8').split('\n').filter(Boolean);
  return lines.flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}

// ─── CLI args ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    }
  }
  return args;
}

// ─── CLI entry ────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = parseArgs(process.argv);

  if (args['record']) {
    const name    = args.name || '';
    const success = args.success !== 'false';
    const ms      = parseInt(args['duration-ms'] || '0', 10);
    const hp      = args.history || DEFAULT_HISTORY_PATH;
    if (!name) { process.stderr.write('--name required for --record\n'); process.exit(1); }
    recordOutcome(hp, name, success, ms);
    process.stdout.write(JSON.stringify({ recorded: true, name, success, durationMs: ms }) + '\n');
    process.exit(0);
  }

  const query      = args.query || '';
  const digestPath = args.digests || DEFAULT_DIGEST_PATH;
  const histPath   = args.history || DEFAULT_HISTORY_PATH;
  const top        = parseInt(args.top || '5', 10);
  const category   = args.category || null;

  const allDigests = loadDigests(digestPath);
  if (allDigests.length === 0) {
    process.stderr.write(`No digests found at ${digestPath}. Run skill-distiller --distill-all first.\n`);
    process.exit(1);
  }

  const filtered = category
    ? allDigests.filter(d => d.category === category)
    : allDigests;

  const history  = loadHistory(histPath);
  const ranked   = rankSkills(filtered, query, history, {});
  const topN     = ranked.slice(0, top);

  if (args.json) {
    process.stdout.write(JSON.stringify({ query, total: filtered.length, ranked: topN }) + '\n');
    process.exit(0);
  }

  process.stdout.write(`Query: "${query}"  (${filtered.length} skills, showing top ${topN.length})\n\n`);
  topN.forEach((s, i) => {
    process.stdout.write(
      `${i + 1}. ${s.name} [${s.category}]  score=${s.score}  tokens=~${s.token_estimate}  risk=${s.risk_level}  verified=${s.verified}\n`
    );
  });
}

module.exports = { scoreSkill, rankSkills, relevanceScore, tokenScore, riskScore, loadDigests, loadHistory, recordOutcome };
