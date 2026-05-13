const fs = require("fs");
const os = require("os");
const path = require("path");

const REQUIRED_PATTERNS = [
  { label: "frontmatter name architect-first", pattern: /^name:\s*architect-first$/m },
  { label: "v2 version", pattern: /^version:\s*2\.0\.0$/m },
  { label: "architecture contract artifact", pattern: /\.planning\/ARCHITECTURE-<date>-<slug>\.md/ },
  { label: "contract section", pattern: /## Architecture Contract/i },
  { label: "acceptance tests before code", pattern: /acceptance tests before code/i },
  { label: "sprint slices", pattern: /sprint slices/i },
  { label: "docs codemap delta", pattern: /docs\/codemap delta/i },
  { label: "phase 2.5 heading", pattern: /^### Phase 2\.5 - Top-3 Implementation Scan$/m },
  { label: "ctx7 search command", pattern: /MSYS_NO_PATHCONV=1 ctx7 search "<pattern>" \| head -40/ },
  { label: "top three candidates", pattern: /top three candidates/i },
  { label: "ctx7 library fallback", pattern: /MSYS_NO_PATHCONV=1 ctx7 library "<pattern>"/ },
  { label: "hard stop rule", pattern: /Missing Phase 2\.5 top-3 implementation scan/i },
  { label: "acceptance rejection", pattern: /Architecture decision without ctx7 top-3 evidence/i },
];

function normalizeContent(content) {
  return content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function defaultSkillPaths() {
  return [
    path.join(os.homedir(), ".claude", "skills", "architect-first", "SKILL.md"),
    path.join(os.homedir(), ".codex", "skills", "architect-first", "SKILL.md"),
    path.join(os.homedir(), ".gemini", "skills", "architect-first", "SKILL.md"),
  ];
}

function evaluateArchitectFirstSkill(skillPath) {
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
  const results = targetPaths.map((skillPath) => evaluateArchitectFirstSkill(path.resolve(skillPath)));
  const failed = results.filter((result) => !result.success);
  return {
    success: failed.length === 0,
    checked: results.length,
    failed,
  };
}

function formatText(result) {
  if (result.success) {
    return [`OK: architect-first skill`, `checked: ${result.checked}`].join("\n");
  }

  const failures = result.failed
    .map((failure) => `${failure.path}: ${failure.missing.join("; ")}`)
    .join("\n");
  return ["FAIL: architect-first skill", `checked: ${result.checked}`, "success: false", failures].join("\n");
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
  evaluateArchitectFirstSkill,
  run,
};
