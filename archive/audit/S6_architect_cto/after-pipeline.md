---
name: pipeline
description: Orchestrator v3 — real Skill tool delegation with shared pipeline-state.json context. Use for any new task, feature, bug fix, or refactor. Classifies work, writes shared state, then delegates through Skill() to sub-skills instead of re-injecting their SKILL.md each step.
trigger: start task, new feature, implement, fix bug, refactor, pipeline
---

# /pipeline — Orchestrator v3

Real orchestrator. Not a declarative guide — you MUST actually invoke the Skill tool for each phase and MUST write `~/.claude/pipeline-state.json` before doing so.

State schema: see `~/.claude/skills/pipeline/state-schema.md`.

---

## Step 0 — Precheck (always)

1. Confirm a `CLAUDE.md` exists at project root. If missing → `project-docs-gate` will have already hard-blocked; you cannot proceed here.
2. If `~/.claude/pipeline-state.json` exists AND its `cwd` matches current project AND `ts` < 24h old → treat as resume. Read it, then jump to the phase listed in `phase`. Do not rewrite state from scratch.
3. **File-size precheck (B03).** If the user task names a specific target file, run `wc -l "<file>"`. If >500 LOC → announce "⚠ file is NNN LOC (>500). Each Edit reloads ~2K tokens/100 LOC. Recommend splitting first — invoke `Skill(architect-first)` to design a split, OR user confirm override." Only proceed to Step 1 after ack.
4. Otherwise → fresh pipeline. Proceed to Step 1.

---

## Step 1 — Classify (one line out loud)

Read in parallel:
- project `CLAUDE.md` → stack, commands, gotchas
- `git status -- .` → changed file count
- user task text → domain keywords

Classify (say the verdict + why in one line):

| Bucket | Signals |
|---|---|
| ULTRA-TRIVIAL | 1 file, <10 lines, rename/typo/config tweak |
| TRIVIAL | 1 file, <50 lines, no new deps |
| MEDIUM | 1-3 files, known scope, minor deps |
| COMPLEX | 3+ files OR new architecture OR new API/dep |

---

## Step 2 — Write shared state (mandatory, before any Skill() call)

Write `~/.claude/pipeline-state.json` once, now:

```bash
cat > ~/.claude/pipeline-state.json <<'EOF'
{
  "cwd": "<absolute cwd>",
  "task": "<user task, <=300 chars>",
  "complexity": "MEDIUM",
  "stack": "<from CLAUDE.md Stack section, one line>",
  "commands": { "test": "<cmd>", "lint": "<cmd>", "build": "<cmd>" },
  "domain": "<frontend|backend|security|architect|qa|devops>",
  "phase": "classified",
  "checkpoints": [{ "phase": "classified", "ts": "<ISO>" }],
  "ts": "<ISO>"
}
EOF
```

This file is the single source of truth for sub-skills. They read it instead of re-parsing CLAUDE.md. Saves 15-25% tokens per pipeline run.

---

## Step 3 — Route (REAL Skill tool calls, not narration)

### ULTRA-TRIVIAL → inline
Edit directly. Hooks handle quality. Delete `~/.claude/pipeline-state.json` at end.

### TRIVIAL → inline + proof
- Context7 if external lib (`mcp__context7__resolve-library-id` → `query-docs`)
- Edit → run the project's test command → show output
- Delete state file at end.

### MEDIUM → 2 Skill() calls
1. Implement inline (Context7 first if needed)
2. **Invoke:** `Skill(skill="inline-review")` → update state `phase=reviewed`
3. Run `commands.test` → show output
4. **Invoke:** `Skill(skill="ship")` if tests pass → update state `phase=shipped`

### COMPLEX → 4 Skill() calls with checkpoints

```
Step A. Skill(skill="architect-first")   → design, validation, approval
        └─ checkpoint: phase=architected, append to checkpoints[]
Step B. TaskCreate tasks ([IMPLEMENT]/[REVIEW]/[SHIP] prefixes)
        Skill(skill="sprint")             → per-task execution loop
        └─ checkpoint: phase=implementing
Step C. Skill(skill="inline-review")     → full-change review
        └─ checkpoint: phase=reviewed
Step D. Skill(skill="ship") [--pr]        → commit + PR
        └─ checkpoint: phase=shipped
```

**After each sub-skill returns:** append a checkpoint entry to `~/.claude/pipeline-state.json.checkpoints[]` with `{ phase, ts }` before starting the next phase. This is the only way the orchestrator verifies sub-skills actually ran.

---

## Step 4 — Sub-skill context protocol (B14)

Sub-skills invoked via `Skill()` must:
1. **Read `~/.claude/pipeline-state.json` FIRST.** If present + fresh → use `task`, `stack`, `commands`, `domain` from it. Do NOT re-read CLAUDE.md Stack/Commands sections.
2. Update their own phase + checkpoints when done.
3. Never re-run classification — trust `complexity` field.

This is why state is written before any `Skill()` call.

---

## Step 5 — Stack-specific command defaults

| Stack detected | Test | Lint |
|---|---|---|
| Python | `python -m pytest tests/ -v` | `ruff check src/` |
| Next.js/React | `npm run build` | `npx tsc --noEmit` |
| Node API | `npm test` | `npm run lint` |
| Go | `go test ./...` | `go vet ./...` |

Project CLAUDE.md Commands section overrides these.

---

## Step 6 — Auto-agent routing (spawn silently)

| Trigger | Agent | Model |
|---|---|---|
| 3+ files changing | architect | sonnet |
| auth/security/middleware file | security-reviewer | sonnet |
| Bug failing 3+ attempts | build-error-resolver | haiku |
| 10+ edits without review | code-reviewer | haiku |

Agents ARE allowed to run in parallel with sub-skills — they operate on files, not state.

---

## Step 7 — End of pipeline

On successful `ship`:
```bash
echo '{ "phase": "shipped", "ts": "'$(date -u +%FT%TZ)'" }' > ~/.claude/pipeline-state.json
```

This clears state so the next `/pipeline` invocation starts fresh.

---

## Hooks enforce (don't duplicate)
- **graphify-read-gate** — query over full-read
- **edit-enforcer** — Context7 + review reminders
- **domain-agent-gate** — injects domain rules on first edit
- **loop-guardian** — 6+ same-edit BLOCK (S4)
- **ship-gate** — blocks session exit with uncommitted changes

## Override domain
Say `use frontend | backend | security | architect | qa | devops` to force. Overrides `domain` in state file.
