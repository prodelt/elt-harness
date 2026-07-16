#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REQUIRED_COVERAGE = ["memory", "skills", "toolsets", "contextCompression", "gateway", "mcp"];
const REQUIRED_DECISIONS = ["adopt", "adapt", "reject"];

function readFixture(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function evaluateCoverage(coverage) {
  const missing = REQUIRED_COVERAGE.filter((item) => coverage[item] !== true);
  return {
    success: missing.length === 0,
    missing,
  };
}

function evaluatePatterns(patterns) {
  const entries = Array.isArray(patterns) ? patterns : [];
  const invalid = entries.filter(
    (pattern) =>
      !pattern ||
      !REQUIRED_DECISIONS.includes(normalize(pattern.decision)) ||
      !String(pattern.name || "").trim() ||
      !String(pattern.reason || "").trim()
  );
  const decisions = new Set(entries.map((pattern) => normalize(pattern.decision)));
  const missingDecisions = REQUIRED_DECISIONS.filter((decision) => !decisions.has(decision));
  return {
    success: invalid.length === 0 && missingDecisions.length === 0 && entries.length >= 3,
    invalidCount: invalid.length,
    missingDecisions,
    entries,
  };
}

function evaluateGuardrails(guardrails) {
  return {
    success:
      guardrails.installRunForbiddenWithoutApproval === true &&
      guardrails.requiresSandboxPlan === true &&
      guardrails.noGlobalRuntimeChanges === true,
  };
}

function evaluateSpike(fixture) {
  const windows = fixture.windowsSupport || {};
  const coverage = evaluateCoverage(fixture.coverage || {});
  const patterns = evaluatePatterns(fixture.patterns || []);
  const guardrails = evaluateGuardrails(fixture.guardrails || {});
  const windowsOk = normalize(windows.nativeWindows) === "unsupported" && windows.wsl2Required === true;
  const readOnlyOk = fixture.sources && fixture.sources.readOnly === true;
  return {
    success: readOnlyOk && windowsOk && coverage.success && patterns.success && guardrails.success,
    readOnlyOk,
    windowsOk,
    coverage,
    patterns: {
      success: patterns.success,
      invalidCount: patterns.invalidCount,
      missingDecisions: patterns.missingDecisions,
      decisions: patterns.entries.map((item) => `${item.name}:${normalize(item.decision)}`),
    },
    guardrailsOk: guardrails.success,
  };
}

function formatText(result) {
  const lines = [
    result.success ? "OK: hermes architecture spike" : "FAIL: hermes architecture spike",
    `read-only scope: ${result.readOnlyOk}`,
    `windows constraint documented: ${result.windowsOk}`,
    `coverage complete: ${result.coverage.success}`,
    `patterns complete: ${result.patterns.success}`,
    `guardrails complete: ${result.guardrailsOk}`,
    `pattern decisions: ${result.patterns.decisions.join(", ")}`,
  ];
  if (result.coverage.missing.length > 0) lines.push(`missing coverage: ${result.coverage.missing.join(", ")}`);
  if (result.patterns.missingDecisions.length > 0) {
    lines.push(`missing decisions: ${result.patterns.missingDecisions.join(", ")}`);
  }
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
    const result = evaluateSpike(readFixture(options.fixtureFile));
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
  evaluateCoverage,
  evaluatePatterns,
  evaluateSpike,
};
