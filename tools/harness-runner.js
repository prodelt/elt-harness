#!/usr/bin/env node
'use strict';

/**
 * tools/harness-runner.js — Agent Harness Runner v1 (P5.1)
 *
 * Schema definition and phase-transition engine for Agent Harness pipeline runs.
 * Each run is stored as .planning/runs/<runId>/run.json in the project root.
 *
 * Pipeline phases (aligned with Методология Agent Harness, sections 1–5):
 *   fetch_context → plan_design → implement → linter → tests → code_review → git_push → complete
 *
 * Quality gates (per methodology section 5):
 *   Each phase exit requires a gate result (pass | fail).
 *   On fail with fixLoop: fixAttempts++ → transition to prior phase.
 *   On fixAttempts >= maxRetries: status → failed (max-retries guard, section 4.Г).
 *
 * CLI:
 *   node tools/harness-runner.js create <taskId>
 *       [--root <path>] [--max-retries <n>] [--threshold low|medium|high|critical] [--json]
 *
 *   node tools/harness-runner.js transition <runId> <pass|fail>
 *       [--note <text>] [--root <path>] [--json]
 *
 *   node tools/harness-runner.js status <runId> [--root <path>] [--json]
 *
 *   node tools/harness-runner.js artifact <runId> <key> <filePath>
 *       [--root <path>] [--json]
 *
 *   node tools/harness-runner.js list [--root <path>] [--json]
 */

const fs   = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Ordered pipeline phases (fetch_context is the entry point).
 * 'complete' and 'failed' are terminal — they appear in run.phase but not here.
 */
const PHASES = [
  'fetch_context',
  'plan_design',
  'implement',
  'linter',
  'tests',
  'code_review',
  'git_push',
];

const TERMINAL_PHASES = new Set(['complete', 'failed']);

const STATUSES = new Set(['running', 'paused', 'complete', 'failed']);

/** Minimum severity threshold for code_review to block (P5.2 enforces). */
const REVIEW_THRESHOLDS = new Set(['low', 'medium', 'high', 'critical']);

/** Ordered severity levels for threshold comparison (lowest → highest). */
const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

/** Named artifact slots per run — keyed output files from agents. */
const ARTIFACT_KEYS = new Set([
  'design',
  'implementation_plan',
  'qa_plan',
  'review_summary',
]);

/**
 * Phase transition table (methodology section 4.Г — State Machine & Feedback Layer).
 *
 * pass      — next phase when the gate passes (exit code 0 / approved).
 * fail      — next phase when the gate fails (exit code != 0 / blocked).
 * fixLoop   — true when a fail increments fixAttempts and guards maxRetries.
 *
 * Special: implement.fail === 'linter' intentionally (implement always moves
 * forward — the linter is the judge, not the coder; methodology section 5.3-5.4).
 */
const TRANSITIONS = {
  fetch_context: { pass: 'plan_design', fail: 'failed',      fixLoop: false },
  plan_design:   { pass: 'implement',   fail: 'plan_design', fixLoop: true  },
  implement:     { pass: 'linter',      fail: 'linter',      fixLoop: false }, // always fwd
  linter:        { pass: 'tests',       fail: 'implement',   fixLoop: true  },
  tests:         { pass: 'code_review', fail: 'linter',      fixLoop: true  },
  code_review:   { pass: 'git_push',    fail: 'implement',   fixLoop: true  },
  git_push:      { pass: 'complete',    fail: 'failed',      fixLoop: false },
};

// ── ID & path helpers ─────────────────────────────────────────────────────────

/**
 * Generate a unique run ID in the format run-YYYYMMDDHHmmss-<6hex>.
 * @param {Date} [now]
 * @returns {string}
 */
function generateRunId(now = new Date()) {
  const stamp = now.toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14); // YYYYMMDDHHmmss
  const rand = crypto.randomBytes(3).toString('hex');
  return `run-${stamp}-${rand}`;
}

/** Absolute path to the runs directory inside a project root. */
function runsDir(root) {
  return path.join(root, '.planning', 'runs');
}

/** Absolute path to a specific run's run.json file. */
function getRunPath(runId, root) {
  return path.join(runsDir(root), runId, 'run.json');
}

// ── Schema validation ─────────────────────────────────────────────────────────

/**
 * Validate a run object against the harness schema.
 * Does not touch the filesystem.
 *
 * @param {unknown} obj
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSchema(obj) {
  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['run must be a non-null object'] };
  }

  const errors = [];

  if (typeof obj.runId !== 'string' || !obj.runId.trim()) {
    errors.push('runId must be a non-empty string');
  }
  if (typeof obj.taskId !== 'string' || !obj.taskId.trim()) {
    errors.push('taskId must be a non-empty string');
  }

  const allPhases = [...PHASES, ...TERMINAL_PHASES];
  if (!allPhases.includes(obj.phase)) {
    errors.push(`phase must be one of: ${allPhases.join(', ')}; got: ${obj.phase}`);
  }

  if (!STATUSES.has(obj.status)) {
    errors.push(`status must be one of: ${[...STATUSES].join(', ')}; got: ${obj.status}`);
  }

  if (typeof obj.fixAttempts !== 'number' || !Number.isInteger(obj.fixAttempts) || obj.fixAttempts < 0) {
    errors.push('fixAttempts must be a non-negative integer');
  }
  if (typeof obj.maxRetries !== 'number' || !Number.isInteger(obj.maxRetries) || obj.maxRetries < 1) {
    errors.push('maxRetries must be a positive integer');
  }

  if (!Array.isArray(obj.phases)) {
    errors.push('phases must be an array');
  }

  if (!obj.artifacts || typeof obj.artifacts !== 'object' || Array.isArray(obj.artifacts)) {
    errors.push('artifacts must be a plain object');
  } else {
    for (const k of ARTIFACT_KEYS) {
      if (!(k in obj.artifacts)) errors.push(`artifacts.${k} is required`);
    }
  }

  if (!obj.config || typeof obj.config !== 'object' || Array.isArray(obj.config)) {
    errors.push('config must be a plain object');
  } else {
    if (typeof obj.config.maxRetries !== 'number') {
      errors.push('config.maxRetries must be a number');
    }
    if (!REVIEW_THRESHOLDS.has(obj.config.reviewBlockThreshold)) {
      errors.push(
        `config.reviewBlockThreshold must be one of: ${[...REVIEW_THRESHOLDS].join(', ')}; ` +
        `got: ${obj.config.reviewBlockThreshold}`
      );
    }
  }

  if (typeof obj.createdAt !== 'string') errors.push('createdAt must be an ISO string');
  if (typeof obj.updatedAt !== 'string') errors.push('updatedAt must be an ISO string');
  if (!('closedAt' in obj))              errors.push('closedAt field is required (may be null)');
  if (!('failReason' in obj))            errors.push('failReason field is required (may be null)');

  return { valid: errors.length === 0, errors };
}

// ── Phase-transition logic ────────────────────────────────────────────────────

/**
 * Resolve the next phase given the current phase, gate result, and run state.
 * Pure function — does not write to disk.
 *
 * @param {string}  currentPhase
 * @param {boolean} passed         — true = gate passed
 * @param {{ fixAttempts: number, maxRetries: number }} run
 * @returns {{ nextPhase: string, incrementFix: boolean, failReason: string|null }}
 */
function resolveNextPhase(currentPhase, passed, run) {
  const entry = TRANSITIONS[currentPhase];
  if (!entry) throw new Error(`Unknown phase: ${JSON.stringify(currentPhase)}`);

  if (passed) {
    return { nextPhase: entry.pass, incrementFix: false, failReason: null };
  }

  // Fail path:
  if (entry.fixLoop) {
    if (run.fixAttempts >= run.maxRetries) {
      return {
        nextPhase:    'failed',
        incrementFix: false,
        failReason:   `maxRetries (${run.maxRetries}) exceeded at phase ${currentPhase}`,
      };
    }
    return { nextPhase: entry.fail, incrementFix: true, failReason: null };
  }

  // Non-fix-loop fail (fetch_context, implement always-fwd, git_push):
  return { nextPhase: entry.fail, incrementFix: false, failReason: null };
}

// ── Run file operations ───────────────────────────────────────────────────────

/**
 * Build an empty phase record for the given phase name.
 * @param {string} phase
 * @param {string} now  ISO timestamp
 * @returns {object}
 */
function buildPhaseRecord(phase, now) {
  return {
    phase,
    status:     'active',
    enteredAt:  now,
    exitedAt:   null,
    gateResult: null,
    artifacts:  [],
  };
}

/**
 * Create a new harness run and write run.json to .planning/runs/<runId>/.
 *
 * @param {string} taskId
 * @param {{
 *   root?: string,
 *   maxRetries?: number,
 *   reviewBlockThreshold?: string,
 *   _now?: Date
 * }} options
 * @returns {{ runId: string, runPath: string, run: object }}
 */
function createRun(taskId, options = {}) {
  const {
    root = process.cwd(),
    maxRetries = 3,
    reviewBlockThreshold = 'high',
    _now = new Date(),
  } = options;

  if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
    throw new Error('taskId must be a non-empty string');
  }
  if (!REVIEW_THRESHOLDS.has(reviewBlockThreshold)) {
    throw new Error(
      `reviewBlockThreshold must be one of: ${[...REVIEW_THRESHOLDS].join(', ')}; ` +
      `got: ${reviewBlockThreshold}`
    );
  }
  if (!Number.isInteger(maxRetries) || maxRetries < 1) {
    throw new Error('maxRetries must be a positive integer');
  }

  const now   = _now.toISOString();
  const runId = generateRunId(_now);

  /** @type {object} run.json schema */
  const run = {
    runId,
    taskId,
    phase:       'fetch_context',
    status:      'running',
    fixAttempts: 0,
    maxRetries,
    failReason:  null,
    createdAt:   now,
    updatedAt:   now,
    closedAt:    null,
    phases: [buildPhaseRecord('fetch_context', now)],
    artifacts: {
      design:              null,
      implementation_plan: null,
      qa_plan:             null,
      review_summary:      null,
    },
    config: {
      maxRetries,
      reviewBlockThreshold,
    },
  };

  const runPath = getRunPath(runId, root);
  fs.mkdirSync(path.dirname(runPath), { recursive: true });
  fs.writeFileSync(runPath, JSON.stringify(run, null, 2), 'utf8');

  return { runId, runPath, run };
}

/**
 * Read an existing run from disk and parse it.
 *
 * @param {string} runId
 * @param {string} [root]
 * @returns {object}
 * @throws {Error} if the run file does not exist
 */
function readRun(runId, root = process.cwd()) {
  const runPath = getRunPath(runId, root);
  if (!fs.existsSync(runPath)) {
    throw new Error(`Run not found: ${runId} (expected: ${runPath})`);
  }
  return JSON.parse(fs.readFileSync(runPath, 'utf8'));
}

/**
 * Advance the run to the next phase based on the gate result.
 * Reads → validates transition → writes updated run.json → returns updated run.
 *
 * @param {string}  runId
 * @param {boolean} passed      — true = gate passed, false = gate failed
 * @param {{
 *   root?: string,
 *   notes?: string[],
 *   _now?: Date
 * }} options
 * @returns {object}  updated run
 * @throws {Error} if run is in a terminal state or the phase is unknown
 */
function transition(runId, passed, options = {}) {
  const { root = process.cwd(), notes = [], _now = new Date() } = options;
  const run = readRun(runId, root);

  if (TERMINAL_PHASES.has(run.phase)) {
    throw new Error(
      `Run ${runId} is in terminal state "${run.phase}". No further transitions are allowed.`
    );
  }

  const now = _now.toISOString();
  const { nextPhase, incrementFix, failReason } = resolveNextPhase(run.phase, passed, run);

  // Close out the current phase record
  const currentRecord = run.phases[run.phases.length - 1];
  if (currentRecord && currentRecord.status === 'active') {
    currentRecord.exitedAt  = now;
    currentRecord.status    = passed ? 'passed' : 'failed';
    currentRecord.gateResult = { passed, notes };
  }

  // Increment fix-attempt counter when entering a fix loop
  if (incrementFix) run.fixAttempts += 1;

  // Update phase and status
  if (TERMINAL_PHASES.has(nextPhase)) {
    run.phase     = nextPhase;
    run.status    = nextPhase; // 'complete' | 'failed'
    run.closedAt  = now;
    run.failReason = failReason;
  } else {
    run.phase = nextPhase;
    run.phases.push(buildPhaseRecord(nextPhase, now));
  }

  run.updatedAt = now;

  const runPath = getRunPath(runId, root);
  fs.writeFileSync(runPath, JSON.stringify(run, null, 2), 'utf8');

  return run;
}

/**
 * Record a named artifact path for the current run.
 * Updates both run.artifacts[key] and the current phase's artifacts list.
 *
 * @param {string} runId
 * @param {string} key       — one of ARTIFACT_KEYS
 * @param {string} filePath  — relative or absolute path to the artifact file
 * @param {string} [root]
 * @returns {object}  updated run
 */
function recordArtifact(runId, key, filePath, root = process.cwd()) {
  if (!ARTIFACT_KEYS.has(key)) {
    throw new Error(
      `Unknown artifact key "${key}". Must be one of: ${[...ARTIFACT_KEYS].join(', ')}`
    );
  }
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('filePath must be a non-empty string');
  }

  const run = readRun(runId, root);
  run.artifacts[key] = filePath;

  // Append to the current phase's artifact list if not already present
  const currentRecord = run.phases[run.phases.length - 1];
  if (currentRecord && !currentRecord.artifacts.includes(filePath)) {
    currentRecord.artifacts.push(filePath);
  }

  run.updatedAt = new Date().toISOString();

  const runPath = getRunPath(runId, root);
  fs.writeFileSync(runPath, JSON.stringify(run, null, 2), 'utf8');

  return run;
}

// ── Review agent contract (P5.2) ─────────────────────────────────────────────

/**
 * Return true when `severity` meets or exceeds `threshold`.
 * Both must be members of SEVERITY_ORDER.
 *
 * @param {string} severity   — finding severity
 * @param {string} threshold  — config.reviewBlockThreshold
 * @returns {boolean}
 */
function severityMeetsThreshold(severity, threshold) {
  return SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(threshold);
}

/**
 * Submit code-review findings and auto-transition based on the run's
 * `config.reviewBlockThreshold`.
 *
 * Reviewer inputs contract (methodology section 5.6):
 *   - design artifact path (recorded earlier in `artifacts.design`)
 *   - final diff / implementation artifact (recorded in `artifacts.implementation_plan`)
 *   - findings[] — each finding must include { severity, message }
 *
 * Blocking logic: any finding whose severity meets or exceeds the threshold
 * causes a fail transition (→ implement).  Zero or only below-threshold
 * findings cause a pass transition (→ git_push).
 *
 * @param {string} runId
 * @param {Array<{severity: string, message: string, file?: string, line?: number}>} findings
 * @param {{
 *   root?: string,
 *   summaryPath?: string,
 *   _now?: Date
 * }} options
 * @returns {{
 *   run: object,
 *   blocked: boolean,
 *   blockingFindings: Array<object>
 * }}
 * @throws {Error} if run is not in code_review phase or findings are invalid
 */
function submitReview(runId, findings, options = {}) {
  const { root = process.cwd(), summaryPath = null, _now = new Date() } = options;

  if (!Array.isArray(findings)) {
    throw new Error('findings must be an array');
  }

  const run = readRun(runId, root);
  if (run.phase !== 'code_review') {
    throw new Error(
      `submitReview only valid during code_review phase; current: ${run.phase}`
    );
  }

  const threshold = run.config.reviewBlockThreshold;

  const validFindings = findings.map((f, i) => {
    if (!f || typeof f !== 'object') throw new Error(`findings[${i}] must be an object`);
    if (!REVIEW_THRESHOLDS.has(f.severity)) {
      throw new Error(
        `findings[${i}].severity must be one of: ${[...REVIEW_THRESHOLDS].join(', ')}; got: ${f.severity}`
      );
    }
    if (typeof f.message !== 'string' || !f.message.trim()) {
      throw new Error(`findings[${i}].message must be a non-empty string`);
    }
    return {
      severity: f.severity,
      message:  f.message,
      file:     f.file  != null ? String(f.file)  : null,
      line:     f.line  != null ? Number(f.line)   : null,
    };
  });

  const blockingFindings = validFindings.filter(f =>
    severityMeetsThreshold(f.severity, threshold)
  );
  const blocked = blockingFindings.length > 0;

  // Record findings into current phase record before transition reads the file
  const currentRecord = run.phases[run.phases.length - 1];
  if (currentRecord) {
    currentRecord.reviewFindings   = validFindings;
    currentRecord.blocked          = blocked;
    currentRecord.blockingFindings = blockingFindings;
  }

  if (summaryPath) {
    run.artifacts.review_summary = summaryPath;
    if (currentRecord && !currentRecord.artifacts.includes(summaryPath)) {
      currentRecord.artifacts.push(summaryPath);
    }
  }

  run.updatedAt = _now.toISOString();
  fs.writeFileSync(getRunPath(runId, root), JSON.stringify(run, null, 2), 'utf8');

  const note = blocked
    ? `Blocked by ${blockingFindings.length} finding(s) at or above '${threshold}' severity`
    : `Review passed — ${validFindings.length} finding(s) all below '${threshold}' threshold`;

  const updatedRun = transition(runId, !blocked, { root, notes: [note], _now });
  return { run: updatedRun, blocked, blockingFindings };
}

/**
 * List all run IDs present under .planning/runs/ in the given root.
 *
 * @param {string} [root]
 * @returns {string[]}  sorted array of run IDs
 */
function listRuns(root = process.cwd()) {
  const dir = runsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => fs.existsSync(path.join(dir, name, 'run.json')))
    .sort();
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(argv[i]);
    }
  }
  return { flags, positional };
}

function cliMain(argv) {
  const { flags, positional } = parseArgs(argv);
  const asJson = Boolean(flags.json);
  const root   = typeof flags.root === 'string' ? path.resolve(flags.root) : process.cwd();
  const [cmd, ...rest] = positional;

  function emit(obj) {
    process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
  }
  function fail(msg) {
    if (asJson) emit({ ok: false, error: msg });
    else process.stderr.write(`ERROR: ${msg}\n`);
    process.exit(1);
  }

  try {
    if (cmd === 'create') {
      const [taskId] = rest;
      if (!taskId) return fail('Usage: create <taskId> [--root <path>] [--max-retries <n>] [--threshold <level>] [--json]');
      const maxRetries = flags['max-retries'] ? parseInt(String(flags['max-retries']), 10) : 3;
      const threshold  = typeof flags.threshold === 'string' ? flags.threshold : 'high';
      const result = createRun(taskId, { root, maxRetries, reviewBlockThreshold: threshold });
      emit({ ok: true, runId: result.runId, phase: result.run.phase, runPath: result.runPath });
      return;
    }

    if (cmd === 'transition') {
      const [runId, result] = rest;
      if (!runId || !result) return fail('Usage: transition <runId> <pass|fail> [--note <text>] [--root <path>] [--json]');
      if (result !== 'pass' && result !== 'fail') return fail('result must be "pass" or "fail"');
      const passed = result === 'pass';
      const notes  = typeof flags.note === 'string' ? [flags.note] : [];
      const run    = transition(runId, passed, { root, notes });
      emit({ ok: true, runId, phase: run.phase, status: run.status, fixAttempts: run.fixAttempts });
      return;
    }

    if (cmd === 'status') {
      const [runId] = rest;
      if (!runId) return fail('Usage: status <runId> [--root <path>] [--json]');
      emit(readRun(runId, root));
      return;
    }

    if (cmd === 'artifact') {
      const [runId, key, filePath] = rest;
      if (!runId || !key || !filePath) return fail('Usage: artifact <runId> <key> <filePath> [--root <path>] [--json]');
      const run = recordArtifact(runId, key, filePath, root);
      emit({ ok: true, runId, key, filePath, phase: run.phase });
      return;
    }

    if (cmd === 'list') {
      const ids = listRuns(root);
      emit({ ok: true, count: ids.length, runs: ids });
      return;
    }

    if (cmd === 'review') {
      const [runId] = rest;
      if (!runId) {
        return fail(
          'Usage: review <runId> (--severity <level> --message <text> | --findings-json <path>) ' +
          '[--summary-path <path>] [--root <path>] [--json]'
        );
      }
      let findings;
      if (typeof flags['findings-json'] === 'string') {
        const raw = fs.readFileSync(path.resolve(flags['findings-json']), 'utf8');
        findings = JSON.parse(raw);
      } else {
        const severity = typeof flags.severity === 'string' ? flags.severity : null;
        const message  = typeof flags.message  === 'string' ? flags.message  : null;
        if (!severity || !message) {
          return fail('review: provide --findings-json <path> OR --severity <level> --message <text>');
        }
        findings = [{ severity, message }];
      }
      const summaryPath = typeof flags['summary-path'] === 'string' ? flags['summary-path'] : null;
      const result = submitReview(runId, findings, { root, summaryPath });
      emit({
        ok: true,
        runId,
        blocked:         result.blocked,
        blockingCount:   result.blockingFindings.length,
        phase:           result.run.phase,
        status:          result.run.status,
        fixAttempts:     result.run.fixAttempts,
        blockingFindings: result.blockingFindings,
      });
      return;
    }

    fail(`Unknown command: ${cmd || '(none)'}. Available: create, transition, status, artifact, list, review`);
  } catch (err) {
    fail(err.message);
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  PHASES,
  TERMINAL_PHASES,
  TRANSITIONS,
  ARTIFACT_KEYS,
  REVIEW_THRESHOLDS,
  SEVERITY_ORDER,
  generateRunId,
  runsDir,
  getRunPath,
  validateSchema,
  resolveNextPhase,
  buildPhaseRecord,
  createRun,
  readRun,
  transition,
  recordArtifact,
  listRuns,
  severityMeetsThreshold,
  submitReview,
};

// ponytail: deprecated CLI (spec 005 T018). Exports stay live for existing importers;
// file is removed in T019 after zero-caller proof.
if (require.main === module) {
  console.error(
    'DEPRECATED: harness-runner.js is not an active route. Agent Harness v1 / Pipeline v3 is retired.\n' +
    '  Code work: /elt (tools/elt.js) — oracle → judge proof → guarded commit\n' +
    '  Migration & removal plan: specs/005-elt-control-plane-convergence/spec.md §9'
  );
  process.exit(1);
}
