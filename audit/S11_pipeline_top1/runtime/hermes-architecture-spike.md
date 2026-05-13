# Hermes Agent Architecture Spike

## Goal

Close Task 52 by extracting reusable ideas from Hermes Agent into S11 without replacing Claude/Codex as primary runtime.

## Scope

- Read-only architecture analysis only.
- No install/run in this session.
- No global runtime changes.

## Sources (checked 2026-04-24)

- GitHub: `NousResearch/hermes-agent` README/docs index.
- Existing S11 docs: `DEVELOPER_KNOWLEDGE_OS_ARCH.md`, `DEVELOPER_KNOWLEDGE_OS_AUDIT_2026-04-24.md`, `github-discovery-workflow.md`.

## Hard Platform Constraint

- Hermes README explicitly states: native Windows is not supported.
- Required path for this environment: WSL2.
- Therefore: install or runtime experiments are out of scope until a dedicated approval + sandbox plan exists.

## Architecture Areas Reviewed

1. Memory model (persistent profile + conversation search)
2. Skills lifecycle (creation + iterative improvement)
3. Toolsets and execution gateways
4. Context compression and retrieval
5. MCP integration boundary

## Pattern Decisions

| Pattern | Decision | Action in S11 |
|---|---|---|
| Event-driven learning loop (`task -> reflection -> skill delta`) | adapt | move into Task 53 as controlled no-auto-promote loop using `/learn` + quarantine + manifest |
| Persistent searchable memory for cross-session recall | adopt | keep project-scoped memory/knowledge routing; enrich with structured event metadata instead of full transcript storage |
| Unified multi-channel messaging gateway | reject | out of scope for current local coding runtime; too high complexity and unclear ROI for this repo |

## Guardrails

- `install/run Hermes` is forbidden without explicit user approval.
- Any future spike must include:
  - isolated WSL2 environment plan;
  - rollback plan;
  - token budget estimate before/after;
  - no writes to global settings until spike validation passes.

## Verdict

Task 52 is closed when:
- document includes `adopt/adapt/reject` decisions;
- Windows/WSL2 limitation is explicit;
- no runtime installation/config changes are performed.
