const fs = require("fs");
const os = require("os");
const path = require("path");

const REQUIRED_PATTERNS = [
  { label: "frontmatter name init-project", pattern: /^name:\s*init-project$/m },
  { label: "semver version", pattern: /^version:\s*\d+\.\d+\.\d+$/m },
  { label: "success criteria", pattern: /^## Success Criteria$/m },
  { label: "real project root detection", pattern: /real project root/i },
  { label: "project markers", pattern: /\.git[\s\S]*package\.json[\s\S]*pyproject\.toml[\s\S]*go\.mod[\s\S]*Cargo\.toml/i },
  { label: "parent root mismatch", pattern: /parent folder[\s\S]*success:\s*false/i },
  { label: "create upgrade noop modes", pattern: /`create`[\s\S]*`upgrade`[\s\S]*`noop`/i },
  { label: "preserve stack architecture gotchas", pattern: /preserve[\s\S]*Stack[\s\S]*Architecture[\s\S]*Gotchas/i },
  { label: "pipeline block", pattern: /\/pipeline[\s\S]*Context7[\s\S]*TDD[\s\S]*\/inline-review[\s\S]*\/ship[\s\S]*checkpoint/i },
  { label: "sync all 3 docs", pattern: /CLAUDE\.md[\s\S]*AGENTS\.md[\s\S]*\.gemini\/GEMINI\.md/i },
  { label: "settings json warning", pattern: /\.claude\/settings\.json/i },
  { label: "settings local broad permissions warning", pattern: /\.claude\/settings\.local\.json[\s\S]*warning/i },
  { label: "safe.directory warning", pattern: /safe\.directory/i },
  { label: "proof field", pattern: /`proof`/i },
];

function normalizeContent(content) {
  return content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function defaultSkillPaths() {
  return [
    path.join(__dirname, "init-project", "SKILL.md"),
    path.join(os.homedir(), ".claude", "skills", "init-project", "SKILL.md"),
    path.join(os.homedir(), ".codex", "skills", "init-project", "SKILL.md"),
    path.join(os.homedir(), ".gemini", "skills", "init-project", "SKILL.md"),
  ];
}

function evaluateInitProjectSkill(skillPath) {
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
  const results = targetPaths.map((skillPath) => evaluateInitProjectSkill(path.resolve(skillPath)));
  const failed = results.filter((result) => !result.success);
  return {
    success: failed.length === 0,
    checked: results.length,
    failed,
  };
}

function formatText(result) {
  if (result.success) {
    return ["OK: init-project skill", `checked: ${result.checked}`].join("\n");
  }

  const failures = result.failed
    .map((failure) => `${failure.path}: ${failure.missing.join("; ")}`)
    .join("\n");
  return ["FAIL: init-project skill", `checked: ${result.checked}`, "success: false", failures].join("\n");
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
  evaluateInitProjectSkill,
  run,
};
