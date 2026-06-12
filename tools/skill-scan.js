#!/usr/bin/env node
'use strict';

/**
 * skill-scan.js — Node wrapper around NVIDIA SkillSpector (static-only).
 *
 * Vets an agent-skill path (single skill, pack, or repo) for security risk
 * BEFORE it is installed/promoted, then applies an HONEST gate that
 * distinguishes real executable risk from documentation false-positives.
 *
 * Why a custom gate: SkillSpector's static stage is high-recall / low-precision
 * by design (the LLM stage is meant to filter). On reputable doc-skills it
 * fires HIGH findings simply because a skill *describes* a dangerous pattern
 * (e.g. git-guardrails lists `git reset --hard` in order to BLOCK it, or a
 * skill teaches prompt-injection defense). The published research shows the
 * real risk lives in EXECUTABLE scripts, not in markdown prose. So we gate:
 *
 *   blocked  -> HIGH/CRITICAL finding in an executable component (real code),
 *               OR any hard-block signature (YARA malware, credential-exfil
 *               taint chain, input->exec taint, dangerous-execution chain,
 *               harmful content) regardless of file type.
 *   review   -> HIGH/CRITICAL finding only in non-executable (markdown) files
 *               for prose categories -> advisory, needs human acknowledgement.
 *   pass     -> only LOW/MEDIUM findings.
 *
 * Exit codes (for supply-chain gating):
 *   0 pass | 4 review | 3 blocked | 2 scanner error / not installed
 *
 * Usage: node tools/skill-scan.js <path> [--json] [--llm]
 * Static-only by default (no API cost, offline). --llm enables the optional
 * semantic pass (requires an Anthropic/OpenAI key in env).
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SPECTOR_DIR = path.join(REPO_ROOT, 'vendor', 'skill-packs', 'skillspector');

// Signatures that indicate genuine malicious intent — block even in markdown.
const HARD_BLOCK_IDS = new Set([
  'P5', // Harmful content
  'AST8', // Dangerous execution chain (exec/eval + dynamic source)
  'TT3', // Credential exfiltration chain
  'TT5', // External input -> code execution
  'YR1', 'YR2', 'YR3', 'YR4', // YARA: malware / webshell / cryptominer / hacktool
]);

// Categories whose HIGH findings represent real CODE behavior (block only when
// they appear inside an executable component).
const CODE_CATEGORIES = new Set([
  'Behavioral AST',
  'Taint Tracking',
  'Supply Chain',
  'Data Exfiltration',
]);

function resolveBinary() {
  const candidates = [
    path.join(SPECTOR_DIR, '.venv', 'Scripts', 'skillspector.exe'),
    path.join(SPECTOR_DIR, '.venv', 'Scripts', 'skillspector'),
    path.join(SPECTOR_DIR, '.venv', 'bin', 'skillspector'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    target: args.find((a) => !a.startsWith('--')),
    json: args.includes('--json'),
    llm: args.includes('--llm'),
  };
}

function runScan(binary, target, useLlm) {
  const scanArgs = ['scan', target, '--format', 'json'];
  if (!useLlm) scanArgs.push('--no-llm');
  const result = spawnSync(binary, scanArgs, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw new Error(`scanner spawn failed: ${result.error.message}`);
  const stdout = (result.stdout || '').trim();
  if (!stdout) throw new Error(`scanner produced no output (stderr: ${(result.stderr || '').slice(0, 400)})`);
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('scanner output is not JSON');
  return JSON.parse(stdout.slice(start));
}

function fileOf(loc) {
  if (!loc) return null;
  if (typeof loc === 'string') return loc;
  return loc.file || null;
}

/** Apply the honest gate. Returns { verdict, issues, execFileCount }. */
function classify(issues, components) {
  const execFiles = new Set(components.filter((c) => c.executable).map((c) => c.path));
  let blocked = false;
  let review = false;
  const norm = issues.map((i) => {
    const sev = String(i.severity || '').toUpperCase();
    const file = fileOf(i.location);
    const line = i.location && i.location.start_line ? i.location.start_line : null;
    const isExec = file ? execFiles.has(file) : false;
    const high = sev === 'HIGH' || sev === 'CRITICAL';
    let gate = null;
    if (high) {
      if (HARD_BLOCK_IDS.has(i.id)) { blocked = true; gate = 'hard-block'; }
      else if (isExec && CODE_CATEGORIES.has(i.category)) { blocked = true; gate = 'executable-code'; }
      else { review = true; gate = 'advisory-markdown'; }
    }
    return {
      id: i.id, category: i.category, severity: sev,
      confidence: i.confidence, file, line,
      finding: i.finding, executable: isExec, gate,
    };
  });
  const verdict = blocked ? 'blocked' : review ? 'review' : 'pass';
  return { verdict, issues: norm, execFileCount: execFiles.size };
}

function summarize(target, raw) {
  const risk = raw.risk_assessment || {};
  const components = Array.isArray(raw.components) ? raw.components : [];
  const issues = Array.isArray(raw.issues) ? raw.issues : [];
  const { verdict, issues: norm, execFileCount } = classify(issues, components);
  const blocking = norm.filter((i) => i.gate === 'hard-block' || i.gate === 'executable-code');
  const advisory = norm.filter((i) => i.gate === 'advisory-markdown');
  return {
    target,
    rawScore: typeof risk.score === 'number' ? risk.score : null,
    rawSeverity: String(risk.severity || 'UNKNOWN').toUpperCase(),
    verdict, // pass | review | blocked  (the honest gate result)
    componentCount: components.length,
    execFileCount,
    blockingCount: blocking.length,
    advisoryCount: advisory.length,
    blocking: blocking.slice(0, 25),
    advisory: advisory.slice(0, 25),
  };
}

const EXIT = { pass: 0, review: 4, blocked: 3 };

function render(s) {
  const lines = [
    `${s.verdict.toUpperCase()}  raw=${s.rawSeverity}(${s.rawScore})  ` +
      `blocking=${s.blockingCount} advisory=${s.advisoryCount}  exec=${s.execFileCount}/${s.componentCount}  ${path.basename(s.target)}`,
  ];
  for (const i of s.blocking) lines.push(`  ✗ [${i.severity}/${i.gate}] ${i.id} ${i.category}: ${i.finding} (${i.file}:${i.line || '?'})`);
  for (const i of s.advisory) lines.push(`  ~ [${i.severity}] ${i.id} ${i.category}: ${i.finding} (${i.file}:${i.line || '?'})`);
  return lines.join('\n');
}

function main() {
  const { target, json, llm } = parseArgs(process.argv);
  if (!target) { process.stderr.write('usage: node tools/skill-scan.js <path> [--json] [--llm]\n'); process.exit(2); }
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) { process.stderr.write(`path not found: ${resolved}\n`); process.exit(2); }
  const binary = resolveBinary();
  if (!binary) {
    process.stderr.write(
      'SkillSpector not installed. Run:\n  cd vendor/skill-packs/skillspector && uv venv --python 3.12 .venv && uv pip install --python .venv -e .\n'
    );
    process.exit(2);
  }
  let summary;
  try {
    summary = summarize(target, runScan(binary, resolved, llm));
  } catch (err) {
    process.stderr.write(`skill-scan error: ${err.message}\n`);
    process.exit(2);
  }
  process.stdout.write(`${json ? JSON.stringify(summary, null, 2) : render(summary)}\n`);
  process.exit(EXIT[summary.verdict]);
}

if (require.main === module) main();

module.exports = { resolveBinary, summarize, classify, HARD_BLOCK_IDS, CODE_CATEGORIES };
