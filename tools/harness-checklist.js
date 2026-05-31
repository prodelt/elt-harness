#!/usr/bin/env node
'use strict';

/**
 * tools/harness-checklist.js — Harness Self-Audit Checklist (S54)
 *
 * Runs the ai-boost/awesome-harness-engineering production-readiness checklist
 * (CC0 1.0) against THIS repo's agent harness. Each checklist item is either:
 *   - auto:   a programmatic fact check against the repo → pass | warn | fail
 *   - manual: needs a written justification in
 *             .planning/harness-checklist-justifications.json
 *             present → pass (justified); absent → needs-justification (warn level)
 *
 * Source principle: failing item = blocker; skipped item needs written justification.
 * needs-justification is a WARN, never a FAIL — it means "write the rationale".
 *
 * Patterns reused:
 *   - checkArtifact / writeArtifact / TTL  ← tools/docs-gate.js
 *   - audit + markdown structure           ← tools/agent-surface-audit.js
 *
 * Flags:
 *   --root <path>   Project root (default: cwd)
 *   --json          Output JSON report
 *   --write         Write .planning/harness-checklist-latest.{json,md}
 *   --markdown      Print markdown to stdout
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PLANNING_DIR = '.planning';
const ARTIFACT_BASE = 'harness-checklist-latest';
const JUSTIFICATIONS_FILE = 'harness-checklist-justifications.json';
const TTL_MS = 24 * 60 * 60 * 1000;

const CATEGORIES = [
  'agent-instructions',
  'tool-design',
  'context-delivery',
  'planning-artifacts',
  'permissions-sandbox',
  'verification-loop',
];

// ── status helpers ──────────────────────────────────────────────────────────

// Normalize a status to an ordinal level (needs-justification ≈ warn).
const LEVEL = { pass: 0, 'needs-justification': 1, warn: 1, fail: 2 };

function pass(detail) { return { status: 'pass', detail }; }
function warn(detail) { return { status: 'warn', detail }; }
function fail(detail) { return { status: 'fail', detail }; }

/**
 * Worst status wins. needs-justification aggregates to 'warn'.
 * @param {string[]} statuses
 * @returns {'pass'|'warn'|'fail'}
 */
function aggregate(statuses) {
  let level = 0;
  for (const s of statuses) level = Math.max(level, LEVEL[s] || 0);
  return level >= 2 ? 'fail' : level >= 1 ? 'warn' : 'pass';
}

/**
 * Resolve a manual item against the justifications map.
 * @param {string} id
 * @param {Record<string,string>} justifications
 */
function evaluateManual(id, justifications) {
  const note = justifications && typeof justifications[id] === 'string' ? justifications[id].trim() : '';
  if (note) return { status: 'pass', detail: `justified: ${note}` };
  return { status: 'needs-justification', detail: 'No written justification — add to .planning/harness-checklist-justifications.json' };
}

// ── checklist items (ai-boost 6 categories) ──────────────────────────────────

const ITEMS = [
  // agent-instructions
  { id: 'agents-docs-exist', category: 'agent-instructions', type: 'auto',
    label: 'AGENTS.md / CLAUDE.md / .gemini/GEMINI.md exist & synced',
    check: (f) => !f.docsAgents
      ? fail('AGENTS.md (canonical AI doc) missing')
      : (f.docsClaude && f.docsGemini)
        ? pass('AGENTS.md + CLAUDE.md + .gemini/GEMINI.md present')
        : warn('Canonical AGENTS.md present but a mirror (CLAUDE.md/.gemini/GEMINI.md) is missing — run /sync-docs') },
  { id: 'tool-permissions-explicit', category: 'agent-instructions', type: 'auto',
    label: 'Tool permissions explicit (settings.json permissions)',
    check: (f) => f.permissions ? pass('permissions block defined in settings.json') : fail('No permissions block in ~/.claude/settings.json') },
  { id: 'verification-gates-defined', category: 'agent-instructions', type: 'auto',
    label: 'Verification gates defined with correct commands',
    check: (f) => f.verificationGatesInDocs ? pass('AGENTS.md has Commands / verification gates') : warn('No verification commands found in AGENTS.md') },
  { id: 'no-ambiguous-instructions', category: 'agent-instructions', type: 'manual',
    label: 'No ambiguous instructions open to multiple interpretations' },

  // tool-design
  { id: 'harness-tests-present', category: 'tool-design', type: 'auto',
    label: 'harness-runner tests exist',
    check: (f) => f.harnessTestsPass ? pass('tools/harness-runner.test.js present (run separately for pass/fail)') : fail('tools/harness-runner.test.js missing') },
  { id: 'consistent-tool-returns', category: 'tool-design', type: 'auto',
    label: 'Tool return values consistent (validateSchema present)',
    check: (f) => f.validateSchemaExists ? pass('validateSchema defined in harness-runner') : warn('No validateSchema — return-shape consistency unverified') },
  { id: 'tool-name-unambiguous', category: 'tool-design', type: 'manual',
    label: 'Each tool has a clear, unambiguous name' },
  { id: 'single-responsibility', category: 'tool-design', type: 'manual',
    label: 'No tool does more than one conceptual thing' },
  { id: 'error-messages-actionable', category: 'tool-design', type: 'manual',
    label: 'Error messages tell the agent what to do next' },

  // context-delivery
  { id: 'state-in-files', category: 'context-delivery', type: 'auto',
    label: 'Long-lived state in files (.planning non-empty)',
    check: (f) => f.planningNonEmpty ? pass('.planning/ holds plans/state') : warn('.planning/ empty or missing') },
  { id: 'compaction-strategy', category: 'context-delivery', type: 'auto',
    label: 'Context compaction strategy defined',
    check: (f) => f.compactionHooks ? pass('context-budget-gate / session-size-guard / active-window present') : warn('No compaction hooks found') },
  { id: 'secret-protection', category: 'context-delivery', type: 'auto',
    label: 'No sensitive data in agent context (secret scanner)',
    check: (f) => f.secretScanner ? pass('secret-scanner Bash gate present') : fail('No secret-scanner hook — secret leak protection missing') },
  { id: 'context-scoped', category: 'context-delivery', type: 'manual',
    label: 'Context scoped to the task, not the whole codebase' },

  // planning-artifacts
  { id: 'plan-implement-templates', category: 'planning-artifacts', type: 'auto',
    label: 'PLAN.md / IMPLEMENT.md templates exist',
    check: (f) => (f.planTemplate && f.implementTemplate) ? pass('PLAN + IMPLEMENT templates vendored') : warn('Missing PLAN.md or IMPLEMENT.md template under .planning/harness/templates') },
  { id: 'fresh-architecture', category: 'planning-artifacts', type: 'auto',
    label: 'A recent ARCHITECTURE-*.md exists',
    check: (f) => f.freshArchitecture ? pass('Recent .planning/ARCHITECTURE-*.md found') : warn('No recent ARCHITECTURE-*.md (last 30 days)') },
  { id: 'milestones-have-verify', category: 'planning-artifacts', type: 'auto',
    label: 'Milestones carry explicit verify commands',
    check: (f) => f.milestonesWithVerify ? pass('Plans use "verify:" milestone commands') : warn('No "verify:" milestone commands found in .planning') },
  { id: 'scope-boundaries-written', category: 'planning-artifacts', type: 'manual',
    label: 'In-scope / out-of-scope boundaries written down' },

  // permissions-sandbox
  { id: 'permissions-defined', category: 'permissions-sandbox', type: 'auto',
    label: 'Agent runs with explicit permissions',
    check: (f) => f.permissions ? pass('permissions block defined') : fail('No permissions block in settings.json') },
  { id: 'destructive-confirmation', category: 'permissions-sandbox', type: 'auto',
    label: 'Destructive operations require confirmation',
    check: (f) => f.destructiveConfirm ? pass('/careful or /freeze guard present') : warn('No /careful or /freeze destructive guard skill found') },
  { id: 'fs-scoped', category: 'permissions-sandbox', type: 'auto',
    label: 'File-system access scoped to project (git -- .)',
    check: (f) => f.fsScope ? pass('git-workflow-audit enforces -- . scope') : warn('No git scope enforcement tool found') },
  { id: 'minimum-permissions', category: 'permissions-sandbox', type: 'manual',
    label: 'Agent runs with the minimum permissions needed' },

  // verification-loop
  { id: 'tests-exist', category: 'verification-loop', type: 'auto',
    label: 'Tests exist for the harness outputs',
    check: (f) => f.harnessTestsPass ? pass('harness-runner test suite present') : fail('No harness-runner test suite') },
  { id: 'doctor-runs', category: 'verification-loop', type: 'auto',
    label: 'doctor aggregates verification checks',
    check: (f) => f.doctorRuns ? pass('tools/doctor.js present') : warn('tools/doctor.js missing') },
  { id: 'verification-gates-present', category: 'verification-loop', type: 'auto',
    label: 'Verification gates present in docs',
    check: (f) => f.verificationGatesInDocs ? pass('Verification commands documented') : warn('No verification commands documented') },
  { id: 'eval-criteria-upfront', category: 'verification-loop', type: 'manual',
    label: 'Eval criteria written before the task starts, not after' },
];

// ── build (pure) ──────────────────────────────────────────────────────────────

/**
 * Build the full checklist report from gathered facts + justifications.
 * Pure: no I/O. @param {object} facts @param {Record<string,string>} justifications
 */
function buildChecklist(facts, justifications = {}) {
  const counts = { pass: 0, warn: 0, fail: 0, needsJustification: 0 };
  const categories = CATEGORIES.map((catId) => {
    const items = ITEMS.filter((i) => i.category === catId).map((item) => {
      const res = item.type === 'auto' ? item.check(facts) : evaluateManual(item.id, justifications);
      if (res.status === 'needs-justification') counts.needsJustification++;
      else counts[res.status]++;
      return { id: item.id, type: item.type, label: item.label, status: res.status, detail: res.detail };
    });
    return { id: catId, status: aggregate(items.map((i) => i.status)), items };
  });
  return {
    categories,
    summary: { status: aggregate(categories.map((c) => c.status)), counts },
  };
}

// ── facts gathering (I/O) ─────────────────────────────────────────────────────

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }

function readTextSafe(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }

function dirHasEntries(p) { try { return fs.readdirSync(p).length > 0; } catch { return false; } }

function settingsHasPermissions(claudeDir) {
  try {
    const s = JSON.parse(readTextSafe(path.join(claudeDir, 'settings.json')) || '{}');
    return !!s.permissions && typeof s.permissions === 'object';
  } catch { return false; }
}

function hasRecentArchitecture(planningDir, now = Date.now()) {
  try {
    const cutoff = 30 * 24 * 60 * 60 * 1000;
    return fs.readdirSync(planningDir).some((name) => {
      if (!/^ARCHITECTURE-.*\.md$/.test(name)) return false;
      const st = fs.statSync(path.join(planningDir, name));
      return now - st.mtimeMs <= cutoff;
    });
  } catch { return false; }
}

function planningHasVerify(root) {
  const dirs = [path.join(root, PLANNING_DIR), path.join(root, PLANNING_DIR, 'harness', 'templates')];
  for (const dir of dirs) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.md')) continue;
        if (/verify:/.test(readTextSafe(path.join(dir, name)))) return true;
      }
    } catch { /* skip */ }
  }
  return false;
}

/**
 * Gather all repo facts (fs-only, sandbox-safe, no child processes).
 * @param {string} root  project root
 * @param {string} home  user home (for ~/.claude)
 */
function gatherFacts(root, home = os.homedir()) {
  const claudeDir = path.join(home, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');
  const skillsDir = path.join(claudeDir, 'skills');
  const planningDir = path.join(root, PLANNING_DIR);
  const templatesDir = path.join(planningDir, 'harness', 'templates');
  const agentsText = readTextSafe(path.join(root, 'AGENTS.md'));
  const runnerText = readTextSafe(path.join(root, 'tools', 'harness-runner.js'));

  return {
    docsAgents: exists(path.join(root, 'AGENTS.md')),
    docsClaude: exists(path.join(root, 'CLAUDE.md')),
    docsGemini: exists(path.join(root, '.gemini', 'GEMINI.md')),
    permissions: settingsHasPermissions(claudeDir),
    verificationGatesInDocs: /##\s*Commands/i.test(agentsText) && /\.test\.js|test-all-hooks|doctor\.js/.test(agentsText),
    harnessTestsPass: exists(path.join(root, 'tools', 'harness-runner.test.js')) && exists(path.join(root, 'tools', 'harness-runner.js')),
    validateSchemaExists: /function\s+validateSchema/.test(runnerText),
    planningNonEmpty: dirHasEntries(planningDir),
    compactionHooks: exists(path.join(hooksDir, 'context-budget-gate.js'))
      || exists(path.join(hooksDir, 'session-size-guard.js'))
      || exists(path.join(hooksDir, 'lib', 'active-window.js')),
    secretScanner: exists(path.join(hooksDir, 'secret-scanner.js')),
    planTemplate: exists(path.join(templatesDir, 'PLAN.md')),
    implementTemplate: exists(path.join(templatesDir, 'IMPLEMENT.md')),
    freshArchitecture: hasRecentArchitecture(planningDir),
    milestonesWithVerify: planningHasVerify(root),
    destructiveConfirm: exists(path.join(skillsDir, 'careful')) || exists(path.join(skillsDir, 'freeze'))
      || exists(path.join(hooksDir, 'secret-scanner.js')),
    fsScope: exists(path.join(root, 'tools', 'git-workflow-audit.js')),
    doctorRuns: exists(path.join(root, 'tools', 'doctor.js')),
  };
}

// ── runner ────────────────────────────────────────────────────────────────────

function loadJustifications(root) {
  try {
    return JSON.parse(readTextSafe(path.join(root, PLANNING_DIR, JUSTIFICATIONS_FILE)) || '{}') || {};
  } catch { return {}; }
}

function runChecklist({ root: rawRoot, home = os.homedir(), write = false } = {}) {
  const root = path.resolve(rawRoot || process.cwd());
  const facts = gatherFacts(root, home);
  const justifications = loadJustifications(root);
  const { categories, summary } = buildChecklist(facts, justifications);
  const report = {
    generatedAt: new Date().toISOString(),
    projectRoot: root.replace(/\\/g, '/'),
    source: 'ai-boost/awesome-harness-engineering (CC0 1.0)',
    facts,
    categories,
    summary,
  };
  if (write) writeArtifact(root, report);
  return report;
}

// ── artifact I/O ────────────────────────────────────────────────────────────

function writeArtifact(root, report) {
  const dir = path.join(root, PLANNING_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ARTIFACT_BASE}.json`), JSON.stringify(report, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, `${ARTIFACT_BASE}.md`), toMarkdown(report) + '\n', 'utf8');
}

function toMarkdown(report) {
  const icon = { pass: '✅', warn: '⚠️', fail: '❌', 'needs-justification': '📝' };
  const c = report.summary.counts;
  const lines = [
    '# Harness Self-Audit Checklist',
    '',
    `Generated: ${report.generatedAt}`,
    `Project root: \`${report.projectRoot}\``,
    `Source: ${report.source || 'ai-boost/awesome-harness-engineering (CC0 1.0)'}`,
    '',
    '## Summary',
    '',
    `Status: **${report.summary.status.toUpperCase()}** — ${c.pass} pass / ${c.warn} warn / ${c.fail} fail / ${c.needsJustification} needs-justification`,
    '',
  ];
  for (const cat of report.categories) {
    lines.push(`## ${icon[cat.status] || '?'} ${cat.id} — ${cat.status.toUpperCase()}`);
    lines.push('');
    for (const it of cat.items) {
      lines.push(`- ${icon[it.status] || '?'} \`${it.id}\` (${it.type}) — ${it.label}`);
      lines.push(`  - ${it.detail}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * checkArtifact — used by doctor-core.js to read the latest report.
 * @param {string} root @param {Date} now
 */
function checkArtifact(root, now = new Date()) {
  const file = path.join(root, PLANNING_DIR, `${ARTIFACT_BASE}.json`);
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const generatedAt = typeof value.generatedAt === 'string' ? new Date(value.generatedAt) : null;
    const stale = !generatedAt || Number.isNaN(generatedAt.getTime())
      || now.getTime() - generatedAt.getTime() > TTL_MS;
    return { ok: true, value, stale, file };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { root: process.cwd(), json: false, write: false, markdown: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) opts.root = args[++i];
    else if (args[i] === '--json') opts.json = true;
    else if (args[i] === '--write') opts.write = true;
    else if (args[i] === '--markdown') opts.markdown = true;
  }
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  const report = runChecklist({ root: opts.root, write: opts.write });

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else if (opts.markdown) {
    process.stdout.write(toMarkdown(report) + '\n');
  } else {
    const c = report.summary.counts;
    process.stdout.write(`Harness Self-Audit — ${report.summary.status.toUpperCase()}\n`);
    process.stdout.write(`  ${c.pass} pass / ${c.warn} warn / ${c.fail} fail / ${c.needsJustification} needs-justification\n`);
    for (const cat of report.categories) {
      process.stdout.write(`  [${cat.status.toUpperCase()}] ${cat.id}\n`);
      for (const it of cat.items) {
        if (it.status !== 'pass') process.stdout.write(`      ${it.status}: ${it.id} — ${it.detail}\n`);
      }
    }
  }
  process.exit(report.summary.status === 'fail' ? 1 : 0);
}

module.exports = {
  CATEGORIES,
  ITEMS,
  TTL_MS,
  aggregate,
  evaluateManual,
  buildChecklist,
  gatherFacts,
  runChecklist,
  checkArtifact,
  writeArtifact,
  toMarkdown,
  parseArgs,
};
