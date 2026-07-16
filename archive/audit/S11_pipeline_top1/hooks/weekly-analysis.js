#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_HOOKS_DIR = path.join(os.homedir(), ".claude", "hooks");
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), ".claude");

function readJson(filePath, fallback) {
  try {
    const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  } catch {
    return "";
  }
}

function getWeekLabel(date = new Date()) {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function scoreHook(stats) {
  const fired = Number(stats.fired || 0);
  const warned = Number(stats.warned || 0);
  const blocked = Number(stats.blocked || 0);
  const errors = Number(stats.error || 0);
  return fired + (warned * 3) + (blocked * 5) + (errors * 8);
}

function collectTopHooks(metricsPath, limit = 5) {
  const data = readJson(metricsPath, { hooks: {} });
  return Object.entries(data.hooks || {})
    .filter(([name]) => !name.startsWith("_"))
    .map(([name, stats]) => ({
      name,
      fired: Number(stats.fired || 0),
      warned: Number(stats.warned || 0),
      blocked: Number(stats.blocked || 0),
      error: Number(stats.error || 0),
      lastSeen: stats._lastSeen || null,
      score: scoreHook(stats),
    }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.blocked !== left.blocked) return right.blocked - left.blocked;
      if (right.warned !== left.warned) return right.warned - left.warned;
      if (right.fired !== left.fired) return right.fired - left.fired;
      return left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

function parseErrorLine(line) {
  const match = line.match(/^(\S+)\s+\[([A-Z]+)\]\s+\[([a-z0-9-]+)\]\s+(.+)$/i);
  if (!match) return null;
  return {
    ts: match[1],
    level: match[2],
    hook: match[3],
    message: match[4].replace(/\s+\{.*$/, "").trim().slice(0, 140),
  };
}

function isInsideWindow(ts, now, days) {
  const time = Date.parse(ts);
  if (Number.isNaN(time)) return false;
  return time >= now.getTime() - (days * 86400000);
}

function collectTopErrors(logPath, options = {}) {
  const now = options.now || new Date();
  const days = Number(options.days || 7);
  const limit = Number(options.limit || 5);
  const lines = readText(logPath).split("\n").filter(Boolean);
  const counts = new Map();

  for (const line of lines) {
    const parsed = parseErrorLine(line);
    if (!parsed || !isInsideWindow(parsed.ts, now, days)) continue;
    const key = `${parsed.hook}||${parsed.message}`;
    const current = counts.get(key) || { ...parsed, count: 0 };
    counts.set(key, {
      ...current,
      count: current.count + 1,
      lastSeen: parsed.ts > current.ts ? parsed.ts : current.ts,
    });
  }

  return [...counts.values()]
    .map((item) => ({ ...item, lastSeen: item.lastSeen || item.ts }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (right.lastSeen !== left.lastSeen) return right.lastSeen.localeCompare(left.lastSeen);
      return left.hook.localeCompare(right.hook);
    })
    .slice(0, limit);
}

function buildHookProposal(hook) {
  const action = hook.error > 0
    ? "Стабілізувати error-path і додати regression test на повторюваний збій."
    : hook.blocked > 0
      ? "Переглянути matcher або додати safe-case bypass для легітимних сценаріїв."
      : hook.warned > 0
        ? "Додати dedupe/cooldown для повторних advisory-повідомлень."
        : "Перевірити matcher scope і fast-path skip, якщо хук спрацьовує надто часто.";
  return {
    title: `Зменшити шум від \`${hook.name}\``,
    score: hook.score,
    evidence: `score=${hook.score}; fired=${hook.fired}; warned=${hook.warned}; blocked=${hook.blocked}; error=${hook.error}`,
    action,
  };
}

function buildErrorProposal(item) {
  return {
    title: `Прибрати повторюваний log-патерн у \`${item.hook}\``,
    score: item.count * 10,
    evidence: `${item.count}× ${item.level} за ${item.message}`,
    action: "Або усунути першопричину, або нормалізувати лог до одного зрозумілого повідомлення без спаму.",
  };
}

function buildRankedProposals(topHooks, topErrors) {
  const hookProposals = topHooks.map(buildHookProposal);
  const errorProposals = topErrors
    .filter((item) => !topHooks.some((hook) => hook.name === item.hook))
    .map(buildErrorProposal);
  return [...hookProposals, ...errorProposals]
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, 5);
}

function createWeeklyReport(input) {
  const proposals = buildRankedProposals(input.topHooks, input.topErrors);
  const lines = [
    `# Щотижневі pipeline-пропозиції — ${input.weekLabel}`,
    "",
    `Згенеровано: ${input.generatedAt}`,
    `Вікно аналізу: ${input.days} днів`,
    "Правило ранжування noisy hooks: fired + warned*3 + blocked*5 + error*8.",
    "",
    "## Top-5 шумних хуків",
    ...renderHookRows(input.topHooks),
    "",
    "## Top-5 повторюваних log-патернів",
    ...renderErrorRows(input.topErrors),
    "",
    "## Ранжовані пропозиції",
    ...renderProposalRows(proposals),
  ];
  return lines.join("\n");
}

function renderHookRows(topHooks) {
  if (topHooks.length === 0) return ["- Немає даних у metrics.json."];
  return topHooks.map(
    (hook) => `- \`${hook.name}\` — score ${hook.score}; fired=${hook.fired}, warned=${hook.warned}, blocked=${hook.blocked}, error=${hook.error}`
  );
}

function renderErrorRows(topErrors) {
  if (topErrors.length === 0) return ["- Немає повторюваних записів у errors.log за вибране вікно."];
  return topErrors.map(
    (item) => `- \`${item.hook}\` — ${item.count}× ${item.level}; ${item.message}; lastSeen=${item.lastSeen}`
  );
}

function renderProposalRows(proposals) {
  if (proposals.length === 0) return ["1. Даних недостатньо для нових пропозицій."];
  return proposals.flatMap((proposal, index) => [
    `${index + 1}. **${proposal.title}**`,
    `   Доказ: ${proposal.evidence}`,
    `   Дія: ${proposal.action}`,
  ]);
}

function runWeeklyAnalysis(options = {}) {
  const now = options.now || new Date();
  const hooksDir = options.hooksDir || DEFAULT_HOOKS_DIR;
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;
  const days = Number(options.days || 7);
  const limit = Number(options.limit || 5);
  const weekLabel = options.weekLabel || getWeekLabel(now);
  const topHooks = collectTopHooks(path.join(hooksDir, "metrics.json"), limit);
  const topErrors = collectTopErrors(path.join(hooksDir, "errors.log"), { now, days, limit });
  const report = createWeeklyReport({
    weekLabel,
    generatedAt: now.toISOString(),
    days,
    topHooks,
    topErrors,
  });
  const outputPath = path.join(outputDir, `proposals-${weekLabel}.md`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, report, "utf8");
  return { outputPath, weekLabel, topHooks, topErrors, report };
}

function parseArgs(argv) {
  return argv.reduce((state, arg) => {
    const [key, value] = arg.split("=");
    if (key === "--hooks-dir") return { ...state, hooksDir: value };
    if (key === "--output-dir") return { ...state, outputDir: value };
    if (key === "--week") return { ...state, weekLabel: value };
    if (key === "--days") return { ...state, days: Number(value) || state.days };
    if (key === "--limit") return { ...state, limit: Number(value) || state.limit };
    return state;
  }, { days: 7, limit: 5 });
}

function main() {
  const result = runWeeklyAnalysis(parseArgs(process.argv.slice(2)));
  process.stdout.write(
    `[weekly-analysis] hooks=${result.topHooks.length} errors=${result.topErrors.length} -> ${result.outputPath}\n`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`weekly-analysis failed: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  collectTopErrors,
  collectTopHooks,
  createWeeklyReport,
  getWeekLabel,
  runWeeklyAnalysis,
};
