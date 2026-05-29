#!/usr/bin/env node
'use strict';

/**
 * Tests for sync-agent-surface.js
 * Uses temp directories to avoid touching real skill dirs.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    process.stdout.write(`  [PASS] ${label}\n`);
  } else {
    failed++;
    process.stdout.write(`  [FAIL] ${label}\n`);
  }
}

function assertEqual(a, b, label) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) {
    process.stdout.write(`  [FAIL] ${label}\n    expected: ${JSON.stringify(b)}\n    got:      ${JSON.stringify(a)}\n`);
    failed++;
  } else {
    passed++;
    process.stdout.write(`  [PASS] ${label}\n`);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
  return dir;
}

function makeSkillDir(base, skillName, files = { 'SKILL.md': '# skill' }) {
  const dir = path.join(base, skillName);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

function cleanup(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ── inline module (extracted logic for testing without touching real dirs) ──

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
    const srcPath = path.join(src, f);
    const dstPath = path.join(dst, f);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDirSync(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

const SENSITIVE_SKILLS = new Set(['red-team']);

function analyzeTarget(targetName, targetDir, sourceSkills, sourceDir, opts = {}) {
  const targetSkills = listSkillDirs(targetDir);
  const targetSet = new Set(targetSkills);
  const clientOnly = new Set();

  const missing = [];
  const conflicts = [];
  const upToDate = [];
  const skipped = [];

  for (const skill of sourceSkills) {
    if (clientOnly.has(skill)) { skipped.push({ skill, reason: 'client-only-in-target' }); continue; }
    if (SENSITIVE_SKILLS.has(skill) && !opts.includeSensitive) { skipped.push({ skill, reason: 'sensitive-requires-flag' }); continue; }

    if (!targetSet.has(skill)) {
      missing.push(skill);
    } else {
      const srcHash = dirContentsHash(path.join(sourceDir, skill));
      const dstHash = dirContentsHash(path.join(targetDir, skill));
      if (srcHash !== dstHash) {
        conflicts.push({ skill, note: 'content-differs' });
      } else {
        upToDate.push(skill);
      }
    }
  }

  const extra = targetSkills.filter(s => !sourceSkills.includes(s));
  return { target: targetName, missing, conflicts, upToDate, skipped, extra };
}

function analyzeAll(claudeDir, targetDirs, opts = {}) {
  const sourceSkills = listSkillDirs(claudeDir);
  const results = {};
  for (const [name, dir] of Object.entries(targetDirs)) {
    results[name] = analyzeTarget(name, dir, sourceSkills, claudeDir, opts);
  }
  return { source: 'claude', sourceSkillCount: sourceSkills.length, results };
}

function applySync(analysis, clientDirs, claudeDir, opts = {}) {
  const applied = [];
  const errors = [];

  for (const [targetName, result] of Object.entries(analysis.results)) {
    const targetDir = clientDirs[targetName];

    for (const skill of result.missing) {
      try {
        copyDirSync(path.join(claudeDir, skill), path.join(targetDir, skill));
        applied.push({ target: targetName, skill, action: 'copied' });
      } catch (err) {
        errors.push({ target: targetName, skill, error: err.message });
      }
    }

    if (opts.force) {
      for (const { skill } of result.conflicts) {
        try {
          copyDirSync(path.join(claudeDir, skill), path.join(targetDir, skill));
          applied.push({ target: targetName, skill, action: 'overwritten' });
        } catch (err) {
          errors.push({ target: targetName, skill, error: err.message });
        }
      }
    }
  }

  return { applied, errors };
}

// ── test suites ───────────────────────────────────────────────────────────────

let tmp;

process.stdout.write('\nSync Agent Surface — Unit Tests\n\n');

// Suite 1: listSkillDirs
process.stdout.write('[Suite 1] listSkillDirs\n');
{
  tmp = makeTmpDir();
  makeSkillDir(tmp, 'skill-a');
  makeSkillDir(tmp, 'skill-b');
  fs.writeFileSync(path.join(tmp, 'not-a-dir.md'), 'x');
  fs.mkdirSync(path.join(tmp, '.hidden'));

  const result = listSkillDirs(tmp);
  assertEqual(result, ['skill-a', 'skill-b'], 'returns only non-hidden dirs, sorted');
  assertEqual(listSkillDirs('/nonexistent'), [], 'returns [] for missing dir');
  cleanup(tmp);
}

// Suite 2: dirContentsHash
process.stdout.write('\n[Suite 2] dirContentsHash\n');
{
  tmp = makeTmpDir();
  const a = path.join(tmp, 'a');
  const b = path.join(tmp, 'b');
  const c = path.join(tmp, 'c');
  makeSkillDir(tmp, 'a', { 'SKILL.md': 'same content' });
  makeSkillDir(tmp, 'b', { 'SKILL.md': 'same content' });
  makeSkillDir(tmp, 'c', { 'SKILL.md': 'different content' });

  assert(dirContentsHash(a) === dirContentsHash(b), 'identical content = same hash');
  assert(dirContentsHash(a) !== dirContentsHash(c), 'different content = different hash');
  cleanup(tmp);
}

// Suite 3: analyzeTarget — missing skills
process.stdout.write('\n[Suite 3] analyzeTarget — missing\n');
{
  tmp = makeTmpDir();
  const src = path.join(tmp, 'source');
  const dst = path.join(tmp, 'target');
  fs.mkdirSync(src); fs.mkdirSync(dst);
  makeSkillDir(src, 'skill-a');
  makeSkillDir(src, 'skill-b');
  makeSkillDir(src, 'red-team');

  const result = analyzeTarget('gemini', dst, ['skill-a', 'skill-b', 'red-team'], src);
  assertEqual(result.missing, ['skill-a', 'skill-b'], 'missing lists skills absent from target');
  assertEqual(result.skipped.length, 1, 'red-team is skipped without --include-sensitive');
  assertEqual(result.skipped[0].reason, 'sensitive-requires-flag', 'skipped reason is correct');
  cleanup(tmp);
}

// Suite 4: analyzeTarget — conflicts and up-to-date
process.stdout.write('\n[Suite 4] analyzeTarget — conflicts/upToDate\n');
{
  tmp = makeTmpDir();
  const src = path.join(tmp, 'source');
  const dst = path.join(tmp, 'target');
  fs.mkdirSync(src); fs.mkdirSync(dst);
  makeSkillDir(src, 'same-skill', { 'SKILL.md': 'shared' });
  makeSkillDir(src, 'diff-skill', { 'SKILL.md': 'source version' });
  makeSkillDir(dst, 'same-skill', { 'SKILL.md': 'shared' });
  makeSkillDir(dst, 'diff-skill', { 'SKILL.md': 'target different' });

  const result = analyzeTarget('gemini', dst, ['same-skill', 'diff-skill'], src);
  assertEqual(result.upToDate, ['same-skill'], 'identical skill is up-to-date');
  assertEqual(result.conflicts.length, 1, 'differing skill detected as conflict');
  assertEqual(result.conflicts[0].skill, 'diff-skill', 'conflict skill named correctly');
  cleanup(tmp);
}

// Suite 5: analyzeTarget — extras in target
process.stdout.write('\n[Suite 5] analyzeTarget — extra target-only skills\n');
{
  tmp = makeTmpDir();
  const src = path.join(tmp, 'source');
  const dst = path.join(tmp, 'target');
  fs.mkdirSync(src); fs.mkdirSync(dst);
  makeSkillDir(src, 'skill-a');
  makeSkillDir(dst, 'skill-a');
  makeSkillDir(dst, 'target-only');

  const result = analyzeTarget('gemini', dst, ['skill-a'], src);
  assertEqual(result.extra, ['target-only'], 'target-only skill listed as extra');
  cleanup(tmp);
}

// Suite 6: analyzeAll — multi-target
process.stdout.write('\n[Suite 6] analyzeAll — multi-target\n');
{
  tmp = makeTmpDir();
  const claude = path.join(tmp, 'claude');
  const codex  = path.join(tmp, 'codex');
  const gemini = path.join(tmp, 'gemini');
  fs.mkdirSync(claude); fs.mkdirSync(codex); fs.mkdirSync(gemini);
  makeSkillDir(claude, 'skill-x');
  makeSkillDir(codex, 'skill-x');
  // gemini missing skill-x

  const analysis = analyzeAll(claude, { codex, gemini });
  assert('codex' in analysis.results, 'codex in results');
  assert('gemini' in analysis.results, 'gemini in results');
  assertEqual(analysis.results.codex.missing, [], 'codex has all skills');
  assertEqual(analysis.results.gemini.missing, ['skill-x'], 'gemini missing skill-x');
  assertEqual(analysis.sourceSkillCount, 1, 'source skill count correct');
  cleanup(tmp);
}

// Suite 7: applySync — copies missing skills
process.stdout.write('\n[Suite 7] applySync — copies missing skills\n');
{
  tmp = makeTmpDir();
  const claude = path.join(tmp, 'claude');
  const gemini = path.join(tmp, 'gemini');
  fs.mkdirSync(claude); fs.mkdirSync(gemini);
  makeSkillDir(claude, 'new-skill', { 'SKILL.md': 'content here' });

  const analysis = analyzeAll(claude, { gemini });
  assert(analysis.results.gemini.missing.includes('new-skill'), 'new-skill in missing');

  const applyResult = applySync(analysis, { gemini }, claude);
  assertEqual(applyResult.errors, [], 'no errors during apply');
  assert(applyResult.applied.length === 1, 'one skill applied');
  assertEqual(applyResult.applied[0], { target: 'gemini', skill: 'new-skill', action: 'copied' }, 'apply record correct');
  assert(fs.existsSync(path.join(gemini, 'new-skill', 'SKILL.md')), 'SKILL.md copied to target');
  assertEqual(
    fs.readFileSync(path.join(gemini, 'new-skill', 'SKILL.md'), 'utf8'),
    'content here',
    'file content preserved'
  );
  cleanup(tmp);
}

// Suite 8: applySync — does not overwrite conflicts without --force
process.stdout.write('\n[Suite 8] applySync — conflict not overwritten without --force\n');
{
  tmp = makeTmpDir();
  const claude = path.join(tmp, 'claude');
  const gemini = path.join(tmp, 'gemini');
  fs.mkdirSync(claude); fs.mkdirSync(gemini);
  makeSkillDir(claude, 'pipeline', { 'SKILL.md': 'claude version' });
  makeSkillDir(gemini, 'pipeline', { 'SKILL.md': 'gemini version' });

  const analysis = analyzeAll(claude, { gemini });
  assert(analysis.results.gemini.conflicts.length === 1, 'conflict detected');

  const applyResult = applySync(analysis, { gemini }, claude);
  assertEqual(applyResult.applied, [], 'nothing applied without --force');
  assertEqual(
    fs.readFileSync(path.join(gemini, 'pipeline', 'SKILL.md'), 'utf8'),
    'gemini version',
    'target file not overwritten'
  );
  cleanup(tmp);
}

// Suite 9: applySync — force-overwrites conflicts
process.stdout.write('\n[Suite 9] applySync — force overwrites conflicts\n');
{
  tmp = makeTmpDir();
  const claude = path.join(tmp, 'claude');
  const gemini = path.join(tmp, 'gemini');
  fs.mkdirSync(claude); fs.mkdirSync(gemini);
  makeSkillDir(claude, 'pipeline', { 'SKILL.md': 'claude v3' });
  makeSkillDir(gemini, 'pipeline', { 'SKILL.md': 'gemini old' });

  const analysis = analyzeAll(claude, { gemini });
  const applyResult = applySync(analysis, { gemini }, claude, { force: true });
  assert(applyResult.applied.length === 1, 'one skill overwritten');
  assertEqual(applyResult.applied[0].action, 'overwritten', 'action is overwritten');
  assertEqual(
    fs.readFileSync(path.join(gemini, 'pipeline', 'SKILL.md'), 'utf8'),
    'claude v3',
    'file overwritten with source content'
  );
  cleanup(tmp);
}

// Suite 10: applySync — idempotent (second apply = no changes)
process.stdout.write('\n[Suite 10] applySync — idempotent after first apply\n');
{
  tmp = makeTmpDir();
  const claude = path.join(tmp, 'claude');
  const gemini = path.join(tmp, 'gemini');
  fs.mkdirSync(claude); fs.mkdirSync(gemini);
  makeSkillDir(claude, 'skill-a', { 'SKILL.md': 'a' });

  // First apply
  const a1 = analyzeAll(claude, { gemini });
  applySync(a1, { gemini }, claude);

  // Second apply
  const a2 = analyzeAll(claude, { gemini });
  const r2 = applySync(a2, { gemini }, claude);
  assertEqual(r2.applied, [], 'second apply makes no changes');
  assertEqual(a2.results.gemini.missing, [], 'nothing missing after first apply');
  assertEqual(a2.results.gemini.upToDate, ['skill-a'], 'skill is up-to-date');
  cleanup(tmp);
}

// Suite 11: sensitive skill skipped by default, synced with flag
process.stdout.write('\n[Suite 11] sensitive skill handling\n');
{
  tmp = makeTmpDir();
  const claude = path.join(tmp, 'claude');
  const gemini = path.join(tmp, 'gemini');
  fs.mkdirSync(claude); fs.mkdirSync(gemini);
  makeSkillDir(claude, 'red-team');

  const r1 = analyzeTarget('gemini', gemini, ['red-team'], claude, {});
  assertEqual(r1.skipped.length, 1, 'red-team skipped without flag');
  assertEqual(r1.missing, [], 'red-team not in missing without flag');

  const r2 = analyzeTarget('gemini', gemini, ['red-team'], claude, { includeSensitive: true });
  assertEqual(r2.missing, ['red-team'], 'red-team in missing with flag');
  assertEqual(r2.skipped, [], 'no skipped entries with flag');
  cleanup(tmp);
}

// Suite 12: CLI dry-run outputs JSON
process.stdout.write('\n[Suite 12] CLI --dry-run --json\n');
{
  let output;
  try {
    output = execSync(
      'node tools/sync-agent-surface.js --dry-run --json',
      { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 10000 }
    );
    const data = JSON.parse(output);
    assert(data.dryRun === true, 'dryRun=true in output');
    assert(typeof data.sourceSkillCount === 'number', 'sourceSkillCount is number');
    assert(typeof data.results === 'object', 'results is object');
    assert('gemini' in data.results, 'gemini in results');
  } catch (err) {
    assert(false, `CLI dry-run failed: ${err.message}`);
  }
}

// ── summary ───────────────────────────────────────────────────────────────────

process.stdout.write(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
