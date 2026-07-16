# pipeline-state.json — Shared Context for Sub-Skills

**Location:** `~/.claude/pipeline-state.json` (global, single active pipeline)

**Purpose:** `/pipeline` writes this file ONCE, sub-skills (`architect-first`, `sprint`, `inline-review`, `ship`) read minimal context from it instead of re-injecting their full SKILL.md and re-parsing CLAUDE.md every invocation. Saves 15-25% tokens per pipeline run (B14).

## Schema

```json
{
  "cwd": "C:/Claude playground/project",
  "task": "user original request verbatim (<=300 chars)",
  "complexity": "ULTRA-TRIVIAL | TRIVIAL | MEDIUM | COMPLEX",
  "stack": "Next.js 16 | Python 3.11 | Go 1.22 | ...",
  "commands": {
    "test": "npm test",
    "lint": "npx tsc --noEmit",
    "build": "npm run build"
  },
  "domain": "frontend | backend | security | architect | qa | devops",
  "phase": "classified | architected | implementing | reviewed | shipped",
  "checkpoints": [
    { "phase": "classified",  "ts": "2026-04-17T22:00:00Z" },
    { "phase": "architected", "ts": "2026-04-17T22:15:00Z" }
  ],
  "ts": "2026-04-17T22:00:00Z"
}
```

## Lifecycle

1. **Write (by `/pipeline`):** Immediately after classification step, before any `Skill()` call.
2. **Read (by sub-skills):** Check if file exists AND `cwd` matches current project AND `ts` within last 24h. If yes → use its `stack`/`commands`/`task`/`domain` as truth; skip redundant `CLAUDE.md` re-read.
3. **Update (by each sub-skill):** Append to `checkpoints[]` when step completes. Update `phase`.
4. **Clear (by `ship`):** On successful `ship`, overwrite with `{ "phase": "shipped", "ts": "..." }` minimal record.

## Staleness rule

If `cwd` differs from current project, or `ts` older than 24h → treat as stale, ignore, rewrite from scratch. Never carry state across projects.

## Minimal ops (LLM-friendly)

Write in bash:
```bash
cat > ~/.claude/pipeline-state.json <<'EOF'
{ "cwd": "...", "task": "...", "complexity": "MEDIUM", ... }
EOF
```

Read + check freshness (inside sub-skill):
```bash
cat ~/.claude/pipeline-state.json 2>/dev/null | head -50
```

No node helper required — plain JSON write/read is sufficient.

## Why shared global file vs per-project?

Single active pipeline at a time. Global path keeps sub-skills simple (no cwd parsing). `cwd` field inside the JSON disambiguates if a stale file survives.
