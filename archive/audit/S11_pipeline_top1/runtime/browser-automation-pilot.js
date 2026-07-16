#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const COST_SCORE = { low: 3, medium: 2, high: 1 };
const QUALITY_SCORE = { low: 1, medium: 2, high: 3 };
const REQUIRED_OPTIONS = ["playwright-cli", "browser-harness", "chrome-devtools-mcp"];
const POLICY_MODES = new Set(["project-only", "on-demand", "project+on-demand"]);
const UNSAFE_COMMAND = /\b(rm|del|remove-item|git\s+reset\s+--hard|format)\b/i;

function readFixture(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function normalizeLevel(value) {
  return String(value || "").trim().toLowerCase();
}

function hasUnsafePlanStep(steps) {
  return (steps || []).some((step) => UNSAFE_COMMAND.test(String(step)));
}

function scoreOption(option) {
  const tokenCost = normalizeLevel(option.tokenCost);
  const setupCost = normalizeLevel(option.setupCost);
  const reliability = normalizeLevel(option.reliability);
  const security = normalizeLevel(option.security);
  const control = normalizeLevel(option.humanVisibleControl);
  const deterministic = Boolean(option.deterministic);
  const score =
    (COST_SCORE[tokenCost] || 0) +
    (COST_SCORE[setupCost] || 0) +
    (QUALITY_SCORE[reliability] || 0) +
    (QUALITY_SCORE[security] || 0) +
    (QUALITY_SCORE[control] || 0) +
    (deterministic ? 2 : 0);
  return {
    name: String(option.name || "").trim(),
    scope: String(option.scope || "").trim().toLowerCase(),
    score,
    hasUnsafePlanStep: hasUnsafePlanStep(option.dryRunPlan),
    dryRunPlanSteps: Array.isArray(option.dryRunPlan) ? option.dryRunPlan.length : 0,
  };
}

function evaluateSelection(scored, selection) {
  const ranking = scored.slice().sort((left, right) => right.score - left.score);
  const defaultName = String(selection.default || "").trim();
  const fallbackName = String(selection.fallback || "").trim();
  const topScore = ranking[0] ? ranking[0].score : -1;
  const topNames = ranking.filter((item) => item.score === topScore).map((item) => item.name);
  const defaultOk = topNames.includes(defaultName);
  const fallbackCandidate = ranking.find((item) => item.name !== defaultName);
  const fallbackOk = Boolean(fallbackCandidate) && fallbackCandidate.name === fallbackName;
  return {
    ranking,
    defaultOk,
    fallbackOk,
    defaultName,
    fallbackName,
  };
}

function evaluatePilot(fixture) {
  const scenario = fixture.scenario || {};
  const options = Array.isArray(fixture.options) ? fixture.options : [];
  const selection = fixture.selection || {};
  const optionNames = new Set(options.map((item) => String(item.name || "").trim()));
  const requiredOptionCoverage = REQUIRED_OPTIONS.every((name) => optionNames.has(name));
  const scenarioOk =
    String(scenario.mode || "").toLowerCase() === "dry-run" &&
    Array.isArray(scenario.steps) &&
    scenario.steps.length >= 5;

  const scored = options.map(scoreOption);
  const badSafety = scored.filter((item) => item.hasUnsafePlanStep);
  const badPlans = scored.filter((item) => item.dryRunPlanSteps < 2);
  const badScopes = scored.filter((item) => item.scope === "global");
  const policyOk =
    POLICY_MODES.has(String(selection.policyMode || "").trim().toLowerCase()) &&
    selection.allowGlobalDefault === false;

  const decision = evaluateSelection(scored, selection);
  const selectedDefault = scored.find((item) => item.name === decision.defaultName);
  const selectedFallback = scored.find((item) => item.name === decision.fallbackName);
  const selectedScopeOk =
    selectedDefault && selectedFallback && selectedDefault.scope !== "global" && selectedFallback.scope !== "global";

  return {
    success:
      scenarioOk &&
      requiredOptionCoverage &&
      badSafety.length === 0 &&
      badPlans.length === 0 &&
      badScopes.length === 0 &&
      policyOk &&
      decision.defaultOk &&
      decision.fallbackOk &&
      selectedScopeOk,
    scenario: scenario.name || null,
    requiredOptionCoverage,
    scenarioOk,
    policyOk,
    defaultOk: decision.defaultOk,
    fallbackOk: decision.fallbackOk,
    selectedScopeOk: Boolean(selectedScopeOk),
    ranking: decision.ranking,
    unsafeOptions: badSafety.map((item) => item.name),
    incompletePlans: badPlans.map((item) => item.name),
    globalScopeOptions: badScopes.map((item) => item.name),
  };
}

function formatText(result) {
  const lines = [
    result.success ? "OK: browser automation pilot" : "FAIL: browser automation pilot",
    `scenario: ${result.scenario || "unknown"}`,
    `required options covered: ${result.requiredOptionCoverage}`,
    `scenario dry-run valid: ${result.scenarioOk}`,
    `policy valid: ${result.policyOk}`,
    `default selection valid: ${result.defaultOk}`,
    `fallback selection valid: ${result.fallbackOk}`,
    `selected scopes valid: ${result.selectedScopeOk}`,
    "Ranking:",
    ...result.ranking.map((item) => `- ${item.name}: score=${item.score}, scope=${item.scope}`),
  ];
  if (result.unsafeOptions.length > 0) lines.push(`unsafe options: ${result.unsafeOptions.join(", ")}`);
  if (result.incompletePlans.length > 0) lines.push(`incomplete plans: ${result.incompletePlans.join(", ")}`);
  if (result.globalScopeOptions.length > 0) lines.push(`global scope options: ${result.globalScopeOptions.join(", ")}`);
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--fixture-file") {
      options.fixtureFile = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--json") {
      options.json = true;
    }
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.fixtureFile) throw new Error("Missing --fixture-file.");
    const result = evaluatePilot(readFixture(options.fixtureFile));
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatText(result));
    if (!result.success) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluatePilot,
  evaluateSelection,
  hasUnsafePlanStep,
  scoreOption,
};
