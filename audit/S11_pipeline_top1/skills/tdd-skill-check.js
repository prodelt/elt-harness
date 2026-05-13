const fs = require("fs");
const os = require("os");
const path = require("path");

const REQUIRED_PATTERNS = [
  { label: "frontmatter name tdd", pattern: /^name:\s*tdd$/m },
  { label: "semver version", pattern: /^version:\s*\d+\.\d+\.\d+$/m },
  { label: "success criteria", pattern: /^## Success Criteria$/m },
  { label: "red green refactor", pattern: /Red[\s-]*Green[\s-]*Refactor/i },
  { label: "bad vs good examples", pattern: /bad vs good/i },
  { label: "toBeDefined bad example", pattern: /\.toBeDefined\(\)/ },
  { label: "concrete toBe example", pattern: /\.toBe\(<concrete>\)/ },
  { label: "concrete business assertion", pattern: /concrete business assertion/i },
  { label: "ban return-type-only assertions", pattern: /return-type-only assertions/i },
  { label: "business predicate checklist", pattern: /Business Predicate Checklist/i },
  { label: "expected values before implementation", pattern: /expected values before implementation/i },
  { label: "success false on shallow tests", pattern: /success:\s*false[\s\S]*return-type-only/i },
];

function normalizeContent(content) {
  return content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function defaultSkillPaths() {
  return [
    path.join(os.homedir(), ".claude", "skills", "tdd", "SKILL.md"),
    path.join(os.homedir(), ".codex", "skills", "tdd", "SKILL.md"),
    path.join(os.homedir(), ".gemini", "skills", "tdd", "SKILL.md"),
  ];
}

function evaluateTddSkill(skillPath) {
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
  const results = targetPaths.map((skillPath) => evaluateTddSkill(path.resolve(skillPath)));
  const failed = results.filter((result) => !result.success);
  return {
    success: failed.length === 0,
    checked: results.length,
    failed,
  };
}

function formatText(result) {
  if (result.success) {
    return [`OK: tdd skill`, `checked: ${result.checked}`].join("\n");
  }

  const failures = result.failed
    .map((failure) => `${failure.path}: ${failure.missing.join("; ")}`)
    .join("\n");
  return ["FAIL: tdd skill", `checked: ${result.checked}`, "success: false", failures].join("\n");
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
  evaluateTddSkill,
  run,
};
