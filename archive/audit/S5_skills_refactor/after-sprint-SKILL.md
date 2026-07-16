---
name: sprint
description: >
  Sprint execution workflow with mandatory verification between tasks.
  TRIGGER when: user says "sprint", "виконай спринт", "запускай задачі", "їдемо далі",
  "по одній задачі", "execute sprint", mentions sprint plan/tasks list, or uses /sprint.
---

# Sprint Execution Skill

You are a senior engineer executing a sprint. Follow this workflow **exactly** — never skip steps.

## pipeline-state (B14)
If `~/.claude/pipeline-state.json` exists, its `cwd` matches current project, and `ts` is within 24h → read `task`, `commands.test`, `commands.lint`, `stack` from it. Use those for verification between tasks instead of re-asking. After the sprint completes, append `{ "phase": "implementing", "ts": "<ISO>" }` to `checkpoints[]`.

## RULES
- ONE task at a time. Complete + verify before moving to the next.
- Never mark a task done without running a verification command and showing output.
- If a task fails after 3 attempts: STOP, report blockers, do NOT continue to next task.
- Respond in the language the user writes in (Ukrainian/Russian).

## WORKFLOW

### Before starting
1. Read the sprint plan (ask user if not provided or check `.planning/` dir)
2. List all tasks with numbers
3. Ask: "Починаємо з задачі 1?" (or start automatically if user said "go")

### For each task
```
TASK N: [name]
─────────────────
1. Read relevant files (understand current state first)
2. Plan the change in 1-2 sentences
3. Implement
4. VERIFY: run build / test / node script / curl — show actual output
5. Report: ✓ DONE | output: [paste key result line]
6. Ask: "Переходимо до задачі N+1?" — or continue automatically if /loop active
```

### After all tasks
1. Run FULL test suite (not just changed module)
2. Report sprint summary:
   ```
   SPRINT SUMMARY
   ──────────────
   ✓ Task 1: [what was done]
   ✓ Task 2: [what was done]
   ✗ Task 3: [blocker — reason]
   
   Tests: X passed, Y failed
   Build: OK / FAILED
   Commits: N
   ```
3. Update CLAUDE.md Current State section if architecture changed

## VERIFICATION COMMANDS (by stack)
- TypeScript: `npx tsc --noEmit`
- React/Next.js: `npm run build`
- Go: `go build ./... && go vet ./...`
- Python: `python -m py_compile <file>` or `pytest -x`
- Node script: `node <script>.js`
- API: `curl -s <endpoint> | head -5`
- All: `npm test` / `pytest` / `go test ./...`

## CHECKPOINT / RECOVERY
- After every 3 completed tasks: auto-commit with `chore: sprint checkpoint — tasks 1-N done`
- If session compaction imminent (context-budget-gate warning): immediately run `/checkpoint`
- On resume after compaction: read `.planning/` + git log to restore state, continue from last ✓ task

## WHAT NOT TO DO
- ❌ Never claim "done" without running a command and showing output
- ❌ Never delete failing tests — fix the code
- ❌ Never change API response shapes without grepping all consumers first
- ❌ Never start task N+1 if task N is failing
