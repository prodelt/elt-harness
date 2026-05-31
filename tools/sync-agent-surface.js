#!/usr/bin/env node
'use strict';

/**
 * sync-agent-surface.js — sync skills from Claude → Codex/Gemini
 *
 * Usage:
 *   node tools/sync-agent-surface.js --dry-run --json
 *   node tools/sync-agent-surface.js --apply --target gemini
 *   node tools/sync-agent-surface.js --apply --target codex
 *   node tools/sync-agent-surface.js --apply --target all
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const HOME = os.homedir();

const CLIENTS = {
  claude: path.join(HOME, '.claude', 'skills'),
  codex:  path.join(HOME, '.codex', 'skills'),
  gemini: path.join(HOME, '.gemini', 'skills'),
};

// Skills that require explicit --include-sensitive to sync
const SENSITIVE_SKILLS = new Set(['red-team']);

// Skills that are client-specific and should not be synced FROM Claude
// (they exist only in other clients intentionally)
const CLIENT_ONLY = {
  gemini: new Set(['architect', 'autofix', 'backend', 'devops', 'frontend', 'graphify', 'nextjs', 'security', 'security-agent', 'supabase']),
};

const SYNC_IGNORE_NAMES = new Set(['.git']);

// ── helpers ──────────────────────────────────────────────────────────────────

function listSkillDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => {
      if (f.startsWith('.')) return false;
      return fs.statSync(path.join(dir, f)).isDirectory();
    })
    .sort();
}

function dirContentsHash(dir) {
  const entries = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (SYNC_IGNORE_NAMES.has(f)) continue;
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      entries.push(`d:${f}:${dirContentsHash(full)}`);
    } else {
      const h = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      entries.push(`f:${f}:${h}`);
    }
  }
  return entries.join('|');
}

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (SYNC_IGNORE_NAMES.has(f)) continue;
    const srcPath = path.join(src, f);
    const dstPath = path.join(dst, f);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function assertInside(parentDir, childPath) {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') {
    throw new Error(`Refusing to operate outside target skill root: ${child}`);
  }
}

// ── analysis ─────────────────────────────────────────────────────────────────

function analyzeTarget(targetName, targetDir, sourceSkills, sourceDir, opts = {}) {
  const targetSkills = listSkillDirs(targetDir);
  const targetSet = new Set(targetSkills);
  const clientOnly = CLIENT_ONLY[targetName] || new Set();

  const missing = [];
  const conflicts = [];
  const upToDate = [];
  const skipped = [];

  for (const skill of sourceSkills) {
    if (clientOnly.has(skill)) {
      skipped.push({ skill, reason: 'client-only-in-target' });
      continue;
    }
    if (SENSITIVE_SKILLS.has(skill) && !opts.includeSensitive) {
      skipped.push({ skill, reason: 'sensitive-requires-flag' });
      continue;
    }

    if (!targetSet.has(skill)) {
      missing.push(skill);
    } else {
      // both exist — check if different
      const srcHash = dirContentsHash(path.join(sourceDir, skill));
      const dstHash = dirContentsHash(path.join(targetDir, skill));
      if (srcHash !== dstHash) {
        conflicts.push({ skill, note: 'content-differs' });
      } else {
        upToDate.push(skill);
      }
    }
  }

  // skills only in target (not in source) — informational
  const extra = targetSkills.filter(s => !sourceSkills.includes(s));

  return { target: targetName, missing, conflicts, upToDate, skipped, extra };
}

function analyzeAll(opts = {}) {
  const sourceDir = CLIENTS.claude;
  const sourceSkills = listSkillDirs(sourceDir);

  const results = {};
  const targets = opts.target === 'all'
    ? ['codex', 'gemini']
    : [opts.target || 'gemini'];

  for (const t of targets) {
    if (!CLIENTS[t]) continue;
    results[t] = analyzeTarget(t, CLIENTS[t], sourceSkills, sourceDir, opts);
  }

  return { source: 'claude', sourceSkillCount: sourceSkills.length, results };
}

// ── apply ─────────────────────────────────────────────────────────────────────

function applySync(analysis, opts = {}) {
  const applied = [];
  const errors = [];

  for (const [targetName, result] of Object.entries(analysis.results)) {
    const targetDir = CLIENTS[targetName];
    const sourceDir = CLIENTS.claude;

    for (const skill of result.missing) {
      try {
        const src = path.join(sourceDir, skill);
        const dst = path.join(targetDir, skill);
        copyDirSync(src, dst);
        applied.push({ target: targetName, skill, action: 'copied' });
      } catch (err) {
        errors.push({ target: targetName, skill, error: err.message });
      }
    }

    if (opts.force) {
      for (const { skill } of result.conflicts) {
        try {
          const src = path.join(sourceDir, skill);
          const dst = path.join(targetDir, skill);
          assertInside(targetDir, dst);
          fs.rmSync(dst, { recursive: true, force: true });
          copyDirSync(src, dst);
          applied.push({ target: targetName, skill, action: 'overwritten' });
        } catch (err) {
          errors.push({ target: targetName, skill, error: err.message });
        }
      }
    }
  }

  return { applied, errors };
}

// ── formatting ────────────────────────────────────────────────────────────────

function printReport(analysis, applyResult) {
  console.log('\nAgent Surface Sync Report');
  console.log('=========================');
  console.log(`Source: claude (${analysis.sourceSkillCount} skill dirs)`);

  for (const [name, r] of Object.entries(analysis.results)) {
    console.log(`\n[${name.toUpperCase()}]`);
    if (r.missing.length) {
      console.log(`  Missing (${r.missing.length}): ${r.missing.join(', ')}`);
    } else {
      console.log('  Missing: none');
    }
    if (r.conflicts.length) {
      console.log(`  Conflicts (${r.conflicts.length}): ${r.conflicts.map(c => c.skill).join(', ')}`);
    }
    if (r.skipped.length) {
      console.log(`  Skipped (${r.skipped.length}): ${r.skipped.map(s => `${s.skill}(${s.reason})`).join(', ')}`);
    }
    console.log(`  Up-to-date: ${r.upToDate.length}`);
    if (r.extra.length) {
      console.log(`  Target-only extras: ${r.extra.join(', ')}`);
    }
  }

  if (applyResult) {
    console.log('\n[APPLIED]');
    if (applyResult.applied.length) {
      for (const a of applyResult.applied) {
        console.log(`  ${a.action}: ${a.target}/${a.skill}`);
      }
    }
    if (applyResult.errors.length) {
      for (const e of applyResult.errors) {
        console.log(`  ERROR ${e.target}/${e.skill}: ${e.error}`);
      }
    }
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isApply = args.includes('--apply');
  const isJson = args.includes('--json');
  const isForce = args.includes('--force');
  const includeSensitive = args.includes('--include-sensitive');

  const targetIdx = args.indexOf('--target');
  const target = targetIdx >= 0 ? args[targetIdx + 1] : 'gemini';

  const opts = { target, force: isForce, includeSensitive };
  const analysis = analyzeAll(opts);

  let applyResult = null;
  if (isApply && !isDryRun) {
    applyResult = applySync(analysis, opts);
  }

  const output = {
    dryRun: isDryRun || !isApply,
    source: analysis.source,
    sourceSkillCount: analysis.sourceSkillCount,
    results: analysis.results,
    ...(applyResult ? { applied: applyResult } : {}),
  };

  if (isJson) {
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    return;
  }

  printReport(analysis, applyResult);

  if (!isApply && !isDryRun) {
    console.log('\nRun with --dry-run to preview or --apply to sync missing skills.');
  }
}

main();
