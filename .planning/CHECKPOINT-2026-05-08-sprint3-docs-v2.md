# CHECKPOINT 2026-05-08 - Sprint 3 Docs v2

## Focus

Sprint 3: `init-project v2` and `sync-docs v2`.

## Implemented

- Added `tools/project-docs-core.js` section-aware docs engine.
- Added `tools/project-docs.js` CLI with `init`, `sync`, and `verify`.
- Added `tools/project-docs.test.js` regression coverage.
- Added `tools/install-doc-skills.js` and used it to update:
  - `~/.claude/skills/init-project/SKILL.md`
  - `~/.codex/skills/init-project/SKILL.md`
  - `~/.claude/skills/sync-docs/SKILL.md`
  - `~/.codex/skills/sync-docs/SKILL.md`
- Refreshed skill-registry digests for `init-project` and `sync-docs`.
- Updated `AGENTS.md`, `CLAUDE.md`, and `.gemini/GEMINI.md` with Sprint 3 commands/state.

## Verification

- `node tools/project-docs.test.js` -> PASS
- `node tools/project-docs.js verify --root .` -> PASS; all six sections present; `core sections identical: false`
- `node tools/doctor.test.js` -> PASS
- `node --check tools/project-docs-core.js` -> PASS
- `node --check tools/project-docs.js` -> PASS
- `node --check tools/install-doc-skills.js` -> PASS
- `git diff --check` -> PASS
- `node tools/doctor.js --no-graphify` outside sandbox -> PASS=13 WARN=4 FAIL=0
- CLI create smoke -> PASS; created 3 docs, `.rag/manifest.json`, `.planning`, registry
- CLI upgrade smoke -> PASS; preserved protected `Local gotcha.` into `.gemini/GEMINI.md`
- `node tools/skill-search.js "init project docs" --top 3` -> `init-project` rank 1
- `node tools/skill-search.js "sync docs" --top 3` -> `sync-docs` rank 1

## Known Warnings

- Current command-center docs have all six core sections, but their core text is not identical across the three tools.
- Real doctor still reports the known suspicious git ref, invalid legacy global state, and Defender-risk red-team files.
- Graphify was intentionally skipped in doctor verification with `--no-graphify`.
- Pre-existing dirty files remain untouched: `.rag/.gitignore`, `MEMORY.md`, and older untracked audit/planning/generated files.
