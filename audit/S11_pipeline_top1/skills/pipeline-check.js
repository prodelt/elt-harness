const fs = require("fs");
const os = require("os");
const path = require("path");

const REQUIRED_PATTERNS = [
  { label: "frontmatter name pipeline", pattern: /^name:\s*pipeline$/m },
  { label: "v2 version", pattern: /^version:\s*2\.0\.0$/m },
  { label: "checklist extraction", pattern: /checklist extraction/i },
  { label: "project guard", pattern: /project guard/i },
  { label: "minimal route", pattern: /minimal route/i },
  { label: "per-project state", pattern: /~\/\.claude\/projects\/<projectKey>\/pipeline-state\.json/ },
  { label: "final criteria check", pattern: /final criteria check/i },
  {
    label: "skill budget",
    pattern: /no more than one orchestrator \+ one domain \+ one verifier/i,
  },
  { label: "simple bypass", pattern: /simple tasks bypass heavy workflow/i },
];

function normalizeContent(content) {
  return content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function defaultSkillPaths() {
  return [
    path.join(os.homedir(), ".claude", "skills", "pipeline", "SKILL.md"),
    path.join(os.homedir(), ".codex", "skills", "pipeline", "SKILL.md"),
    path.join(os.homedir(), ".gemini", "skills", "pipeline", "SKILL.md"),
  ];
}

function evaluatePipelineSkill(skillPath) {
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
  const results = targetPaths.map((skillPath) => evaluatePipelineSkill(path.resolve(skillPath)));
  const failed = results.filter((result) => !result.success);
  return {
    success: failed.length === 0,
    checked: results.length,
    failed,
  };
}

function formatText(result) {
  if (result.success) {
    return [`OK: pipeline skill`, `checked: ${result.checked}`].join("\n");
  }

  const failures = result.failed
    .map((failure) => `${failure.path}: ${failure.missing.join("; ")}`)
    .join("\n");
  return ["FAIL: pipeline skill", `checked: ${result.checked}`, "success: false", failures].join("\n");
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
  evaluatePipelineSkill,
  run,
};
