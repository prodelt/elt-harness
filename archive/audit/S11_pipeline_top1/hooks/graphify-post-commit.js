#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { spawn } = require("child_process");

let metrics;
try {
  metrics = require("./lib/metrics");
} catch (_) {
  metrics = { inc: () => {} };
}

const HOOK = "graphify-post-commit";

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch (_) {
    return null;
  }
}

function shouldHandleCommand(command) {
  return /^\s*git\s+commit(?:\s|$)/i.test(command || "");
}

function getExitCode(input) {
  const sources = [input && input.tool_response, input && input.tool_result];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of ["exit_code", "exitCode", "status", "code"]) {
      if (Number.isInteger(source[key])) return source[key];
    }
  }
  return null;
}

function responseText(input) {
  const response = input && (input.tool_response || input.tool_result);
  if (typeof response === "string") return response;
  if (!response || typeof response !== "object") return "";
  return String(response.stdout || response.stderr || response.output || response.content || "");
}

function isSuccessfulCommit(input) {
  const exitCode = getExitCode(input);
  if (exitCode !== null) return exitCode === 0;
  const text = responseText(input).toLowerCase();
  if (!text) return true;
  if (/(nothing to commit|fatal:|error:|aborting commit)/.test(text)) return false;
  return /\[[^\]]+[0-9a-f]{7,}\]/.test(text) || /files? changed/.test(text);
}

function spawnGraphifyUpdate(cwd, spawnImpl = spawn) {
  const child = spawnImpl("cmd", ["/c", "graphify", "update", "."], {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function handleInput(input, options = {}) {
  if (!input || input.tool_name !== "Bash") return "";
  metrics.inc(HOOK, "fired");

  const command = input.tool_input && input.tool_input.command;
  if (!shouldHandleCommand(command)) return "";
  if (!isSuccessfulCommit(input)) return "";

  try {
    spawnGraphifyUpdate(input.cwd || process.cwd(), options.spawnImpl);
    metrics.inc(HOOK, "spawned");
  } catch (_) {
    metrics.inc(HOOK, "error");
  }
  return "";
}

if (require.main === module) {
  process.stdout.write(handleInput(readInput()));
}

module.exports = {
  getExitCode,
  handleInput,
  isSuccessfulCommit,
  shouldHandleCommand,
  spawnGraphifyUpdate,
};
