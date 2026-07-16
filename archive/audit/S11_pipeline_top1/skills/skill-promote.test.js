/**
 * Integration tests for skill-promote.ps1 and skill-rollback.ps1.
 * Runs PowerShell scripts against temp directories — no production roots touched.
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPTS = path.dirname(__filename);
const PROMOTE = path.join(SCRIPTS, "skill-promote.ps1");
const ROLLBACK = path.join(SCRIPTS, "skill-rollback.ps1");

const DUMMY_SKILL_MD = `---
name: dummy-skill
description: Dummy skill for promote/rollback tests.
version: 1.0.0
requires: []
changelog:
  - 1.0.0 (2026-04-26): initial
---

# Dummy Skill
`;

function runPS(scriptPath, args) {
  const cmd = [
    `& '${scriptPath.replace(/'/g, "''")}'`,
    ...args,
  ].join(" ");
  return spawnSync(
    "powershell.exe",
    ["-ExecutionPolicy", "Bypass", "-Command", cmd],
    { encoding: "utf8", timeout: 15000 }
  );
}

function mkTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(root, name, content = DUMMY_SKILL_MD) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), content, "utf8");
  return dir;
}

function psEscPath(p) {
  return `'${p.replace(/'/g, "''")}'`;
}

let staging, prod1, prod2, auditLog, tmp;

function setup() {
  tmp = mkTempDir("skill-test-");
  staging = path.join(tmp, "staging");
  prod1 = path.join(tmp, "prod1");
  prod2 = path.join(tmp, "prod2");
  auditLog = path.join(tmp, "promote.log");
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(prod1, { recursive: true });
  fs.mkdirSync(prod2, { recursive: true });
}

function teardown() {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// ── promote: happy path ──────────────────────────────────────────────────────
test("promote copies skill to all production roots", () => {
  setup();
  writeSkill(staging, "dummy-skill");

  const result = runPS(PROMOTE, [
    `-Name dummy-skill`,
    `-StagingRoot ${psEscPath(staging)}`,
    `-ProductionRoots ${psEscPath(prod1)},${psEscPath(prod2)}`,
    `-AuditLog ${psEscPath(auditLog)}`,
  ]);

  assert.strictEqual(result.status, 0, `PS exited ${result.status}\n${result.stderr}`);
  assert.ok(
    fs.existsSync(path.join(prod1, "dummy-skill", "SKILL.md")),
    "SKILL.md missing in prod1"
  );
  assert.ok(
    fs.existsSync(path.join(prod2, "dummy-skill", "SKILL.md")),
    "SKILL.md missing in prod2"
  );

  teardown();
});

// ── promote: audit log written ───────────────────────────────────────────────
test("promote writes JSONL audit log entry", () => {
  setup();
  writeSkill(staging, "dummy-skill");

  runPS(PROMOTE, [
    `-Name dummy-skill`,
    `-StagingRoot ${psEscPath(staging)}`,
    `-ProductionRoots ${psEscPath(prod1)}`,
    `-AuditLog ${psEscPath(auditLog)}`,
  ]);

  assert.ok(fs.existsSync(auditLog), "audit log not created");
  const line = fs.readFileSync(auditLog, "utf8").trim().split("\n")[0];
  const entry = JSON.parse(line);
  assert.strictEqual(entry.skill, "dummy-skill");
  assert.strictEqual(entry.action, "promote");

  teardown();
});

// ── promote: backup created ──────────────────────────────────────────────────
test("promote creates backup of existing production skill", () => {
  setup();
  writeSkill(staging, "dummy-skill");
  // Pre-populate prod so promote has something to back up
  writeSkill(prod1, "dummy-skill", DUMMY_SKILL_MD.replace("1.0.0", "0.9.0"));

  runPS(PROMOTE, [
    `-Name dummy-skill`,
    `-StagingRoot ${psEscPath(staging)}`,
    `-ProductionRoots ${psEscPath(prod1)}`,
    `-AuditLog ${psEscPath(auditLog)}`,
  ]);

  const backups = fs
    .readdirSync(path.join(prod1, ".backups"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("dummy-skill_"));
  assert.ok(backups.length >= 1, "no backup directory created");

  teardown();
});

// ── promote: fails if staging SKILL.md missing semver fields ─────────────────
test("promote exits non-zero when staging SKILL.md lacks version field", () => {
  setup();
  const badMd = `---\nname: dummy-skill\ndescription: no semver\n---\n# Body\n`;
  writeSkill(staging, "dummy-skill", badMd);

  const result = runPS(PROMOTE, [
    `-Name dummy-skill`,
    `-StagingRoot ${psEscPath(staging)}`,
    `-ProductionRoots ${psEscPath(prod1)}`,
    `-AuditLog ${psEscPath(auditLog)}`,
  ]);

  assert.notStrictEqual(result.status, 0, "expected non-zero exit for invalid staging skill");

  teardown();
});

// ── rollback: happy path ─────────────────────────────────────────────────────
test("rollback restores latest backup", () => {
  setup();
  // v1 already in production — simulate existing skill
  const v1Md = DUMMY_SKILL_MD;
  writeSkill(prod1, "dummy-skill", v1Md);

  // Stage v2 and promote — this backs up v1 and installs v2
  const v2Md = DUMMY_SKILL_MD
    .replace("version: 1.0.0", "version: 2.0.0")
    .replace("1.0.0 (2026-04-26): initial", "2.0.0 (2026-04-26): upgrade");
  writeSkill(staging, "dummy-skill", v2Md);

  runPS(PROMOTE, [
    `-Name dummy-skill`,
    `-StagingRoot ${psEscPath(staging)}`,
    `-ProductionRoots ${psEscPath(prod1)}`,
    `-AuditLog ${psEscPath(auditLog)}`,
  ]);

  // Confirm v2 is now in prod
  const afterPromote = fs.readFileSync(path.join(prod1, "dummy-skill", "SKILL.md"), "utf8");
  assert.ok(afterPromote.includes("2.0.0"), "promote did not install v2");

  // Rollback — should restore v1
  const result = runPS(ROLLBACK, [
    `-Name dummy-skill`,
    `-ProductionRoots ${psEscPath(prod1)}`,
    `-AuditLog ${psEscPath(auditLog)}`,
  ]);

  assert.strictEqual(result.status, 0, `rollback PS exited ${result.status}\n${result.stderr}`);
  const restored = fs.readFileSync(path.join(prod1, "dummy-skill", "SKILL.md"), "utf8");
  assert.ok(restored.includes("1.0.0"), "rollback did not restore v1");

  teardown();
});

// ── rollback: fails gracefully when no backup ────────────────────────────────
test("rollback exits non-zero when no backup exists", () => {
  setup();

  const result = runPS(ROLLBACK, [
    `-Name nonexistent-skill`,
    `-ProductionRoots ${psEscPath(prod1)}`,
    `-AuditLog ${psEscPath(auditLog)}`,
  ]);

  assert.notStrictEqual(result.status, 0, "expected non-zero exit when no backup found");

  teardown();
});

// ── rollback: audit log entry on rollback ─────────────────────────────────────
test("rollback appends JSONL audit log entry", () => {
  setup();
  writeSkill(staging, "dummy-skill");

  runPS(PROMOTE, [
    `-Name dummy-skill`,
    `-StagingRoot ${psEscPath(staging)}`,
    `-ProductionRoots ${psEscPath(prod1)}`,
    `-AuditLog ${psEscPath(auditLog)}`,
  ]);
  runPS(ROLLBACK, [
    `-Name dummy-skill`,
    `-ProductionRoots ${psEscPath(prod1)}`,
    `-AuditLog ${psEscPath(auditLog)}`,
  ]);

  const lines = fs.readFileSync(auditLog, "utf8").trim().split("\n");
  assert.ok(lines.length >= 2, "expected at least 2 log entries (promote + rollback)");
  const rollbackEntry = JSON.parse(lines[lines.length - 1]);
  assert.strictEqual(rollbackEntry.action, "rollback");

  teardown();
});

// ── rollback: byte-identical SHA-256 comparison ──────────────────────────────
test("rollback restores byte-identical content (SHA-256 match)", () => {
  setup();
  const crypto = require("node:crypto");

  const originalMd = DUMMY_SKILL_MD;
  writeSkill(prod1, "dummy-skill", originalMd);
  const originalHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(prod1, "dummy-skill", "SKILL.md")))
    .digest("hex");

  // Promote v2 over v1
  const v2Md = DUMMY_SKILL_MD
    .replace("version: 1.0.0", "version: 2.0.0")
    .replace("1.0.0 (2026-04-26): initial", "2.0.0 (2026-04-26): upgrade");
  writeSkill(staging, "dummy-skill", v2Md);
  runPS(PROMOTE, [
    `-Name dummy-skill`,
    `-StagingRoot ${psEscPath(staging)}`,
    `-ProductionRoots ${psEscPath(prod1)}`,
    `-AuditLog ${psEscPath(auditLog)}`,
  ]);

  // Rollback to v1
  runPS(ROLLBACK, [
    `-Name dummy-skill`,
    `-ProductionRoots ${psEscPath(prod1)}`,
    `-AuditLog ${psEscPath(auditLog)}`,
  ]);

  const restoredHash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(prod1, "dummy-skill", "SKILL.md")))
    .digest("hex");

  assert.strictEqual(restoredHash, originalHash, "SHA-256 mismatch: rollback did not restore byte-identical state");

  teardown();
});

// ── runner ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    process.stdout.write(`  PASS  ${name}\n`);
    passed++;
  } catch (err) {
    process.stderr.write(`  FAIL  ${name}\n        ${err.message}\n`);
    failed++;
  }
}

process.stdout.write(`\n${passed}/${passed + failed} tests passed\n`);
if (failed > 0) process.exit(1);
