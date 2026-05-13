# CHECKPOINT 2026-05-08 - Sprint 4 Codemap/RAG Slice

## Focus

Sprint 4: Graphify/RAG/codemap repair.

## Implemented

- Added `tools/codemap-core.js`, `tools/codemap.js`, and `tools/codemap.test.js`.
- Integrated `doctor` Graphify checks with codemap scope + relevance smoke.
- Added registry-backed RAG project discovery in `tools/rag_queue.py`.
- Replaced hardcoded project map in `tools/rag-ingest.py` with registry discovery.
- Extended queue stats with stable counts: `total`, `pending`, `indexed`, `failed`, `skipped`, `processing`, `stale`.
- Updated `AGENTS.md`, `CLAUDE.md`, and `.gemini/GEMINI.md`.

## Verification

- `node tools/codemap.test.js` -> PASS
- `node tools/codemap.js --root .` outside sandbox -> PASS=1 WARN=1 FAIL=0
  - PASS: relevance smoke cited `tools/project-docs-core.js`
  - WARN: graph is 93% noisy sources
- `python tools/rag_queue_test.py` -> PASS, 8 tests
- `python -m py_compile tools/rag_queue.py tools/rag-ingest.py` -> PASS
- `python tools/rag-ingest.py --help` -> PASS
- `python tools/rag-ingest.py --project pipeline-setupper --queue-stats` -> `{"total": 1, "pending": 0, "indexed": 1, "failed": 0, "skipped": 0, "processing": 0, "stale": 0}`

## Verification Gap

Full `node tools/doctor.js` outside sandbox was requested but rejected by the execution environment usage limit. `doctor --no-graphify` still runs in sandbox; direct codemap outside sandbox verifies the new Graphify path.

## Remaining Sprint 4 Work

- Rebuild Graphify with exclusions for noisy sources.
- Add Graphify project-scope config/enforcement before rebuild.
- Evaluate Serena and Aider repo map on two real projects.
- Decide whether Graphify remains primary after relevance tests on rebuilt graphs.

## Dirty Files Not From This Sprint

- `.rag/.gitignore`
- `MEMORY.md`
- older untracked planning/audit/generated files
