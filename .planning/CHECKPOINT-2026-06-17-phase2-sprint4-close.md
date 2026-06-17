## Checkpoint - 2026-06-17 (Phase 2 Sprint 4 — closed)

### Build Status
- Compiles: not applicable (Node.js scripts, no build step)
- Lint: not configured for `~/.amos` or `~/.claude/hooks`
- Type check: not run (JS, no TS)

### Test Metrics
- `~/.claude/hooks/test-all-hooks.js`: 39/39 PASS (was 38 — +1: `precompact-handoff.js`)
- `~/.claude/hooks/test-hooks-behavior.js`: 62/62 PASS (was 58 — +4 behavioral cases:
  precompact manual trigger, precompact auto trigger, long-session warning at 7h, no warning at 2h)
- New tests this sprint: 5 total (1 sanity registration + 4 behavioral cases)

### Code Modifications Since Last Checkpoint
- Files created: `~/.claude/hooks/precompact-handoff.js` (new PreCompact hook)
- Files modified: `~/.claude/hooks/lib/config.js` (+`sessionFocus` defaults), `~/.claude/settings.json`
  (+`PreCompact` hook group), `~/.claude/hooks/session-focus-gate.js` (+`sessionDurationHours`,
  `findPreviousSessionDuration`, `respond()`/`main()` now thread `prevDurationHours`),
  `~/.claude/hooks/test-all-hooks.js` (+1 mock + registration), `~/.claude/hooks/test-hooks-behavior.js`
  (+4 behavioral tests)
- Files deleted: none
- Lines added/removed: `~/.claude/hooks` +~150/-4 (new file + small edits to 4 existing files); this
  repo: docs-only (roadmap update + this checkpoint)

### Git State
- **Pipiline setupper** (this repo) — Branch: `feature/doc-hygiene-phase2`, uncommitted:
  `.planning/ROADMAP-AMOS-PHASE2-2026-06-17.md` (Sprint 4 closure notes) + this checkpoint file +
  pre-existing `.planning/handoffs/3fbbd78d-...yaml` / `43165529-...yaml` (untouched this session)
- **~/.claude** — uncommitted: `hooks/precompact-handoff.js` (new), `hooks/lib/config.js`,
  `settings.json`, `hooks/session-focus-gate.js`, `hooks/test-all-hooks.js`,
  `hooks/test-hooks-behavior.js` (modified) — not committed; many other unrelated pre-existing
  untracked/modified files in `~/.claude` left untouched (out of scope, same as prior sprints)
- **~/.amos** — untouched this sprint (reused existing `logPolicyEvent`/`initDb` from Sprint 5)

### Completed Tasks
- Sprint 4 remainder (PreCompact hook + ≥6h session-length detector) — Claude
  - `precompact-handoff.js`, modeled on `stop-auto-checkpoint.js`'s fail-soft/silent-stdout
    style: reads `{session_id, transcript_path, cwd, trigger}` from stdin, writes a Markdown
    briefing (branch, HEAD, git status, current focus goal from `claude-session-focus/goal.json`)
    to `~/.claude/auto-checkpoints/precompact-<ts>.md`, logs `policy_events`
    (`precompact-handoff`, detail = trigger). Wired into `settings.json` as a new `PreCompact`
    hook group — Claude-only by design (Codex/Gemini don't get this one, per roadmap).
  - `session-focus-gate.js`: `findPreviousSessionDuration()` resolves the project's transcript
    dir the same way `appendFocusHistory` already does, picks the most-recently-modified
    `*.jsonl` that isn't the current session, computes the timestamp spread in hours. When
    `>= cfg.sessionFocus.longSessionHours` (default 6), the `SESSION FOCUS` hint gets an extra
    sentence: "⚠ Прошлая сессия длилась Nч — держи фокус строго на ОДНОЙ цели."
  - Live-fire proof (separate from the unit tests, real stdin subprocess calls against this
    project's actual cwd — same rigor as Sprint 3's proof): ran `precompact-handoff.js` with
    `trigger: 'manual'` against the real repo cwd → wrote
    `precompact-2026-06-17T09-09-14-731Z.md` containing the real branch
    (`feature/doc-hygiene-phase2`), real last commit, and real `git status --short` output;
    `amos policy --since 1d` showed the real row `precompact-handoff  manual` (4 total events
    incl. the test-suite's own manual/auto runs). Ran `session-focus-gate.js` directly against
    the real cwd (no fixture) to confirm zero regression — plain hint, no warning, since the
    real previous session wasn't long enough to trip the threshold.

### Remaining Work
- Sprint 6 (codegraph/graphify-only read-gate mirrored to Codex/Gemini; graph integrity checks;
  codegraph-vs-Read honesty metric in harvest) — unowned, next up per roadmap order
- Manual doc-bloat trim (фузи музи 329, Mammoth, Sys admin BOT, Izi_logist, fasoli, bot_reclamaties)
  — unowned, flagged by `/doc-hygiene` audit-all, not yet fixed (carried over from Sprint 3 checkpoint)
- Mammoth CLAUDE.md/AGENTS.md `init` overwrite from a prior session — still needs manual `git
  revert` review (carried over, not touched this session)
- New/modified hook files in `~/.claude` not yet committed — pending user decision (see Next Steps)

### Blockers
- None. All tests green. No commit made this session (global instruction: never commit without
  explicit user ask) — awaiting user confirmation to commit the `~/.claude` hook changes and/or
  this repo's roadmap update.

### Cost Snapshot (AMOS)
- `amos policy --since 1d` now includes `precompact-handoff` (4 events) as a new kind this sprint

### Next Steps
1. Ask user whether to commit the `~/.claude` hook changes (new file + settings.json wiring +
   config.js + test suite updates) and this repo's `.planning` doc updates.
2. Start Sprint 6 (codegraph/graphify-only enforcement — read-gate mirrored to Codex/Gemini,
   graph integrity checks, codegraph-vs-Read honesty metric) — larger scope, touches Codex
   hooks too; scope it as its own plan before implementing, per the project's "план до кода"
   rule for 3+ files.

### Resume Pointer
- Focus: AMOS Phase 2 roadmap, Sprint 6 — mirror the codegraph/graphify read-gate to Codex and
  Gemini, verify graph integrity (`.codegraph/` freshness, no `node_modules` in the index), and
  add a codegraph-vs-Read honesty metric to harvest.
- Resume: read `.planning/ROADMAP-AMOS-PHASE2-2026-06-17.md` Sprint 6 section, then this
  checkpoint file, then proceed.
