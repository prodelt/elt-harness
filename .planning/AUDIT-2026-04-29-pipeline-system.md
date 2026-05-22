# Pipeline / Claude / Codex Deep Audit - 2026-04-29

## Verdict

Score: **82/100**.

The system is operationally strong at the hook/runtime layer, but not yet as strong as the previous `~97/100` documentation claim. The biggest gaps are stale RAG state, incomplete Claude-to-Codex skill availability, dirty workspace hygiene, and local secret/fixture risk.

## Evidence

- Runtime versions verified outside sandbox:
  - Claude Code `2.1.123`
  - Codex CLI `0.125.0`
  - Node `v24.14.0`
  - bun `1.3.13`
  - Graphify responds to `graphify --help`
- Hook verification outside sandbox:
  - `node ~/.claude/hooks/test-all-hooks.js` -> `33/33 PASS`
  - `node ~/.codex/test-codex-hooks.js` -> `43/43 PASS`
  - `node ~/.claude/hooks/test-hooks-behavior.js` -> `37/37 PASS`
- Registered hooks:
  - Claude settings: 47 hook refs, 46 unique hook files
  - Codex hooks: 43 hook refs, 42 unique hook files
  - Claude-only by design/runtime support: `env-change-watcher.js`, `skill-selector-gate.js`, `task-completed-gate.js`, `tool-policy-gate.js`
- Skills:
  - Claude skills: 50 directories, 47 valid `SKILL.md` files with `name:` frontmatter
  - Codex skills: 28 directories
  - Missing from Codex includes mattpocock/architecture workflow skills such as `grill-me`, `diagnose`, `domain-model`, `improve-codebase-architecture`, `request-refactor-plan`, `qa`, `zoom-out`
- RAG/Graphify:
  - `.rag/manifest.json` last built `2026-04-26`
  - `.rag/index` still contains old docs with `31/31`, `33/33`, and `graphify --version`
  - `graphify query "что делает edit-enforcer?" --budget 400` returned `No matching nodes found`
- Workspace:
  - Repo branch: `feature/s11-task-43-init-project-upgrade-mode`
  - Modified docs from S13 remain uncommitted: `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`
  - Many untracked artifacts exist: `.tmp/`, `graphify-out/`, audit reports, generated tools/cache folders
  - `tools/` is about 587 MB / 12.5k files
- Security:
  - `.env` exists, is ignored by `.gitignore`, and contains `GOOGLE_API_KEY`
  - `.tmp` contains demo/quarantine hardcoded token fixtures
  - Hook behavior blocks real secret patterns in tests

## Score Breakdown

- Runtime + hook correctness: **28/30**
- Cross-tool config correctness: **15/20**
- Skill lifecycle and availability: **13/20**
- RAG / retrieval accuracy: **7/15**
- Security and operational hygiene: **12/15**
- Total: **82/100**

## Highest-Risk Gaps

1. **RAG index is stale and partially wrong.** It can inject obsolete test counts and old Graphify commands even after docs were fixed.
2. **Codex does not have the full Claude skill surface.** If the expectation is "everything from Claude Code loaded into Codex", that is currently false.
3. **Workspace hygiene is weak.** Large untracked/generated directories increase search cost, accidental context pollution, and audit noise.
4. **Local secrets are present.** `.env` is ignored, so this is not a git leak right now, but it is still a local handling risk.
5. **Previous docs overstate quality.** Live runtime is good, but `~97/100` is too generous until RAG and skill-sync are fixed.

## Recommended Fix Order

1. Rebuild `.rag/index` after S13 docs changes, then verify Graphify can answer about `edit-enforcer`.
2. Define skill mirror policy: either intentionally Claude-only, or sync mattpocock architecture skills into Codex.
3. Clean or quarantine `.tmp`, generated red-team/tool caches, and large irrelevant trees from default search/RAG paths.
4. Add a CI-style audit command that runs all three hook suites plus doc/RAG stale checks.
5. Keep `.env` ignored, but add `.env.example` and a local secret hygiene note.
