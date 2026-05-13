const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { evaluateLearnSkill, run } = require("./learn-skill-check");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "learn-skill-check-"));

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
      "name: learn",
      "version: 1.0.0",
      "---",
      "# Learn",
      "## Success Criteria",
      "- Return success.",
      "## Process",
      "1. Save memory.",
      "",
    ].join("\n")
  );

  const invalidResult = evaluateLearnSkill(invalidPath);
  assert.strictEqual(invalidResult.success, false);
  assert.ok(invalidResult.missing.includes("3+ repeat threshold"));
  assert.ok(invalidResult.missing.includes("propose diff phase"));
  assert.ok(invalidResult.missing.includes("approval before apply"));

  const validPath = path.join(tempRoot, "valid", "SKILL.md");
  const fixturePath = path.join(__dirname, "learn", "SKILL.md");
  writeFile(validPath, fs.readFileSync(fixturePath, "utf8"));

  const validResult = evaluateLearnSkill(validPath);
  assert.deepStrictEqual(validResult.missing, []);
  assert.strictEqual(validResult.success, true);

  const runResult = run([validPath, invalidPath]);
  assert.strictEqual(runResult.success, false);
  assert.strictEqual(runResult.checked, 2);
  assert.strictEqual(runResult.failed.length, 1);

  process.stdout.write("learn-skill-check.test.js PASS\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
