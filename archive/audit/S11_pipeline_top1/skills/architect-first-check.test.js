const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { evaluateArchitectFirstSkill, run } = require("./architect-first-check");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "architect-first-check-"));

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
      "name: architect-first",
      "version: 1.0.0",
      "---",
      "# Architect First",
      "## Architecture Flow",
      "### Phase 2 - Multi-Perspective Validation",
      "Present A/B/C options.",
      "",
    ].join("\n")
  );

  const invalidResult = evaluateArchitectFirstSkill(invalidPath);
  assert.strictEqual(invalidResult.success, false);
  assert.ok(invalidResult.missing.includes("phase 2.5 heading"));
  assert.ok(invalidResult.missing.includes("ctx7 search command"));
  assert.ok(invalidResult.missing.includes("hard stop rule"));

  const validPath = path.join(tempRoot, "valid", "SKILL.md");
  const fixturePath = path.join(__dirname, "architect-first", "SKILL.md");
  writeFile(validPath, fs.readFileSync(fixturePath, "utf8"));

  const validResult = evaluateArchitectFirstSkill(validPath);
  assert.deepStrictEqual(validResult.missing, []);
  assert.strictEqual(validResult.success, true);

  const runResult = run([validPath, invalidPath]);
  assert.strictEqual(runResult.success, false);
  assert.strictEqual(runResult.checked, 2);
  assert.strictEqual(runResult.failed.length, 1);

  process.stdout.write("architect-first-check.test.js PASS\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
