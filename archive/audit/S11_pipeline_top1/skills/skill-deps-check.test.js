const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  evaluateSkillDependencies,
  parseRequires,
} = require("./skill-deps-check");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-deps-check-"));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

try {
  const sprintSkillPath = path.join(tempRoot, "skills", "sprint", "SKILL.md");
  writeFile(
    sprintSkillPath,
    [
      "---",
      "name: sprint",
      "requires: [architect-first]",
      "---",
      "# Sprint",
      "",
    ].join("\n")
  );

  assert.deepStrictEqual(parseRequires(fs.readFileSync(sprintSkillPath, "utf8")), [
    "architect-first",
  ]);

  const classifiedStatePath = path.join(tempRoot, "classified-state.json");
  writeFile(
    classifiedStatePath,
    JSON.stringify(
      {
        phase: "classified",
        checkpoints: [{ phase: "classified", skill: "pipeline", ts: "2026-04-22T00:00:00Z" }],
      },
      null,
      2
    )
  );

  const classifiedResult = evaluateSkillDependencies({
    skillPath: sprintSkillPath,
    statePath: classifiedStatePath,
  });
  assert.deepStrictEqual(classifiedResult.missing, ["architect-first"]);
  assert.match(classifiedResult.advisory, /Run \/architect-first or \/pipeline first/);

  const architectedStatePath = path.join(tempRoot, "architected-state.json");
  writeFile(
    architectedStatePath,
    JSON.stringify(
      {
        phase: "architected",
        checkpoints: [{ phase: "architected", ts: "2026-04-22T00:05:00Z" }],
      },
      null,
      2
    )
  );

  const architectedResult = evaluateSkillDependencies({
    skillPath: sprintSkillPath,
    statePath: architectedStatePath,
  });
  assert.deepStrictEqual(architectedResult.missing, []);

  const explicitSkillStatePath = path.join(tempRoot, "explicit-skill-state.json");
  writeFile(
    explicitSkillStatePath,
    JSON.stringify(
      {
        phase: "classified",
        checkpoints: [
          { phase: "classified", skill: "pipeline", ts: "2026-04-22T00:00:00Z" },
          { phase: "architected", skill: "architect-first", ts: "2026-04-22T00:03:00Z" },
        ],
      },
      null,
      2
    )
  );

  const explicitSkillResult = evaluateSkillDependencies({
    skillPath: sprintSkillPath,
    statePath: explicitSkillStatePath,
  });
  assert.deepStrictEqual(explicitSkillResult.missing, []);

  process.stdout.write("skill-deps-check.test.js PASS\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
