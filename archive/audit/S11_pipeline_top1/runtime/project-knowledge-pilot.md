# Project Knowledge Pilot

## Goal

Close Task 49 by proving a project-scoped graph/RAG route for `Pipeline-setupper` that reduces full-code reads. The pilot keeps `LightRAG` in project scope, reuses existing `Graphify`, and preserves `grep` for exact low-cost lookups.

## Phase 1 - Pilot Choice

### Option A - Pipeline-setupper

Pros:
- current repo, no cross-project handoff needed;
- rich audit/doc corpus already exists;
- Graphify is already part of the workflow;
- easy to compare docs-heavy and code-structure-heavy questions.

Cons:
- answers can overfit to audit artifacts if ingest scope is too broad.

### Option B - Law-assistant

Pros:
- likely broader product surface and stronger real-project signal.

Cons:
- not the current workspace;
- would add cross-repo verification cost for this batch;
- harder to prove without pulling more external context.

### Option C - Multi-project pilot

Pros:
- closer to final Knowledge OS vision.

Cons:
- too much scope for one task pair;
- higher token and coordination cost;
- weaker rollback if the storage split is wrong.

Verdict: accept Option A. `Pipeline-setupper` is enough to validate the route order before scaling to other projects.

## Phase 2.5 - Evidence

### LightRAG

Context7 `/hkuds/lightrag/v1.4.10` confirms:
- multiple query modes exist: `local`, `global`, `hybrid`, `naive`, `mix`, `bypass`;
- the query API can include references and chunk content;
- LightRAG exposes a local/server deployment path rather than forcing a global install;
- the documented fit is graph + vector retrieval, which matches the project-knowledge objective better than plain docs search.

Keep/change decision:
- Keep `LightRAG` as the project-scoped RAG candidate.
- Change the rollout to `read-only pilot first`, no global MCP, no default startup install.

### Existing Graphify route

Keep/change decision:
- Keep `Graphify` for structural/code ownership questions.
- Change policy so Graphify is not treated as a docs memory layer; it remains a graph/code route.

### Plain grep / targeted reads

Keep/change decision:
- Keep `grep` for exact, cheap, line-preserving questions.
- Change default routing so `grep` is no longer the first move for broad architectural questions.

## Storage Split

### Global development knowledge

Only cross-project policies:
- docs/bootstrap rules;
- git discipline and security rules;
- Context7/GitHub discovery rules;
- route-order policy.

### Project knowledge

Approved sources for `Pipeline-setupper`:
- `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`;
- `audit/S11_pipeline_top1/runtime/*.md`;
- `MEMORY.md`;
- Graphify outputs and selected code summaries;
- session learnings that are specific to this repo.

### Task-local scratch

Temporary only:
- comparison fixtures;
- experiment notes;
- route exceptions before promotion into project knowledge.

## Approved Ingest Scope

Safe sources only:
- project docs;
- ADR/audit/runtime docs;
- selected code summaries, not full raw dumps;
- Graphify outputs;
- session learnings relevant to this repo.

Do not ingest:
- `.env` files;
- tokens or local credentials;
- unrelated repos;
- raw secrets from logs;
- broad filesystem snapshots.

## Sync Policy

| Layer | System of record | Sync rule |
|---|---|---|
| Global rules | global docs and hooks | update only through explicit S11 tasks |
| Project docs | repo markdown | feed into both Graphify and LightRAG inputs |
| Structural code knowledge | Graphify | rebuild after meaningful code changes |
| Docs/ADR/learnings knowledge | LightRAG | refresh after task closure or major doc changes |
| Session state | `MEMORY.md` + handoff docs | summarize, then promote only project-relevant knowledge |

## Route Order

1. CLI capability registry
2. Project graph/RAG
3. Project docs and memory
4. Targeted grep/read

## Comparison Table

Generated from `project-knowledge-pilot.fixture.json` and verified by `project-knowledge-pilot.js`.

| Question | Grep cost | Graph result | RAG result | Chosen route |
|---|---|---|---|---|
| What hook blocks direct edits when Context7 proof is missing? | high | edit-enforcer.js and related tracker path can be found cheaply in the code graph | RAG can answer from docs and friction logs, but graph is cheaper for exact hook ownership | graphify |
| Which startup payload sources are currently the top token offenders? | medium | Graph can locate the audit script, but not the measured findings directly | RAG can answer directly from startup-payload-audit.md and NEXT_SESSION_PROMPT evidence | lightrag |
| Where is the duplicate Mammoth ERP config drift documented? | medium | Graph points to the audit script, but not the finding text itself | RAG summarizes the duplicate key finding from the audit report | lightrag |
| Which file regenerates AUTO_NEXT_SESSION_PROMPT on Stop? | high | Graph finds stop-auto-checkpoint.js and its handoff-sync integration immediately | RAG has the policy summary but not the exact code path as reliably as the graph | graphify |
| What are the first commands for the next session? | low | Graph is unnecessary for one exact section lookup | RAG can answer from NEXT_SESSION_PROMPT, but plain grep is the cheapest route | grep |
| Which files were added in Task 48 for GitHub-first discovery? | medium | Graph finds the runtime files and their references | RAG can summarize from MEMORY and NEXT_SESSION_PROMPT, but graph gives the exact file set | graphify |
| What safe sources should be ingested into a project RAG index? | high | Graph cannot reason about policy as well as a docs-focused layer | RAG can answer from architecture and audit docs that define approved sources | lightrag |
| How should knowledge sync work between Claude, Codex, Graphify, LightRAG, and memory markdown? | high | Graph only shows code edges, not the intended operating policy | RAG can merge guidance from architecture, audit, and pilot notes into one answer | lightrag |
| Which test file verifies skill quarantine denial of dangerous bundle files? | high | Graph points directly to skill-quarantine-scan.test.js | RAG can mention it from summaries, but graph is the exact structural route | graphify |
| What exact line marks Task 49 open in PLAN.md? | low | Graph is overkill for a single line-number lookup | RAG may paraphrase instead of preserving the exact PLAN line | grep |

## Rollback / No-Secrets Checklist

- keep the pilot in project scope only;
- use env vars for provider credentials only;
- ingest docs, summaries, Graphify outputs, and session learnings only;
- exclude raw secrets, `.env` files, auth tokens, and unrelated repos;
- rebuild or delete the project index if scope drifts.

## Pilot Verdict

Accept the pilot.

`Graphify` should answer structural/code-ownership questions, `LightRAG` should answer docs/policy/memory questions, and `grep` should remain the cheapest exact-match fallback. This closes the design side of Task 49 without adding any global runtime burden.
