# CHECKPOINT 2026-05-08 - Sprint 1 Doctor

## Focus

Sprint 1: add a global project registry and doctor command that can report pass/warn/fail from any project without destructive cleanup.

## Implemented

- Added architecture contract: `.planning/ARCHITECTURE-2026-05-08-sprint1-doctor.md`.
- Added `tools/doctor-core.js` and `tools/doctor.js`.
- Added `tools/doctor.test.js`.
- Added local/global-ready wrappers:
  - `tools/doctor.cmd`
  - `tools/doctor.ps1`
  - `tools/skill.cmd`
  - `tools/skill.ps1`
- Installed wrappers into `~/.claude/bin/`.
- Added `~/.claude/bin` to User PATH and current verification process.
- Created/updated `~/.claude/projects-registry.json` with project key `pipiline-setupper-eb257e8d`.
- Updated `AGENTS.md`, `CLAUDE.md`, and `.gemini/GEMINI.md` with doctor/skill commands and S15 current state.

## Doctor Checks

The doctor currently checks:

- AI docs exist and contain core sections.
- Local project rules are detectable.
- Project registry entry exists.
- Skill registry JSONL parses.
- `SKILL.md` frontmatter is present and structurally valid.
- Claude hook files/settings are reachable.
- Graphify CLI/graph/relevance smoke.
- RAG manifest/index/queue.
- Git refs, including suspicious invalid ref filenames.
- Global pipeline-state validity.
- Defender-risk red-team file extensions.

## Known Findings

- `~/.claude/skills/ship/SKILL.md` has no YAML frontmatter fence.
- `.git/refs/heads/feature/s11-task-43-init-project-upgrade-mode (1)` is suspicious and must not be removed without explicit approval.
- `~/.claude/pipeline-state.json` is invalid JSON / wrong global state; Sprint 2 should replace it with per-project state.
- `tools/red-team` and `~/.claude/skills/red-team` contain Defender-risk extensions; no quarantine/delete was done.

## Verification Snapshot

- `node tools\doctor.test.js` -> `doctor tests: PASS`.
- `node tools\doctor.js` outside sandbox -> `PASS=13 WARN=3 FAIL=1`; Graphify graph and relevance smoke passed.
- `~/.claude/bin/doctor.cmd --root "C:\Claude playground\Pipiline setupper" --no-graphify` from `C:\tmp` reached the project and reported known findings.
- `doctor.cmd --root "C:\Claude playground\Pipiline setupper" --no-graphify` from `C:\tmp` works by command name after PATH update.
- `skill.cmd "architecture refactor" --top 3` from `C:\tmp` returned `architect-first`, `cto-playbook`, `pipeline`.

## Next

Sprint 2 should implement per-project state isolation and make doctor check the new state path before the old global file.
