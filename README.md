# Pipeline Setupper — token-disciplined Claude Code / Codex CLI setup

Personal setup for Claude Code (with mirror configs for Codex CLI & Antigravity)
focused on one metric: **tokens burned per session**. Ships 30 Node.js hooks that
gate, block, or advise on tool use before costly mistakes hit the transcript.

Empirically measured: **196K → ~90K tokens/session** (≈2.2×) when the setup
is enabled.

## What's in the box

```
~/.claude/
├── settings.json              Claude Code harness config (hooks, skills, env)
├── hooks/                     30 Node.js hooks (see table below)
│   ├── lib/{config,logger,metrics,pathnorm}.js   Shared utilities
│   ├── config.json            Hook thresholds (edit here, not in hook code)
│   ├── hook-stats.js          CLI: node hook-stats.js [--errors|--reset]
│   ├── test-all-hooks.js      Sanity: exit 0 + valid JSON shape (29/29)
│   └── test-hooks-behavior.js BLOCK/ALLOW behavior suite (29/29)
├── skills/                    User-invocable /slash commands
├── rules/rules.md             Global rules (pulled into every session)
├── CLAUDE.md                  User-level instructions
├── CONFIG_MAP.md              Where each config key lives + why
└── ISOLATION_POLICY.md        Why shared-hooks across Claude/Codex

~/.codex/hooks.json            Mirror of 28 of the same hooks (Codex CLI)
```

## The token-burn problem this solves

A baseline Claude Code session burns ~196K tokens. Empirical breakdown from a
real 337-event session:

| Leak | Size | Fix |
|---|---:|---|
| One failed Edit on settings.json (schema returned as tool_result) | **223K** | `settings-schema-guard.js` — pre-validates edit, blocks `_`-prefix keys |
| Edit tool `originalFile` duplication (B03, upstream runtime bug) | ~10K per Edit | `edit-enforcer.js` — file-size warn @500 LOC, block @1200 LOC |
| Write for partial edits to existing large files | ~4K per Write | `write-over-edit-guard.js` — forces Edit for ≥150-LOC files with ≥80% overlap |
| Bash with unbounded stdout (cat/find/npm ls) | 10-50K | `bash-output-advisor.js` — PostToolUse, suggests `head`/`tail` |
| SessionStart hints for unused tooling | 113 tokens × every session | `graphify-session-init.js` — silent when graph not present |
| Skill listing at startup (30+ skills with long descriptions) | ~25K | `settings.json`: `skillListingMaxDescChars: 512`, `skillOverrides: user-invocable-only` for rarely-used skills |
| Free-form tool result in context budget | 130K default | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=88`, `context-budget-gate.js` |

## Hook catalog (30 hooks)

### SessionStart (5)
- `project-docs-gate` — blocks work in a project without CLAUDE.md/AGENTS.md/.gemini/GEMINI.md
- `session-focus-gate` — forces one-goal-per-session, cleans old tool-results
- `autoskills-check` — detects tech stack from package.json, suggests Context7
- `graphify-session-init` — silent unless graph exists (zero-cost when unused)
- `memory-discipline` — blocks if MEMORY.md >100 lines

### UserPromptSubmit (1)
- `context-budget-gate` — warns at 130K context, suggests /checkpoint

### PreToolUse (9)
- `graphify-read-gate` [Read] — redirects large-file reads to `graphify query`
- `graphify-preuse` [Glob|Grep] — same, for structural queries
- `settings-schema-guard` [Edit|Write] — pre-validates settings.json edits
- `write-over-edit-guard` [Write] — forces Edit for existing large files
- `config-protection` [Edit|Write] — locks hooks config files unless explicitly opted-in
- `domain-agent-gate` [Edit|Write] — auto-routes to architect/security-reviewer/code-reviewer
- `edit-enforcer` [Edit|Write] — inline-review + Context7 + file-size + loop guard
- `secret-scanner` [Bash] — blocks commands containing API keys
- `quality-gate-runner` [Bash] — blocks test-skipping patterns

### PostToolUse (11)
- `post-edit-combined`, `context7-reminder`, `inline-review-gate` [Edit|Write]
- `verification-tracker`, `loop-guardian` [Edit|Write|Bash]
- `secret-output-scanner`, `bash-output-advisor` [Bash]
- `inline-review-tracker` [Agent]
- `scope-guard` [TaskCreate]
- `context7-tracker` [MCP context7]
- `pipeline-tracker` [Skill]

### Stop (2)
- `stop-verification` — warns if code changed but no tests ran this session
- `ship-gate` — blocks exit with uncommitted code files (bypassable)

### Notification (1) / FileChanged (1)
- `task-completed-gate`, `env-change-watcher`

## Installation

Prereqs: Node.js 18+, Windows or macOS (paths in hooks are Windows-shaped; audit
before use on macOS).

```bash
# 1. Clone into home directory
git clone https://github.com/YOUR-FORK/pipeline-setupper ~/.claude

# 2. (Windows) Junction shared memory to Codex
cmd /c mklink /J "%USERPROFILE%\.codex\memories" "%USERPROFILE%\.claude\projects\C--\memory"

# 3. Verify
node ~/.claude/hooks/test-all-hooks.js          # expect 29/29 PASS
node ~/.claude/hooks/test-hooks-behavior.js     # expect 29/29 PASS
node ~/.codex/test-codex-hooks.js               # expect 28/28 PASS
```

All hooks **fail-safe**: any unhandled error → `exit(0)` (never blocks work).

## Observability

```bash
node ~/.claude/hooks/hook-stats.js              # fire/warn/block counts per hook
node ~/.claude/hooks/hook-stats.js --errors     # error log tail
node ~/.claude/hooks/hook-stats.js --reset      # zero counters

node ~/.claude/hooks/analyze-session.js <path.jsonl>   # post-hoc session breakdown
```

`analyze-session.js` produces the exact cost breakdown that motivated this
project — top-10 biggest events, tool-result bytes per tool, Read destinations.
Run it on any `~/.claude/projects/*/session.jsonl` to see where your tokens went.

## Design principles

1. **Fail-safe over fail-closed.** Every hook wraps its body in try/catch and
   exits 0 on error. A broken hook never stops work — it just stops helping.
2. **Silent on the happy path.** Hooks emit output only when they have a
   specific warning/block. No "ran successfully" noise.
3. **Thresholds in one file.** Every tunable lives in `hooks/config.json`; hook
   code reads defaults but never hard-codes business thresholds.
4. **Shared across tools.** Claude Code, Codex CLI, and Antigravity all run
   the same `.js` files. One fix, three tools. See `ISOLATION_POLICY.md` for why.
5. **Measure, don't guess.** Every optimization in this repo comes from running
   `analyze-session.js` on a real transcript and finding the actual top offenders.

## Gotchas for contributors

- **Windows `git root = C:\`** — the whole filesystem is one repo. Hooks must
  scope `git status -- .` to CWD.
- **Never run `graphify claude install` on Windows** — generates broken
  PowerShell hooks. Use `graphify-preuse.js` (already installed).
- **`cwd` comes from hook input**, not `process.cwd()` (which is always
  `~/.claude/hooks/`).
- **Claude Code settings.json schema is strict** — `additionalProperties: false`
  at the top level. `_`-prefixed keys are rejected. Use `CONFIG_MAP.md`
  for documentation, not inline comments.
- **Stop-hook output format is different**: `{ decision, reason }` not
  `hookSpecificOutput`.

## Credits

Built through 8 audit sprints. Token-burn data collected from 72 real sessions
(14.1M tokens) across `~/.claude/projects/`. Every threshold and pattern was
validated empirically, not copied from a blog post.
