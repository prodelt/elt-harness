'use strict';
// 011 T022 — числа из спеки (77% block-rate, 5.75 прогонов судьи/коммит, 29% покрытие,
// 185 c судья) до сих пор перемерялись руками через разбор run-log.jsonl. Одна команда,
// одна функция правды: `elt stats` считает то же самое из тех же записей.

const GATE_STATUSES = ['l0-clean', 'judge-pass', 'judge-block', 'judge-inconclusive', 'judge-dead'];

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

// Источник блока по маркерам T019 в reasons; L0 считается отдельно по статусу (до судьи).
function classifyBlockSource(reasons) {
  const r = (reasons || []).join(' ');
  if (/red-proof/.test(r)) return 'red-proof';
  if (/grounding|no-reasons/.test(r)) return 'grounding';
  return 'судья';
}

function computeStats(entries, { since } = {}) {
  const filtered = since ? entries.filter((e) => e.ts && e.ts >= since) : entries.slice();

  const gateRuns = filtered.filter((e) => GATE_STATUSES.includes(e.status));
  const judgedRuns = gateRuns.filter((e) => e.status !== 'l0-clean');
  const l0CleanRuns = gateRuns.filter((e) => e.status === 'l0-clean');
  const blockedRuns = judgedRuns.filter((e) => e.status === 'judge-block');
  const inconclusiveRuns = judgedRuns.filter((e) => e.status === 'judge-inconclusive');
  const l0Blocked = filtered.filter((e) => e.status === 'l0-block');
  const commits = filtered.filter((e) => e.commit);
  const gatedCommits = commits.filter((e) => !(e.oracle && e.oracle.skipped) && !e.approvalSkipped);
  const judgeInvocations = judgedRuns.reduce((sum, e) => sum + (Array.isArray(e.judges) ? e.judges.length : 1), 0);
  const oracleDurations = filtered
    .map((e) => (e.oracle && typeof e.oracle.durationSec === 'number' ? e.oracle.durationSec : null))
    .filter((v) => v !== null)
    .sort((a, b) => a - b);

  const ratio = (num, den) => (den > 0 ? num / den : null);

  const blockBreakdown = { 'red-proof': 0, grounding: 0, судья: 0, L0: l0Blocked.length };
  for (const e of blockedRuns) blockBreakdown[classifyBlockSource(e.reasons)] += 1;

  return {
    since: since || null,
    totalEntries: filtered.length,
    gateRuns: gateRuns.length,
    judgedRuns: judgedRuns.length,
    commits: commits.length,
    blockRate: ratio(blockedRuns.length, judgedRuns.length),
    l0CleanShare: ratio(l0CleanRuns.length, gateRuns.length),
    inconclusiveShare: ratio(inconclusiveRuns.length, judgedRuns.length),
    judgeRunsPerCommit: ratio(judgeInvocations, commits.length),
    gateCoverage: ratio(gatedCommits.length, commits.length),
    oracleP50: percentile(oracleDurations, 50),
    oracleP90: percentile(oracleDurations, 90),
    blockBreakdown,
  };
}

function parseRunLog(raw) {
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; } // битая строка не хоронит статистику
  }).filter(Boolean);
}

module.exports = { computeStats, parseRunLog, classifyBlockSource, percentile };
