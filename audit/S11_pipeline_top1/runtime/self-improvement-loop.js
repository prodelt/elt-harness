#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REQUIRED_INTEGRATIONS = [
  "learn",
  "githubDiscovery",
  "quarantineScan",
  "promotionManifest",
  "projectRagWrite",
  "checkpoint",
];
const REQUIRED_EVENTS = [
  "end-of-task",
  "repeated-pattern",
  "new-tool-discovered",
  "failed-workflow",
  "successful-workflow",
];
const REQUIRED_SCOPES = ["globalDevKnowledge", "projectKnowledge", "skillUpdate", "taskLocalNote"];

function readFixture(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function evaluateIntegrations(integrations) {
  const missing = REQUIRED_INTEGRATIONS.filter((name) => integrations[name] !== true);
  return { success: missing.length === 0, missing };
}

function evaluateEvents(events) {
  const list = Array.isArray(events) ? events : [];
  const enabled = new Set(list.filter((item) => item && item.enabled === true).map((item) => String(item.name || "")));
  const missing = REQUIRED_EVENTS.filter((name) => !enabled.has(name));
  return { success: missing.length === 0, missing, count: enabled.size };
}

function evaluateScopes(writeScopes) {
  const missing = REQUIRED_SCOPES.filter((name) => !Array.isArray(writeScopes[name]) || writeScopes[name].length === 0);
  return { success: missing.length === 0, missing };
}

function evaluateTokenBudget(tokenBudget) {
  const before = Number(tokenBudget.before || 0);
  const after = Number(tokenBudget.after || 0);
  const maxDelta = Number(tokenBudget.maxDelta || 0);
  const delta = after - before;
  return {
    success: Number.isFinite(delta) && delta >= 0 && delta <= maxDelta,
    before,
    after,
    delta,
    maxDelta,
  };
}

function evaluateDryRun(dryRun, writeScopes) {
  const proposal = dryRun.generatedProposal || {};
  const targetScope = String(proposal.targetScope || "");
  const validScope = Object.prototype.hasOwnProperty.call(writeScopes, targetScope);
  return {
    success:
      String(dryRun.triggerEvent || "") === "end-of-task" &&
      Boolean(String(proposal.type || "").trim()) &&
      validScope &&
      Boolean(String(proposal.summary || "").trim()) &&
      proposal.autoPromote === false &&
      proposal.requiresQuarantine === true,
    targetScope,
    autoPromote: proposal.autoPromote,
    requiresQuarantine: proposal.requiresQuarantine,
  };
}

function evaluateBatchPolicy(batchPolicy) {
  return {
    success: Number(batchPolicy.tasksPerBatch || 0) === 3 && batchPolicy.updateDocsOncePerBatch === true,
  };
}

function evaluateLoop(fixture) {
  const integrations = evaluateIntegrations(fixture.integrations || {});
  const events = evaluateEvents(fixture.events || []);
  const scopes = evaluateScopes(fixture.writeScopes || {});
  const tokenBudget = evaluateTokenBudget(fixture.tokenBudget || {});
  const dryRun = evaluateDryRun(fixture.dryRun || {}, fixture.writeScopes || {});
  const batchPolicy = evaluateBatchPolicy(fixture.batchPolicy || {});
  return {
    success: integrations.success && events.success && scopes.success && tokenBudget.success && dryRun.success && batchPolicy.success,
    integrations,
    events,
    scopes,
    tokenBudget,
    dryRun,
    batchPolicy,
  };
}

function formatText(result) {
  const lines = [
    result.success ? "OK: self-improvement loop" : "FAIL: self-improvement loop",
    `integrations: ${result.integrations.success}`,
    `events: ${result.events.success}`,
    `write scopes: ${result.scopes.success}`,
    `token budget: ${result.tokenBudget.success} (delta=${result.tokenBudget.delta}, max=${result.tokenBudget.maxDelta})`,
    `dry-run proposal: ${result.dryRun.success} (scope=${result.dryRun.targetScope})`,
    `batch policy: ${result.batchPolicy.success}`,
  ];
  if (result.integrations.missing.length > 0) lines.push(`missing integrations: ${result.integrations.missing.join(", ")}`);
  if (result.events.missing.length > 0) lines.push(`missing events: ${result.events.missing.join(", ")}`);
  if (result.scopes.missing.length > 0) lines.push(`missing scopes: ${result.scopes.missing.join(", ")}`);
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
    const result = evaluateLoop(readFixture(options.fixtureFile));
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
  evaluateBatchPolicy,
  evaluateLoop,
  evaluateTokenBudget,
};
