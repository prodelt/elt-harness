const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_CACHE_PATH = path.join(os.homedir(), ".claude", "skill-registry", "index.jsonl");
const DEFAULT_TTL_HOURS = 24;
const KNOWN_TRUSTED_OWNERS = new Set([
  "anthropics", "better-auth", "browser-use", "coreyhaines31", "expo", "firebase",
  "firecrawl", "github", "google-labs-code", "googleworkspace", "larksuite",
  "microsoft", "nextlevelbuilder", "openai", "skillssh", "supabase", "vercel", "vercel-labs",
]);

function normalizeNewlines(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function normalizeQuery(query) {
  return String(query || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseCountToken(token) {
  const match = String(token || "")
    .trim()
    .match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) {
    return null;
  }

  const value = Number.parseFloat(match[1]);
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[
    (match[2] || "").toUpperCase()
  ];
  return Math.round(value * (multiplier || 1));
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^a-z0-9:+_-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token));
}

function inferTriggers({ query, name, description }) {
  return Array.from(new Set([...tokenize(query), ...tokenize(name), ...tokenize(description)])).slice(
    0,
    6
  );
}

function estimateTokenEstimate({ name, description, triggers }) {
  const triggerCost = (Array.isArray(triggers) ? triggers.length : 0) * 6;
  const rawCost = `${name || ""} ${description || ""}`.trim().length;
  const estimated = Math.ceil(rawCost / 4) + triggerCost;
  return Math.max(32, Math.min(256, estimated || 32));
}

function inferSourceTrust({ source, installCount, sourceInstallCount }) {
  const owner = String(source || "").split("/")[0] || "";
  if (KNOWN_TRUSTED_OWNERS.has(owner)) {
    return "high";
  }

  const usage = installCount || sourceInstallCount || 0;
  if (usage >= 10_000) {
    return "medium";
  }

  return "unknown";
}

function trustRank(value) {
  return { unknown: 0, medium: 1, high: 2 }[value] || 0;
}

function quoteSkillName(name) {
  return /\s/.test(name) ? `"${name}"` : name;
}

function buildInstallCommand(source, name) {
  if (!source || !name) {
    return "";
  }

  return `npx skills add ${source} --skill ${quoteSkillName(name)}`;
}

function createMetadata({
  name,
  source,
  query,
  description = "",
  installCount = null,
  sourceInstallCount = null,
  registryUrl = "",
  snapshotScope = "skill",
}) {
  const triggers = inferTriggers({ query, name, description });
  return {
    name,
    source,
    description: description || null,
    triggers,
    installCommand: buildInstallCommand(source, name),
    tokenEstimate: estimateTokenEstimate({ name, description, triggers }),
    sourceTrust: inferSourceTrust({ source, installCount, sourceInstallCount }),
    installCount,
    sourceInstallCount,
    registryUrl: registryUrl || null,
    snapshotScope,
  };
}

function parseSkillsFindOutput(text, query) {
  const lines = normalizeNewlines(text).split("\n");
  const items = [];
  let pendingIndex = -1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const entryMatch = line.match(
      /^(?<source>[a-z0-9_.-]+\/[a-z0-9_.-]+)@(?<name>.+?)\s+(?<installs>\d+(?:\.\d+)?[KMB]?)\s+installs?$/i
    );
    if (entryMatch && entryMatch.groups) {
      const installCount = parseCountToken(entryMatch.groups.installs);
      items.push(
        createMetadata({
          name: entryMatch.groups.name.trim(),
          source: entryMatch.groups.source.trim(),
          query,
          installCount,
        })
      );
      pendingIndex = items.length - 1;
      continue;
    }

    if ((line.startsWith("└ ") || line.startsWith("http")) && pendingIndex !== -1) {
      const registryUrl = line.replace(/^└\s*/, "").trim();
      items[pendingIndex] = { ...items[pendingIndex], registryUrl };
      pendingIndex = -1;
    }
  }

  return items;
}

function extractOwnerFromSnapshot(text, explicitOwner) {
  if (explicitOwner) {
    return explicitOwner.trim();
  }

  const ownerMatch = normalizeNewlines(text).match(/^#\s+([a-z0-9_.-]+)$/im);
  return ownerMatch ? ownerMatch[1] : "";
}

function parseLeaderboardLine(line, query) {
  const match = line.match(
    /^(?:\d+\s+)?(?<name>\S+)\s+(?<source>[a-z0-9_.-]+\/[a-z0-9_.-]+)\s+(?<installs>\d+(?:\.\d+)?[KMB]?)$/i
  );
  if (!match || !match.groups) {
    return [];
  }

  return [
    createMetadata({
      name: match.groups.name.trim(),
      source: match.groups.source.trim(),
      query,
      installCount: parseCountToken(match.groups.installs),
      registryUrl: `https://skills.sh/${match.groups.source.trim()}/${match.groups.name.trim()}`,
    }),
  ];
}

function parsePreviewSkillNames(previewText) {
  return previewText
    .replace(/\+\d+\s+more/gi, "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseSourcePreviewLine(line, query, owner) {
  const match = line.match(
    /^(?<repo>[a-z0-9_.-]+)\s+(?<count>\d+)\s+skills?\s+:\s+(?<skills>.+?)\s+(?<installs>\d+(?:\.\d+)?[KMB]?)$/i
  );
  if (!match || !match.groups || !owner) {
    return [];
  }

  const source = `${owner}/${match.groups.repo.trim()}`;
  const sourceInstallCount = parseCountToken(match.groups.installs);
  return parsePreviewSkillNames(match.groups.skills).map((name) =>
    createMetadata({
      name,
      source,
      query,
      sourceInstallCount,
      registryUrl: `https://skills.sh/${owner}/${match.groups.repo.trim()}/${name}`,
      snapshotScope: "source-preview",
    })
  );
}

function parseSkillsShSnapshot(text, { query = "", owner = "" } = {}) {
  const lines = normalizeNewlines(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const resolvedOwner = extractOwnerFromSnapshot(text, owner);
  return dedupeMetadata(
    lines.flatMap((line) => [
      ...parseLeaderboardLine(line, query),
      ...parseSourcePreviewLine(line, query, resolvedOwner),
    ])
  );
}

function dedupeMetadata(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = `${item.source}::${item.name}`;
    const previous = byKey.get(key);
    byKey.set(
      key,
      !previous
        ? item
        : {
            ...previous,
            ...item,
            description: previous.description || item.description,
            installCount: previous.installCount || item.installCount,
            sourceInstallCount: previous.sourceInstallCount || item.sourceInstallCount,
            registryUrl: previous.registryUrl || item.registryUrl,
            triggers: previous.triggers.length >= item.triggers.length ? previous.triggers : item.triggers,
            tokenEstimate: Math.max(previous.tokenEstimate, item.tokenEstimate),
            sourceTrust:
              trustRank(previous.sourceTrust) >= trustRank(item.sourceTrust)
                ? previous.sourceTrust
                : item.sourceTrust,
            snapshotScope:
              previous.snapshotScope === "skill" || item.snapshotScope !== "skill"
                ? previous.snapshotScope
                : item.snapshotScope,
          }
    );
  }

  return Array.from(byKey.values()).sort((left, right) => {
    if (left.source === right.source) {
      return left.name.localeCompare(right.name);
    }
    return left.source.localeCompare(right.source);
  });
}

function parseRegistrySnapshot({ source, text, query, owner }) {
  if (source === "skills-cli") {
    return parseSkillsFindOutput(text, query);
  }

  if (source === "skills.sh") {
    return parseSkillsShSnapshot(text, { query, owner });
  }

  throw new Error(`Unsupported source: ${source}`);
}

function buildCacheKey({ source, query, owner }) {
  return [source, normalizeQuery(query), String(owner || "").trim().toLowerCase()].join("::");
}

function readCacheIndex(cachePath) {
  if (!cachePath || !fs.existsSync(cachePath)) {
    return [];
  }

  return normalizeNewlines(fs.readFileSync(cachePath, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function findFreshCacheEntry({ cachePath, source, query, owner, now }) {
  const cacheKey = buildCacheKey({ source, query, owner });
  return readCacheIndex(cachePath)
    .filter((entry) => entry.cacheKey === cacheKey)
    .filter((entry) => Date.parse(entry.expiresAt) > now.getTime())
    .sort((left, right) => Date.parse(right.fetchedAt) - Date.parse(left.fetchedAt))[0];
}

function appendCacheEntry(cachePath, entry) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.appendFileSync(cachePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function runSkillsFind(query) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(executable, ["skills", "find", query], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, DISABLE_TELEMETRY: "1" },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "skills find failed").trim());
  }

  return result.stdout || "";
}

function loadSnapshotText(options) {
  if (typeof options.snapshotText === "string") {
    return options.snapshotText;
  }
  if (options.snapshotFile) {
    return fs.readFileSync(path.resolve(options.snapshotFile), "utf8");
  }
  if (options.source === "skills-cli") {
    const runner = options.commandRunner || runSkillsFind;
    return runner(options.query);
  }
  if (typeof options.fetchText === "function") {
    return options.fetchText({ query: options.query, owner: options.owner });
  }

  throw new Error("skills.sh snapshots require snapshotText, snapshotFile, or fetchText.");
}

function validateOptions(options) {
  const query = normalizeQuery(options.query);
  const ttlHours = Number(options.ttlHours || DEFAULT_TTL_HOURS);
  const source = String(options.source || "skills-cli");
  if (!query) {
    throw new Error("Missing --query. Provide a non-empty query string.");
  }
  if (!["skills-cli", "skills.sh"].includes(source)) {
    throw new Error(`Unsupported --source: ${source}`);
  }
  if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
    throw new Error("ttlHours must be a positive number.");
  }

  return {
    ...options,
    source,
    query,
    ttlHours,
    cachePath: path.resolve(options.cachePath || DEFAULT_CACHE_PATH),
  };
}

function searchRegistry(rawOptions) {
  const options = validateOptions(rawOptions);
  const now = options.now instanceof Date ? options.now : new Date();
  const cached = options.refresh
    ? null
    : findFreshCacheEntry({
        cachePath: options.cachePath,
        source: options.source,
        query: options.query,
        owner: options.owner,
        now,
      });

  if (cached) {
    return {
      success: true,
      source: options.source,
      query: options.query,
      owner: options.owner || null,
      cacheHit: true,
      cachePath: options.cachePath,
      fetchedAt: cached.fetchedAt,
      items: cached.items,
    };
  }

  const snapshot = loadSnapshotText(options);
  const items = parseRegistrySnapshot({
    source: options.source,
    text: snapshot,
    query: options.query,
    owner: options.owner,
  });
  const entry = {
    cacheKey: buildCacheKey(options),
    source: options.source,
    query: options.query,
    owner: options.owner || null,
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + options.ttlHours * 60 * 60 * 1000).toISOString(),
    items,
  };
  appendCacheEntry(options.cachePath, entry);

  return {
    success: true,
    source: options.source,
    query: options.query,
    owner: options.owner || null,
    cacheHit: false,
    cachePath: options.cachePath,
    fetchedAt: entry.fetchedAt,
    items,
  };
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--query") {
      options.query = next;
      index += 1;
    } else if (current === "--source") {
      options.source = next;
      index += 1;
    } else if (current === "--owner") {
      options.owner = next;
      index += 1;
    } else if (current === "--cache") {
      options.cachePath = next;
      index += 1;
    } else if (current === "--ttl-hours") {
      options.ttlHours = next;
      index += 1;
    } else if (current === "--snapshot-file") {
      options.snapshotFile = next;
      index += 1;
    } else if (current === "--refresh") {
      options.refresh = true;
    } else if (current === "--json") {
      options.json = true;
    }
  }
  return options;
}

function formatText(result) {
  return [
    "OK: skill registry",
    `source: ${result.source}`,
    `query: ${result.query}`,
    `cache: ${result.cacheHit ? "HIT" : "MISS"}`,
    `results: ${result.items.length}`,
    ...result.items.slice(0, 5).map((item) => `- ${item.name} | ${item.source} | ${item.sourceTrust}`),
  ].join("\n");
}

if (require.main === module) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const result = searchRegistry(options);
    process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : formatText(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_CACHE_PATH,
  buildCacheKey,
  createMetadata,
  dedupeMetadata,
  estimateTokenEstimate,
  findFreshCacheEntry,
  inferSourceTrust,
  inferTriggers,
  parseCountToken,
  parseRegistrySnapshot,
  parseSkillsFindOutput,
  parseSkillsShSnapshot,
  readCacheIndex,
  searchRegistry,
  validateOptions,
};
