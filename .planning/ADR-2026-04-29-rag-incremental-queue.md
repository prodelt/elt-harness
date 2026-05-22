# ADR: Queue-Based Incremental RAG Ingest

**Status:** Accepted
**Date:** 2026-04-29

## Context

LightRAG ingest currently rebuilds project indexes manually through `tools/rag-ingest.py`.
Hook-driven synchronous ingest is unsafe because document extraction calls Gemini or Ollama and can hit quota, timeout, or local model latency. Edit hooks must stay fast and advisory.

## Decision

Add a file-backed incremental queue under each project `.rag/queue.json`.
Hooks or manual commands enqueue changed files only. A separate `--process-queue` command initializes LightRAG, reads the pending queue, and inserts only matching manifest documents with stable IDs and file paths.

## Data Flow

1. File changes are passed to `python tools/rag-ingest.py --project <name> --queue <file>`.
2. The queue normalizes the file path relative to the project, verifies it is included by `.rag/manifest.json`, applies exclude patterns, and deduplicates by relative path.
3. `python tools/rag-ingest.py --project <name> --process-queue` loads pending entries, reads current file contents, and calls `rag.ainsert(docs, ids=..., file_paths=...)`.
4. Processed entries are marked `indexed`; missing or excluded entries are marked `skipped`.

## Alternatives Considered

- Synchronous PostToolUse LightRAG ingest: rejected because it would put LLM quota and latency on the edit path.
- Full rebuild after every edit: rejected because it repeats extraction for unchanged docs and keeps stale windows large.
- Graphify-only retrieval: kept as complementary structural search, but it does not replace semantic project summaries.

## Constraints

- No secrets in queue state.
- Queue writes must be atomic.
- Queue processing must be manual or background-safe, never a blocking hook action.
- Existing full ingest and query commands must keep working.

## Verification

- Unit tests cover include/exclude matching and queue deduplication.
- CLI smoke tests cover `--help`, `--queue`, and `--queue-stats` without touching LightRAG network paths.
