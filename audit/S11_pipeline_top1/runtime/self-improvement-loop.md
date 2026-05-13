# Self-Improvement And Knowledge Sync Loop

## Goal

Close Task 53 by defining a controlled loop where Claude/Codex improve skills and knowledge without chaotic writes or auto-promotion.

## Integration Chain

Loop integrates:
1. `/learn` pattern extraction;
2. GitHub/skills discovery (`gh` + `skill-registry`);
3. quarantine scan (`skill-quarantine-scan`);
4. promotion manifest gate;
5. project RAG write path;
6. `/checkpoint` for handoff continuity.

## Event Triggers

Required events:
- `end-of-task`
- `repeated-pattern`
- `new-tool-discovered`
- `failed-workflow`
- `successful-workflow`

Each event produces a proposal, not an automatic install or promotion.

## Write Scope Policy

| Scope | Allowed payload |
|---|---|
| Global dev knowledge | cross-project policies and reusable engineering heuristics |
| Project knowledge | repo-specific architecture, runbooks, route decisions, verified evidence |
| Skill update | proposed SKILL.md deltas with explicit approval gate |
| Task-local note | temporary scratch notes and one-off measurements |

Forbidden:
- writing project artifacts into global memory by default;
- promoting discovered tools or skills without quarantine + manifest + approval.

## Token Budget Gate

Before/after token snapshots are mandatory for each promotion proposal:
- `before`: current session startup/input footprint;
- `after`: projected footprint after proposed change;
- proposal is allowed only if `delta <= configured maxDelta`.

## Dry-Run Example (completed task)

Dry-run reference uses Task 50 completion as a seed event:
- trigger: `end-of-task`;
- generated proposal: update project knowledge routing note + optional skill delta;
- target scope: `projectKnowledge`;
- `autoPromote=false`;
- `requiresQuarantine=true`;
- token budget delta recorded and within threshold.

## Batch Documentation Policy (new)

To avoid repeating the same handoff work three times:
- execute independent runtime tasks in batches of `3` when feasible;
- perform one consolidated documentation sync after the batch:
  - `PLAN.md`;
  - `MEMORY.md`;
  - `NEXT_SESSION_PROMPT.md`;
  - auto-handoff generated files.

This keeps proofs complete while reducing repetitive documentation overhead.

## Verdict

Task 53 is closed when a dry-run produces:
- generated proposal;
- explicit target memory scope;
- no-auto-promote policy;
- token-budget check result;
- and batch documentation rule is encoded.
