---
name: architect-first
description: Guide for implementing the Architect-First development philosophy - perfect architecture, pragmatic execution, quality guaranteed by tests. Use this skill when starting new features, refactoring systems, or when architectural decisions are needed. Enforces non-negotiables like complete design/documentation before code, zero coupling, and validation by multiple perspectives before structural decisions.
source: https://github.com/SynkraAI/aiox-core
stars: 2515
---

# Architect First

**Core principle: Architecture and documentation BEFORE code. Tests are the safety net that permits pragmatic execution.**

## pipeline-state (B14)
If `~/.claude/pipeline-state.json` exists, its `cwd` matches current project, and `ts` is within 24h → read `task`, `stack`, `commands`, `domain` from it. Do NOT re-parse CLAUDE.md for those. After this skill completes, append `{ "phase": "architected", "ts": "<ISO>" }` to `checkpoints[]` and set `phase=architected`.

## Quality Gates

### Non-Negotiable (STOP if violated)
- Complete design + docs BEFORE any code
- Never lose capability vs previous version
- Zero coupling between modules
- Structural decisions validated by multiple perspectives
- No hardcoded mutable config values (use YAML/env)

### Negotiable (with test safety net)
- Code style — acceptable IF backed by tests
- Feature completeness — 80% OK if core use case works
- Quick & dirty — allowed ONLY with test plan + logging

## Workflow Decision Tree

```
New Task
    ↓
Is this structural/architectural?
    ↓ YES                    ↓ NO
[Architecture Flow]    [Execution Flow]
```

### Architecture Flow

1. **Map Before Modify** — document current state, all dependencies
2. **Multi-perspective Validation** — present A/B/C options with trade-offs, get validation
3. **Design Doc BEFORE Code** — architecture diagrams, component interactions, data flows, config schema
4. **Gold Standard Check** — does new design maintain ALL previous capabilities?
5. **Zero Coupling Check** — no hardcoded cross-module dependencies
6. **Now implement**

### Execution Flow

1. Pre-implementation checklist:
   - [ ] Architecture documented and validated?
   - [ ] Core use case clearly defined?
   - [ ] Config externalized?
   - [ ] Test strategy defined?
2. Define test plan FIRST
3. Implement (can be "ugly" if tests cover it)
4. Validate: tests pass + logs confirm behavior

## Hard Stop Rules

STOP immediately if detecting:
- Capability loss vs baseline
- Structural decision without multi-perspective validation
- Coupling between modules
- Missing architectural documentation
- Quick & dirty code WITHOUT test plan + logs
- Hardcoded mutable config values

## Heuristics

1. **Architect Before Build** — design/docs always before code
2. **Never Lose Capability** — accumulate, never reduce
3. **Zero Coupling, Max Modularity**
4. **Config > Hardcoding** — externalize all mutable values
5. **Map Before Modify** — document structure before changing it
6. **Quality Escape Hatch** — tests permit temporary imperfection
7. **Speed via Automation** — not via shortcuts

## Acceptance Criteria

**Accept:**
- "Ugly" code WITH comprehensive tests
- 80% features IF core case covered
- Large refactors that increase flexibility

**Reject:**
- "Ugly" code WITHOUT tests
- Capability loss without explicit justification
- Hardcoded mutable values
- Deployment without core case working

## Quick Reference

**Starting new feature:**
1. Map current architecture
2. Design A/B/C options
3. Validate with stakeholders
4. Document architecture + ADR
5. Define tests
6. Implement with logging
7. Validate and iterate

**Quick implementation (safety net mode):**
1. Pre-implementation checklist
2. Define test plan
3. Add log points
4. Implement
5. Verify tests pass
6. Inspect logs
7. Refactor if needed
