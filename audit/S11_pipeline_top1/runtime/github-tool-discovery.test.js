const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  evaluateCandidate,
  evaluateCandidates,
} = require("./github-tool-discovery");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "github-tool-discovery-"));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

try {
  const quarantineRoot = path.join(tempRoot, ".tmp", "skill-quarantine");
  const safeSkillDir = path.join(quarantineRoot, "opencli", "specs", "opencli-spec");
  writeFile(
    path.join(safeSkillDir, "SKILL.md"),
    [
      "---",
      "name: opencli-spec",
      "description: Safe OpenCLI descriptor workflow.",
      "version: 1.0.0",
      "requires: []",
      "changelog:",
      "  - 1.0.0 (2026-04-24): initial release",
      "---",
      "# OpenCLI Spec",
      "",
      "## Success Criteria",
      "",
      "Return `success: true` only when all applicable predicates below are true:",
      "- Requested workflow outcome is produced in the expected file, branch, PR, report, or deployed resource.",
      "- Required verification command(s) complete successfully and the final response includes their exact command names plus pass/fail evidence.",
      "- Any required user approval, dependency gate, or handoff checkpoint is explicitly satisfied.",
      "- Final response reports `success`, `criteria_checked`, `proof`, and `remaining_work`.",
      "- If any predicate cannot be verified, return `success: false` with `remaining_work` and the blocking reason.",
      "",
    ].join("\n")
  );

  const batch = evaluateCandidates([
    {
      candidate: "OpenCLI",
      kind: "spec",
      scopeHint: "project",
      query: "opencli descriptor spec",
      repo: {
        fullName: "opencli/opencli",
        stars: 2400,
        forks: 180,
        archived: false,
        license: "Apache-2.0",
        pushedAt: "2026-04-20T08:00:00Z",
      },
      releases: {
        publishedAt: "2026-04-18T08:00:00Z",
      },
      support: {
        windows: "documented",
        wsl: "not-required",
      },
      security: {
        requiresSecrets: false,
        rollback: "manifest",
        autoPromoteRequested: true,
      },
      overlap: {
        level: "adjacent",
        reason: "descriptor format complements existing CLI routing docs",
      },
      tokenCost: {
        estimatedReadTokens: 320,
      },
      registry: {
        source: "skills.sh",
        owner: "vercel-labs",
        snapshotText: [
          "# vercel-labs",
          "33 sources 216 skills 2.5M total installs",
          "skills 4 skills : search-skills, typescript-docs, cli-audit +1 more 1.2M",
        ].join("\n"),
      },
      quarantine: {
        skillDir: safeSkillDir,
        quarantineRoot,
      },
    },
    {
      candidate: "browser-harness",
      kind: "browser-automation",
      scopeHint: "on-demand",
      query: "browser harness github",
      repo: {
        fullName: "browser-use/browser-harness",
        stars: 950,
        forks: 67,
        archived: false,
        license: "MIT",
        pushedAt: "2026-04-12T08:00:00Z",
      },
      releases: {
        publishedAt: "2026-03-30T08:00:00Z",
      },
      support: {
        windows: "unknown",
        wsl: "documented",
      },
      security: {
        requiresSecrets: false,
        rollback: "workspace-only",
      },
      overlap: {
        level: "medium",
        reason: "overlaps with Playwright for deterministic browser tasks",
      },
      tokenCost: {
        estimatedReadTokens: 1180,
      },
    },
    {
      candidate: "hermes-agent",
      kind: "agent-framework",
      scopeHint: "research",
      query: "hermes agent github",
      repo: {
        fullName: "NousResearch/hermes-agent",
        stars: 410,
        forks: 54,
        archived: false,
        license: "MIT",
        pushedAt: "2025-11-01T08:00:00Z",
      },
      releases: {
        publishedAt: null,
      },
      support: {
        windows: "unsupported",
        wsl: "required",
      },
      security: {
        requiresSecrets: false,
        rollback: "none",
      },
      overlap: {
        level: "high",
        reason: "overlaps with current orchestrator, memory, and agent routing work",
      },
      tokenCost: {
        estimatedReadTokens: 2100,
      },
    },
    {
      candidate: "LightRAG",
      kind: "knowledge-store",
      scopeHint: "project",
      query: "lightrag github",
      repo: {
        fullName: "HKUDS/LightRAG",
        stars: 17600,
        forks: 1650,
        archived: false,
        license: "MIT",
        pushedAt: "2026-04-21T08:00:00Z",
      },
      releases: {
        publishedAt: "2026-04-17T08:00:00Z",
      },
      support: {
        windows: "documented",
        wsl: "supported",
      },
      security: {
        requiresSecrets: false,
        rollback: "workspace-only",
      },
      overlap: {
        level: "adjacent",
        reason: "fills project knowledge gap next to Graphify",
      },
      tokenCost: {
        estimatedReadTokens: 980,
      },
    },
  ]);

  assert.strictEqual(batch.success, true);
  assert.strictEqual(batch.results.length, 4);

  const byName = Object.fromEntries(batch.results.map((item) => [item.candidate, item]));
  assert.strictEqual(byName.OpenCLI.verdict, "adopt-spec");
  assert.strictEqual(byName.OpenCLI.scope, "project");
  assert.strictEqual(byName.OpenCLI.autoPromote, false);
  assert.ok(byName.OpenCLI.criteria.some((criterion) => criterion.id === "registry-overlap"));
  assert.ok(byName.OpenCLI.criteria.some((criterion) => criterion.id === "quarantine-scan"));

  assert.strictEqual(byName["browser-harness"].verdict, "quarantine-readonly-spike");
  assert.strictEqual(byName["browser-harness"].scope, "on-demand");
  assert.ok(byName["browser-harness"].criteria.some((criterion) => criterion.id === "windows-support"));

  assert.strictEqual(byName["hermes-agent"].verdict, "research-only");
  assert.ok(byName["hermes-agent"].blockingReasons.some((reason) => reason.includes("Windows")));

  assert.strictEqual(byName.LightRAG.verdict, "quarantine-readonly-spike");
  assert.strictEqual(byName.LightRAG.scope, "project");
  assert.ok(byName.LightRAG.criteria.some((criterion) => criterion.id === "adoption"));

  const rejected = evaluateCandidate({
    candidate: "mystery-tool",
    kind: "runtime",
    scopeHint: "on-demand",
    repo: {
      fullName: "unknown/mystery-tool",
      stars: 4,
      forks: 0,
      archived: true,
      license: "",
      pushedAt: "2024-01-01T00:00:00Z",
    },
    support: {
      windows: "unsupported",
      wsl: "unknown",
    },
    security: {
      requiresSecrets: true,
      rollback: "none",
    },
    overlap: {
      level: "high",
      reason: "duplicates existing capability",
    },
    tokenCost: {
      estimatedReadTokens: 2600,
    },
  });
  assert.strictEqual(rejected.verdict, "reject");
  assert.strictEqual(rejected.autoPromote, false);
  assert.ok(rejected.blockingReasons.length >= 3);

  process.stdout.write("github-tool-discovery.test.js PASS\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
