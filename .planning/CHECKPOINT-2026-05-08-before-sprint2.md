# CHECKPOINT 2026-05-08 - Before Sprint 2

## Focus

Continue global Claude/Codex modernization after Sprint 1.

## Current Commit

- `135730b feat(doctor): add global project health check`

## Sprint 1 Status

Completed and committed:

- Global doctor implementation:
  - `tools/doctor-core.js`
  - `tools/doctor.js`
  - `tools/doctor.test.js`
  - `tools/doctor.cmd`
  - `tools/doctor.ps1`
- Global skill wrapper:
  - `tools/skill.cmd`
  - `tools/skill.ps1`
- Planning/docs:
  - `.planning/ARCHITECTURE-2026-05-08-sprint1-doctor.md`
  - `.planning/CHECKPOINT-2026-05-08-sprint1-doctor.md`
  - `AGENTS.md`
  - `CLAUDE.md`
  - `.gemini/GEMINI.md`
- Global side effects:
  - `~/.claude/bin/doctor.cmd`
  - `~/.claude/bin/doctor.ps1`
  - `~/.claude/bin/skill.cmd`
  - `~/.claude/bin/skill.ps1`
  - `~/.claude/bin` added to User PATH
  - `~/.claude/projects-registry.json` created with `pipiline-setupper-eb257e8d`

## Proof Already Captured

- `node tools\doctor.test.js` -> `doctor tests: PASS`.
- `node tools\doctor.js` outside sandbox -> `PASS=13 WARN=3 FAIL=1`.
- `doctor.cmd --root "C:\Claude playground\Pipiline setupper" --no-graphify` works from `C:\tmp`.
- `skill.cmd "architecture refactor" --top 3` works from `C:\tmp`.

## Current Dirty Files Not From Sprint 1 Ship

Tracked dirty:

- `.rag/.gitignore`
- `MEMORY.md`

There are many older untracked audit/planning/generated files in the worktree. Do not revert or clean them without explicit user approval.

## Known Doctor Findings

- `~/.claude/skills/ship/SKILL.md` has no YAML frontmatter fence.
- `.git/refs/heads/feature/s11-task-43-init-project-upgrade-mode (1)` is suspicious; do not remove without explicit approval.
- `~/.claude/pipeline-state.json` is invalid/global and must be replaced by per-project state.
- `tools/red-team` and `~/.claude/skills/red-team` contain Defender-risk extensions; do not quarantine/delete without explicit approval.

## Next Sprint

Sprint 2 - Project capsule / state isolation.

Goal: no global state leaks between projects.

Tasks:

- Replace `~/.claude/pipeline-state.json` with per-project state path.
- Add deterministic project key normalization.
- Add TTL and future timestamp rejection.
- Update `pipeline`, `architect-first`, `sprint`, `inline-review`, `ship` to read project state.
- Add migration fallback for old state, read-only.
- Update doctor to report per-project state health and legacy global state separately.

Acceptance:

- Opening project A never resumes project B state.
- State survives session resume.
- Doctor catches stale/wrong/future legacy state.

## Resume Command Hints

Start by reading:

1. `.planning/NEXT_SESSION_PROMPT-2026-05-08-global-system-audit.md`
2. `.planning/AUDIT-2026-05-08-global-claude-codex-system.md`
3. `.planning/CHECKPOINT-2026-05-08-sprint1-doctor.md`
4. this checkpoint

Then inspect:

- `tools/doctor-core.js`
- `~/.claude/pipeline-state.json`
- `~/.codex/skills/pipeline/SKILL.md`
- `~/.codex/skills/architect-first/SKILL.md`
- `~/.codex/skills/sprint/SKILL.md`
- `~/.codex/skills/inline-review/SKILL.md`
- `~/.codex/skills/ship/SKILL.md`
