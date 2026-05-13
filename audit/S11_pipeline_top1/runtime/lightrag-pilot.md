# LightRAG Pilot

## Scope

Project-scoped pilot only for `Pipeline-setupper`. No global install, no global MCP, no automatic startup dependency.

## Why LightRAG

Context7 for `/hkuds/lightrag/v1.4.10` shows the current fit we need:
- graph-aware plus vector retrieval instead of plain embedding lookup;
- multiple query modes: `local`, `global`, `hybrid`, `naive`, `mix`, `bypass`;
- query responses can include references and chunk content;
- API/server path exists, so the pilot can stay local/project-scoped.

## Proposed Ingest Set

- `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`
- `MEMORY.md`
- `audit/S11_pipeline_top1/runtime/*.md`
- selected code summaries derived from hooks/runtime files
- Graphify outputs and important session learnings

## Excluded Inputs

- `.env*`
- auth tokens or local credentials
- full raw repo dumps
- unrelated repos and legacy untracked folders

## Query Mode Mapping

| Need | Recommended mode | Why |
|---|---|---|
| exact project policy summary | `global` | best for high-level doc synthesis |
| entity-specific question about one hook/file | `local` | narrows retrieval to relevant entities |
| mixed docs + structure context | `mix` | combines graph and vector retrieval |
| fallback vector-only lookup | `naive` | cheap fallback if graph signal is weak |

## Deployment Shape

- keep runtime local to the project;
- credentials via env vars only;
- rebuild index after major doc changes or after a batch of closed tasks;
- delete/rebuild if scope contamination is suspected.

## Success Criteria

- comparison table exists for 10 representative questions;
- pilot keeps knowledge split clean: global vs project vs task-local;
- no secrets in ingest scope;
- no global runtime writes are required to validate the route.
