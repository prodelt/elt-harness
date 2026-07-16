---
name: architect-first
description: >-
  Architect-first v2 for complex features, refactors, and structural decisions.
  Produces a concrete architecture contract artifact, acceptance tests, sprint
  slices, and docs/codemap delta before implementation starts.
source: https://github.com/SynkraAI/aiox-core
stars: 2515
version: 2.0.0
requires: []
changelog:
  - 2.0.0 (2026-05-08): require architecture contract artifact, acceptance tests, sprint slices, and docs/codemap delta
  - 1.1.0 (2026-04-23): add Phase 2.5 top-3 implementation scan with ctx7 search evidence
  - 1.0.1 (2026-04-22): append explicit skill name in pipeline checkpoints
  - 1.0.0 (2026-04-22): initialize semver metadata
---

# Architect First v2

Use this skill only when the task needs architecture: multi-file feature work,
new API or storage contracts, significant refactors, new dependencies, or
cross-module behavior. Simple edits should bypass this skill.

## Success Criteria

Return `success: true` only when all applicable predicates below are true:
- `.planning/ARCHITECTURE-<date>-<slug>.md` is created or updated.
- The architecture contract names owners, interfaces, data flow, risks, and rollback.
- Acceptance tests are defined before code and each test maps to a user-visible outcome.
- Sprint slices are small, ordered, and independently verifiable.
- Docs/codemap delta is explicit: which docs, project maps, or graph indexes need updates.
- Required verification command(s) complete successfully and the final response includes exact command names plus pass/fail evidence.
- Final response reports `success`, `criteria_checked`, `proof`, and `remaining_work`.
- If any predicate cannot be verified, return `success: false` with `remaining_work` and the blocking reason.

## pipeline-state

Canonical active state path: `~/.claude/projects/<projectKey>/pipeline-state.json`.
Compute `projectKey` as lowercase basename slug plus `-` plus the first 8 sha1
hex chars of the normalized absolute cwd lowercased with `/` separators.

If the canonical state exists, its `cwd` matches current project, and `ts` is
within 24h, read `task`, `stack`, `commands`, and `domain` from it. Do not
re-parse project docs for those fields. After this skill completes, append
`{ "phase": "architected", "skill": "architect-first", "ts": "<ISO>" }` to
`checkpoints[]` and set `phase=architected`.

## Architecture Contract

Create or update `.planning/ARCHITECTURE-<date>-<slug>.md` with these sections:

- Problem: user goal, non-goals, and the smallest useful outcome.
- Current map: relevant modules, data flow, contracts, and ownership boundaries.
- Constraints: compatibility, performance, security, deployment, and no-new-deps limits.
- Options: A/B/C choices with trade-offs and rejected alternatives.
- Decision: selected approach and why it preserves existing capability.
- Contracts: API shape, data schema, state transitions, error shape, and config.
- Acceptance tests before code: tests or checks that prove the contract works.
- Sprint slices: ordered implementation slices with command-level verification.
- Docs/codemap delta: docs, ADRs, README/AGENTS updates, Graphify/codemap refresh needs.
- Rollback: how to revert or disable the change safely.

## Architecture Flow

### Phase 1 - Map Before Modify

Document current behavior, dependencies, data flow, contracts, and compatibility
constraints before proposing changes.

### Phase 2 - Multi-Perspective Validation

Present A/B/C options with concrete trade-offs. Include what each option
optimizes for, what it risks, and how it preserves existing capability.

### Phase 2.5 - Top-3 Implementation Scan

Before selecting an option, compare the proposed pattern against the top three
relevant implementations or library patterns discovered through Context7:

```bash
MSYS_NO_PATHCONV=1 ctx7 search "<pattern>" | head -40
```

Record the ctx7 search query, top three candidates, and one keep/change decision
for each candidate. If the local ctx7 CLI does not support `search`, record that
result and run the documented equivalent:

```bash
MSYS_NO_PATHCONV=1 ctx7 library "<pattern>" "top implementations architecture alternatives" | head -40
```

Do not proceed to Phase 3 until the contract includes ctx7 evidence or a clear
reason why Context7 could not return relevant results.

### Phase 3 - Write The Contract

Write the architecture contract artifact before implementation. The contract is
the handoff into `/sprint`; code work starts only after acceptance tests and
sprint slices are written.

### Phase 4 - Capability And Coupling Check

Confirm the design keeps previous capabilities unless explicitly traded off.
Modules must communicate through stable contracts, not hidden shared state or
hardcoded cross-module dependencies.

### Phase 5 - Implementation Handoff

Return a concise implementation handoff:

- artifact path;
- chosen option;
- acceptance tests before code;
- sprint slices;
- docs/codemap delta;
- verification commands.

## Hard Stop Rules

STOP immediately if detecting:
- Capability loss without explicit approval.
- Structural decision without multi-perspective validation.
- Missing Phase 2.5 top-3 implementation scan for architecture choices.
- Architecture decision without ctx7 top-3 evidence.
- Missing `.planning/ARCHITECTURE-<date>-<slug>.md` contract.
- Missing acceptance tests before code.
- Missing sprint slices for a complex implementation.
- Missing docs/codemap delta.
- Coupling between modules through hidden mutable state.
- Target file >500 LOC and task requires structural edits; split first.

## Quick Reference

1. Read pipeline state, project docs, and current code map.
2. Create `.planning/ARCHITECTURE-<date>-<slug>.md`.
3. Map current behavior and constraints.
4. Compare A/B/C options.
5. Run Phase 2.5 Context7 top-3 scan.
6. Select the contract.
7. Define acceptance tests before code.
8. Break work into sprint slices.
9. Declare docs/codemap delta.
10. Hand off to implementation with proof requirements.
