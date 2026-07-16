---
name: prime
description: >
  Loads comprehensive project context into session: stack, architecture, git state, env vars, commands.
  TRIGGER when: user says /prime, "load context", "prime context", "what's this project",
  start of session in unfamiliar project, after context compaction, before long autonomous run.
---

# /prime — Project Context Loader

Systematic context injection. Reads all project facts and presents a structured summary so the session starts with complete understanding.

## When to Use
- Start of any session in a new/unfamiliar project
- After `/compact` (context compaction wipes session memory)
- Before delegating a long autonomous run
- When switching between projects mid-session

## Workflow

### Step 1: Collect raw facts (run in parallel)

```bash
# Stack detection
cat package.json 2>/dev/null | head -40
cat go.mod 2>/dev/null | head -15
cat pyproject.toml 2>/dev/null | head -20
cat Cargo.toml 2>/dev/null | head -15

# Project structure
ls -1 src/ app/ lib/ pages/ api/ cmd/ 2>/dev/null | head -20

# Git history
git log --oneline -8 2>/dev/null

# Current state
git status --short 2>/dev/null | head -15

# Env keys (names ONLY — NEVER values)
cat .env.example 2>/dev/null | grep -E '^[A-Z_]+=' | sed 's/=.*/=***/'
grep -E '^[A-Z_]+=' .env 2>/dev/null | sed 's/=.*/=***/' 2>/dev/null | head -15
```

### Step 2: Read project docs
- `CLAUDE.md` — full read (contains architecture, gotchas, current state)
- `README.md` — first 40 lines if no CLAUDE.md

### Step 3: Present context summary

Format output exactly like this:

```
CONTEXT PRIMED ──────────────────────────────
Project:     {name from package.json/go.mod or dir name}
Stack:       {tech + major versions, comma-separated}
Run:         {dev command}
Build:       {build command}
Test:        {test command}

Architecture:
  {top 3-5 directories} → {what each does}

Recent commits:
  {last 5 in plain language, 1 line each}

Git state:   {N files changed / clean}
Branch:      {current branch}

Env vars:    {comma-separated key names, or "none found"}
─────────────────────────────────────────────
Session goal: {from session-focus gate if set, else "not set"}
```

### Step 4: Warnings
- CLAUDE.md missing → "WARN: No CLAUDE.md found. Run /init-project to create project docs."
- No git repo → skip git sections
- No package.json/go.mod/pyproject.toml → "WARN: No stack file detected. Manual context needed."

## Rules
- NEVER print .env values — key names only
- Output under 50 lines — scannable, not a novel
- Read CLAUDE.md fully if it exists (it has the most context)
- This is read-only — never edit any files during /prime
- Combine with /careful or /freeze for safe investigation sessions:
  `/prime` → `/careful` → start working
