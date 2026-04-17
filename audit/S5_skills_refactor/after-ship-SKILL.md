# Ship — Release Automation

> Automate: quality gate → commit → optional PR → optional deploy → learn → checkpoint.

## pipeline-state (B14)
If `~/.claude/pipeline-state.json` exists, `cwd` matches, and `ts` < 24h → read `task`, `commands.test`, `commands.build` from it. Use for commit message context and pre-ship verification. After ship succeeds, overwrite state with `{ "phase": "shipped", "ts": "<ISO>" }` to clear active pipeline.

## When to Use
- End of a pipeline session (MEDIUM/COMPLEX)
- Manually: `/ship` after completing work
- With PR: `/ship --pr` to also create a GitHub Pull Request
- With deploy: `/ship --deploy` to trigger Vercel deploy after commit

## Workflow

### Step 1: Assess changes
```bash
git status
git diff --stat
```
If nothing to commit → say "Nothing to ship" and exit.

### Step 2: Quality gate (inline)
Run checks based on detected stack (same logic as quality-gate-runner.js):
- **TypeScript**: `npx tsc --noEmit`
- **Lint**: `npm run lint` (if script exists)
- **Go**: `go vet ./...`
- **Python**: `python -m py_compile` on changed .py files
- **Secrets scan**: grep staged files for AWS access keys, OpenAI tokens, GitHub personal-access tokens, etc.

If ANY check fails → show errors → ask to fix → don't commit.
If ALL pass → proceed.

### Step 3: Generate commit
Analyze the diff to determine:
- **Type**: feat (new feature), fix (bug), refactor, docs, test, chore
- **Scope**: component/module name from changed paths
- **Description**: what changed and why (1 sentence)

Format: `{type}({scope}): {description}`

Show the generated message, ask: "Commit? [y/edit/n]"
- y → commit with this message
- edit → user provides custom message
- n → abort

Stage relevant files (not `.env`, not `node_modules`).

### Step 4: Optional PR (`--pr` flag)
If `--pr` was passed or user says "pr":
```bash
gh pr create --title "{commit message}" --body "$(cat <<'EOF'
## Summary
{bullet points from diff analysis}

## Changes
{list of changed files with brief description}

## Test plan
{verification steps based on what was changed}

Generated with Claude Code
EOF
)"
```

### Step 5: Optional deploy (`--deploy` flag)
Detect if Vercel project:
- Check for `vercel.json` or `.vercel/` directory
- Check CLAUDE.md Stack section for "Vercel"

If Vercel project and `--deploy`:
- Push to branch → Vercel auto-deploys preview
- For production: ask confirmation first

### Step 6: Session wrap-up
After commit:
1. Run `/learn` — extract patterns from this session
2. Ask: "Checkpoint before finishing? [y/n]"
   - y → run `/checkpoint`
   - n → done

### Output
```
SHIP COMPLETE ─────────────────────
✓ Quality gate: tsc, lint, secrets — passed
✓ Commit: feat(auth): add JWT refresh rotation
✓ PR: #42 created → https://github.com/user/repo/pull/42
✓ Patterns extracted via /learn
────────────────────────────────────
```

## Rules
- NEVER force-push
- NEVER deploy to production without explicit user confirmation
- NEVER skip quality gate — if checks fail, fix first
- Hooks still fire: quality-gate-runner.js triggers on `git commit` naturally
- If no git repo → skip commit steps, just run /learn + /checkpoint
