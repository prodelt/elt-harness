## Checkpoint - 2026-06-17 (Phase 2 Sprint 3)

### Build Status
- Compiles: not applicable (Node.js scripts, no build step)
- Lint: not configured for ~/.amos or ~/.claude/hooks
- Type check: not run (JS, no TS)

### Test Metrics
- `~/.claude/hooks/test-all-hooks.js`: 38/38 PASS (was 36 — +2 new hooks: `checkpoint-edit-tracker.js`, `checkpoint-nudge-gate.js`)
- `~/.claude/hooks/test-hooks-behavior.js`: 58/58 PASS (was 52 — +6 behavioral cases: below-threshold silence, tier1 nudge, tier2 critical nudge, skip-without-reason denied, skip-with-reason honored, `/checkpoint` reset)
- New tests this sprint: 8 total (2 sanity registrations + 6 behavioral cases)

### Code Modifications Since Last Checkpoint
- Files created: `~/.claude/hooks/lib/checkpoint-state.js` (shared state module), `~/.claude/hooks/checkpoint-edit-tracker.js` (PostToolUse Edit|Write), `~/.claude/hooks/checkpoint-nudge-gate.js` (UserPromptSubmit)
- Files modified: `~/.claude/hooks/lib/config.js` (+`checkpointNudge` defaults), `~/.claude/hooks/config.json` (+`checkpointNudge` block), `~/.claude/settings.json` (wired both new hooks into existing `UserPromptSubmit` / `PostToolUse Edit|Write` groups), `~/.claude/hooks/test-all-hooks.js` (+2 registrations, +1 tmp-dir cleanup), `~/.claude/hooks/test-hooks-behavior.js` (+6 behavioral tests)
- Files deleted: none persisted (one disposable demo driver script `.sprint3-demo.js`, created to run the live-fire proof in a single Node process, deleted after capturing output; two stray artifacts from an earlier Windows-path-mangling mistake during manual testing — `UsersespadAppDataLocalTemp...json` in both `~/.claude/hooks/` and this repo's root — also cleaned up)
- Lines added/removed: ~/.claude/hooks +~230/-0 (new files) + small edits to 5 existing files; this repo: docs-only (roadmap + this checkpoint)

### Git State
- **Pipiline setupper** (this repo) — Branch: `feature/doc-hygiene-phase2`, uncommitted: `.planning/ROADMAP-AMOS-PHASE2-2026-06-17.md` (Sprint 3 closure notes) + pre-existing `.planning/handoffs/3fbbd78d-...yaml` (untouched this session, was already modified before this session started)
- **~/.claude** — uncommitted: `hooks/lib/checkpoint-state.js`, `hooks/checkpoint-edit-tracker.js`, `hooks/checkpoint-nudge-gate.js` (new), `hooks/lib/config.js`, `hooks/config.json`, `settings.json`, `hooks/test-all-hooks.js`, `hooks/test-hooks-behavior.js` (modified) — not committed; many other unrelated pre-existing untracked/modified files in `~/.claude` left untouched (out of scope, same as prior sprints)
- **~/.amos** — untouched this sprint (used existing `logPolicyEvent`/`initDb` from Sprint 5, no new AMOS code needed)

### Completed Tasks
- Sprint 3 (enforcement `/checkpoint`: edit-count/time threshold → nudge → reason-required skip) — Claude
  - Built `checkpoint-edit-tracker.js` + `checkpoint-nudge-gate.js`, mirroring `verification-tracker.js`'s state-file pattern and `ship-gate.js`'s skip-with-reason bypass.
  - Threshold: 15 edits or 60 minutes since last `/checkpoint` → tier1 advisory nudge via `additionalContext`. 2x threshold (30 edits / 120 min) → critical nudge; suppressing it requires a skip file with a non-empty `reason` (consumed once, 1h validity — same shape as ship-gate's skip file). A reason-less skip attempt is denied (logged, nudge persists). Explicit `/checkpoint` in the prompt resets the counter and logged-tier flags, staying silent. The hook never returns `decision:block` — only `additionalContext` — so the user's prompt always goes through, per roadmap's "не hard-block работу" requirement.
  - Live-fire proof (separate from the unit tests, run as a single Node process using nested `spawnSync` to avoid a Bash-tool sandboxing pitfall — see below): drove 15 real Edit-tool events through the tracker → tier1 nudge fired with the literal text "CHECKPOINT: 15 edits / 0 мин без /checkpoint...". Drove 15 more (30 total) → critical nudge fired ("...КРИТИЧНО... 2x порога..."). Wrote a skip file with no `reason` → denied (nudge persisted, file consumed). Wrote a skip file with a `reason` → honored (silent, file consumed). Sent `/checkpoint` as the next prompt → state reset to 0 edits.
  - Verified real `policy_events` rows via `amos policy --since 1d`: `checkpoint-nudge-tier1`, `checkpoint-nudge-critical`, `checkpoint-nudge-skip-denied` ("no reason given"), `checkpoint-nudge-skip-override` (with the actual reason text) — also visible in the `amos doctor` Policy Events summary block.
  - Incidental find, recorded as a feedback memory: chaining multiple independent `node -e` invocations in one Bash-tool command line does not share filesystem state reliably (sibling process spawns, not nested) — one invocation's `writeFileSync` was invisible (`ENOENT`) to the very next `node -e` read in the same `;`-chained line. Separately, interpolating a Windows backslash path into a `node -e` argument got mangled by Git Bash into a bareword filename, creating two garbage artifact files (cleaned up). Fix used here and recorded for future hook live-fire demos: do it as one Node script using `spawnSync` internally (same pattern as `test-hooks-behavior.js`'s `runHook()`), never a chain of standalone `node -e` calls.

### Remaining Work
- Sprint 4 remainder (PreCompact hook for Claude; session-length ≥6h detector in SessionStart focus hint) — unowned
- Sprint 6 (codegraph/graphify-only read-gate mirrored to Codex/Gemini; graph integrity checks; codegraph-vs-Read honesty metric in harvest) — unowned
- Manual doc-bloat trim (фузи музи 329, Mammoth, Sys admin BOT, Izi_logist, fasoli, bot_reclamaties) — unowned, flagged by `/doc-hygiene` audit-all, not yet fixed
- Mammoth CLAUDE.md/AGENTS.md `init` overwrite from a prior session — still needs manual `git revert` review (not touched this session)
- New hook files in `~/.claude` not yet committed — pending user decision (see Next Steps)

### Blockers
- None. All escape valves and tests green. No commit made this session (global instruction: never commit without explicit user ask) — awaiting user confirmation to commit the `~/.claude` hook changes.

### Cost Snapshot (AMOS)
- claude/claude-opus-4-8: dominant model over the last 7d (per prior checkpoints)
- claude/claude-sonnet-4-6: this session's model
- `amos doctor` Policy Events (last 1d) now includes 4 new kinds from this sprint: `checkpoint-nudge-critical` (6), `checkpoint-nudge-tier1` (4), `checkpoint-nudge-skip-override` (3), `checkpoint-nudge-skip-denied` (3)

### Next Steps
1. Ask user whether to commit the `~/.claude` hook changes (new files + settings.json wiring + test suite updates) — this repo's `.planning` doc update can be committed together with or separately from the `~/.claude` commit, per user preference.
2. Start a NEW session for Sprint 4 remainder (PreCompact hook + ≥6h detector), then Sprint 6, one sprint per session (do not repeat the 12.9h overrun).

### Resume Pointer
- Focus: AMOS Phase 2 roadmap, Sprint 4 remainder — add a PreCompact hook (Claude-only) that auto-generates a handoff before compaction even without a following user prompt, and a ≥6h session-duration detector reinforcing "1 цель = 1 сессия" in the SessionStart focus hint.
- Resume: read `.planning/ROADMAP-AMOS-PHASE2-2026-06-17.md` Sprint 4 section, then this checkpoint file, then proceed.
