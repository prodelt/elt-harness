# Checkpoint - 2026-05-08 before Sprint 3

## Build Status

- Compiles: not run
- Lint: not configured
- Type check: not configured

## Test Metrics

- `node tools\doctor.test.js`: PASS (`doctor tests: PASS`)
- Coverage: not measured
- New tests this sprint: doctor state isolation tests from Sprint 2

## Code Modifications Since Last Checkpoint

- Sprint 2 committed as `e7f7412 feat: isolate pipeline state per project`.
- Files committed in Sprint 2:
  - `tools/doctor-core.js`
  - `tools/doctor.test.js`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.gemini/GEMINI.md`
  - `.planning/ARCHITECTURE-2026-05-08-sprint2-project-state.md`

## Git State

- Branch: `feature/s11-task-43-init-project-upgrade-mode`
- Last commit: `e7f7412 feat: isolate pipeline state per project`
- Uncommitted pre-existing changes still present and intentionally not touched:
  - `.rag/.gitignore`
  - `MEMORY.md`
  - many older untracked audit/planning/generated files

## Completed Tasks

- Sprint 2 project state isolation implemented.
- Active state path is `~/.claude/projects/<projectKey>/pipeline-state.json`.
- Legacy `~/.claude/pipeline-state.json` is read-only fallback/diagnostic.
- `doctor` reports project state and legacy global state separately.
- Global `pipeline`, `architect-first`, `sprint`, `inline-review`, and `ship` skill docs updated in both `.codex` and `.claude`.
- `~/.claude/bin` restored in User PATH.

## Remaining Work

- Sprint 3 scope not started yet.
- Known existing warnings remain:
  - suspicious git ref `feature/s11-task-43-init-project-upgrade-mode (1)`;
  - invalid legacy global pipeline state;
  - Defender-risk red-team files;
  - Graphify relevance remains noisy and was skipped in final Sprint 2 doctor verification.

## Blockers

- Context7 MCP API key is invalid; CLI fallback via `cmd /c npx ctx7 ...` worked for Node docs.
- Sandbox can distort project root for `doctor`; real project verification must run outside sandbox when checking project key/state.

## Next Steps

1. Read Sprint 3 source from `.planning/NEXT_SESSION_PROMPT-2026-05-08-global-system-audit.md` and `.planning/AUDIT-2026-05-08-global-claude-codex-system.md`.
2. Classify Sprint 3 and write/update project-local pipeline state.
3. Execute Sprint 3 one task at a time with verification after each task.
