const fs = require("fs");
const path = require("path");

const { evaluateSkillSuccessCriteria } = require("./success-criteria-check");

const DEFAULT_QUARANTINE_ROOT = path.resolve(".tmp", "skill-quarantine");
const WARN_TOKEN_ESTIMATE = 1800;
const MAX_TOKEN_ESTIMATE = 3000;
const MAX_SKILL_BYTES = 16 * 1024;
const MAX_BUNDLE_FILES = 32;
const MAX_TEXT_SCAN_BYTES = 24 * 1024;
const DENY_BINARY_EXTENSIONS = new Set([".dll", ".dylib", ".exe", ".jar", ".msi", ".so"]);

const DENY_PATTERNS = [
  {
    id: "destructive-command",
    message: "dangerous shell command or destructive operation",
    regex:
      /\b(rm\s+-rf|git\s+reset\s+--hard|del\s+\/f\s+\/s|format\s+[a-z]:|Remove-Item\b[^\n]*-Recurse[^\n]*-Force|curl[^\n|]+\|\s*(bash|sh)|Invoke-WebRequest[^\n|]+\|\s*iex|iwr[^\n|]+\|\s*iex)\b/i,
  },
  {
    id: "global-root-write",
    message: "attempt to write directly into global skill roots",
    regex: /(~\/\.(claude|codex|gemini)\/skills|\.\\(claude|codex|gemini)\\skills|\$HOME\\\.(claude|codex|gemini)\\skills|C:\\Users\\[^\\]+\\\.(claude|codex|gemini)\\skills)/i,
  },
  {
    id: "embedded-secret",
    message: "hardcoded secret-like token or private key",
    regex:
      /\b(sk-(live|proj)-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|(api[_-]?key|secret|token)\s*[:=]\s*['"]?[A-Za-z0-9._-]{16,}['"]?)\b|-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
  },
];

const WARN_PATTERNS = [
  {
    id: "skip-verification",
    message: "instruction weakens verification or review",
    regex: /\b(--no-verify|skip (tests|review)|ignore failing tests|disable security|bypass sandbox)\b/i,
  },
  {
    id: "approval-bypass",
    message: "instruction implies skipping approval gates",
    regex: /\b(no need to ask|do not ask for approval|without approval)\b/i,
  },
];

function normalizeNewlines(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function estimateTokenCount(text) {
  return Math.ceil(normalizeNewlines(text).length / 4);
}

function extractFrontmatterBlock(content) {
  const normalized = normalizeNewlines(content);
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
  return match ? match[1] : "";
}

function parseFrontmatter(content) {
  const block = extractFrontmatterBlock(content);
  if (!block) {
    return {};
  }

  const lines = block.split("\n");
  const parsed = {};
  let currentArrayKey = "";

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const arrayItemMatch = line.match(/^\s*-\s+(.+)$/);
    if (arrayItemMatch && currentArrayKey) {
      parsed[currentArrayKey].push(arrayItemMatch[1].trim());
      continue;
    }

    const pairMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!pairMatch) {
      currentArrayKey = "";
      continue;
    }

    const key = pairMatch[1];
    const value = pairMatch[2].trim();
    if (!value) {
      parsed[key] = [];
      currentArrayKey = key;
      continue;
    }

    if (/^\[.*\]$/.test(value)) {
      parsed[key] = value
        .slice(1, -1)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      currentArrayKey = "";
      continue;
    }

    parsed[key] = value;
    currentArrayKey = "";
  }

  return parsed;
}

function splitRelativeSegments(relativePath) {
  return normalizeNewlines(relativePath)
    .split(/[\\/]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment !== ".");
}

function inferMetadataFromSkillFile(skillFile, quarantineRoot) {
  const skillDir = path.dirname(path.resolve(skillFile));
  const relativePath = path.relative(path.resolve(quarantineRoot), skillDir);
  const segments = splitRelativeSegments(relativePath);
  if (segments.length < 2) {
    return { source: "", name: "" };
  }

  return {
    source: segments.slice(0, -1).join("/"),
    name: segments[segments.length - 1],
  };
}

function resolveSkillFile(options) {
  if (options.skillFile) {
    return path.resolve(options.skillFile);
  }

  if (options.skillDir) {
    return path.join(path.resolve(options.skillDir), "SKILL.md");
  }

  if (!options.source || !options.name) {
    throw new Error("Provide --skill-file/--skill-dir or both --source and --name.");
  }

  return path.join(path.resolve(options.quarantineRoot), ...options.source.split("/"), options.name, "SKILL.md");
}

function isInsideDirectory(targetPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(targetPath));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function evaluateQuarantinePath(skillFile, quarantineRoot, source, name) {
  const expectedPath = path.join(path.resolve(quarantineRoot), ...source.split("/"), name, "SKILL.md");
  const resolvedSkillFile = path.resolve(skillFile);
  const details = {
    expectedPath,
    actualPath: resolvedSkillFile,
  };

  if (!isInsideDirectory(resolvedSkillFile, quarantineRoot) && resolvedSkillFile !== path.resolve(expectedPath)) {
    return {
      id: "quarantine-path",
      severity: "deny",
      success: false,
      message: "skill file is outside the quarantine root",
      details,
      evidence: [resolvedSkillFile],
    };
  }

  return {
    id: "quarantine-path",
    severity: "deny",
    success: resolvedSkillFile === path.resolve(expectedPath),
    message:
      resolvedSkillFile === path.resolve(expectedPath)
        ? "skill file matches expected quarantine layout"
        : "skill file does not match <quarantine>/<source>/<skill>/SKILL.md layout",
    details,
    evidence: [path.relative(path.resolve(quarantineRoot), resolvedSkillFile)],
  };
}

function evaluateFrontmatter(content) {
  const parsed = parseFrontmatter(content);
  const missing = ["name", "description"].filter((key) => {
    const value = parsed[key];
    return typeof value !== "string" || !value.trim();
  });

  return {
    id: "frontmatter",
    severity: "deny",
    success: missing.length === 0,
    message: missing.length === 0 ? "frontmatter contains required metadata" : `missing frontmatter fields: ${missing.join(", ")}`,
    details: { missing, keys: Object.keys(parsed).sort() },
    evidence: Object.keys(parsed).sort(),
  };
}

function evaluateSize(content, stats) {
  const tokenEstimate = estimateTokenCount(content);
  const failures = [];
  if (stats.size > MAX_SKILL_BYTES) {
    failures.push(`file size ${stats.size} bytes exceeds ${MAX_SKILL_BYTES}`);
  }
  if (tokenEstimate > MAX_TOKEN_ESTIMATE) {
    failures.push(`token estimate ${tokenEstimate} exceeds ${MAX_TOKEN_ESTIMATE}`);
  }

  return {
    id: "size-budget",
    severity: failures.length > 0 ? "deny" : tokenEstimate > WARN_TOKEN_ESTIMATE ? "warn" : "info",
    success: failures.length === 0 && tokenEstimate <= WARN_TOKEN_ESTIMATE,
    message:
      failures.length > 0
        ? failures.join("; ")
        : tokenEstimate > WARN_TOKEN_ESTIMATE
          ? `token estimate ${tokenEstimate} is above warning budget ${WARN_TOKEN_ESTIMATE}`
          : "skill size is within quarantine budget",
    details: { bytes: stats.size, tokenEstimate },
    evidence: [`bytes=${stats.size}`, `tokens=${tokenEstimate}`],
  };
}

function collectPatternHits(content, patterns, severity, targetLabel = "SKILL.md") {
  return patterns.flatMap((pattern) => {
    const hits = [];
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match = regex.exec(content);
    while (match) {
      hits.push(match[0]);
      match = regex.exec(content);
      if (!regex.global) {
        break;
      }
    }

    if (hits.length === 0) {
      return [];
    }

    return [
      {
        id: pattern.id,
        severity,
        success: false,
        message: `${pattern.message} in ${targetLabel}`,
        details: { hits: hits.length, target: targetLabel },
        evidence: hits.slice(0, 3).map((hit) => `${targetLabel}: ${hit}`),
      },
    ];
  });
}

function listBundleFiles(skillDir) {
  const files = [];
  const queue = [path.resolve(skillDir)];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

function shouldScanAsText(filePath, stats) {
  if (stats.size > MAX_TEXT_SCAN_BYTES) {
    return false;
  }

  const extension = path.extname(filePath).toLowerCase();
  return !DENY_BINARY_EXTENSIONS.has(extension);
}

function evaluateBundleFiles(skillDir, skillFile) {
  const bundleFiles = listBundleFiles(skillDir);
  const checks = [];
  const skillDirResolved = path.resolve(skillDir);

  if (bundleFiles.length > MAX_BUNDLE_FILES) {
    checks.push({
      id: "bundle-file-count",
      severity: "warn",
      success: false,
      message: `bundle contains ${bundleFiles.length} files, above warning budget ${MAX_BUNDLE_FILES}`,
      details: { files: bundleFiles.length },
      evidence: bundleFiles.slice(0, 5).map((filePath) => path.relative(skillDirResolved, filePath)),
    });
  }

  for (const filePath of bundleFiles) {
    if (path.resolve(filePath) === path.resolve(skillFile)) {
      continue;
    }

    const stats = fs.statSync(filePath);
    const relativePath = path.relative(skillDirResolved, filePath);
    const extension = path.extname(filePath).toLowerCase();

    if (DENY_BINARY_EXTENSIONS.has(extension)) {
      checks.push({
        id: "bundle-binary",
        severity: "deny",
        success: false,
        message: `bundle contains binary or executable artifact in ${relativePath}`,
        details: { target: relativePath, bytes: stats.size },
        evidence: [relativePath],
      });
      continue;
    }

    if (!shouldScanAsText(filePath, stats)) {
      checks.push({
        id: "bundle-large-file",
        severity: "warn",
        success: false,
        message: `bundle file ${relativePath} is too large for inline text scan`,
        details: { target: relativePath, bytes: stats.size },
        evidence: [relativePath],
      });
      continue;
    }

    const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    checks.push(...collectPatternHits(content, DENY_PATTERNS, "deny", relativePath));
    checks.push(...collectPatternHits(content, WARN_PATTERNS, "warn", relativePath));
  }

  return checks;
}

function evaluateSuccessCriteria(skillFile) {
  const result = evaluateSkillSuccessCriteria(skillFile);
  return {
    id: "success-criteria",
    severity: "deny",
    success: result.success,
    message: result.success ? "success criteria are explicit and verifiable" : result.reasons.join("; "),
    details: { predicates: result.predicates },
    evidence: result.reasons,
  };
}

function summarizeChecks(checks) {
  const denyFailures = checks.filter((check) => check.severity === "deny" && !check.success);
  const warnings = checks.filter((check) => check.severity === "warn" && !check.success);

  return {
    success: denyFailures.length === 0,
    verdict: denyFailures.length === 0 ? (warnings.length > 0 ? "allow-with-warnings" : "allow") : "deny",
    failures: denyFailures,
    warnings,
  };
}

function scanSkillQuarantine(rawOptions) {
  const quarantineRoot = path.resolve(rawOptions.quarantineRoot || DEFAULT_QUARANTINE_ROOT);
  const skillFile = resolveSkillFile({ ...rawOptions, quarantineRoot });
  if (!fs.existsSync(skillFile)) {
    return {
      success: false,
      verdict: "deny",
      source: rawOptions.source || null,
      name: rawOptions.name || null,
      skillFile,
      quarantineRoot,
      checks: [
        {
          id: "skill-file",
          severity: "deny",
          success: false,
          message: "SKILL.md not found in quarantine target",
          details: { skillFile },
          evidence: [skillFile],
        },
      ],
      failures: [],
      warnings: [],
    };
  }

  const inferred = inferMetadataFromSkillFile(skillFile, quarantineRoot);
  const source = rawOptions.source || inferred.source;
  const name = rawOptions.name || inferred.name;
  const content = fs.readFileSync(skillFile, "utf8").replace(/^\uFEFF/, "");
  const stats = fs.statSync(skillFile);
  const skillDir = path.dirname(skillFile);
  const checks = [
    evaluateQuarantinePath(skillFile, quarantineRoot, source, name),
    evaluateFrontmatter(content),
    evaluateSize(content, stats),
    evaluateSuccessCriteria(skillFile),
    ...collectPatternHits(content, DENY_PATTERNS, "deny"),
    ...collectPatternHits(content, WARN_PATTERNS, "warn"),
    ...evaluateBundleFiles(skillDir, skillFile),
  ];
  const summary = summarizeChecks(checks);

  return {
    success: summary.success,
    verdict: summary.verdict,
    source,
    name,
    skillFile,
    quarantineRoot,
    checks,
    failures: summary.failures,
    warnings: summary.warnings,
  };
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--source") {
      options.source = next;
      index += 1;
    } else if (current === "--name") {
      options.name = next;
      index += 1;
    } else if (current === "--skill-file") {
      options.skillFile = next;
      index += 1;
    } else if (current === "--skill-dir") {
      options.skillDir = next;
      index += 1;
    } else if (current === "--quarantine-root") {
      options.quarantineRoot = next;
      index += 1;
    } else if (current === "--json") {
      options.json = true;
    }
  }

  return options;
}

function formatCheck(check) {
  return `- [${check.success ? "OK" : check.severity.toUpperCase()}] ${check.id}: ${check.message}`;
}

function formatText(result) {
  return [
    result.success ? "OK: skill quarantine" : "FAIL: skill quarantine",
    `verdict: ${result.verdict}`,
    `source: ${result.source || "(unknown)"}`,
    `name: ${result.name || "(unknown)"}`,
    ...result.checks.map(formatCheck),
  ].join("\n");
}

if (require.main === module) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result = scanSkillQuarantine(options);
    process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : formatText(result)}\n`);
    process.exitCode = result.success ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_QUARANTINE_ROOT,
  MAX_SKILL_BYTES,
  MAX_TOKEN_ESTIMATE,
  WARN_TOKEN_ESTIMATE,
  estimateTokenCount,
  evaluateFrontmatter,
  inferMetadataFromSkillFile,
  parseFrontmatter,
  resolveSkillFile,
  scanSkillQuarantine,
};
