---
name: git-flow
description: GitHub Flow operator for one-task feature branches: start a branch, sync it with main, finish with verification, commit, optional push/PR, and handoff. Use when the user asks for /git-flow, git flow, branch workflow, start/sync/finish a feature branch, or enforce S11 git discipline.
version: 1.0.0
requires: []
changelog:
  - 1.0.0 (2026-04-22): initialize semver metadata
---

# Git Flow

Use this skill to run one focused GitHub Flow task without touching unrelated work.


## Success Criteria

Return `success: true` only when all applicable predicates below are true:
- Requested workflow outcome is produced in the expected file, branch, PR, report, or deployed resource.
- Required verification command(s) complete successfully and the final response includes their exact command names plus pass/fail evidence.
- Any required user approval, dependency gate, or handoff checkpoint is explicitly satisfied.
- Final response reports `success`, `criteria_checked`, `proof`, and `remaining_work`.
- If any predicate cannot be verified, return `success: false` with `remaining_work` and the blocking reason.

## Rules

- One task per branch.
- Never work directly on `main` or `master`.
- Never use `git add .` or `git add -A`; stage explicit files.
- Never force-push to `main`.
- Use Conventional Commits: `<type>(<scope>): <subject>`.
- Before changing API contracts, find and update all consumers in the same branch.

## Start

Use when the user says `/git-flow start <type> <short-name>` or asks to start a new task branch.

1. Check current state:
   ```bash
   git status --short
   git branch --show-current
   ```
2. If tracked changes exist, do not switch branches until they are committed or explicitly parked.
3. Create a valid branch name:
   ```text
   <type>/<kebab-name>
   ```
   Allowed types: `feature`, `fix`, `hotfix`, `chore`, `docs`, `refactor`, `test`.
4. Normalize the name to match `^[a-z0-9][a-z0-9-]{2,49}$`.
   If the user gives a one-letter name like `/git-flow start feature x`, use `feature/x-task`.
5. Create the branch:
   ```bash
   git checkout -b feature/example-task
   ```
6. Confirm:
   ```bash
   git branch --show-current
   ```

## Sync

Use when the user says `/git-flow sync` or asks to update the branch.

1. Fetch remote refs:
   ```bash
   git fetch origin
   ```
2. Rebase onto main:
   ```bash
   git rebase origin/main
   ```
3. If conflicts happen, stop and resolve them deliberately. Do not discard user changes.

## Finish

Use when the user says `/git-flow finish` or asks to ship the branch.

1. Review changes:
   ```bash
   git status --short
   git diff --stat
   ```
2. Run the project verification commands from `AGENTS.md` or `CLAUDE.md`.
3. Scan changed files for secrets and debug output.
4. Stage explicit files only:
   ```bash
   git add path/to/file
   ```
5. Commit with a Conventional Commit message:
   ```bash
   git commit -m "feat(scope): concise subject"
   ```
6. If the user asked for a PR, push the branch and create one:
   ```bash
   git push -u origin HEAD
   gh pr create --title "feat(scope): concise subject" --body "Summary + Test plan"
   ```

## Output

Report:

- branch name
- verification commands and pass/fail results
- commit hash if created
- PR URL if created
- any remaining uncommitted tracked files
