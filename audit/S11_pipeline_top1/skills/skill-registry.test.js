const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parseSkillsFindOutput,
  parseSkillsShSnapshot,
  readCacheIndex,
  searchRegistry,
} = require("./skill-registry");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-registry-"));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

try {
  const cliOutput = [
    "Install with npx skills add <owner/repo@skill>",
    "",
    "vercel-labs/agent-skills@frontend-design 1.2K installs",
    "└ https://skills.sh/frontend-design",
    "anthropics/skills@pdf 82.6K installs",
    "└ https://skills.sh/pdf",
  ].join("\n");
  const cliItems = parseSkillsFindOutput(cliOutput, "frontend design");
  assert.strictEqual(cliItems.length, 2);
  assert.strictEqual(cliItems[0].name, "frontend-design");
  assert.strictEqual(cliItems[0].source, "vercel-labs/agent-skills");
  assert.strictEqual(
    cliItems[0].installCommand,
    "npx skills add vercel-labs/agent-skills --skill frontend-design"
  );
  assert.strictEqual(cliItems[0].installCount, 1200);
  assert.strictEqual(cliItems[0].sourceTrust, "high");
  assert.strictEqual(cliItems[0].registryUrl, "https://skills.sh/frontend-design");
  assert.ok(cliItems[0].triggers.includes("frontend"));

  const leaderboardSnapshot = [
    "# Skills",
    "Skills Leaderboard",
    "1 find-skills vercel-labs/skills 1.2M",
    "2 frontend-design anthropics/skills 329.6K",
    "+19 more from microsoft/azure-skills(4.6M total)",
  ].join("\n");
  const leaderboardItems = parseSkillsShSnapshot(leaderboardSnapshot, { query: "find skills" });
  assert.strictEqual(leaderboardItems.length, 2);
  assert.deepStrictEqual(
    leaderboardItems.map((item) => `${item.source}:${item.name}`),
    ["anthropics/skills:frontend-design", "vercel-labs/skills:find-skills"]
  );
  assert.strictEqual(leaderboardItems[1].installCount, 1_200_000);
  assert.strictEqual(
    leaderboardItems[1].registryUrl,
    "https://skills.sh/vercel-labs/skills/find-skills"
  );

  const sourceSnapshot = [
    "# vercel-labs",
    "33 sources 216 skills 2.5M total installs",
    "skills 4 skills : __proto__, search-skills, typescript-docs +1 more 1.2M",
    "agent-skills 14 skills : deploy-to-vercel, vercel-react-view-transitions, vercel-cli-with-tokens +11 more 936.8K",
  ].join("\n");
  const sourceItems = parseSkillsShSnapshot(sourceSnapshot, { query: "vercel", owner: "vercel-labs" });
  assert.ok(sourceItems.some((item) => item.source === "vercel-labs/skills" && item.name === "search-skills"));
  const previewItem = sourceItems.find(
    (item) => item.source === "vercel-labs/agent-skills" && item.name === "deploy-to-vercel"
  );
  assert.ok(previewItem);
  assert.strictEqual(previewItem.installCount, null);
  assert.strictEqual(previewItem.sourceInstallCount, 936800);
  assert.strictEqual(previewItem.snapshotScope, "source-preview");

  const cachePath = path.join(tempRoot, "cache", "index.jsonl");
  let cliRuns = 0;
  const commandRunner = () => {
    cliRuns += 1;
    return cliOutput;
  };

  const firstResult = searchRegistry({
    query: "frontend design",
    source: "skills-cli",
    cachePath,
    now: new Date("2026-04-23T09:00:00Z"),
    commandRunner,
  });
  assert.strictEqual(firstResult.cacheHit, false);
  assert.strictEqual(cliRuns, 1);
  assert.strictEqual(readCacheIndex(cachePath).length, 1);

  const secondResult = searchRegistry({
    query: "frontend design",
    source: "skills-cli",
    cachePath,
    now: new Date("2026-04-23T10:00:00Z"),
    commandRunner,
  });
  assert.strictEqual(secondResult.cacheHit, true);
  assert.strictEqual(cliRuns, 1);
  assert.strictEqual(secondResult.items.length, 2);

  const thirdResult = searchRegistry({
    query: "frontend design",
    source: "skills-cli",
    cachePath,
    now: new Date("2026-04-24T10:00:01Z"),
    commandRunner,
  });
  assert.strictEqual(thirdResult.cacheHit, false);
  assert.strictEqual(cliRuns, 2);
  assert.strictEqual(readCacheIndex(cachePath).length, 2);

  fs.appendFileSync(cachePath, "{bad json}\n", "utf8");
  assert.strictEqual(readCacheIndex(cachePath).length, 2);

  const skillsShSnapshotPath = path.join(tempRoot, "snapshots", "skills-home.txt");
  writeFile(skillsShSnapshotPath, leaderboardSnapshot);
  const snapshotResult = searchRegistry({
    query: "find skills",
    source: "skills.sh",
    cachePath: path.join(tempRoot, "cache", "skills-sh.jsonl"),
    snapshotFile: skillsShSnapshotPath,
    now: new Date("2026-04-23T11:00:00Z"),
  });
  assert.strictEqual(snapshotResult.cacheHit, false);
  assert.strictEqual(snapshotResult.items.length, 2);
  assert.strictEqual(snapshotResult.items[0].sourceTrust, "high");

  process.stdout.write("skill-registry.test.js PASS\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
