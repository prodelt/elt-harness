# Architecture 2026-05-08 - Sprint 4 Codemap/RAG Slice

## Goal

Make code maps and RAG setup diagnosable before relying on them for project context.

## Components

- `tools/codemap-core.js`: Graphify graph scope analysis and relevance smoke checks.
- `tools/codemap.js`: CLI wrapper for codemap doctor.
- `tools/codemap.test.js`: regression tests for scope, noisy graph detection, outside-project sources, and relevance checks.
- `tools/rag_queue.py`: registry discovery and richer queue stats.
- `tools/rag-ingest.py`: project selection now comes from `~/.claude/projects-registry.json` aliases instead of a hardcoded project map.

## Codemap Rules

- Graph is invalid if it includes absolute source paths outside the project root.
- Graph is suspicious if more than 25% of nodes come from noisy prefixes such as `tools/red-team/`, `graphify-out/cache/`, `node_modules/`, or `audit/1c-dev-pilot/recon/`.
- Relevance smoke must cite a current-project file and match expected symbols.

## RAG Rules

- Registered projects are discovered from `~/.claude/projects-registry.json`.
- Project aliases include registry key, registry name slug, project folder slug, and `.rag/manifest.json` `project`.
- Queue stats return stable keys: `total`, `pending`, `indexed`, `failed`, `skipped`, `processing`, `stale`.

## Current Finding

The existing Graphify graph is usable enough to cite `tools/project-docs-core.js`, but it is noisy: 93% of nodes come from red-team/recon/cache-like sources. Sprint 4 detects this automatically; rebuilding/excluding noisy paths is a follow-up.
