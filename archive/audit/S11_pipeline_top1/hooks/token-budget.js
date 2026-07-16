#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_ROOT = path.join(os.homedir(), ".claude", "projects");
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), ".claude");
const DEFAULT_DAYS = 7;
const DEFAULT_LIMIT = 10;
const FLAT_TOLERANCE_PCT = 3;

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function formatDateLabel(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function walkRecentJsonl(rootDir, cutoffMs) {
  const files = [];
  if (!fs.existsSync(rootDir)) return files;
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const items = safe(() => fs.readdirSync(dir, { withFileTypes: true }), []);
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!item.name.endsWith(".jsonl")) continue;
      const stat = safe(() => fs.statSync(fullPath), null);
      if (!stat || stat.mtimeMs < cutoffMs) continue;
      files.push({ filePath: fullPath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return files;
}

function projectNameFromPath(rootDir, filePath) {
  const rel = path.relative(rootDir, filePath);
  return rel.split(path.sep)[0] || "unknown";
}

function collectProjectRows(files, rootDir, limit) {
  const byProject = new Map();
  for (const file of files) {
    const project = projectNameFromPath(rootDir, file.filePath);
    const current = byProject.get(project) || { project, sessions: 0, totalBytes: 0, lastMtimeMs: 0 };
    byProject.set(project, {
      project,
      sessions: current.sessions + 1,
      totalBytes: current.totalBytes + file.sizeBytes,
      lastMtimeMs: Math.max(current.lastMtimeMs, file.mtimeMs),
    });
  }

  return [...byProject.values()]
    .map((row) => ({
      project: row.project,
      sessions: row.sessions,
      avgKB: row.totalBytes / row.sessions / 1024,
      lastMtimeMs: row.lastMtimeMs,
    }))
    .sort((left, right) => {
      if (right.sessions !== left.sessions) return right.sessions - left.sessions;
      if (right.avgKB !== left.avgKB) return right.avgKB - left.avgKB;
      return left.project.localeCompare(right.project);
    })
    .slice(0, limit);
}

function listBudgetFiles(outputDir, currentLabel) {
  const items = safe(() => fs.readdirSync(outputDir, { withFileTypes: true }), []);
  return items
    .filter((item) => item.isFile())
    .map((item) => item.name)
    .map((name) => {
      const match = name.match(/^budget-(\d{4}-\d{2}-\d{2})\.md$/);
      return match ? { name, label: match[1] } : null;
    })
    .filter(Boolean)
    .filter((item) => item.label !== currentLabel)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function parseBudgetReport(filePath, label) {
  const text = safe(() => fs.readFileSync(filePath, "utf8"), "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const rows = [];
  for (const line of lines) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|\s*([^|]+?)\s*\|$/);
    if (!match || match[1].trim() === "project") continue;
    rows.push({
      label,
      project: match[1].trim(),
      sessions: Number(match[2]),
      avgKB: Number(match[3]),
      trend: match[4].trim(),
    });
  }
  return rows;
}

function buildHistoryByProject(outputDir, currentLabel) {
  const history = new Map();
  for (const file of listBudgetFiles(outputDir, currentLabel)) {
    const reportPath = path.join(outputDir, file.name);
    for (const row of parseBudgetReport(reportPath, file.label)) {
      const rows = history.get(row.project) || [];
      history.set(row.project, [...rows, row]);
    }
  }
  return history;
}

function classifyDelta(prevValue, nextValue, tolerancePct = FLAT_TOLERANCE_PCT) {
  if (prevValue <= 0 && nextValue <= 0) return 0;
  if (prevValue <= 0) return 1;
  const deltaPct = ((nextValue - prevValue) / prevValue) * 100;
  if (Math.abs(deltaPct) <= tolerancePct) return 0;
  return deltaPct > 0 ? 1 : -1;
}

function formatStepTrend(prevValue, currentValue) {
  if (prevValue <= 0 && currentValue > 0) return "new";
  const deltaPct = prevValue > 0 ? ((currentValue - prevValue) / prevValue) * 100 : 100;
  if (Math.abs(deltaPct) <= FLAT_TOLERANCE_PCT) return "flat";
  const direction = deltaPct > 0 ? "↑" : "↓";
  return `${direction} ${deltaPct > 0 ? "+" : ""}${Math.round(deltaPct)}%`;
}

function formatTrend(historyRows, currentAvgKB) {
  if (!historyRows || historyRows.length === 0) return "new";
  const values = historyRows.slice(-2).map((row) => row.avgKB);
  const prevValue = historyRows[historyRows.length - 1].avgKB;
  if (values.length === 2) {
    const directionA = classifyDelta(values[0], values[1]);
    const directionB = classifyDelta(values[1], currentAvgKB);
    if (directionA !== 0 && directionA === directionB) {
      return directionA > 0 ? "↑ 3d" : "↓ 3d";
    }
  }
  return formatStepTrend(prevValue, currentAvgKB);
}

function createBudgetReport(input) {
  const lines = [
    `# Token Budget — ${input.dateLabel}`,
    "",
    `Generated: ${input.generatedAt}`,
    `Window: ${input.days} days`,
    `Projects: ${input.rows.length}`,
    "",
    "| project | sessions | avg_kb | trend |",
    "| --- | ---: | ---: | --- |",
  ];

  if (input.rows.length === 0) {
    lines.push("| — | 0 | 0.0 | new |");
  } else {
    for (const row of input.rows) {
      lines.push(`| ${row.project} | ${row.sessions} | ${row.avgKB.toFixed(1)} | ${row.trend} |`);
    }
  }

  lines.push("");
  lines.push(`Overall avg_kb: ${input.overallAvgKB.toFixed(1)}`);
  return lines.join("\n");
}

function runTokenBudget(options = {}) {
  const now = options.now || new Date();
  const dateLabel = options.dateLabel || formatDateLabel(now);
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;
  const days = Number(options.days || DEFAULT_DAYS);
  const limit = Number(options.limit || DEFAULT_LIMIT);
  const cutoffMs = now.getTime() - (days * 86400000);
  const files = walkRecentJsonl(rootDir, cutoffMs);
  const baseRows = collectProjectRows(files, rootDir, limit);
  const history = buildHistoryByProject(outputDir, dateLabel);
  const rows = baseRows.map((row) => ({
    ...row,
    trend: formatTrend(history.get(row.project) || [], row.avgKB),
  }));
  const overallAvgKB = rows.length === 0
    ? 0
    : rows.reduce((sum, row) => sum + row.avgKB, 0) / rows.length;
  const report = createBudgetReport({
    dateLabel,
    generatedAt: now.toISOString(),
    days,
    rows,
    overallAvgKB,
  });
  const outputPath = path.join(outputDir, `budget-${dateLabel}.md`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, report, "utf8");
  return { outputPath, rows, overallAvgKB, report };
}

function parseArgs(argv) {
  return argv.reduce((state, arg) => {
    if (arg === "--help") return { ...state, help: true };
    const [key, value] = arg.split("=");
    if (key === "--root") return { ...state, rootDir: value };
    if (key === "--output-dir") return { ...state, outputDir: value };
    if (key === "--date") return { ...state, dateLabel: value };
    if (key === "--days") return { ...state, days: Number(value) || state.days };
    if (key === "--limit") return { ...state, limit: Number(value) || state.limit };
    return state;
  }, { days: DEFAULT_DAYS, limit: DEFAULT_LIMIT, help: false });
}

function printHelp() {
  process.stdout.write(
    "usage: token-budget.js [--root=<dir>] [--output-dir=<dir>] [--date=YYYY-MM-DD] [--days=N] [--limit=N]\n"
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const result = runTokenBudget(args);
  process.stdout.write(`[token-budget] projects=${result.rows.length} -> ${result.outputPath}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`token-budget failed: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  buildHistoryByProject,
  collectProjectRows,
  createBudgetReport,
  formatTrend,
  parseBudgetReport,
  runTokenBudget,
  walkRecentJsonl,
};
