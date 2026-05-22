const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { evaluatePipelineSkill, run } = require("./pipeline-check");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-check-"));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

try {
  const invalidPath = path.join(tempRoot, "invalid", "SKILL.md");
  writeFile(
    invalidPath,
    [
      "---",
      "name: pipeline",
      "version: 2.0.0",
      "---",
      "# /pipeline",
      "Route every task through a long workflow.",
      "",
    ].join("\n")
  );

  const invalidResult = evaluatePipelineSkill(invalidPath);
  assert.strictEqual(invalidResult.success, false);
  assert.ok(invalidResult.missing.includes("v3 version"));
  assert.ok(invalidResult.missing.includes("classification"));
  assert.ok(invalidResult.missing.includes("session ledger"));

  const validPath = path.join(tempRoot, "valid", "SKILL.md");
  const fixturePath = path.join(__dirname, "pipeline", "SKILL.md");
  writeFile(validPath, fs.readFileSync(fixturePath, "utf8"));

  const validResult = evaluatePipelineSkill(validPath);
  assert.deepStrictEqual(validResult.missing, []);
  assert.strictEqual(validResult.success, true);

  const runResult = run([validPath, invalidPath]);
  assert.strictEqual(runResult.success, false);
  assert.strictEqual(runResult.checked, 2);
  assert.strictEqual(runResult.failed.length, 1);

  process.stdout.write("pipeline-check.test.js PASS\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
