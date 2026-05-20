#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HARD_BLOCK_PATTERNS = [/secret/i, /destructive/i, /commit/i, /config-protection/i, /settings-schema/i, /freeze/i];
const BACKGROUND_PATTERNS = [/dashboard/i, /graphify-auto-update/i, /post-commit/i, /stats/i, /metrics/i, /telemetry/i];
const TELEMETRY_PATTERNS = [/tracker/i, /metrics/i, /stats/i, /learn/i];

function readJson(file) {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function readErrorSummary(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    const byHook = lines.reduce((acc, line) => {
      const match = line.match(/\[ERROR\]\s+([^:\s]+)/);
      if (!match) return acc;
      return { ...acc, [match[1]]: (acc[match[1]] || 0) + 1 };
    }, {});
    return { ok: true, total_lines: lines.length, error_lines: lines.filter((line) => line.includes('[ERROR]')).length, by_hook: byHook };
  } catch (error) {
    return { ok: false, total_lines: 0, error_lines: 0, by_hook: {}, error: error.message };
  }
}

function hookName(command) {
  const match = String(command || '').match(/([^\\/]+)\.js\b/);
  return match ? match[1] : String(command || '').split(/\s+/).slice(-1)[0] || 'unknown';
}

function classifyHook(command) {
  const text = String(command || '');
  if (HARD_BLOCK_PATTERNS.some((pattern) => pattern.test(text))) return 'hard-block';
  if (BACKGROUND_PATTERNS.some((pattern) => pattern.test(text))) return 'background';
  if (TELEMETRY_PATTERNS.some((pattern) => pattern.test(text))) return 'telemetry';
  return 'advisory';
}

function failurePolicy(hookClass) {
  if (hookClass === 'hard-block') return 'may block on real safety violation';
  if (hookClass === 'background') return 'must fail soft';
  if (hookClass === 'telemetry') return 'metrics only, must fail soft';
  return 'advisory output capped, must fail soft';
}

function flattenClaudeHooks(settings) {
  const hooks = settings.hooks || {};
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((group) => {
    const matcher = group.matcher || '';
    return (group.hooks || []).map((hook) => ({
      platform: 'claude',
      event,
      matcher,
      command: hook.command || '',
      statusMessage: hook.statusMessage || '',
    }));
  }));
}

function flattenCodexHooks(config) {
  const hooks = (config && config.hooks) || {};
  return Object.entries(hooks).flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((group) => {
    const matcher = group.matcher || '';
    return (group.hooks || []).map((hook) => ({
      platform: 'codex',
      event,
      matcher,
      command: hook.command || '',
      statusMessage: hook.statusMessage || '',
    }));
  }));
}

function summarize(items) {
  const byClass = items.reduce((acc, item) => ({ ...acc, [item.class]: (acc[item.class] || 0) + 1 }), {});
  const byEvent = items.reduce((acc, item) => ({ ...acc, [item.event]: (acc[item.event] || 0) + 1 }), {});
  const duplicateGroups = Object.values(items.reduce((acc, item) => {
    const key = `${item.platform}:${item.event}:${item.matcher || '<none>'}`;
    return { ...acc, [key]: [...(acc[key] || []), item.name] };
  }, {})).filter((group) => group.length > 1);
  return {
    total: items.length,
    by_class: byClass,
    by_event: byEvent,
    duplicate_groups: duplicateGroups.map((group) => ({ count: group.length, hooks: group })),
  };
}

function candidateReason(hook) {
  const evidence = hook.evidence || {};
  if (hook.class === 'hard-block') return 'hard-block hooks are retained unless replaced by equivalent safety coverage';
  if (!evidence.run_count && !evidence.warn_count && !evidence.block_count && !evidence.error_count) return 'missing runtime metrics';
  if (evidence.output_chars === null) return 'missing output_chars evidence';
  if (evidence.block_count > 0) return 'prevented failures or blocked commands during window';
  if (evidence.error_count > 0) return 'has errors; fix fail-soft behavior before diet decision';
  return 'candidate for manual review after measurement window';
}

function buildCandidates(report) {
  const candidates = report.hooks.map((hook) => {
    const reason = candidateReason(hook);
    return {
      name: hook.name,
      platform: hook.platform,
      event: hook.event,
      matcher: hook.matcher,
      class: hook.class,
      evidence: hook.evidence,
      eligible_for_removal: reason === 'candidate for manual review after measurement window',
      reason,
      rollback: hook.rollback,
    };
  });
  const eligible = candidates.filter((candidate) => candidate.eligible_for_removal);
  return {
    kind: 'hook-diet-candidates',
    source_inventory: report.sources,
    summary: {
      total: candidates.length,
      eligible_for_removal: eligible.length,
      blocked: candidates.length - eligible.length,
      note: 'No hook should be removed until output_chars and runtime metrics are present for the target hook.',
    },
    candidates,
  };
}

function metricFor(metrics, name) {
  const item = (metrics.hooks || {})[name] || {};
  return {
    run_count: item.fired || 0,
    warn_count: item.warned || 0,
    block_count: item.blocked || 0,
    error_count: item.error || 0,
    avg_wall_time_ms: item._avgMs || 0,
    last_seen: item._lastSeen || '',
    output_chars: item.outputChars || item._outputChars || null,
  };
}

function buildInventory(options = {}) {
  const home = options.home || os.homedir();
  const claudeFile = options.claudeFile || path.join(home, '.claude', 'settings.json');
  const codexFile = options.codexFile || path.join(home, '.codex', 'hooks.json');
  const metricsFile = options.metricsFile || path.join(home, '.claude', 'hooks', 'metrics.json');
  const errorsLog = options.errorsLog || path.join(home, '.claude', 'hooks', 'errors.log');
  const claude = readJson(claudeFile);
  const codex = readJson(codexFile);
  const metrics = readJson(metricsFile);
  const errors = readErrorSummary(errorsLog);
  const rawItems = [
    ...(claude.ok ? flattenClaudeHooks(claude.value) : []),
    ...(codex.ok ? flattenCodexHooks(codex.value) : []),
  ];
  const hooks = rawItems.map((item) => {
    const hookClass = classifyHook(item.command);
    return {
      ...item,
      name: hookName(item.command),
      class: hookClass,
      owner: item.platform,
      evidence: metricFor(metrics.ok ? metrics.value : {}, hookName(item.command)),
      failure_policy: failurePolicy(hookClass),
      rollback: 'restore prior hook registration from git or set hook disabled-by-default',
      evidence_required: ['run_count', 'block_warn_count', 'error_count', 'avg_wall_time_ms', 'output_chars', 'overlap', 'prevented_failure'],
    };
  });
  const missingEvidence = hooks.filter((hook) => hook.evidence.run_count === 0 && hook.evidence.warn_count === 0 && hook.evidence.block_count === 0 && hook.evidence.error_count === 0).length;
  return {
    kind: 'hook-diet-inventory',
    sources: {
      claude: { file: claudeFile, ok: claude.ok, error: claude.error || '' },
      codex: { file: codexFile, ok: codex.ok, error: codex.error || '' },
      metrics: { file: metricsFile, ok: metrics.ok, error: metrics.error || '', updated: metrics.ok ? metrics.value._updated || '' : '' },
      errors: { file: errorsLog, ok: errors.ok, error: errors.error || '', total_lines: errors.total_lines, error_lines: errors.error_lines },
    },
    summary: summarize(hooks),
    evidence_summary: {
      hooks_missing_runtime_metrics: missingEvidence,
      hooks_with_runtime_metrics: hooks.length - missingEvidence,
      errors_by_hook: errors.by_hook,
    },
    hooks,
  };
}

function parseArgs(argv) {
  const defaults = { json: false, summary: false, home: os.homedir() };
  const parseNext = (index, state) => {
    if (index >= argv.length) return state;
    const arg = argv[index];
    if (arg === '--json') return parseNext(index + 1, { ...state, json: true });
    if (arg === '--summary') return parseNext(index + 1, { ...state, summary: true });
    if (arg === '--candidates') return parseNext(index + 1, { ...state, candidates: true });
    if (arg === '--out') return parseNext(index + 2, { ...state, out: argv[index + 1] || state.out });
    if (arg === '--home') return parseNext(index + 2, { ...state, home: argv[index + 1] || state.home });
    if (arg === '--claude-file') return parseNext(index + 2, { ...state, claudeFile: argv[index + 1] || state.claudeFile });
    if (arg === '--codex-file') return parseNext(index + 2, { ...state, codexFile: argv[index + 1] || state.codexFile });
    if (arg === '--metrics-file') return parseNext(index + 2, { ...state, metricsFile: argv[index + 1] || state.metricsFile });
    if (arg === '--errors-log') return parseNext(index + 2, { ...state, errorsLog: argv[index + 1] || state.errorsLog });
    return parseNext(index + 1, state);
  };
  return parseNext(2, defaults);
}

function main() {
  const options = parseArgs(process.argv);
  const report = buildInventory(options);
  if (options.candidates) {
    const candidates = buildCandidates(report);
    if (options.out) {
      fs.mkdirSync(path.dirname(options.out), { recursive: true });
      fs.writeFileSync(options.out, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(JSON.stringify(candidates.summary, null, 2) + '\n');
    return;
  }
  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  if (options.summary) {
    process.stdout.write(JSON.stringify(report.summary, null, 2) + '\n');
    return;
  }
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `hook-diet inventory: ${report.summary.total} hooks\n`);
}

if (require.main === module) main();

module.exports = {
  buildCandidates,
  buildInventory,
  classifyHook,
  flattenClaudeHooks,
  flattenCodexHooks,
  readErrorSummary,
};
