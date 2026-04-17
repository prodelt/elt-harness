# Inline Review — Quick Self-Review

> Fast code review after completing a work unit. Domain-aware, actionable, concise.

## pipeline-state (B14)
If `~/.claude/pipeline-state.json` exists, `cwd` matches, and `ts` < 24h old → read `task`, `domain`, `stack` from it for scope and focus. Skip re-reading CLAUDE.md for these fields. After review completes, append `{ "phase": "reviewed", "ts": "<ISO>" }` to `checkpoints[]`.

## When to Use
- After completing a sprint task (MEDIUM/COMPLEX pipeline)
- After implementing a feature chunk
- Manually: `/inline-review` at any point

## Workflow

### Step 1: Collect changes
Run `git diff --name-only HEAD` or track files modified since last review.
If no git changes, use the list of files from the last Edit/Write operations.

### Step 2: Detect domain
Based on changed file extensions and paths:
- `.tsx`, `.jsx`, `components/`, `app/` → read `~/.claude/skills/agents/frontend.md`
- `.go`, `api/`, `handlers/`, `services/` → read `~/.claude/skills/agents/backend.md`
- `auth`, `middleware`, `security`, `rls` → read `~/.claude/skills/agents/security.md`
- `.test.`, `.spec.`, `__tests__/` → read `~/.claude/skills/agents/qa.md`
- `Dockerfile`, `.github/`, `vercel.json` → read `~/.claude/skills/agents/devops.md`
- Multiple domains → read the PRIMARY one (most files changed)

### Step 3: Spawn code-reviewer subagent
Use the Agent tool with these EXACT parameters:

```
Agent(
  subagent_type: "code-reviewer",
  model: "haiku",
  prompt: "Review these changed files against {domain} best practices.
    Read each file using the Read tool. Answer 5 questions ONLY — 1 line each:
    1. Does this change do what was asked? (yes/no + note if no)
    2. Obvious bugs? (list or 'none')
    3. console.log / hardcoded values / secrets? (list or 'none')
    4. Breaks existing patterns? (yes + what, or 'no')
    5. One thing to improve? (or 'nothing')
    Files: {file list}"
)
```

The code-reviewer subagent has access to: Read, Grep, Glob, Bash.
It CAN and MUST read the actual file contents, not just filenames.

### Step 4: Report
Format the 5 answers as a compact block:

```
INLINE REVIEW ───────────────────
1. Does what was asked: yes
2. Bugs: none
3. Hardcode/secrets: none
4. Patterns: consistent
5. Improve: consider extracting helper
─────────────────────────────────
```

### Step 5: Act on findings
- All clean → continue to next task
- Issues found → ask: "Fix now or continue? [fix/continue]"
- Critical bug → fix immediately, don't ask

## Rules
- NEVER skip inline-review in MEDIUM/COMPLEX pipeline
- If subagent fails or returns empty → fallback: read the diff yourself and answer the 5 questions directly
- Don't review config files, lockfiles, or generated code
