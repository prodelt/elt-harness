#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { searchRegistry } = require("../skills/skill-registry");
const { scanSkillQuarantine } = require("../skills/skill-quarantine-scan");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_CACHE_PATH = path.join(REPO_ROOT, ".tmp", "github-tool-discovery-registry.jsonl");
const ALLOW_LICENSES = new Set(["apache-2.0", "bsd-2-clause", "bsd-3-clause", "isc", "mit", "mpl-2.0"]);
const WARN_LICENSES = new Set(["lgpl-2.1", "lgpl-3.0"]);
const PASS_STARS = 1000;
const WARN_STARS = 100;
const PASS_ACTIVITY_DAYS = 180;
const WARN_ACTIVITY_DAYS = 365;
const WARN_TOKEN_COST = 1200;
const FAIL_TOKEN_COST = 2000;

function normalizeString(value) {
  return String(value || "").trim();
}

function normalizeLower(value) {
  return normalizeString(value).toLowerCase();
}

function toIsoDate(value) {
  const normalized = normalizeString(value);
  return normalized ? new Date(normalized) : null;
}

function daysSince(value, now) {
  const parsed = toIsoDate(value);
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.floor((now.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000));
}

function createCriterion(id, status, summary, details = {}) {
  return {
    id,
    status,
    summary,
    details,
  };
}

function assessAdoption(candidate) {
  const stars = Number(candidate.repo?.stars || 0);
  const forks = Number(candidate.repo?.forks || 0);
  if (stars >= PASS_STARS || forks >= 100) {
    return createCriterion("adoption", "pass", `strong GitHub adoption (${stars} stars / ${forks} forks)`, {
      stars,
      forks,
    });
  }
  if (stars >= WARN_STARS || forks >= 10) {
    return createCriterion("adoption", "warn", `limited adoption (${stars} stars / ${forks} forks)`, {
      stars,
      forks,
    });
  }
  return createCriterion("adoption", "fail", `weak adoption signal (${stars} stars / ${forks} forks)`, {
    stars,
    forks,
  });
}

function assessMaintenance(candidate, now) {
  const archived = Boolean(candidate.repo?.archived);
  const pushAge = daysSince(candidate.repo?.pushedAt, now);
  const releaseAge = daysSince(candidate.releases?.publishedAt, now);
  const freshestAge = Math.min(pushAge, releaseAge);
  if (archived) {
    return createCriterion("maintenance", "fail", "repository is archived", {
      pushAge,
      releaseAge,
    });
  }
  if (freshestAge <= PASS_ACTIVITY_DAYS) {
    return createCriterion("maintenance", "pass", `active maintenance (${freshestAge} days since latest activity)`, {
      pushAge,
      releaseAge,
    });
  }
  if (freshestAge <= WARN_ACTIVITY_DAYS) {
    return createCriterion("maintenance", "warn", `maintenance looks stale (${freshestAge} days since latest activity)`, {
      pushAge,
      releaseAge,
    });
  }
  return createCriterion("maintenance", "fail", `maintenance is too stale (${freshestAge} days since latest activity)`, {
    pushAge,
    releaseAge,
  });
}

function assessLicense(candidate) {
  const license = normalizeLower(candidate.repo?.license);
  if (ALLOW_LICENSES.has(license)) {
    return createCriterion("license", "pass", `acceptable license ${license}`, { license });
  }
  if (WARN_LICENSES.has(license)) {
    return createCriterion("license", "warn", `license ${license} needs manual review`, { license });
  }
  if (license) {
    return createCriterion("license", "fail", `license ${license} is not approved for promotion`, { license });
  }
  return createCriterion("license", "fail", "missing or unknown license", { license: null });
}

function assessWindowsSupport(candidate) {
  const windows = normalizeLower(candidate.support?.windows);
  const wsl = normalizeLower(candidate.support?.wsl);
  if (windows === "documented" || windows === "supported") {
    return createCriterion("windows-support", "pass", `Windows support is ${windows}`, {
      windows,
      wsl,
    });
  }
  if (windows === "unsupported") {
    return createCriterion("windows-support", "fail", "Windows support is explicitly unsupported", {
      windows,
      wsl,
    });
  }
  if (wsl === "documented" || wsl === "supported" || wsl === "required") {
    return createCriterion("windows-support", "warn", `Windows path depends on WSL (${wsl})`, {
      windows,
      wsl,
    });
  }
  return createCriterion("windows-support", "warn", "Windows support is not documented", {
    windows,
    wsl,
  });
}

function assessSecurity(candidate) {
  const requiresSecrets = Boolean(candidate.security?.requiresSecrets);
  const rollback = normalizeLower(candidate.security?.rollback);
  const autoPromoteRequested = Boolean(candidate.security?.autoPromoteRequested);
  if (requiresSecrets) {
    return createCriterion("security", "fail", "candidate requires secrets during discovery or install", {
      rollback,
      autoPromoteRequested,
    });
  }
  if (!rollback || rollback === "none") {
    return createCriterion("security", "warn", "rollback plan is missing", {
      rollback,
      autoPromoteRequested,
    });
  }
  if (autoPromoteRequested && rollback !== "manifest") {
    return createCriterion("security", "warn", "auto-promote was requested without manifest-grade rollback", {
      rollback,
      autoPromoteRequested,
    });
  }
  return createCriterion("security", "pass", `rollback strategy is ${rollback || "defined"}`, {
    rollback,
    autoPromoteRequested,
  });
}

function assessTokenCost(candidate) {
  const estimatedReadTokens = Number(candidate.tokenCost?.estimatedReadTokens || 0);
  if (estimatedReadTokens >= FAIL_TOKEN_COST) {
    return createCriterion("token-cost", "fail", `token cost is too high (${estimatedReadTokens})`, {
      estimatedReadTokens,
    });
  }
  if (estimatedReadTokens >= WARN_TOKEN_COST) {
    return createCriterion("token-cost", "warn", `token cost is elevated (${estimatedReadTokens})`, {
      estimatedReadTokens,
    });
  }
  return createCriterion("token-cost", "pass", `token cost is acceptable (${estimatedReadTokens})`, {
    estimatedReadTokens,
  });
}

function assessOverlap(candidate) {
  const level = normalizeLower(candidate.overlap?.level);
  const reason = normalizeString(candidate.overlap?.reason);
  if (level === "high") {
    return createCriterion("overlap", "fail", `high overlap with existing tools${reason ? `: ${reason}` : ""}`, {
      level,
      reason,
    });
  }
  if (level === "medium" || level === "adjacent") {
    return createCriterion("overlap", "warn", `partial overlap${reason ? `: ${reason}` : ""}`, {
      level,
      reason,
    });
  }
  return createCriterion("overlap", "pass", reason || "candidate fills a distinct gap", {
    level: level || "none",
    reason,
  });
}

function assessRegistry(candidate) {
  if (!candidate.registry?.source) {
    return null;
  }

  const query = normalizeString(candidate.registry.query || candidate.query || candidate.candidate);
  const result = searchRegistry({
    query,
    source: candidate.registry.source,
    owner: candidate.registry.owner,
    snapshotText: candidate.registry.snapshotText,
    snapshotFile: candidate.registry.snapshotFile,
    cachePath: candidate.registry.cachePath || DEFAULT_CACHE_PATH,
    refresh: true,
  });
  if (result.items.length > 0) {
    return createCriterion("registry-overlap", "pass", `registry found ${result.items.length} related entries`, {
      source: result.source,
      items: result.items.length,
    });
  }
  return createCriterion("registry-overlap", "warn", "registry found no direct overlap", {
    source: result.source,
    items: 0,
  });
}

function assessQuarantine(candidate) {
  if (!candidate.quarantine) {
    return null;
  }

  const result = scanSkillQuarantine({
    skillFile: candidate.quarantine.skillFile,
    skillDir: candidate.quarantine.skillDir,
    quarantineRoot: candidate.quarantine.quarantineRoot,
    source: candidate.quarantine.source,
    name: candidate.quarantine.name,
  });
  if (result.verdict === "deny") {
    return createCriterion("quarantine-scan", "fail", "quarantine scan denied the candidate bundle", {
      verdict: result.verdict,
      failures: result.failures.map((failure) => failure.id),
    });
  }
  if (result.verdict === "allow-with-warnings") {
    return createCriterion("quarantine-scan", "warn", "quarantine scan passed with warnings", {
      verdict: result.verdict,
      warnings: result.warnings.map((warning) => warning.id),
    });
  }
  return createCriterion("quarantine-scan", "pass", "quarantine scan passed", {
    verdict: result.verdict,
  });
}

function collectCriteria(candidate, now) {
  return [
    assessAdoption(candidate),
    assessMaintenance(candidate, now),
    assessLicense(candidate),
    assessSecurity(candidate),
    assessWindowsSupport(candidate),
    assessTokenCost(candidate),
    assessOverlap(candidate),
    assessRegistry(candidate),
    assessQuarantine(candidate),
  ].filter(Boolean);
}

function pickScope(candidate) {
  const hinted = normalizeLower(candidate.scopeHint);
  if (hinted) {
    return hinted;
  }
  const kind = normalizeLower(candidate.kind);
  if (kind === "spec" || kind === "knowledge-store") {
    return "project";
  }
  if (kind === "agent-framework" || kind === "browser-automation") {
    return "on-demand";
  }
  return "project";
}

function classifyVerdict(candidate, criteria) {
  const byId = Object.fromEntries(criteria.map((criterion) => [criterion.id, criterion]));
  const fatalFailures = criteria.filter(
    (criterion) => criterion.status === "fail" && ["license", "maintenance", "security", "quarantine-scan"].includes(criterion.id)
  );
  if (fatalFailures.length > 0) {
    return "reject";
  }

  if (normalizeLower(candidate.kind) === "spec") {
    return "adopt-spec";
  }

  const researchSignals = [
    byId["windows-support"]?.status === "fail",
    byId.overlap?.status === "fail",
    byId["token-cost"]?.status === "fail",
    normalizeLower(candidate.scopeHint) === "research",
  ].filter(Boolean).length;
  if (researchSignals > 0) {
    return "research-only";
  }

  return "quarantine-readonly-spike";
}

function buildNextActions(verdict, scope) {
  if (verdict === "adopt-spec") {
    return [
      "adapt the format in project scope",
      "keep global install disabled",
      "add manifest and rollback before any promotion",
    ];
  }
  if (verdict === "quarantine-readonly-spike") {
    return [
      `clone only into ${scope} quarantine workspace`,
      "run a read-only spike",
      "re-check promotion gates after manifest and rollback exist",
    ];
  }
  if (verdict === "research-only") {
    return [
      "limit work to architecture notes or comparison docs",
      "do not install into project or global scope",
      "revisit only if a later task needs this exact capability",
    ];
  }
  return [
    "stop discovery for this candidate",
    "record the rejection reason",
    "search for a lower-risk alternative",
  ];
}

function summarizeProof(candidate, criteria) {
  return criteria.map((criterion) => `${criterion.id}: ${criterion.summary}`).slice(0, 6).concat([
    `repo: ${normalizeString(candidate.repo?.fullName) || "unknown"}`,
  ]);
}

function evaluateCandidate(rawCandidate, options = {}) {
  const candidate = {
    ...rawCandidate,
    repo: { ...(rawCandidate.repo || {}) },
    releases: { ...(rawCandidate.releases || {}) },
    support: { ...(rawCandidate.support || {}) },
    security: { ...(rawCandidate.security || {}) },
    overlap: { ...(rawCandidate.overlap || {}) },
    tokenCost: { ...(rawCandidate.tokenCost || {}) },
    registry: rawCandidate.registry ? { ...rawCandidate.registry } : null,
    quarantine: rawCandidate.quarantine ? { ...rawCandidate.quarantine } : null,
  };
  const now = options.now instanceof Date ? options.now : new Date("2026-04-24T00:00:00Z");
  const criteria = collectCriteria(candidate, now);
  const verdict = classifyVerdict(candidate, criteria);
  const scope = verdict === "research-only" ? "research" : pickScope(candidate);
  const blockingReasons = criteria
    .filter((criterion) => criterion.status === "fail")
    .map((criterion) => criterion.summary);

  return {
    success: true,
    candidate: normalizeString(candidate.candidate) || "unknown",
    kind: normalizeString(candidate.kind) || "runtime",
    repo: normalizeString(candidate.repo?.fullName) || null,
    verdict,
    scope,
    autoPromote: false,
    criteria_checked: criteria.length,
    criteria,
    blockingReasons,
    nextActions: buildNextActions(verdict, scope),
    proof: summarizeProof(candidate, criteria),
  };
}

function evaluateCandidates(candidates, options = {}) {
  const results = candidates.map((candidate) => evaluateCandidate(candidate, options));
  return {
    success: true,
    criteria_checked: results.reduce((sum, result) => sum + result.criteria_checked, 0),
    results,
  };
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--fixture-file") {
      options.fixtureFile = next;
      index += 1;
    } else if (current === "--json") {
      options.json = true;
    }
  }
  return options;
}

function loadCandidates(options) {
  if (!options.fixtureFile) {
    throw new Error("Missing --fixture-file.");
  }
  const parsed = JSON.parse(fs.readFileSync(path.resolve(options.fixtureFile), "utf8"));
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed.candidates)) {
    return parsed.candidates;
  }
  throw new Error("Fixture file must contain an array or { candidates: [] }.");
}

function formatText(result) {
  const lines = ["OK: github discovery"];
  for (const entry of result.results) {
    lines.push(`${entry.candidate}: ${entry.verdict} (${entry.scope})`);
    lines.push(`  repo=${entry.repo}`);
    lines.push(`  autoPromote=${entry.autoPromote}`);
    lines.push(`  blocking=${entry.blockingReasons.join(" | ") || "none"}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const candidates = loadCandidates(options);
    const result = evaluateCandidates(candidates);
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatText(result));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateCandidate,
  evaluateCandidates,
};
