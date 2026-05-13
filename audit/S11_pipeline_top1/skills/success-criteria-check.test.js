const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  ensureStandardSuccessCriteria,
  evaluateSkillSuccessCriteria,
  extractSuccessCriteria,
  run,
} = require("./success-criteria-check");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "success-criteria-check-"));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

try {
  const missingPath = path.join(tempRoot, "skills", "missing", "SKILL.md");
  writeFile(
    missingPath,
    [
      "---",
      "name: missing",
      "version: 1.0.0",
      "requires: []",
      "changelog:",
      "  - 1.0.0: test",
      "---",
      "# Missing",
      "",
      "## Workflow",
      "- Do work.",
      "",
    ].join("\n")
  );

  const missingResult = evaluateSkillSuccessCriteria(missingPath);
  assert.strictEqual(missingResult.success, false);
  assert.deepStrictEqual(missingResult.reasons, ["missing ## Success Criteria section"]);

  const upgraded = ensureStandardSuccessCriteria(fs.readFileSync(missingPath, "utf8"));
  assert.match(upgraded, /## Success Criteria/);
  assert.match(upgraded, /success: false/);

  writeFile(missingPath, upgraded);
  const upgradedResult = evaluateSkillSuccessCriteria(missingPath);
  assert.strictEqual(upgradedResult.success, true);

  const fencedPath = path.join(tempRoot, "skills", "fenced", "SKILL.md");
  writeFile(
    fencedPath,
    [
      "---",
      "name: fenced",
      "version: 1.0.0",
      "requires: []",
      "changelog:",
      "  - 1.0.0: test",
      "---",
      "# Fenced",
      "",
      "```markdown",
      "## Success Criteria",
      "- This is only an example inside a code fence.",
      "```",
      "",
      "## Workflow",
      "- Do work.",
      "",
    ].join("\n")
  );

  const fencedCriteria = extractSuccessCriteria(fs.readFileSync(fencedPath, "utf8"));
  assert.strictEqual(fencedCriteria.exists, false);

  const existingPath = path.join(tempRoot, "skills", "existing", "SKILL.md");
  writeFile(
    existingPath,
    [
      "---",
      "name: existing",
      "version: 1.0.0",
      "requires: []",
      "changelog:",
      "  - 1.0.0: test",
      "---",
      "# Existing",
      "",
      "## Success Criteria",
      "- File `output.md` exists.",
      "- Verification command passes.",
      "",
      "## Workflow",
      "- Do work.",
      "",
    ].join("\n")
  );

  const existingUpdated = ensureStandardSuccessCriteria(fs.readFileSync(existingPath, "utf8"));
  assert.match(existingUpdated, /success: false/);
  assert.match(existingUpdated, /proof\/evidence/);
  assert.match(existingUpdated, /## Workflow/);

  const runResult = run({
    roots: [path.join(tempRoot, "skills")],
    files: [],
    writeStandard: true,
  });
  assert.strictEqual(runResult.success, true);
  assert.strictEqual(runResult.checked, 3);
  assert.strictEqual(runResult.updated, 2);

  process.stdout.write("success-criteria-check.test.js PASS\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
