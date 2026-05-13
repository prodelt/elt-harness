const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const REQUIRED_DOCS = ["CLAUDE.md", "AGENTS.md", path.join(".gemini", "GEMINI.md")];
const REQUIRED_SECTIONS = [
  "## Overview",
  "## Stack",
  "## Commands",
  "## Architecture",
  "## Gotchas",
  "## Current State",
];
const PIPELINE_TERMS = ["/pipeline", "Context7", "TDD", "verification", "/inline-review", "/ship", "checkpoint"];
const ROOT_MARKERS = [".git", "package.json", "pyproject.toml", "go.mod", "Cargo.toml"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "dist", "build", "coverage"]);

function normalizeContent(content) {
  return content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function hasMarker(dirPath, marker) {
  return fs.existsSync(path.join(dirPath, marker));
}

function scoreRootCandidate(dirPath) {
  return ROOT_MARKERS.reduce((score, marker) => score + (hasMarker(dirPath, marker) ? 1 : 0), 0);
}

function listDescendantCandidates(rootPath, maxDepth = 2, depth = 0, results = []) {
  if (depth > maxDepth || !fs.existsSync(rootPath)) {
    return results;
  }

  const score = scoreRootCandidate(rootPath);
  if (score > 0) {
    results.push({ path: rootPath, score, depth });
  }

  const entries = fs.readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) {
      continue;
    }
    listDescendantCandidates(path.join(rootPath, entry.name), maxDepth, depth + 1, results);
  }

  return results;
}

function detectRealRoot(cwdPath) {
  const resolved = path.resolve(cwdPath);
  const candidates = listDescendantCandidates(resolved)
    .sort((a, b) => b.score - a.score || a.depth - b.depth || a.path.localeCompare(b.path));

  if (candidates.length === 0) {
    return { cwd: resolved, realRoot: resolved, mismatch: false, candidates: [] };
  }

  const best = candidates[0];
  return {
    cwd: resolved,
    realRoot: best.path,
    mismatch: best.path !== resolved,
    candidates,
  };
}

function extractSection(content, heading) {
  const normalized = normalizeContent(content);
  const lines = normalized.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return "";
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) {
      end = index;
      break;
    }
  }

  return lines.slice(start, end).join("\n").trim();
}

function readDoc(docPath) {
  if (!fs.existsSync(docPath)) {
    return null;
  }
  return normalizeContent(fs.readFileSync(docPath, "utf8"));
}

function evaluateDocs(rootPath) {
  const docs = Object.fromEntries(
    REQUIRED_DOCS.map((doc) => {
      const docPath = path.join(rootPath, doc);
      return [doc, readDoc(docPath)];
    })
  );

  const failures = [];
  const warnings = [];
  for (const doc of REQUIRED_DOCS) {
    if (!docs[doc]) {
      failures.push(`missing doc: ${doc}`);
      continue;
    }

    for (const section of REQUIRED_SECTIONS) {
      if (!docs[doc].includes(section)) {
        failures.push(`${doc} missing section ${section}`);
      }
    }

    const missingTerms = PIPELINE_TERMS.filter((term) => !docs[doc].includes(term));
    if (missingTerms.length > 0) {
      failures.push(`${doc} missing pipeline block terms: ${missingTerms.join(", ")}`);
    }
  }

  if (failures.length === 0) {
    const baseline = REQUIRED_SECTIONS.map((section) => extractSection(docs["CLAUDE.md"], section));
    for (const doc of REQUIRED_DOCS.slice(1)) {
      const sections = REQUIRED_SECTIONS.map((section) => extractSection(docs[doc], section));
      if (JSON.stringify(sections) !== JSON.stringify(baseline)) {
        failures.push(`core sections are not synchronized in ${doc}`);
      }
    }
  }

  const settingsPath = path.join(rootPath, ".claude", "settings.json");
  if (!fs.existsSync(settingsPath)) {
    warnings.push(`missing settings file: ${settingsPath}`);
  }

  const legacySettingsPath = path.join(rootPath, ".claude", "settings.local.json");
  if (fs.existsSync(legacySettingsPath)) {
    warnings.push(`stale broad-permission settings file present: ${legacySettingsPath}`);
  }

  return { failures, warnings };
}

function detectGitHealth(rootPath, execGit = cp.execFileSync) {
  if (!fs.existsSync(path.join(rootPath, ".git"))) {
    return [];
  }

  try {
    execGit("git", ["-C", rootPath, "status", "--short"], { stdio: "pipe", encoding: "utf8" });
    return [];
  } catch (error) {
    const stderr = `${error.stderr || ""}${error.stdout || ""}`;
    if (/dubious ownership|safe\.directory/i.test(stderr)) {
      return [`git safe.directory warning: run git config --global --add safe.directory "${rootPath}"`];
    }
    return [`git health warning: ${stderr.trim() || String(error.message || error)}`];
  }
}

function inspectProjectSetup(cwdPath, options = {}) {
  const rootInfo = detectRealRoot(cwdPath);
  const failures = [];
  const warnings = [];

  if (rootInfo.mismatch) {
    failures.push(`real root differs from cwd: cwd=${rootInfo.cwd} realRoot=${rootInfo.realRoot}`);
  }

  const docsResult = evaluateDocs(rootInfo.realRoot);
  failures.push(...docsResult.failures);
  warnings.push(...docsResult.warnings);
  warnings.push(...detectGitHealth(rootInfo.realRoot, options.execGit));

  return {
    success: failures.length === 0,
    cwd: rootInfo.cwd,
    realRoot: rootInfo.realRoot,
    mismatch: rootInfo.mismatch,
    failures,
    warnings,
  };
}

function formatText(result) {
  if (result.success) {
    return [
      "OK: project ai setup",
      `realRoot: ${result.realRoot}`,
      `warnings: ${result.warnings.length}`,
    ].join("\n");
  }

  return [
    "FAIL: project ai setup",
    `realRoot: ${result.realRoot}`,
    "success: false",
    ...result.failures,
    ...result.warnings,
  ].join("\n");
}

if (require.main === module) {
  const target = process.argv[2] || process.cwd();
  const result = inspectProjectSetup(target);
  process.stdout.write(`${formatText(result)}\n`);
  process.exitCode = result.success ? 0 : 1;
}

module.exports = {
  detectRealRoot,
  evaluateDocs,
  inspectProjectSetup,
  detectGitHealth,
};
