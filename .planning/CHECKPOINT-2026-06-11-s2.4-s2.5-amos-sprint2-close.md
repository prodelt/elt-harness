# Checkpoint — 2026-06-11 (AMOS Sprint 2 — S2.4 + S2.5 — Sprint 2 CLOSED)

## Build Status
- Compiles: yes (Node.js v24.14.0, node:sqlite — `~/.amos`)
- Lint: not configured
- Type check: not run (JS project)

## Test Metrics
- `~/.amos` (`node --test tests/amos.test.js tests/db.test.js tests/doctor-hooks.test.js`): **77/77 PASS**
  (was 73/73 at S2.3; +4 new Stop-wiring doctor tests)
- `node ~/.claude/hooks/test-all-hooks.js`: 35/35 PASS (unchanged)
- `node ~/.codex/test-codex-hooks.js`: **48/48 PASS** (was 46/48 — fixed, see below)
- `node ~/.claude/hooks/test-hooks-behavior.js`: 44/44 PASS (unchanged)
- `node tools/doctor.js`: 38 checks, 0 FAIL (pre-existing WARNs only: stale harness/git-audit reports, unrelated)

## Code Modifications Since Last Checkpoint (S2.3, 2026-06-10)

### S2.4 — Stop hook wiring
- `~/.amos/bin/amos.js`:
  - `checkAmosHook(client, label)` → `checkAmosHook(client, label, hookEvent, amosEventArg)` —
    generalized to check any `hooks.<hookEvent>` group for `amos.js ... <amosEventArg>`.
  - `handleDoctor()` now runs 6 checks: SessionStart × {Claude,Codex,Gemini} +
    Stop × {Claude,Codex,Gemini}.
- `~/.amos/tests/doctor-hooks.test.js`: +4 tests (S2.4) — INFO/PASS/WARN/malformed for Stop wiring.
- `~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.gemini/settings.json`:
  added `node .../.amos/bin/amos.js event stop` as the last entry in the `Stop` hooks group
  (additive; v3 hooks otherwise untouched).
- Synced to Pipeline Setupper `amos/` mirror: `amos/bin/amos.js`, `amos/tests/doctor-hooks.test.js`.

### Old-system retirement (per user request — AMOS supersedes)
- Removed `stop-auto-checkpoint.js` from the `Stop` hook group in all 3 clients
  (`~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.gemini/settings.json`).
  Its job (write a session-end handoff) is now done by `amos event stop`
  (SQLite `handoffs` table + `.planning/handoffs/<sessionId>.yaml`, ≤1.5KB on resume
  vs. multi-KB freeform `CHECKPOINT-*.md` files). Hook *file* left in place
  (not deleted), just unwired — consistent with v3-legacy archival convention.

### Test-harness fix
- `~/.codex/test-codex-hooks.js`: the dynamic hook-row builder did
  `path.basename(command.split(' ').pop())`, which breaks for multi-arg commands
  like `node <amos.js> event stop` (it took the last *token*, `stop`/`session-start`,
  as the filename → `MISSING`). Fixed: detect `amos.js` in the command, resolve its
  absolute path directly, and pass the trailing `event <name>` args to the spawned
  process. `amos.js event stop` is also now treated as a decision-format hook
  (`{decision,reason}`), like `stop-verification.js`/`ship-gate.js`.
  Result: 46/48 → 48/48. (Not a git-tracked file — `~/.codex` is not a repo.)

## Git State
- `~/.amos`: branch `feature/amos-sprint2-continuity`, commit `787b8db`
  (S2.4 Stop hook wiring, 77/77 tests)
- Pipeline Setupper: branch `amos/sprint1-kernel`, commit `29a6903`
  (sync S2.4 core copies)
- `~/.claude` (master): `settings.json` has the S2.3+S2.4 AMOS hook edits, but
  remains **uncommitted** — it's mixed with pre-existing unrelated uncommitted
  changes (model setting, plugin/marketplace toggles, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`,
  and a **plaintext `GITHUB_PERSONAL_ACCESS_TOKEN`** in `env`). Flagged again for
  separate user cleanup before committing — do not bundle a secret into a commit.
- `~/.codex`, `~/.gemini`: not git repos, files edited directly.

## E2E Proof — S2.5 Cross-Client Resume (2026-06-11)
Simulated `amos event stop` (as Claude Code's new Stop hook would emit) in this
project with `session_id=e2e-claude-2026-06-11`, `task`, `phase`, `changed_files`,
`open_steps`. Result:
1. `.planning/handoffs/e2e-claude-2026-06-11.yaml` written (YAML mirror).
2. `amos status --markdown` (run as any client's status check) shows the task/phase/
   open steps from the handoff — proves the data is readable from the shared
   `~/.amos/state.sqlite`, independent of which client wrote it.
3. `amos resume e2e-claude-2026-06-11` emits a 600-byte
   `{hookSpecificOutput:{additionalContext:...}}` JSON (well under the 1.5KB budget) —
   this is exactly what a Codex/Gemini `SessionStart` hook would receive to resume
   the session Claude left off.

Full transcript captured in this session's tool output (amos.js event stop →
amos status --markdown → amos resume → cat .planning/handoffs/*.yaml).

## Acceptance Criteria — Sprint 2 (PROMPT-SPRINT-2-AMOS.md) — ALL MET
- [x] `amos event stop` writes handoff to SQLite + `.planning/handoffs/X.yaml` (S2.1, re-verified)
- [x] `amos resume X` → ≤1.5KB JSON additionalContext (S2.1, re-verified ~600B)
- [x] `amos status --markdown` → ≤2KB portable snapshot (S2.2, re-verified)
- [x] SessionStart (Claude/Codex/Gemini) → `amos event session-start` (S2.3)
- [x] Stop (Claude/Codex/Gemini) → `amos event stop` (S2.4, new)
- [x] E2E: handoff written → read back cross-client via shared store (S2.5, new)
- [x] Tests ≥55, all PASS → 77/77
- [x] `amos doctor` → SessionStart + Stop hooks PASS for Claude/Codex/Gemini (6/6)

**Sprint 2 (S2.1–S2.5) is CLOSED.**

## Completed Tasks (this session)
1. Generalized `amos doctor`/`checkAmosHook` for SessionStart + Stop wiring checks
2. Added 4 Stop-wiring doctor tests (77/77 total)
3. Wired `amos event stop` into Stop hooks for Claude/Codex/Gemini
4. Removed `stop-auto-checkpoint.js` from all 3 clients (superseded by AMOS handoff)
5. Ran E2E cross-client resume proof
6. Fixed `test-codex-hooks.js` multi-arg-command bug (46/48 → 48/48)
7. Synced `amos/` mirror, committed `~/.amos` (787b8db) and Pipeline Setupper (29a6903)
8. `node tools/doctor.js`: 0 FAIL

## Remaining Work / Next Sprint
- **Sprint 3** (per `.planning/ARCHITECTURE-2026-06-10-amos-agent-mini-os.md`): Tool Policy Gate —
  unified PreToolUse gate via `policy.json` (Context7→CLI, browser→agent-browser,
  chrome MCP→deny), `amos doctor browser` with agent-browser auto-repair.
- Old 4 stray `.planning/CHECKPOINT-*.md` files (2026-05-29/05-30/06-10, untracked)
  are now historical only — `amos event stop` + `.planning/handoffs/` is the live
  continuity mechanism going forward. Can be archived/removed in a future cleanup.
- `~/.claude/settings.json` GITHUB_PERSONAL_ACCESS_TOKEN — needs separate secret
  rotation/cleanup before any commit of that file.

## Blockers
- None
