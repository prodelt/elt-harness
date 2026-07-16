const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { evaluateInitProjectSkill, run } = require("./init-project-skill-check");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "init-project-skill-check-"));

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
      "name: init-project",
      "version: 1.0.0",
      "---",
      "# /init-project",
      "## Success Criteria",
      "- Return success.",
      "## Workflow",
      "Create CLAUDE.md when docs are missing.",
      "Use the current folder as the project root.",
      "",
    ].join("\n")
  );

  const invalidResult = evaluateInitProjectSkill(invalidPath);
  assert.strictEqual(invalidResult.success, false);
  assert.ok(invalidResult.missing.includes("real project root detection"));
  assert.ok(invalidResult.missing.includes("create upgrade noop modes"));
  assert.ok(invalidResult.missing.includes("pipeline block"));

  const validPath = path.join(tempRoot, "valid", "SKILL.md");
  const fixturePath = path.join(__dirname, "init-project", "SKILL.md");
  writeFile(validPath, fs.readFileSync(fixturePath, "utf8"));

  const validResult = evaluateInitProjectSkill(validPath);
  assert.deepStrictEqual(validResult.missing, []);
  assert.strictEqual(validResult.success, true);

  const runResult = run([validPath, invalidPath]);
  assert.strictEqual(runResult.success, false);
  assert.strictEqual(runResult.checked, 2);
  assert.strictEqual(runResult.failed.length, 1);

  process.stdout.write("init-project-skill-check.test.js PASS\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
