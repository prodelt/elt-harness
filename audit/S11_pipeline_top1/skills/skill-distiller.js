#!/usr/bin/env node
'use strict';
// Task 38 — Skill Distiller: deterministic digest + budget governor

const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_DIGEST_PATH = path.join(os.homedir(), '.claude', 'skill-registry', 'digests.jsonl');
const DIGEST_TTL_H = 48;

// Skill category classification patterns
const ORCHESTRATOR_NAMES = new Set(['pipeline', 'company', 'sprint', 'orchestrate']);
const VERIFIER_NAMES = new Set(['inline-review', 'code-review', 'verify', 'ship', 'security-review', 'eval', 'test-coverage']);
const DOMAIN_NAMES = new Set([
  'architect-first', 'cto-playbook', 'tdd', 'red-team', 'security-best-practices',
  'reference-design-adaptation', 'mikrotik-audit', 'contract-review',
  'frontend', 'backend', 'security', 'qa', 'devops',
]);

const NETWORK_PATTERNS = /\b(fetch|axios|http|curl|wget|api\.get|api\.post|WebFetch|WebSearch)\b/i;
const DESTRUCTIVE_PATTERNS = /\b(rm -rf|git reset --hard|DROP TABLE|git push --force|format|DELETE FROM|truncate)\b/i;
const HIGH_RISK_PATTERNS = /\b(production|deploy|migrate|irreversible|destructive)\b/i;

function parseFrontmatter(raw) {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const m = normalized.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const yaml = m[1];
  const result = {};
  for (const line of yaml.split('\n')) {
    const kv = line.match(/^(\w[\w-]*):\s*(.*)/);
    if (kv) result[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return result;
}

function extractSection(body, heading) {
  const re = new RegExp(`#+\\s+${heading}[^\n]*\n([\\s\\S]*?)(?=\n#+\\s|$)`, 'i');
  const m = body.match(re);
  return m ? m[1].trim() : null;
}

function classifySkill(name, description, body) {
  const nameLower = (name || '').toLowerCase();
  if (ORCHESTRATOR_NAMES.has(nameLower)) return 'orchestrator';
  if (VERIFIER_NAMES.has(nameLower)) return 'verifier';
  if (DOMAIN_NAMES.has(nameLower)) return 'domain';
  const descLower = (description || '').toLowerCase();
  if (/orchestrat|delegat|route.*sub.?skill|spawn.*agent/i.test(descLower + body)) return 'orchestrator';
  if (/review|verify|audit|check|test|validate/i.test(descLower)) return 'verifier';
  if (/architect|design|security|frontend|backend|devops/i.test(descLower)) return 'domain';
  return 'utility';
}

function estimateTokens(raw) {
  return Math.ceil(raw.length / 4);
}

function assessRisk(body) {
  if (DESTRUCTIVE_PATTERNS.test(body)) return 'high';
  if (HIGH_RISK_PATTERNS.test(body)) return 'medium';
  return 'low';
}

function distillSkill(skillDir) {
  const mdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(mdPath)) {
    throw new Error(`SKILL.md not found in ${skillDir}`);
  }
  const raw = fs.readFileSync(mdPath, 'utf8');
  const fm = parseFrontmatter(raw);
  const bodyStart = raw.indexOf('---', 3);
  const body = bodyStart >= 0 ? raw.slice(bodyStart + 3).trim() : raw;

  const name = fm.name || path.basename(skillDir);
  const version = fm.version || null;
  const description = fm.description || '';
  const trigger = fm.trigger || '';

  // use_when: first 150 chars of description + trigger keywords
  const useWhen = (description.slice(0, 150) + (trigger ? ` Triggered by: ${trigger.slice(0, 60)}` : '')).trim();

  // avoid_when: from "When NOT to Use" section
  const avoidSection = extractSection(body, 'When NOT to Use') || extractSection(body, 'Not Use') || extractSection(body, 'Avoid');
  const avoidWhen = avoidSection ? avoidSection.replace(/\n+/g, ' ').slice(0, 200).trim() : null;

  const requiresNetwork = NETWORK_PATTERNS.test(body);
  const risk = assessRisk(body);
  const verified = Boolean(version && ('changelog' in fm));
  const tokenEstimate = estimateTokens(raw);
  const category = classifySkill(name, description, body);

  return {
    name,
    version,
    category,
    use_when: useWhen,
    avoid_when: avoidWhen,
    requires_network: requiresNetwork,
    risk,
    verified,
    token_estimate: tokenEstimate,
    digest_ts: new Date().toISOString(),
    skill_dir: skillDir,
  };
}

// ─── Budget Governor ───────────────────────────────────────────────────────

const BUDGET = { orchestrator: 1, domain: 1, verifier: 1 };

function checkBudget(activeSkills, overrideMode = false) {
  if (overrideMode) return { ok: true, violations: [] };
  const counts = { orchestrator: 0, domain: 0, verifier: 0, utility: 0 };
  for (const s of activeSkills) {
    const cat = s.category || 'utility';
    if (cat in counts) counts[cat]++;
  }
  const violations = [];
  for (const [cat, limit] of Object.entries(BUDGET)) {
    if (counts[cat] > limit) {
      violations.push(`${counts[cat]} ${cat} skills active (max ${limit})`);
    }
  }
  return { ok: violations.length === 0, violations, counts };
}

// ─── Cache ────────────────────────────────────────────────────────────────

function loadDigestCache(cachePath) {
  if (!fs.existsSync(cachePath)) return {};
  const cache = {};
  for (const line of fs.readFileSync(cachePath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec.name) cache[rec.name] = rec;
    } catch {}
  }
  return cache;
}

function saveDigestCache(cachePath, cache) {
  const dir = path.dirname(cachePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const lines = Object.values(cache).map(r => JSON.stringify(r)).join('\n');
  fs.writeFileSync(cachePath, lines + '\n', 'utf8');
}

function isFresh(digest) {
  if (!digest || !digest.digest_ts) return false;
  const ageH = (Date.now() - new Date(digest.digest_ts).getTime()) / 3_600_000;
  return ageH < DIGEST_TTL_H;
}

// ─── CLI ──────────────────────────────────────────────────────────────────

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

if (require.main === module) {
  const args = parseArgs(process.argv);

  if (args['check-budget']) {
    // Mode: validate budget for a set of skill names
    // --skills pipeline,architect-first,inline-review,tdd [--override]
    const names = String(args.skills || '').split(',').map(s => s.trim()).filter(Boolean);
    const activeSkills = names.map(n => ({ name: n, category: classifySkill(n, '', '') }));
    const result = checkBudget(activeSkills, Boolean(args.override));
    if (args.json) {
      process.stdout.write(JSON.stringify({ ok: result.ok, violations: result.violations, counts: result.counts }) + '\n');
    } else {
      if (result.ok) {
        process.stdout.write('BUDGET OK — skills: ' + names.join(', ') + '\n');
      } else {
        process.stderr.write('BUDGET VIOLATION:\n');
        result.violations.forEach(v => process.stderr.write('  ✖ ' + v + '\n'));
        process.exit(1);
      }
    }
    process.exit(result.ok ? 0 : 1);
  }

  const cachePath = args.cache || DEFAULT_DIGEST_PATH;
  const cache = loadDigestCache(cachePath);

  if (args['distill-all'] && args['skills-root']) {
    const root = args['skills-root'];
    const dirs = fs.readdirSync(root).filter(d => fs.existsSync(path.join(root, d, 'SKILL.md')));
    const results = [];
    for (const d of dirs) {
      const skillDir = path.join(root, d);
      const existing = cache[d];
      if (!args.force && isFresh(existing)) {
        results.push({ name: d, cached: true, digest: existing });
        continue;
      }
      try {
        const digest = distillSkill(skillDir);
        cache[digest.name] = digest;
        results.push({ name: d, cached: false, digest });
      } catch (e) {
        results.push({ name: d, error: e.message });
      }
    }
    saveDigestCache(cachePath, cache);
    if (args.json) {
      process.stdout.write(JSON.stringify({ distilled: results.length, results }) + '\n');
    } else {
      results.forEach(r => {
        if (r.error) process.stderr.write(`  ✖ ${r.name}: ${r.error}\n`);
        else process.stdout.write(`  ${r.cached ? '~' : '✓'} ${r.name} [${r.digest.category}] ~${r.digest.token_estimate}tok\n`);
      });
    }
    process.exit(0);
  }

  if (!args['skill-dir']) {
    process.stderr.write('Usage: skill-distiller.js --skill-dir <path> [--cache <path>] [--force] [--json]\n');
    process.stderr.write('       skill-distiller.js --check-budget --skills <a,b,c> [--override] [--json]\n');
    process.stderr.write('       skill-distiller.js --distill-all --skills-root <dir> [--cache <path>] [--json]\n');
    process.exit(1);
  }

  const skillDir = path.resolve(args['skill-dir']);
  const existing = cache[path.basename(skillDir)];
  if (!args.force && isFresh(existing)) {
    if (args.json) process.stdout.write(JSON.stringify({ cached: true, digest: existing }) + '\n');
    else process.stdout.write(`(cached) ${existing.name} ${existing.category}\n`);
    process.exit(0);
  }

  try {
    const digest = distillSkill(skillDir);
    cache[digest.name] = digest;
    saveDigestCache(cachePath, cache);
    if (args.json) {
      process.stdout.write(JSON.stringify({ cached: false, digest }) + '\n');
    } else {
      const out = [
        `name:             ${digest.name}`,
        `category:         ${digest.category}`,
        `version:          ${digest.version || '—'}`,
        `risk:             ${digest.risk}`,
        `requires_network: ${digest.requires_network}`,
        `verified:         ${digest.verified}`,
        `token_estimate:   ${digest.token_estimate}`,
        `use_when:         ${digest.use_when.slice(0, 100)}`,
        digest.avoid_when ? `avoid_when:       ${digest.avoid_when.slice(0, 100)}` : null,
      ].filter(Boolean).join('\n');
      process.stdout.write(out + '\n');
    }
  } catch (e) {
    process.stderr.write('ERROR: ' + e.message + '\n');
    process.exit(1);
  }
}

module.exports = { distillSkill, checkBudget, isFresh, loadDigestCache, saveDigestCache, parseFrontmatter, estimateTokens };
