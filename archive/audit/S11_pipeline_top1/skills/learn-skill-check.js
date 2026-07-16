const fs = require("fs");
const os = require("os");
const path = require("path");

const REQUIRED_PATTERNS = [
  { label: "frontmatter name learn", pattern: /^name:\s*learn$/m },
  { label: "semver version", pattern: /^version:\s*\d+\.\d+\.\d+$/m },
  { label: "success criteria", pattern: /^## Success Criteria$/m },
  { label: "3+ repeat threshold", pattern: /at least 3 times|3\+ repeats/i },
  { label: "extract phase", pattern: /^### 1\. Extract$/m },
  { label: "propose diff phase", pattern: /^### 2\. Propose Diff$/m },
  { label: "ask user phase", pattern: /^### 3\. Ask User$/m },
  { label: "apply phase", pattern: /^### 4\. Apply$/m },
  { label: "PR-style proposal", pattern: /PR-style proposal/i },
  { label: "fenced diff example", pattern: /```diff[\s\S]*```/m },
  { label: "SKILL.md target", pattern: /SKILL\.md/ },
  { label: "approval before apply", pattern: /explicit approval before applying/i },
  { label: "success false on missing approval", pattern: /success:\s*false[\s\S]*remaining_work/i },
  { label: "preserve frontmatter", pattern: /Preserve frontmatter fields/i },
  { label: "version bump", pattern: /Bump patch or minor version/i },
];

function normalizeContent(content) {
  return content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function defaultSkillPaths() {
  return [
    path.join(os.homedir(), ".claude", "skills", "learn", "SKILL.md"),
    path.join(os.homedir(), ".codex", "skills", "learn", "SKILL.md"),
    path.join(os.homedir(), ".gemini", "skills", "learn", "SKILL.md"),
  ];
}

function evaluateLearnSkill(skillPath) {
  if (!fs.existsSync(skillPath)) {
    return {
      path: skillPath,
      success: false,
      missing: ["file missing"],
    };
  }

  const content = normalizeContent(fs.readFileSync(skillPath, "utf8"));
  const missing = REQUIRED_PATTERNS
    .filter((requirement) => !requirement.pattern.test(content))
    .map((requirement) => requirement.label);

  return {
    path: skillPath,
    success: missing.length === 0,
    missing,
  };
}

function run(paths) {
  const targetPaths = paths.length > 0 ? paths : defaultSkillPaths();
  const results = targetPaths.map((skillPath) => evaluateLearnSkill(path.resolve(skillPath)));
  const failed = results.filter((result) => !result.success);
  return {
    success: failed.length === 0,
    checked: results.length,
    failed,
  };
}

function formatText(result) {
  if (result.success) {
    return [`OK: learn skill`, `checked: ${result.checked}`].join("\n");
  }

  const failures = result.failed
    .map((failure) => `${failure.path}: ${failure.missing.join("; ")}`)
    .join("\n");
  return ["FAIL: learn skill", `checked: ${result.checked}`, "success: false", failures].join("\n");
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const paths = args.filter((arg) => arg !== "--json");
  const result = run(paths);
  process.stdout.write(`${json ? JSON.stringify(result, null, 2) : formatText(result)}\n`);
  process.exitCode = result.success ? 0 : 1;
}

module.exports = {
  evaluateLearnSkill,
  run,
};
