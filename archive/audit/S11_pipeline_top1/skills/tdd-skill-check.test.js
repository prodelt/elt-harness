const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { evaluateTddSkill, run } = require("./tdd-skill-check");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-skill-check-"));

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
      "name: tdd",
      "version: 1.0.0",
      "---",
      "# TDD",
      "## Success Criteria",
      "- Return success.",
      "## Workflow",
      "Write a failing test first.",
      "Use `.toBeDefined()` to prove the function returns something.",
      "",
    ].join("\n")
  );

  const invalidResult = evaluateTddSkill(invalidPath);
  assert.strictEqual(invalidResult.success, false);
  assert.ok(invalidResult.missing.includes("bad vs good examples"));
  assert.ok(invalidResult.missing.includes("concrete business assertion"));
  assert.ok(invalidResult.missing.includes("ban return-type-only assertions"));

  const validPath = path.join(tempRoot, "valid", "SKILL.md");
  const fixturePath = path.join(__dirname, "tdd", "SKILL.md");
  writeFile(validPath, fs.readFileSync(fixturePath, "utf8"));

  const validResult = evaluateTddSkill(validPath);
  assert.deepStrictEqual(validResult.missing, []);
  assert.strictEqual(validResult.success, true);

  const runResult = run([validPath, invalidPath]);
  assert.strictEqual(runResult.success, false);
  assert.strictEqual(runResult.checked, 2);
  assert.strictEqual(runResult.failed.length, 1);

  process.stdout.write("tdd-skill-check.test.js PASS\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
