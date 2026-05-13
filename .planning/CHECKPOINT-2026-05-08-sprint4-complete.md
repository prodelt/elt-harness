# Checkpoint - 2026-05-08 Sprint 4 Complete

## Focus

Sprint 4: Graphify/RAG/codemap repair.

## Completed

- Added `.graphifyignore` for Graphify project scope.
- Added `codemap:graphifyignore` doctor check and tests.
- Fresh rebuilt Graphify after removing stale `graphify-out/graph.json` semantic/rationale carryover.
- Verified rebuilt graph scope: 810 nodes, 1301 edges, 126 source files, 0 noisy nodes.
- Evaluated Serena and Aider repo map against two real projects:
  - `C:/Claude playground/Pipiline setupper`
  - `C:/Claude playground/browser-harness`
- Decision: Graphify remains primary; Serena is the better future candidate once install/MCP setup is approved; Aider repo map is not adopted until Aider is installed and a stable non-chat wrapper exists.

## Commits

- `af0ee55 feat: scope graphify codemap sources`
- `65263b5 docs: evaluate codemap alternatives`

## Verification

- `node tools/codemap.test.js` -> PASS
- `node tools/doctor.test.js` -> PASS
- `node tools/project-docs.test.js` -> PASS
- `node tools/project-docs.js verify --root .` -> PASS, core sections identical
- `python tools/rag_queue_test.py` -> PASS, 8 tests
- `python tools/rag-ingest.py --project pipeline-setupper --queue-stats` -> PASS, `{"total":1,"pending":0,"indexed":1,"failed":0,"skipped":0,"processing":0,"stale":0}`
- `node tools/codemap.js --root . --no-relevance` -> PASS=2 WARN=0 FAIL=0
- Direct Graphify relevance query for `project-docs-core` cited current files/symbols.

## Known Gaps

- Full `node tools/codemap.js --root .` relevance mode still cannot be run inside Codex sandbox because `spawnSync cmd.exe` returns `EPERM`.
- Outside-sandbox rerun was rejected by environment usage limit.
- `node tools/project-docs.js sync --root .` writes `~/.claude/projects-registry.json`; sandbox blocked it, and outside-sandbox rerun was rejected by usage limit. Safe `verify` passed.
- `aider` and `serena` are not installed locally; evaluation is a preflight, not a live benchmark.

## Dirty Files Not From This Sprint

- `.rag/.gitignore`
- `MEMORY.md`
- older untracked planning/audit/generated files
- untracked `graphify-out/`, `tools/red-team/`, `audit/1c-dev-pilot/`, `.claude/` local settings files

## Next Recommended Sprint

Sprint 5: skills simplification (`pipeline v2`, `architect-first v2`, budget rules, and clearer acceptance-test handoff).

Add this Sprint 5 slice first:

- Graphify cross-project automation:
  - create or update `.graphifyignore` for any registered project;
  - run codemap scope/noisy-ratio checks from `doctor`;
  - detect stale semantic/rationale nodes that survive normal `graphify update .`;
  - recommend or perform a fresh rebuild path when stale noise remains;
  - wire the bootstrap into `init-project`/`sync-docs` or a dedicated codemap setup command.

Done when a newly registered project can get Graphify scope config, rebuild guidance, and codemap health checks without manual copy/paste from Pipeline Setupper.
