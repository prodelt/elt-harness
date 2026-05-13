const fs = require("fs");
const os = require("os");
const path = require("path");

const STANDARD_SECTION = [
  "## Success Criteria",
  "",
  "Return `success: true` only when all applicable predicates below are true:",
  "- Requested workflow outcome is produced in the expected file, branch, PR, report, or deployed resource.",
  "- Required verification command(s) complete successfully and the final response includes their exact command names plus pass/fail evidence.",
  "- Any required user approval, dependency gate, or handoff checkpoint is explicitly satisfied.",
  "- Final response reports `success`, `criteria_checked`, `proof`, and `remaining_work`.",
  "- If any predicate cannot be verified, return `success: false` with `remaining_work` and the blocking reason.",
].join("\n");

const SUCCESS_FALSE_PROTOCOL =
  "- If any predicate cannot be verified, return `success: false` with `remaining_work` and the blocking reason.";
const PROOF_PROTOCOL =
  "- Final response includes proof/evidence for each checked predicate, including exact command names when commands are used.";

function normalizeNewlines(content) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function isFenceLine(line) {
  return line.trim().startsWith("```");
}

function findRealHeading(lines, heading, startIndex = 0) {
  return lines.reduce(
    (state, line, index) => {
      if (index < startIndex || state.matchIndex !== -1) {
        return state;
      }

      const nextInFence = isFenceLine(line) ? !state.inFence : state.inFence;
      return {
        inFence: nextInFence,
        matchIndex: !state.inFence && line.trim() === heading ? index : -1,
      };
    },
    { inFence: false, matchIndex: -1 }
  ).matchIndex;
}

function findNextRealLevelTwoHeading(lines, startIndex) {
  return lines.reduce(
    (state, line, index) => {
      if (index <= startIndex || state.matchIndex !== -1) {
        return state;
      }

      const nextInFence = isFenceLine(line) ? !state.inFence : state.inFence;
      const isHeading = !state.inFence && line.startsWith("## ") && line.trim() !== "## Success Criteria";
      return {
        inFence: nextInFence,
        matchIndex: isHeading ? index : -1,
      };
    },
    { inFence: false, matchIndex: -1 }
  ).matchIndex;
}

function extractSuccessCriteria(content) {
  const normalized = normalizeNewlines(content).replace(/^\uFEFF/, "");
  const lines = normalized.split("\n");
  const startIndex = findRealHeading(lines, "## Success Criteria");
  if (startIndex === -1) {
    return { exists: false, section: "", startIndex: -1, endIndex: -1 };
  }

  const nextHeadingIndex = findNextRealLevelTwoHeading(lines, startIndex);
  const endIndex = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;
  return {
    exists: true,
    section: lines.slice(startIndex, endIndex).join("\n").trim(),
    startIndex,
    endIndex,
  };
}

function extractPredicates(section) {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .filter((line) => /`.+`|must|exists|complete|pass|created|updated|verified|cannot/i.test(line));
}

function evaluateSkillSuccessCriteria(skillPath) {
  const content = fs.readFileSync(skillPath, "utf8");
  const criteria = extractSuccessCriteria(content);
  const predicates = criteria.exists ? extractPredicates(criteria.section) : [];
  const reasons = [
    !criteria.exists ? "missing ## Success Criteria section" : "",
    criteria.exists && predicates.length < 2 ? "fewer than 2 verifiable predicates" : "",
    criteria.exists && !/success:\s*false/i.test(criteria.section)
      ? "missing explicit success: false failure path"
      : "",
    criteria.exists && !/proof|evidence/i.test(criteria.section)
      ? "missing proof/evidence requirement"
      : "",
  ].filter(Boolean);

  return {
    path: skillPath,
    success: reasons.length === 0,
    predicates: predicates.length,
    reasons,
  };
}

function listSkillFiles(rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  if (!fs.existsSync(resolvedRoot)) {
    return [];
  }

  const entries = fs.readdirSync(resolvedRoot, { withFileTypes: true });
  return entries
    .flatMap((entry) => {
      const entryPath = path.join(resolvedRoot, entry.name);
      if (entry.isDirectory()) {
        return listSkillFiles(entryPath);
      }
      return entry.isFile() && entry.name === "SKILL.md" ? [entryPath] : [];
    })
    .sort();
}

function defaultRoots() {
  return [
    path.join(os.homedir(), ".claude", "skills"),
    path.join(os.homedir(), ".codex", "skills"),
    path.join(os.homedir(), ".gemini", "skills"),
  ];
}

function parseCliArgs(argv) {
  const hasJson = argv.includes("--json");
  const hasWriteStandard = argv.includes("--write-standard");
  const rootsIndex = argv.indexOf("--roots");
  const roots =
    rootsIndex === -1
      ? []
      : argv.slice(rootsIndex + 1).filter((value) => !value.startsWith("--"));
  const fileArgs = argv.filter(
    (value, index) =>
      !value.startsWith("--") &&
      (rootsIndex === -1 || index <= rootsIndex || argv[index - 1] === "--file")
  );

  return {
    json: hasJson,
    writeStandard: hasWriteStandard,
    roots: roots.length > 0 ? roots : defaultRoots(),
    files: fileArgs.filter((value) => value.endsWith("SKILL.md")),
  };
}

function ensureStandardSuccessCriteria(content) {
  const normalized = normalizeNewlines(content).replace(/^\uFEFF/, "");
  const lines = normalized.split("\n");
  const criteria = extractSuccessCriteria(normalized);

  if (!criteria.exists) {
    const insertIndex = findNextRealLevelTwoHeading(lines, 0);
    if (insertIndex === -1) {
      return `${normalized.trimEnd()}\n\n${STANDARD_SECTION}\n`;
    }

    return [
      ...lines.slice(0, insertIndex),
      "",
      ...STANDARD_SECTION.split("\n"),
      "",
      ...lines.slice(insertIndex),
    ].join("\n");
  }

  const missingProtocolLines = [
    /proof|evidence/i.test(criteria.section) ? "" : PROOF_PROTOCOL,
    /success:\s*false/i.test(criteria.section) ? "" : SUCCESS_FALSE_PROTOCOL,
  ].filter(Boolean);

  if (missingProtocolLines.length === 0) {
    return normalized;
  }

  return [
    ...lines.slice(0, criteria.endIndex),
    ...missingProtocolLines,
    "",
    ...lines.slice(criteria.endIndex),
  ].join("\n");
}

function writeUpdatedSkill(skillPath) {
  const before = fs.readFileSync(skillPath, "utf8");
  const after = ensureStandardSuccessCriteria(before);
  if (before.replace(/\r\n/g, "\n") === after) {
    return false;
  }

  fs.writeFileSync(skillPath, after.replace(/\n/g, "\r\n"), "utf8");
  return true;
}

function collectSkillFiles({ roots, files }) {
  const explicitFiles = files.map((filePath) => path.resolve(filePath));
  const rootFiles = roots.flatMap((rootPath) => listSkillFiles(rootPath));
  return Array.from(new Set([...explicitFiles, ...rootFiles])).sort();
}

function run(options) {
  const skillFiles = collectSkillFiles(options);
  const writeResults = options.writeStandard
    ? skillFiles.map((skillPath) => ({ path: skillPath, updated: writeUpdatedSkill(skillPath) }))
    : [];
  const results = skillFiles.map(evaluateSkillSuccessCriteria);
  const failed = results.filter((result) => !result.success);

  return {
    success: failed.length === 0,
    checked: results.length,
    updated: writeResults.filter((result) => result.updated).length,
    failed,
  };
}

function formatText(result) {
  if (result.success) {
    return [
      "OK: success criteria",
      `checked: ${result.checked}`,
      `updated: ${result.updated}`,
    ].join("\n");
  }

  const failures = result.failed
    .map((failure) => `${failure.path}: ${failure.reasons.join("; ")}`)
    .join("\n");
  return [
    "FAIL: success criteria",
    `checked: ${result.checked}`,
    `updated: ${result.updated}`,
    "success: false",
    failures,
  ].join("\n");
}

if (require.main === module) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result = run(options);
    const output = options.json ? JSON.stringify(result, null, 2) : formatText(result);
    process.stdout.write(`${output}\n`);
    process.exitCode = result.success ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  STANDARD_SECTION,
  ensureStandardSuccessCriteria,
  evaluateSkillSuccessCriteria,
  extractSuccessCriteria,
  PROOF_PROTOCOL,
  run,
};
