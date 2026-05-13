const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  collectTopErrors,
  collectTopHooks,
  createWeeklyReport,
  getWeekLabel,
  runWeeklyAnalysis,
} = require("./weekly-analysis");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "weekly-analysis-"));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

try {
  const hooksDir = path.join(tempRoot, "hooks");
  const outDir = path.join(tempRoot, "out");
  writeFile(
    path.join(hooksDir, "metrics.json"),
    JSON.stringify(
      {
        _updated: "2026-04-23T12:00:00.000Z",
        hooks: {
          "secret-scanner": { fired: 12, warned: 4, blocked: 3, error: 1 },
          "context7-tracker": { fired: 40 },
          "quality-gate-runner": { fired: 15, warned: 1 },
          "memory-discipline": { fired: 6, warned: 2, blocked: 1 },
          "project-docs-gate": { fired: 3 },
          "loop-guardian": { fired: 4, warned: 1, blocked: 1 },
        },
      },
      null,
      2
    )
  );
  writeFile(
    path.join(hooksDir, "errors.log"),
    [
      "2026-04-22T10:00:00.000Z [WARN] [secret-scanner] SECRET BLOCK: Bearer Token {\"cmd\":\"curl ...\"}",
      "2026-04-22T11:00:00.000Z [WARN] [secret-scanner] SECRET BLOCK: Bearer Token {\"cmd\":\"curl ...\"}",
      "2026-04-22T12:00:00.000Z [WARN] [config-protection] BLOCK edit of .eslintrc",
      "2026-04-20T09:00:00.000Z [ERROR] [context7-tracker] cache write failed {\"code\":\"EACCES\"}",
      "2026-04-10T09:00:00.000Z [WARN] [old-hook] stale warning outside window",
      "",
    ].join("\n")
  );

  const topHooks = collectTopHooks(path.join(hooksDir, "metrics.json"), 5);
  assert.strictEqual(topHooks.length, 5);
  assert.strictEqual(topHooks[0].name, "secret-scanner");
  assert.strictEqual(topHooks[0].score, 47);
  assert.strictEqual(topHooks[1].name, "context7-tracker");

  const topErrors = collectTopErrors(path.join(hooksDir, "errors.log"), {
    now: new Date("2026-04-23T12:00:00.000Z"),
    days: 7,
    limit: 5,
  });
  assert.strictEqual(topErrors.length, 3);
  assert.strictEqual(topErrors[0].hook, "secret-scanner");
  assert.strictEqual(topErrors[0].count, 2);
  assert.ok(topErrors[0].message.includes("SECRET BLOCK"));
  assert.ok(topErrors.every((item) => item.lastSeen.startsWith("2026-04-")));

  const report = createWeeklyReport({
    weekLabel: getWeekLabel(new Date("2026-04-23T12:00:00.000Z")),
    generatedAt: new Date("2026-04-23T12:00:00.000Z").toISOString(),
    days: 7,
    topHooks,
    topErrors,
  });
  assert.ok(report.includes("# Щотижневі pipeline-пропозиції"));
  assert.ok(report.includes("## Top-5 шумних хуків"));
  assert.ok(report.includes("## Ранжовані пропозиції"));
  assert.ok(report.includes("Зменшити шум від `secret-scanner`"));

  const result = runWeeklyAnalysis({
    hooksDir,
    outputDir: outDir,
    now: new Date("2026-04-23T12:00:00.000Z"),
    days: 7,
    limit: 5,
  });
  assert.strictEqual(result.weekLabel, "2026-W17");
  assert.strictEqual(path.basename(result.outputPath), "proposals-2026-W17.md");
  assert.ok(fs.existsSync(result.outputPath));
  assert.ok(result.report.includes("Top-5 повторюваних log-патернів"));

  process.stdout.write("weekly-analysis.test.js PASS\n");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
