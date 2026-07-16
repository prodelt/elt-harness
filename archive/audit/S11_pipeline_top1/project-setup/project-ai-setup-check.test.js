const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { detectGitHealth, inspectProjectSetup } = require("./project-ai-setup-check");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-ai-setup-check-"));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function makeDoc(title) {
  return [
    `# ${title}`,
    "## Overview",
    "Project overview",
    "## Stack",
    "Stack details",
    "## Commands",
    "Commands details",
    "## Architecture",
    "Architecture details",
    "## Gotchas",
    "Gotchas details",
    "## Current State",
    "Current state details",
    "Pipeline: /pipeline Context7 TDD verification /inline-review /ship checkpoint",
    "",
  ].join("\n");
}

try {
  const nestedParent = path.join(tempRoot, "izi-parent");
  const nestedRealRoot = path.join(nestedParent, "izi-tracker");
  writeFile(path.join(nestedRealRoot, "package.json"), '{"name":"izi-tracker"}');
  writeFile(path.join(nestedRealRoot, ".git", "keep"), "");
  writeFile(path.join(nestedRealRoot, "CLAUDE.md"), makeDoc("CLAUDE"));
  writeFile(path.join(nestedRealRoot, "AGENTS.md"), makeDoc("AGENTS"));
  writeFile(path.join(nestedRealRoot, ".gemini", "GEMINI.md"), makeDoc("GEMINI"));

  const nestedResult = inspectProjectSetup(nestedParent, { execGit: () => "" });
  assert.strictEqual(nestedResult.success, false);
  assert.strictEqual(nestedResult.mismatch, true);
  assert.ok(nestedResult.failures.some((failure) => failure.includes("real root differs from cwd")));
  assert.ok(nestedResult.warnings.some((warning) => warning.includes(".claude\\settings.json") || warning.includes(".claude/settings.json")));

  const healthyRoot = path.join(tempRoot, "healthy");
  writeFile(path.join(healthyRoot, "package.json"), '{"name":"healthy"}');
  writeFile(path.join(healthyRoot, ".git", "keep"), "");
  writeFile(path.join(healthyRoot, "CLAUDE.md"), makeDoc("CLAUDE"));
  writeFile(path.join(healthyRoot, "AGENTS.md"), makeDoc("AGENTS"));
  writeFile(path.join(healthyRoot, ".gemini", "GEMINI.md"), makeDoc("GEMINI"));
  writeFile(path.join(healthyRoot, ".claude", "settings.json"), '{"permissions":{}}');

  const healthyResult = inspectProjectSetup(healthyRoot, { execGit: () => "" });
  assert.strictEqual(healthyResult.success, true);
  assert.deepStrictEqual(healthyResult.failures, []);
  assert.deepStrictEqual(healthyResult.warnings, []);

  const staleRoot = path.join(tempRoot, "stale");
  writeFile(path.join(staleRoot, "package.json"), '{"name":"stale"}');
  writeFile(path.join(staleRoot, ".git", "keep"), "");
  writeFile(path.join(staleRoot, "CLAUDE.md"), makeDoc("CLAUDE"));
  writeFile(path.join(staleRoot, "AGENTS.md"), makeDoc("AGENTS"));
  writeFile(path.join(staleRoot, ".gemini", "GEMINI.md"), makeDoc("GEMINI"));
  writeFile(path.join(staleRoot, ".claude", "settings.json"), '{"permissions":{}}');
  writeFile(path.join(staleRoot, ".claude", "settings.local.json"), '{"allow":["*"]}');

  const staleResult = inspectProjectSetup(staleRoot, { execGit: () => "" });
  assert.strictEqual(staleResult.success, true);
  assert.ok(staleResult.warnings.some((warning) => warning.includes("settings.local.json")));

  const gitWarnings = detectGitHealth(healthyRoot, () => {
    const error = new Error("dubious ownership");
    error.stderr = "fatal: detected dubious ownership in repository";
    throw error;
  });
  assert.strictEqual(gitWarnings.length, 1);
  assert.ok(gitWarnings[0].includes("safe.directory"));

  process.stdout.write("project-ai-setup-check.test.js PASS\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
