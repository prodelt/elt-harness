# CHECKPOINT 2026-05-08 — Global Claude/Codex System Audit

## Focus
Audit the global Claude Code + Codex setup so it works predictably on this computer across any project, while preserving each project's own `AGENTS.md` / `CLAUDE.md` / `.gemini/GEMINI.md` specifics.

## User Requirements Captured
- Audit last 7 days of Claude Code and Codex usage.
- Score the system separately from 1-10.
- Research trending/new GitHub repositories and engineering ideas.
- Re-evaluate whether `architect-first` and `pipeline` are useful or overcomplicated.
- Analyze user's work/communication patterns and adapt the system to that style.
- Fix cross-project project docs, Graphify, RAG, codemap, skill search.
- Keep project-specific rules; never wipe local project docs.
- Investigate Windows Defender banning `red-team`.
- Consider integrating `KeygraphHQ/shannon` into red-team kit.
- Consider adding `binhnguyennus/awesome-scalability` into `architect-first`.
- Modernize `init-project` for create/update modes.
- Save a deep plan and split into sprints.

## Local Facts Found
- Project has `AGENTS.md`, `CLAUDE.md`, and `.gemini/GEMINI.md`, but working tree is very dirty with duplicate docs and many untracked planning/audit/RAG artifacts.
- `git log --all` failed because `.git/refs/heads/feature/s11-task-43-init-project-upgrade-mode (1)` is an invalid/broken ref.
- `~/.claude/pipeline-state.json` is global and currently points to `D:\Ametrin projects\Izi tracker\izi-tracker`, phase `architected`, timestamp `2026-05-09T09:00:00Z`; this is a cross-project contamination risk.
- `cmd /c graphify query "what does graphify-session-init do?"` returned noisy results from `tools/red-team` and old audit files instead of a direct answer about the hook. Graphify runs, but retrieval scope/quality is unreliable.
- `node tools\skill-search.js "architecture refactor" --top 5` works in this repo and returns `architect-first`, `cto-playbook`, `pipeline`, `prime`, `tdd`; the user-reported `skill.sh` failure still needs direct inspection.
- `python tools\rag-ingest.py --project pipeline --queue-stats` returned `{"indexed": 1}` only; RAG queue health is not very informative.
- `node ~/.claude/hooks/hook-stats.js` shows recent hooks firing with 0 errors, but only shallow metrics; `errors.log` has 832 lines with warnings, mostly Graphify read advisories.
- `~/.claude/hooks` has 58 JS files; docs mention 48 hook commands, so implementation count and docs may be drifting.
- Claude/Codex recent histories show repeated patterns: user asks to continue from checkpoints, expects no forgotten context, asks for deploy/proof, gets frustrated when work ignores exact acceptance criteria, and frequently requests `/architect-first`, `/pipeline`, `/checkpoint`, `/update-docs`, `/update-codemaps`.
- Codex history includes invalid skill YAML for `itstep-lesson-builder`, Miro MCP auth failure, and repeated complaints about context continuity.

## Skill Notes
- `pipeline` is too much a universal dispatcher and still relies on a single global `~/.claude/pipeline-state.json`; this should become per-project state with TTL and validation.
- `architect-first` has good principles but is too generic and may feel like ceremony unless it outputs small concrete artifacts: options, acceptance tests, risks, sprint slices, and docs/codemaps deltas.
- `init-project` already has create/upgrade/noop language, but needs a stronger merge algorithm, non-destructive doc preservation, and a post-init health check for docs/RAG/Graphify/codemaps.
- `sync-docs` currently says source-of-truth priority and "never shrink", but it risks cloning one doc over another. It needs section-aware merge and project-specific protected blocks.
- `red-team` vendors large offensive trees under `references/external/...`, including compiled/build artifacts and offensive code examples. This likely explains Windows Defender alerts. Safer design: keep only curated markdown indexes locally; fetch or link risky repos on demand into quarantine/external cache.

## Architecture Direction
- Global layer should be a "toolchain kernel": install, health-check, routing, guardrails, shared skill registry, and repair.
- Project layer should own project-specific rules, stack, commands, gotchas, docs, codemap and local RAG index.
- Per-project state should live under a deterministic project key, not one global mutable file.
- `init-project` should never overwrite project specifics; it should preserve protected sections and append/update standard blocks.

## Next Steps
1. Inspect `skill.sh` / skill search files directly.
2. Run web/GitHub research for Shannon, awesome-scalability, and modern code/RAG/agent tooling.
3. Produce final audit scores and sprint roadmap.
4. Save full audit plan into `.planning/AUDIT-2026-05-08-global-claude-codex-system.md`.
