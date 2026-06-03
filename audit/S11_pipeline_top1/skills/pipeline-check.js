const fs = require("fs");
const os = require("os");
const path = require("path");

const REQUIRED_PATTERNS = [
  { label: "frontmatter name pipeline", pattern: /^name:\s*pipeline$/m },
  { label: "v3 version", pattern: /^version:\s*3\.2\.0$/m },
  { label: "checklist extraction", pattern: /checklist extraction/i },
  { label: "project guard", pattern: /project guard/i },
  { label: "classification", pattern: /^## Classification$/m },
  { label: "auto mode", pattern: /`auto` mode/i },
  { label: "interview mode", pattern: /`interview` mode/i },
  { label: "one active goal", pattern: /one active goal per session/i },
  { label: "focused question variants", pattern: /2-3 answer variants plus free-form override/i },
  { label: "state refresh", pattern: /required state refresh at classification/i },
  { label: "state lifecycle", pattern: /^## State Lifecycle$/m },
  { label: "closed phase", pattern: /`closed`/i },
  { label: "per-project state", pattern: /~\/\.claude\/projects\/<projectKey>\/pipeline-state\.json/ },
  { label: "goal field", pattern: /"goal": "<single active goal>"/ },
  { label: "doneWhen field", pattern: /"doneWhen": "<completion criteria>"/ },
  { label: "mode field", pattern: /"mode": "auto \| interview"/ },
  { label: "routers field", pattern: /"routers": \{/ },
  { label: "ledger path", pattern: /"ledgerPath": "<project-local session-ledger\.jsonl>"/ },
  { label: "expiresAt", pattern: /"expiresAt": "<ISO>"/ },
  { label: "closedAt", pattern: /"closedAt": null/ },
  { label: "session ledger", pattern: /^## Session Ledger$/m },
  { label: "classification confidence", pattern: /task classification and confidence;/i },
  { label: "rejected alternatives", pattern: /chosen skills and rejected alternatives;/i },
  { label: "model effort", pattern: /model\/effort selection;/i },
  { label: "supply-chain preflight", pattern: /^### Agent Skill Supply-Chain Preflight$/m },
  { label: "supply-chain audit wrapper", pattern: /agent-skills\.cmd audit/ },
  {
    label: "supply-chain central fallback",
    pattern: /node <central>\/tools\/agent-skill-supply-chain\.js audit/,
  },
  {
    label: "supply-chain before sub-skills",
    pattern: /before\s+loading sub-skills or starting implementation/i,
  },
  {
    label: "supply-chain explicit apply only",
    pattern: /Run repair\s+commands only when explicitly applying a rollout/i,
  },
  { label: "supply-chain install repair", pattern: /agent-skills\.cmd install-skills --target all --apply/ },
  { label: "supply-chain rollout repair", pattern: /agent-skills\.cmd rollout-projects --apply/ },
  {
    label: "supply-chain state and ledger",
    pattern: /Record the command and result in both active project state and the session\s+ledger/i,
  },
  {
    label: "supply-chain drift closeout block",
    pattern: /drift[\s\S]+blocks honest success closeout unless the drift is\s+repaired/i,
  },
  {
    label: "supply-chain documented bypass",
    pattern: /final closeout documents an explicit bypass reason/i,
  },
  { label: "final closeout", pattern: /^## Final Closeout$/m },
  { label: "success proof rule", pattern: /cannot claim success without artifact and verification proof/i },
  { label: "minimal route", pattern: /minimal route/i },
  {
    label: "skill budget",
    pattern: /no more than one orchestrator \+ one domain \+ one verifier/i,
  },
  { label: "simple bypass", pattern: /trivial work stays cheap/i },
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
