# Next Session Prompt - Sprint 5 Graphify Automation

Continue from `C:/Claude playground/Pipiline setupper`.

Focus: Sprint 5 first slice - make Graphify setup work automatically across registered projects.

Done when:

- Registered projects can receive a project-local `.graphifyignore` automatically.
- `doctor` or a dedicated setup command checks Graphify scope/noisy ratio for a target project.
- Stale semantic/rationale nodes from old `graphify-out/graph.json` are detected and produce a clear fresh-rebuild repair path.
- Existing Pipeline Setupper behavior stays green.
- Verification proof is shown.

Context:

- Sprint 4 is complete. Last checkpoint: `.planning/CHECKPOINT-2026-05-08-sprint4-complete.md`.
- Latest commits:
  - `9e03fe3 docs: checkpoint sprint 4 completion`
  - `65263b5 docs: evaluate codemap alternatives`
  - `af0ee55 feat: scope graphify codemap sources`
- Graphify is primary for now. Serena is only a future candidate.
- Current project Graphify fresh rebuild proof: 810 nodes, 1301 edges, 126 source files, 0 noisy nodes.
- Full codemap relevance mode may fail inside Codex sandbox with `spawnSync cmd.exe EPERM`; direct `cmd /c graphify query ...` worked.

Likely files:

- `tools/codemap-core.js`
- `tools/codemap.js`
- `tools/codemap.test.js`
- `tools/doctor-core.js`
- `tools/project-docs-core.js`
- `tools/project-docs.test.js`
- `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`

Do not touch unrelated dirty files unless the new task requires it.
