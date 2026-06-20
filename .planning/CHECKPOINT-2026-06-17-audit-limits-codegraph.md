## Checkpoint - 2026-06-17 (audit + B/C/D)

### Build Status
- Compiles: not applicable (Node.js hooks/scripts)
- Lint: not configured for ~/.claude/hooks
- Type check: not run (JS)

### Test Metrics
- `~/.claude/hooks/test-all-hooks.js`: 39/39 PASS
- `~/.claude/hooks/test-hooks-behavior.js`: 68/68 PASS (+4 new codegraph-bash-gate cases)
- `~/.codex/test-codex-hooks.js`: 47/47 PASS (+1, auto-detected new bash gate)
- New tests this session: 4 (codegraph-bash-gate block/allow/escape/no-index)

### Code Modifications Since Last Checkpoint (all in ~/.claude + ~/.codex, NOT this repo)
- Created: `~/.claude/hooks/codegraph-bash-gate.js`
- Modified: `~/.claude/hooks/config.json` (contextBudget model-aware + codegraphBashGate),
  `~/.claude/hooks/context-budget-gate.js` (model-aware limit, pct-only critical),
  `~/.claude/hooks/test-hooks-behavior.js`, `~/.claude/settings.json` (Bash chain),
  `~/.codex/hooks.json` (mirror, codex not git)
- Deleted: probe `tools/_verify_probe.js` (verify-gate live-fire, cleaned), stray skip-file artifact

### Git State
- This repo (Pipiline setupper): branch `feature/doc-hygiene-phase2`, last `0b5deb1`. Uncommitted = pre-existing .planning/*.yaml/.md handoffs only (auto-generated, not this session's edits) — untouched.
- ~/.claude: branch `chore/ai-os-healing`, 2 new commits — `f8beef7` (B1 model-aware limit), `2eb6187` (C bash dump gate). Other pre-existing uncommitted hooks left untouched (not mine).

### Completed Tasks
- Аудит Phase 2 (тесты 39/68/47 зелёные, policy_events живые) — Claude
- B1 model-aware token limit (окна измерены: opus 616k / sonnet 335k → 1M; haiku 200k) — Claude — committed f8beef7
- C codegraph-bash-gate (cat/type dump block, closes read-gate bypass) — Claude — committed 2eb6187, codex mirrored
- D Morion-auto reindex 155MB→0.64MB (delete .codegraph + init -i; force does NOT VACUUM) — Claude
- E memory + checkpoint — Claude

### Remaining Work
- Doc-bloat cleanup (фузи музи CLAUDE 328/GEMINI 304, Mammoth, Sys admin BOT, Izi_logist, fasoli, bot_reclamaties → ≤150) — pre-existing next task, not started
- Codegraph adoption still ~0% on MAIN agent across projects — bash vector closed (C), Grep vector still advisory; consider positive "use codegraph_context first" nudge
- Optional: disable unused Supabase claude.ai connector (manual, claude.ai → Connectors) to shrink per-turn cache

### Blockers
- None. All changes committed + tested.

### Cost Snapshot (AMOS, last 7d)
- opus-4-8: output=3,154,444 fresh_input=14,859,295 cache_read=274,501,008 (11 sess)
- sonnet-4-6: output=1,235,791 fresh_input=6,230,730 cache_read=219,578,059 (9 sess)
- Origin: main=26 rows / subagent=6 rows
- Cache_read dominates (~494M main) — large cached system prompt re-read per turn

### Next Steps
1. Doc-bloat cleanup: `node tools/project-docs.js audit-all` → trim worst offenders to ≤150 lines.
2. (Optional) Add positive codegraph nudge to lift MAIN-agent adoption above ~0%.

### Resume Pointer
- Focus: trim bloated CLAUDE.md/AGENTS.md/GEMINI.md in flagged projects to ≤150 lines.
- Resume: `node tools/project-docs.js audit-all` (or `/doc-hygiene`) for fresh ranked list, fix worst first.
