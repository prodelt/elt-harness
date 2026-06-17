## Checkpoint - 2026-06-17 (Phase 2 Sprint 6 — closed)

### Build Status
- Compiles: not applicable (Node.js scripts, no build step)
- Lint: not configured for `~/.amos` or `~/.claude/hooks`
- Type check: not run (JS, no TS)

### Test Metrics
- `~/.amos/tests/graph.test.js`: 17/17 PASS (was 12 — +5: `verifyGraph` missing/ok/stale/
  contaminated/error)
- `~/.claude/hooks/test-all-hooks.js`: 39/39 PASS (unchanged — no new hook files this sprint)
- `~/.claude/hooks/test-hooks-behavior.js`: 64/64 PASS (was 62 — +2: BLOCK `graphify claude
  install`, ALLOW `graphify update .`)
- `~/.codex/test-codex-hooks.js`: 46/46 PASS (re-run after shared `secret-scanner.js` edit —
  confirms the Codex-side contract still holds)

### Code Modifications Since Last Checkpoint
- Files created: none
- Files modified:
  - `~/.amos/lib/graph.js` (+`verifyGraph()`), `~/.amos/bin/amos.js` (+`verify` branch in
    `handleGraph()`, +stale/contaminated check in the SessionStart hint builder),
    `~/.amos/tests/graph.test.js` (+5 tests)
  - `~/.claude/hooks/secret-scanner.js` (+unconditional `graphify claude install` deny check),
    `~/.claude/hooks/test-hooks-behavior.js` (+2 behavioral tests)
  - `~/.claude/skills/session-harvest/harvest.js` (+`codegraphCalls`/`rawReadCalls` counters,
    +`honestyLine()` helper, surfaced in both per-project and aggregate render functions) — this
    file auto-mirrors to `~/.codex/skills` and `~/.gemini/skills` via the existing
    `skill-sync-mirror.js` PostToolUse hook, so no manual sync needed there
  - `~/.gemini/hooks/codegraph-read-gate.js` (new copy, mirrored from `~/.claude/hooks/`),
    `~/.gemini/settings.json` (PreToolUse/Read hook now points at `codegraph-read-gate.js`
    instead of the legacy `graphify-read-gate.js`)
- Files deleted: none (legacy `graphify-read-gate.js` left in place, unwired, in both
  `~/.claude/hooks` and `~/.gemini/hooks` — matches existing precedent)
- Lines added/removed: small, surgical edits across 3 global config repos; this repo: docs-only
  (roadmap update + this checkpoint)

### Git State
- **Pipiline setupper** (this repo) — Branch: `feature/doc-hygiene-phase2`, uncommitted:
  `.planning/ROADMAP-AMOS-PHASE2-2026-06-17.md` (Sprint 6 closure notes) + this checkpoint file
- **~/.claude** — uncommitted: `hooks/secret-scanner.js`, `hooks/test-hooks-behavior.js`,
  `skills/session-harvest/harvest.js` (modified) — not committed; many other unrelated
  pre-existing untracked/modified files left untouched (out of scope, same as prior sprints)
- **~/.amos** — uncommitted: `lib/graph.js`, `bin/amos.js`, `tests/graph.test.js` (modified)
- **~/.gemini** — uncommitted: `settings.json` (modified), `hooks/codegraph-read-gate.js` (new) —
  this dir is not a git repo in this setup (no `.git` found), so "committing" it isn't
  applicable the way it is for `~/.claude`/`~/.amos`/this repo

### Completed Tasks
- Sprint 6 (codegraph/graphify-only enforcement + graph integrity) — Claude
  - Investigated the roadmap's 4 assumed gaps before writing any code (Facts Over Guesses) and
    found 2 of them already closed: Codex's `codegraph-read-gate.js` mirror was already wired
    and passing its own test harness; Antigravity (the real "Gemini" client for this project,
    per `GEMINI.md`) inherits the gate for free by reading `~/.claude/settings.json` directly.
    Synced the stale `~/.gemini/hooks` mirror anyway per user's explicit choice, belt-and-suspenders.
  - Built `amos graph verify` using the real `codegraph status --json` / `codegraph files --json
    --format flat` CLI shapes (confirmed by running them against this project before coding, not
    assumed) — detects stale (pendingChanges nonzero) and contaminated (node_modules/vendor/dist
    in the index) graphs, wired into both a new CLI subcommand and the existing SessionStart hint.
  - Closed the gap where `graphify claude install` was documented as forbidden in `CLAUDE.md` but
    never actually enforced — added an unconditional (not just `/careful`-mode) deny check to the
    already-shared `secret-scanner.js`, so both Claude and Codex get it from one edit.
  - Added a codegraph-vs-Read/Grep honesty counter to `harvest.js`, surfaced per-session and
    aggregated per-project.
  - Live-fire proof for all three real pieces (not just unit tests): `amos graph verify` against
    this real project → "OK, 213 files indexed, fresh, clean"; a direct stdin run of
    `secret-scanner.js` with the forbidden command → real `permissionDecision: "deny"` JSON
    (notably, my own *outer* Bash tool call got caught by this same live gate when its text
    literally contained the forbidden phrase — had to route the test through a saved script file
    instead, which is itself proof the gate is active in this very session); a real `harvest.js`
    run against actual transcripts → this project's own last-session line read `codegraph: 0 vs
    Read/Grep: 44 — ⚠ используй codegraph_context вместо Read/Grep`, honestly catching that this
    very session itself fell into the anti-pattern Sprint 6 targets.

### Remaining Work
- None tracked from the Phase 2 roadmap — Sprints 1, 2, 3, 4, 5, 6 are all now closed (Sprint 1
  doc-hygiene, Sprint 5 policy_events were closed in earlier sessions per memory).
- Manual doc-bloat trim (фузи музи 329, Mammoth, Sys admin BOT, Izi_logist, fasoli,
  bot_reclamaties) — unowned, flagged by `/doc-hygiene` audit-all, carried over from earlier
  checkpoints, still not fixed
- Mammoth CLAUDE.md/AGENTS.md `init` overwrite from a prior session — still needs manual `git
  revert` review, carried over, not touched this session
- New/modified files in `~/.claude`, `~/.amos`, `~/.gemini` not yet committed — pending user
  decision (see Next Steps)

### Blockers
- None. All tests green. No commit made yet for Sprint 6's changes (global instruction: never
  commit without explicit user ask) — awaiting confirmation, same as Sprint 4 was committed
  earlier this session after explicit approval.

### Cost Snapshot (AMOS)
- Not separately tracked this sprint — no new `policy_events` kind introduced (the new
  `secret-scanner` deny path reuses the hook's existing `metrics.inc`/`logger.warn`, doesn't add
  an AMOS policy_event kind; could be added later if this gate needs the same observability
  treatment as Sprint 5's gates)

### Next Steps
1. Ask user whether to commit Sprint 6's changes across `~/.claude`, `~/.amos`, and `~/.gemini`
   (3 separate repos/dirs — `~/.gemini` has no `.git` so nothing to commit there, just the file
   changes already on disk), plus this repo's roadmap/checkpoint docs.
2. With all 6 Phase 2 sprints closed, the next step is either a fresh roadmap pass (re-audit the
   system the way the 2026-06-15/17 audits did) or returning to the carried-over doc-bloat /
   Mammoth cleanup items above.

### Resume Pointer
- Focus: Phase 2 roadmap fully closed (Sprints 1-6). Carried-over cleanup items: doc-bloat trim
  across several projects, Mammoth CLAUDE.md/AGENTS.md revert review.
- Resume: read `.planning/ROADMAP-AMOS-PHASE2-2026-06-17.md` (now fully closed) for the complete
  history, then decide between a new audit pass or the carried-over cleanup backlog above.
