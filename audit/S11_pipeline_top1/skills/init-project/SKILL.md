---
name: init-project
description: Initialize or upgrade project AI docs from real project context with root detection and create/upgrade/noop modes
version: 1.1.0
requires: []
changelog:
  - 1.1.0 (2026-04-23): add real-root detection, create/upgrade/noop modes, pipeline upgrade block, and settings warnings
  - 1.0.0 (2026-04-22): initialize semver metadata
---
# /init-project - Project AI Setup Initializer

> Create or upgrade `CLAUDE.md`, `AGENTS.md`, and `.gemini/GEMINI.md` from real project context without wiping project-specific knowledge.

## Success Criteria

Return `success: true` only when all applicable predicates below are true:
- Requested workflow outcome is produced in the expected file, branch, PR, report, or deployed resource.
- Required verification command(s) complete successfully and the final response includes their exact command names plus pass/fail evidence.
- Any required user approval, dependency gate, or handoff checkpoint is explicitly satisfied.
- Final response reports `success`, `criteria_checked`, `proof`, and `remaining_work`.
- If any predicate cannot be verified, return `success: false` with `remaining_work` and the blocking reason.

## When to Use
- A project has no AI docs yet.
- A project has stale AI docs that predate the current pipeline rules.
- A session starts in a parent folder and the real project root must be detected first.
- You need to verify whether the project state is `create`, `upgrade`, or `noop`.

## pipeline-state (B14)

If `~/.claude/pipeline-state.json` exists, `cwd` matches, and `ts` is within 24h, use its task and stack as scope hints. Do not let pipeline-state replace project recon. Root detection still comes from the actual filesystem.

## Workflow

### Step 1 - Detect the real project root before reading docs

Inspect the current folder and nearest descendants/ancestors for project markers:
- `.git`
- `package.json`
- `pyproject.toml`
- `go.mod`
- `Cargo.toml`

Choose the real project root from those markers, not from the session cwd alone.

If the session is opened in a parent folder and the real project root is different:
- report both paths explicitly;
- stop before writing files;
- return `success: false` with `remaining_work` asking for confirmation to continue in the detected root.

### Step 2 - Recon the current project state

Read only the minimum context needed:
- project manifest files for stack and versions;
- `README.md` if present;
- existing `CLAUDE.md`, `AGENTS.md`, `.gemini/GEMINI.md`;
- `git log --oneline -10`;
- `git status --short`;
- `.claude/settings.json` and `.claude/settings.local.json` if present;
- `.env.example` or equivalent key-only env reference.

Never write placeholder text like `TODO`, `[fill this]`, or guessed commands.

### Step 3 - Classify the mode

Classify into exactly one mode:
- `create`: one or more required AI docs are missing.
- `upgrade`: docs exist but are missing current pipeline rules, required sections, or sync between files.
- `noop`: all required docs exist, core sections are synchronized, and current pipeline block is already present.

Return the chosen mode out loud before any write.

### Step 4 - Plan the diff before editing

Before writing, state:
- detected root;
- mode (`create` / `upgrade` / `noop`);
- files to create or update;
- which project-specific details will be preserved;
- which standard pipeline blocks will be added.

If mode is `noop`, do not rewrite files just to normalize wording.

### Step 5 - Create or upgrade the docs safely

Required files:
- `CLAUDE.md`
- `AGENTS.md`
- `.gemini/GEMINI.md`

All three files must contain the same core sections:
- `## Overview`
- `## Stack`
- `## Commands`
- `## Architecture`
- `## Gotchas`
- `## Current State`

During `upgrade`:
- preserve project-specific `Stack`, `Architecture`, and `Gotchas` content when still accurate;
- preserve useful local commands and deployment notes;
- inject the current pipeline block covering `/pipeline`, Context7, TDD, verification, `/inline-review`, `/ship`, and checkpoint/handoff discipline;
- synchronize the core sections across all 3 docs without deleting relevant local notes;
- prefer additive edits over full rewrites.

### Step 6 - Settings and safety checks

Check `.claude/settings.json` in the detected real root.

If `.claude/settings.json` is missing:
- report it as a warning with the expected path.

If `.claude/settings.local.json` exists with broad permissions:
- report an explicit warning;
- do not silently delete it.

If git reports dubious ownership or requires `safe.directory`, return the exact command the user should run.

### Step 7 - Verify the result

Verification must include:
- all 3 docs exist in the real root;
- required sections exist in all 3 docs;
- pipeline upgrade block is present;
- mode result is justified (`create`, `upgrade`, or `noop`);
- warnings are listed for settings or git health when applicable.

### Step 8 - Response contract

Final response must include:
- `success`
- `criteria_checked`
- `proof`
- `remaining_work`

For `parent/root mismatch`, missing confirmation, or unverifiable project facts, return `success: false`.

## Required pipeline block

The upgraded docs must mention this workflow explicitly:
- start from `/pipeline`;
- use Context7 before external-library usage;
- use TDD when applicable;
- run verification before claiming done;
- run `/inline-review` after implementation;
- use `/ship` before ending with uncommitted work;
- update handoff or checkpoint state for the next session.

## Rules

1. Real project root beats current working directory.
2. `upgrade` must preserve project-specific context, not flatten it into a generic template.
3. `noop` means no unnecessary rewrite.
4. Never leak secret values. List env var names only.
5. Report warnings for `.claude/settings.local.json` and git `safe.directory`; do not hide them.
6. Keep all 3 AI docs synchronized on core sections.
