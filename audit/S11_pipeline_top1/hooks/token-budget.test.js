const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { runTokenBudget } = require("./token-budget");

function makeDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSession(projectsDir, project, fileName, sizeBytes, isoDate) {
  const targetDir = path.join(projectsDir, project);
  fs.mkdirSync(targetDir, { recursive: true });
  const filePath = path.join(targetDir, fileName);
  fs.writeFileSync(filePath, "x".repeat(sizeBytes), "utf8");
  const stamp = new Date(isoDate);
  fs.utimesSync(filePath, stamp, stamp);
}

function writeBudget(outputDir, dateLabel, rows) {
  const lines = [
    `# Token Budget — ${dateLabel}`,
    "",
    "| project | sessions | avg_kb | trend |",
    "| --- | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.project} | ${row.sessions} | ${row.avg_kb} | ${row.trend} |`),
    "",
  ];
  fs.writeFileSync(path.join(outputDir, `budget-${dateLabel}.md`), lines.join("\n"), "utf8");
}

try {
  const rootDir = makeDir("token-budget-projects-");
  const outputDir = makeDir("token-budget-output-");
  const now = new Date("2026-04-23T12:00:00.000Z");

  writeBudget(outputDir, "2026-04-20", [
    { project: "alpha", sessions: 2, avg_kb: "100.0", trend: "new" },
    { project: "beta", sessions: 1, avg_kb: "300.0", trend: "new" },
    { project: "gamma", sessions: 1, avg_kb: "220.0", trend: "new" },
  ]);
  writeBudget(outputDir, "2026-04-21", [
    { project: "alpha", sessions: 2, avg_kb: "120.0", trend: "↑ +20%" },
    { project: "beta", sessions: 1, avg_kb: "280.0", trend: "↓ -7%" },
    { project: "gamma", sessions: 1, avg_kb: "214.0", trend: "flat" },
  ]);
  writeBudget(outputDir, "2026-04-22", [
    { project: "alpha", sessions: 2, avg_kb: "140.0", trend: "↑ +17%" },
    { project: "beta", sessions: 1, avg_kb: "260.0", trend: "↓ -7%" },
    { project: "gamma", sessions: 1, avg_kb: "212.0", trend: "flat" },
  ]);

  writeSession(rootDir, "alpha", "a1.jsonl", 160 * 1024, "2026-04-23T09:00:00.000Z");
  writeSession(rootDir, "alpha", "a2.jsonl", 160 * 1024, "2026-04-23T10:00:00.000Z");
  writeSession(rootDir, "beta", "b1.jsonl", 240 * 1024, "2026-04-23T08:00:00.000Z");
  writeSession(rootDir, "gamma", "g1.jsonl", 210 * 1024, "2026-04-23T11:00:00.000Z");
  writeSession(rootDir, "delta", "d1.jsonl", 90 * 1024, "2026-04-23T07:00:00.000Z");
  writeSession(rootDir, "ignored", "old.jsonl", 999 * 1024, "2026-04-01T07:00:00.000Z");

  const result = runTokenBudget({
    now,
    dateLabel: "2026-04-23",
    rootDir,
    outputDir,
    days: 7,
    limit: 10,
  });

  assert.ok(fs.existsSync(result.outputPath));
  assert.strictEqual(result.rows.length, 4);

  const byProject = Object.fromEntries(result.rows.map((row) => [row.project, row]));
  assert.strictEqual(byProject.alpha.sessions, 2);
  assert.strictEqual(byProject.alpha.avgKB.toFixed(1), "160.0");
  assert.strictEqual(byProject.alpha.trend, "↑ 3d");

  assert.strictEqual(byProject.beta.trend, "↓ 3d");
  assert.strictEqual(byProject.gamma.trend, "flat");
  assert.strictEqual(byProject.delta.trend, "new");
  assert.ok(!byProject.ignored);

  assert.match(result.report, /\| alpha \| 2 \| 160\.0 \| ↑ 3d \|/);
  assert.match(result.report, /\| beta \| 1 \| 240\.0 \| ↓ 3d \|/);
  assert.match(result.report, /\| gamma \| 1 \| 210\.0 \| flat \|/);
  assert.match(result.report, /\| delta \| 1 \| 90\.0 \| new \|/);

  process.stdout.write("token-budget.test.js PASS\n");
} catch (error) {
  process.stderr.write(`${error.stack}\n`);
  process.exit(1);
}
