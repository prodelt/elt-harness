const fs = require("fs");
const os = require("os");
const path = require("path");

const IMPLIED_SKILL_PHASES = {
  "architect-first": ["architected", "implementing", "reviewed", "shipped"],
  sprint: ["implementing", "reviewed", "shipped"],
  "inline-review": ["reviewed", "shipped"],
  ship: ["shipped"],
};

function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  return match ? match[1] : "";
}

function parseRequires(content) {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    return [];
  }

  const lines = frontmatter.split("\n");
  const requiresLineIndex = lines.findIndex((line) => line.startsWith("requires:"));
  if (requiresLineIndex === -1) {
    return [];
  }

  const line = lines[requiresLineIndex].trim();
  const inlineMatch = line.match(/^requires:\s*\[(.*)\]\s*$/);
  if (inlineMatch) {
    return inlineMatch[1]
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  const values = [];
  for (let index = requiresLineIndex + 1; index < lines.length; index += 1) {
    const currentLine = lines[index];
    if (!currentLine.startsWith("  - ")) {
      break;
    }
    values.push(currentLine.replace(/^  - /, "").trim());
  }

  return values;
}

function loadState(statePath) {
  if (!statePath || !fs.existsSync(statePath)) {
    return null;
  }

  const raw = fs.readFileSync(statePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function extractSatisfiedDependencies(state) {
  const phases = new Set();
  const skills = new Set();

  if (!state) {
    return { phases, skills };
  }

  if (typeof state.phase === "string" && state.phase) {
    phases.add(state.phase);
  }

  if (Array.isArray(state.completedSkills)) {
    for (const skill of state.completedSkills) {
      if (skill) {
        skills.add(skill);
      }
    }
  }

  if (Array.isArray(state.checkpoints)) {
    for (const checkpoint of state.checkpoints) {
      if (checkpoint && typeof checkpoint.phase === "string" && checkpoint.phase) {
        phases.add(checkpoint.phase);
      }
      if (checkpoint && typeof checkpoint.skill === "string" && checkpoint.skill) {
        skills.add(checkpoint.skill);
      }
    }
  }

  for (const [skillName, requiredPhases] of Object.entries(IMPLIED_SKILL_PHASES)) {
    if (requiredPhases.some((phase) => phases.has(phase))) {
      skills.add(skillName);
    }
  }

  return { phases, skills };
}

function resolveSkillPath(skillArg) {
  if (!skillArg) {
    throw new Error("Missing skill name or path.");
  }

  if (skillArg.includes("\\") || skillArg.includes("/") || skillArg.endsWith(".md")) {
    return path.resolve(skillArg);
  }

  return path.join(os.homedir(), ".claude", "skills", skillArg, "SKILL.md");
}

function evaluateSkillDependencies({ skillPath, statePath }) {
  const content = fs.readFileSync(skillPath, "utf8").replace(/\r\n/g, "\n");
  const requires = parseRequires(content);
  const state = loadState(statePath);
  const satisfied = extractSatisfiedDependencies(state);
  const missing = requires.filter((skill) => !satisfied.skills.has(skill));
  const skillName = path.basename(path.dirname(skillPath));

  return {
    skillName,
    requires,
    missing,
    advisory:
      missing.length > 0
        ? `Prerequisite missing for ${skillName}: ${missing.join(", ")}. Run /${missing[0]} or /pipeline first.`
        : "",
    statePhase: state && typeof state.phase === "string" ? state.phase : null,
    satisfiedSkills: Array.from(satisfied.skills).sort(),
  };
}

function formatResult(result) {
  if (result.missing.length === 0) {
    return [
      `OK: ${result.skillName}`,
      `requires: ${result.requires.join(", ") || "(none)"}`,
      `state phase: ${result.statePhase || "(none)"}`,
    ].join("\n");
  }

  return [
    `ADVISORY: ${result.skillName}`,
    `requires: ${result.requires.join(", ")}`,
    `missing: ${result.missing.join(", ")}`,
    `state phase: ${result.statePhase || "(none)"}`,
    result.advisory,
  ].join("\n");
}

if (require.main === module) {
  const skillArg = process.argv[2];
  const stateArg = process.argv[3] || path.join(os.homedir(), ".claude", "pipeline-state.json");
  const skillPath = resolveSkillPath(skillArg);
  const result = evaluateSkillDependencies({ skillPath, statePath: stateArg });
  process.stdout.write(`${formatResult(result)}\n`);
}

module.exports = {
  evaluateSkillDependencies,
  extractSatisfiedDependencies,
  formatResult,
  parseRequires,
  resolveSkillPath,
};
