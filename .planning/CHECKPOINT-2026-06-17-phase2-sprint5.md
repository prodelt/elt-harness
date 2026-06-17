## Checkpoint - 2026-06-17 11:30

### Build Status
- Compiles: not applicable (Node.js scripts, no build step)
- Lint: not configured for ~/.amos or ~/.claude/hooks
- Type check: not run (JS, no TS)

### Test Metrics
- Total: 238 (amos) + 36 (hooks-all) + 52 (hooks-behavior) = 326
- Passed: 326 | Failed: 0 | Skipped: 0
- Coverage: not measured
- New tests this sprint: 4 (`tests/policy.test.js`: `getPolicyEventsSummary` ×2, `amos policy` CLI ×2)

### Code Modifications Since Last Checkpoint
- Files created: `~/.claude/hooks/config-protection.js`, `project-docs-gate.js`, `ship-gate.js`, `stop-auto-checkpoint.js` (existed on disk, newly tracked in git — pre-existing gap, not new functionality), `~/.amos/tests/s1-model-cost.test.js` (carried over from a prior uncommitted session)
- Files modified: `~/.amos/lib/db.js` (+`getPolicyEventsSummary`, +S1 `migrateSchema`/project+kind cost split), `~/.amos/bin/amos.js` (+`amos policy` command, +policy summary in `amos doctor`), `~/.amos/tests/policy.test.js` (+4 tests), `~/.claude/hooks/plan-enforcement-gate.js`, `config-protection.js`, `project-docs-gate.js`, `ship-gate.js`, `stop-auto-checkpoint.js` (all now call `logPolicyEvent` on fire/block)
- Files deleted: none
- Lines added/removed: ~/.amos +410/-21 (1 commit); ~/.claude/hooks +675/-0 (1 commit, mostly newly-tracked pre-existing files)

### Git State
- **Pipiline setupper** (this repo) — Branch: `feature/doc-hygiene-phase2`, uncommitted: 1 modified + 2 untracked (`.planning/` roadmap + handoffs, pre-existing from prior session, untouched this session)
- **~/.amos** — last commit `67dbe1f feat(amos): S1 cost/model-policy honesty + S5 policy_events observability`, clean
- **~/.claude** — last commit `5f0ecf6 feat(hooks): wire policy_events logging into previously-silent gates`, clean (167 unrelated pre-existing modified/untracked files left untouched — not part of this sprint's scope)

### Completed Tasks
- Sprint 5 (policy_events observability) — Claude
  - `getPolicyEventsSummary(opts)` in `~/.amos/lib/db.js`: groups `policy_events` by `kind` within a `--since` window, plus a `recent` tail
  - `amos policy [--since 1d|7d] [--json]` CLI command + one-line summary block added to `amos doctor`
  - Wired `logPolicyEvent` into 5 previously-silent Claude hooks: `plan-enforcement-gate`, `config-protection`, `project-docs-gate` (no-docs hard block + stack-conflict warning), `ship-gate` (the hard block itself, not just skip-override/denied which already logged), `stop-auto-checkpoint` (checkpoint-skip)
  - Proven end-to-end: synthetic `config-protection` block on `eslint.config.mjs` produced a real row, visible via both `amos policy --since 1d` and `amos doctor`
- Incidentally closed: Sprint 1 phase-1 roadmap leftover (`evaluateMainModel` F5, `cost_ledger` project/kind columns) — found uncommitted in `~/.amos` from a prior session, tests were already green (238/238), committed together with Sprint 5 since both touch `lib/db.js`/`bin/amos.js` and splitting via `git add -p` was impractical (user confirmed: one commit)

### Remaining Work
- Sprint 2 (боевой тест субагентов: forced backend/devops subagent run → verify-gate HARD BLOCK proof) — unowned
- Sprint 3 (enforcement `/checkpoint`: edit-count/time threshold → nudge → reason-required skip) — unowned
- Sprint 4 remainder (PreCompact hook for Claude; session-length ≥6h detector in SessionStart focus hint) — unowned
- Sprint 6 (codegraph/graphify-only read-gate mirrored to Codex/Gemini; graph integrity checks; codegraph-vs-Read honesty metric in harvest) — unowned
- Manual doc-bloat trim (фузи музи 329, Mammoth, Sys admin BOT, Izi_logist, fasoli, bot_reclamaties) — unowned, flagged by `/doc-hygiene` audit-all, not yet fixed
- Mammoth CLAUDE.md/AGENTS.md `init` overwrite from a prior session — still needs manual `git revert` review (not touched this session)

### Blockers
- None. All escape valves and tests green.

### Cost Snapshot (AMOS)
- claude/claude-opus-4-8: output=2891932 fresh_input=14082685 (last 7d, dominant model)
- claude/claude-sonnet-4-6: output=132458 fresh_input=895379 (this session's model)
- Origin: main=16 rows / sub=3 rows (`amos cost`)
- Evolvable instincts: 0 (`amos evolve`, confidence>=0.8 — none cleared the bar yet)

### Next Steps
1. Start a NEW session for Sprint 2 (боевой тест субагентов) — first in dependency order per roadmap, validates Sprint 0's `subagent-verify-gate` actually fires under a real multi-file task routed through `backend`/`devops` subagents.
2. After Sprint 2, proceed Sprint 3 → Sprint 4 remainder → Sprint 6, one sprint per session (do not repeat the 12.9h overrun).

### Resume Pointer
- Focus: AMOS Phase 2 roadmap, Sprint 2 — force a real backend/devops subagent run that edits code without a follow-up test/reviewer, and confirm `subagent-verify-gate` HARD BLOCKs with a `policy_events` row (use `amos policy --since 1d` to verify, now that Sprint 5 makes this observable).
- Resume: read `.planning/ROADMAP-AMOS-PHASE2-2026-06-17.md` Sprint 2 section, then read this checkpoint file, then proceed.
