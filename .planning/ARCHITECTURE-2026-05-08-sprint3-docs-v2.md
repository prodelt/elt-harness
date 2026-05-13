# Architecture 2026-05-08 - Sprint 3 Docs v2

## Goal

Make `init-project` and `sync-docs` section-aware so AI docs work across projects without erasing local rules.

## Components

- `tools/project-docs-core.js`: pure Node core for markdown section parsing, create/upgrade/noop classification, protected-block preservation, artifact bootstrap, registry registration, and verification.
- `tools/project-docs.js`: CLI wrapper for `init`, `sync`, and `verify`.
- `tools/project-docs.test.js`: regression tests for create/noop/upgrade/sync/preamble preservation.
- `tools/install-doc-skills.js`: explicit installer for the global `.claude` and `.codex` `init-project`/`sync-docs` skill docs.

## Merge Contract

- Required core sections: `Overview`, `Stack`, `Commands`, `Architecture`, `Gotchas`, `Current State`.
- Dated headings such as `## Current State (2026-05-08)` count as the canonical core section.
- Existing preambles, non-core sections, and `<!-- project-docs:protected:start NAME -->` blocks are preserved.
- `init` creates `.rag/manifest.json`, `.planning/`, and a registry entry in `~/.claude/projects-registry.json`.

## Verification

- `node tools/project-docs.test.js`
- `node tools/project-docs.js verify --root .`
- `node tools/doctor.test.js`
- `node tools/doctor.js --no-graphify`

## Notes

The current command-center docs have all six core sections but their core text is not word-for-word identical across `AGENTS.md`, `CLAUDE.md`, and `.gemini/GEMINI.md`. That is reported as `core sections identical: false` by `project-docs verify`; it is not treated as a missing-section failure.
