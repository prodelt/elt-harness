'use strict';

/**
 * lib/preflight.js — AMOS Sprint 4: Preflight (skill-router v2)
 *
 * `amos preflight "<task>"` combines:
 *  - local skill registry (~/.claude/skill-registry/digests.jsonl + skill-ranker.js),
 *    including the 43 gstack/* domain skills already present in the registry
 *  - extended domain hints so marketing/planning queries route to gstack skills
 *  - skillgrab CLI (project-context skill plan) for coding-domain queries
 *  - a Context7 CLI reminder when the task touches an external library
 *  - a codemap (Graphify/CodeGraph) hint for the current project root
 *
 * Output is a single record/text block capped at PREFLIGHT_BUDGET_BYTES (1.5KB).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const AMOS_DIR = process.env.AMOS_HOME || path.join(os.homedir(), '.amos');

const RANKER_PATH   = path.join(os.homedir(), '.claude', 'hooks', 'skill-ranker.js');
const DIGEST_PATH   = path.join(os.homedir(), '.claude', 'skill-registry', 'digests.jsonl');
const HISTORY_PATH  = path.join(os.homedir(), '.claude', 'skill-registry', 'history.jsonl');
const INSTALLS_PATH = path.join(os.homedir(), '.claude', 'skill-registry', 'skillsh-installs.json');

const RELEVANCE_THRESHOLD = 0.3;
const PREFLIGHT_BUDGET_BYTES = 1536;
const PREFLIGHT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const SKILLGRAB_CACHE_TTL_MS = 60 * 60 * 1000; // 1h

// ── Domain detection ─────────────────────────────────────────────────────────

const CODING_TERMS   = ['code', 'npm', 'package', 'dependency', 'function', 'bug', 'bugs', 'refactor', 'module', 'api', 'endpoint', 'javascript', 'typescript', 'library', 'sdk', 'test', 'tests'];
const MARKETING_TERMS = ['marketing', 'landing', 'copy', 'campaign', 'content', 'brand', 'social'];
const PLANNING_TERMS  = ['plan', 'sprint', 'retro', 'roadmap', 'strategy', 'ceo', 'milestone'];

function queryTerms(query) {
  return String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function countMatches(terms, list) {
  return terms.filter(t => list.includes(t)).length;
}

function detectDomain(query) {
  const terms = queryTerms(query);
  const scores = {
    coding:    countMatches(terms, CODING_TERMS),
    marketing: countMatches(terms, MARKETING_TERMS),
    planning:  countMatches(terms, PLANNING_TERMS),
  };
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'general';
}

// ── Domain hints — boost local registry ranking for known queries ───────────

const DOMAIN_HINTS = [
  { terms: ['security', 'api', 'input', 'validation'], skills: ['security-best-practices'], relevance: 0.95, reason: 'security/API/input-validation domain hint' },
  { terms: ['browser', 'automation'], skills: ['agent-browser'], relevance: 0.95, reason: 'agent-browser automation domain hint' },
  { terms: ['qa', 'test', 'web'], skills: ['agent-browser'], relevance: 0.9, reason: 'agent-browser web QA domain hint' },
  { terms: ['branch', 'commit'], skills: ['git-flow'], relevance: 0.85, reason: 'git workflow domain hint' },
  { terms: ['research', 'market'], skills: ['research-autopilot'], relevance: 0.85, reason: 'research/market analysis domain hint' },
  { terms: ['contract', 'law'], skills: ['contract-review'], relevance: 0.85, reason: 'legal/contract review domain hint' },
  // Sprint 4 — gstack domain skills (marketing/planning)
  { terms: ['marketing', 'landing'], skills: ['gstack/landing-report'], relevance: 0.9, reason: 'gstack marketing/landing domain hint' },
  { terms: ['sprint', 'retro'], skills: ['gstack/retro'], relevance: 0.9, reason: 'gstack sprint retro domain hint' },
  { terms: ['ceo', 'strategy'], skills: ['gstack/plan-ceo-review'], relevance: 0.9, reason: 'gstack CEO strategy review domain hint' },
];

function relevanceOf(skill) {
  return skill && skill.breakdown && typeof skill.breakdown.relevance === 'number'
    ? skill.breakdown.relevance
    : 0;
}

function matchedHint(query, skillName) {
  const terms = queryTerms(query);
  return DOMAIN_HINTS.find(hint => (
    hint.skills.includes(skillName)
    && hint.terms.every(term => terms.includes(term))
  ));
}

function withRouterRelevance(query, ranked) {
  return ranked
    .map(skill => {
      const hint = matchedHint(query, skill.name);
      if (!hint) return skill;
      const nextBreakdown = {
        ...(skill.breakdown || {}),
        relevance: Math.max(relevanceOf(skill), hint.relevance),
        routerHint: hint.reason,
      };
      const nextScore = Math.max(skill.score || 0, hint.relevance);
      return { ...skill, score: nextScore, breakdown: nextBreakdown };
    })
    .sort((a, b) => (b.score || 0) - (a.score || 0));
}

// ── Local registry helpers ───────────────────────────────────────────────────

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
}

function loadInstallCountMap(file) {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')).counts || {};
  } catch { return {}; }
}

function rankLocalSkills(query, options = {}) {
  const rankerPath   = options.rankerPath || RANKER_PATH;
  const digestPath   = options.digestPath || DIGEST_PATH;
  const historyPath  = options.historyPath || HISTORY_PATH;
  const installsPath = options.installsPath || INSTALLS_PATH;

  if (!fs.existsSync(rankerPath) || !fs.existsSync(digestPath)) return [];

  const ranker = require(rankerPath);
  const digests = loadJsonl(digestPath);
  const history = loadJsonl(historyPath);
  const installCountMap = loadInstallCountMap(installsPath);

  return withRouterRelevance(query, ranker.rankSkills(digests, query, history, {}, installCountMap));
}

// ── skillgrab — project-context skill plan (coding-domain queries) ──────────

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonSafe(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data), 'utf8');
  } catch { /* fail-soft */ }
}

function skillgrabCachePath() {
  return path.join(AMOS_DIR, '.cache', 'skillgrab-cache.json');
}

function runSkillgrab(cwd, options = {}) {
  const cachePath = options.cachePath || skillgrabCachePath();
  const now = options.now || (() => Date.now());
  const cache = readJsonSafe(cachePath) || {};
  const cached = cache[cwd];
  if (cached && (now() - cached.ts) < SKILLGRAB_CACHE_TTL_MS) {
    return cached;
  }

  const runner = options.runner || spawnSync;
  let entry;
  try {
    const result = runner('skillgrab --json --dry-run --agent claude-code', [], {
      cwd, timeout: 8000, encoding: 'utf8', shell: true,
    });
    if (result && result.status === 0 && result.stdout) {
      const data = JSON.parse(result.stdout);
      entry = {
        status: 'ok',
        plan: (data.plan || []).slice(0, 2).map(p => p.skillName || p.slug).filter(Boolean),
        ts: now(),
      };
    } else {
      const err = result && (result.error ? result.error.message : (result.stderr || '').trim());
      entry = { status: 'error', error: err || 'skillgrab failed', plan: [], ts: now() };
    }
  } catch (err) {
    entry = { status: 'error', error: err.message, plan: [], ts: now() };
  }

  cache[cwd] = entry;
  writeJsonSafe(cachePath, cache);
  return entry;
}

// ── Context7 / codemap hints ─────────────────────────────────────────────────

const CONTEXT7_TRIGGER_TERMS = ['library', 'package', 'sdk', 'framework', 'npm', 'dependency'];

function context7Hint(query) {
  const terms = queryTerms(query);
  if (CONTEXT7_TRIGGER_TERMS.some(t => terms.includes(t))) {
    return 'External library detected: ctx7 library <name> && ctx7 docs <id> "<topic>" before use';
  }
  return null;
}

function codemapHint(root) {
  try {
    if (fs.existsSync(path.join(root, 'graphify-out', 'graph.json'))) {
      return 'codemap ready: cmd /c graphify query "<task>" before reading files';
    }
  } catch { /* fail-soft */ }
  return 'codemap not initialized: node tools/codemap.js setup --root .';
}

// ── Preflight record ──────────────────────────────────────────────────────────

function buildPreflight(query, options = {}) {
  const now  = options.now || (() => Date.now());
  const root = options.root || process.cwd();

  const domain = detectDomain(query);
  const ranked = rankLocalSkills(query, options);

  const top = ranked[0];
  const topRelevance = relevanceOf(top);
  const selected = (top && topRelevance >= RELEVANCE_THRESHOLD) ? top.name : 'no skill';

  const local = ranked
    .filter(s => relevanceOf(s) >= RELEVANCE_THRESHOLD)
    .slice(0, 2)
    .map(s => ({ name: s.name, relevance: Math.round(relevanceOf(s) * 100) / 100 }));

  const gstack = local.filter(s => s.name.startsWith('gstack/'));

  let skillgrab = { status: 'skipped', plan: [] };
  if (domain === 'coding') {
    const result = runSkillgrab(root, options.skillgrabOptions || {});
    skillgrab = { status: result.status, plan: result.plan || [] };
  }

  return {
    kind: 'preflight',
    query,
    domain,
    selected,
    local,
    gstack,
    skillgrab,
    context7: context7Hint(query),
    codemap: codemapHint(root),
    ts: new Date(now()).toISOString(),
  };
}

function formatPreflightContext(record) {
  const lines = [
    `AMOS Preflight: "${record.query}"`,
    `Domain: ${record.domain} | Selected: ${record.selected}`,
  ];
  if (record.local.length) {
    lines.push(`Local: ${record.local.map(s => `${s.name}(${s.relevance})`).join(', ')}`);
  }
  if (record.gstack.length) {
    lines.push(`gstack: ${record.gstack.map(s => s.name).join(', ')}`);
  }
  if (record.skillgrab.status !== 'skipped') {
    const plan = record.skillgrab.plan.length ? ` -> ${record.skillgrab.plan.join(', ')}` : '';
    lines.push(`skillgrab: ${record.skillgrab.status}${plan}`);
  }
  if (record.context7) lines.push(`Context7: ${record.context7}`);
  if (record.codemap) lines.push(`Codemap: ${record.codemap}`);
  return lines.join('\n');
}

// ── Preflight artifact (.planning/preflight-latest.json) ─────────────────────

function checkPreflightArtifact(root, now = new Date()) {
  const file = path.join(root, '.planning', 'preflight-latest.json');
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ts = value.ts ? new Date(value.ts) : null;
    const stale = !ts || Number.isNaN(ts.getTime()) || (now.getTime() - ts.getTime()) > PREFLIGHT_TTL_MS;
    return { ok: true, value, stale, file };
  } catch (err) {
    return { ok: false, error: err.message, file };
  }
}

// ── Benchmark ─────────────────────────────────────────────────────────────────

const PREFLIGHT_BENCHMARKS = [
  // --- ported from tools/skill-search.js SKILL_ROUTER_BENCHMARKS (10/10) ---
  { query: 'browser automation ai agent', allow: ['agent-browser'], avoid: ['init-project', 'sync-docs', 'clone-research'] },
  { query: 'security api input validation', allow: ['security-best-practices'] },
  { query: 'create feature branch commit push pr', allow: ['git-flow'] },
  { query: 'update project readme documentation', avoid: ['init-project'] },
  { query: 'build rest api endpoint validation', allow: ['no skill', 'tdd', 'sprint', 'security-best-practices'] },
  { query: 'design react component ui layout', allow: ['no skill', 'design-an-interface'] },
  { query: 'research competitor market analysis', allow: ['research-autopilot'] },
  { query: 'contract review procurement ukraine law', allow: ['contract-review'] },
  { query: 'qa test web interface bugs', allow: ['agent-browser'] },
  { query: 'zzzzzz low confidence nonsense', allow: ['no skill'] },
  // --- new for Sprint 4: marketing/planning -> gstack, coding -> skillgrab ---
  { query: 'create marketing landing page copy and design review', domain: 'marketing', expectGstack: true, allow: ['gstack/landing-report'] },
  { query: 'plan sprint retro and roadmap review', domain: 'planning', expectGstack: true, allow: ['gstack/retro'] },
  { query: 'design ceo strategy review for product roadmap', domain: 'planning', expectGstack: true, allow: ['gstack/plan-ceo-review'] },
  { query: 'add npm package dependency and refactor module code', domain: 'coding', expectSkillgrab: true },
  { query: 'fix bug in javascript function and write unit tests', domain: 'coding', expectSkillgrab: true, allow: ['no skill', 'tdd', 'sprint', 'fix-issue'] },
];

function evaluatePreflightBenchmarks(records) {
  const results = PREFLIGHT_BENCHMARKS.map(benchmark => {
    const record = records[benchmark.query];
    const selected = record && record.selected ? record.selected : '';
    const checks = [];
    if (benchmark.allow) checks.push(benchmark.allow.includes(selected));
    if (benchmark.avoid) checks.push(!benchmark.avoid.includes(selected));
    if (benchmark.domain) checks.push(!!record && record.domain === benchmark.domain);
    if (benchmark.expectGstack) checks.push(!!(record && record.gstack && record.gstack.length > 0));
    if (benchmark.expectSkillgrab) checks.push(!!(record && record.skillgrab && record.skillgrab.status !== 'skipped'));
    return {
      query: benchmark.query,
      selected,
      domain: record && record.domain,
      status: checks.length > 0 && checks.every(Boolean) ? 'pass' : 'fail',
      allow: benchmark.allow || [],
      avoid: benchmark.avoid || [],
    };
  });
  return {
    status: results.every(r => r.status === 'pass') ? 'pass' : 'fail',
    results,
  };
}

module.exports = {
  detectDomain,
  withRouterRelevance,
  rankLocalSkills,
  runSkillgrab,
  context7Hint,
  codemapHint,
  buildPreflight,
  formatPreflightContext,
  checkPreflightArtifact,
  evaluatePreflightBenchmarks,
  PREFLIGHT_BENCHMARKS,
  PREFLIGHT_BUDGET_BYTES,
  RELEVANCE_THRESHOLD,
};
