#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_DESCRIPTOR_DIR = path.join(__dirname, "cli-capabilities");

function readJsonYaml(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadDescriptors(directoryPath = DEFAULT_DESCRIPTOR_DIR) {
  const files = fs
    .readdirSync(directoryPath)
    .filter((fileName) => fileName.endsWith(".opencli.yaml"))
    .sort();
  return files.map((fileName) => readJsonYaml(path.join(directoryPath, fileName)));
}

function buildRegistry(descriptors) {
  return new Map(descriptors.map((descriptor) => [descriptor.info.name, descriptor]));
}

function findCommand(descriptor, commandName) {
  return (descriptor.commands || []).find((command) => command.name === commandName) || null;
}

function substituteParams(template, params) {
  return String(template || "").replace(/\{([^}]+)\}/g, (_, key) => params[key] || `{${key}}`);
}

function chooseTransport(descriptor, need) {
  const normalizedNeed = String(need || "").toLowerCase();
  const transport = descriptor.transport || {};
  if ((transport.preferMcpWhen || []).some((item) => normalizedNeed.includes(String(item).toLowerCase()))) {
    return "mcp";
  }
  if ((transport.preferCliWhen || []).some((item) => normalizedNeed.includes(String(item).toLowerCase()))) {
    return "cli";
  }
  return transport.default || "cli";
}

function buildCommandPlan(descriptor, commandName, params) {
  const command = findCommand(descriptor, commandName);
  if (!command) {
    return null;
  }
  return {
    name: command.name,
    command: substituteParams(command.command, params || {}),
    destructive: Boolean(command.destructive),
    outputs: command.outputs,
  };
}

function evaluateScenario(registry, scenario) {
  const descriptor = registry.get(scenario.tool);
  if (!descriptor) {
    return {
      success: false,
      name: scenario.name,
      reason: `missing descriptor for ${scenario.tool}`,
    };
  }
  const transport = chooseTransport(descriptor, scenario.need || scenario.name || scenario.commandName);
  const plan = buildCommandPlan(descriptor, scenario.commandName, scenario.params);
  const success = Boolean(plan) && transport === scenario.transport && plan.destructive === false;
  return {
    success,
    name: scenario.name,
    tool: scenario.tool,
    transport,
    commandPlan: plan,
    reason: success ? null : "scenario did not resolve to a safe CLI plan",
  };
}

function evaluateMcpPreference(registry, check) {
  const descriptor = registry.get(check.tool);
  if (!descriptor) {
    return {
      success: false,
      tool: check.tool,
      actualTransport: null,
      expectedTransport: check.expectedTransport,
    };
  }
  const actualTransport = chooseTransport(descriptor, check.need);
  return {
    success: actualTransport === check.expectedTransport,
    tool: check.tool,
    actualTransport,
    expectedTransport: check.expectedTransport,
  };
}

function evaluateRegistry(options = {}) {
  const descriptors = loadDescriptors(options.directoryPath || DEFAULT_DESCRIPTOR_DIR);
  const registry = buildRegistry(descriptors);
  const fixture = JSON.parse(fs.readFileSync(path.resolve(options.fixtureFile), "utf8"));
  const scenarios = (fixture.scenarios || []).map((scenario) => evaluateScenario(registry, scenario));
  const preferences = (fixture.mcpPreferenceChecks || []).map((check) => evaluateMcpPreference(registry, check));
  const success = scenarios.every((item) => item.success) && preferences.every((item) => item.success);
  return {
    success,
    descriptorCount: descriptors.length,
    scenarios,
    preferences,
  };
}

function formatText(result) {
  const lines = [
    result.success ? "OK: cli capability registry" : "FAIL: cli capability registry",
    `descriptors: ${result.descriptorCount}`,
    "Scenarios:",
    ...result.scenarios.map((item) =>
      `- ${item.name}: ${item.tool} -> ${item.transport} -> ${item.commandPlan ? item.commandPlan.command : "missing"}`
    ),
    "Preference checks:",
    ...result.preferences.map((item) => `- ${item.tool}: ${item.actualTransport} (expected ${item.expectedTransport})`),
  ];
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--fixture-file") {
      options.fixtureFile = next;
      index += 1;
    } else if (current === "--directory") {
      options.directoryPath = next;
      index += 1;
    } else if (current === "--json") {
      options.json = true;
    }
  }
  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.fixtureFile) {
      throw new Error("Missing --fixture-file.");
    }
    const result = evaluateRegistry(options);
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatText(result));
    if (!result.success) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildCommandPlan,
  chooseTransport,
  evaluateRegistry,
  evaluateScenario,
  loadDescriptors,
};
