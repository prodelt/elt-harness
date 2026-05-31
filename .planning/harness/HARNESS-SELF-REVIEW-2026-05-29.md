# Harness Self-Review — Pipeline Setupper (S54)

> Filled-in `HARNESS_CHECKLIST.md` (ai-boost/awesome-harness-engineering, CC0 1.0) run against
> THIS repo's agent harness. Generated artifact: `.planning/harness-checklist-latest.{json,md}`.
> Re-run: `node tools/harness-checklist.js --root . --write`.

**Reviewed:** 2026-05-29
**Reviewer:** Claude (Opus 4.8) + elt
**Result:** **PASS** — 25 pass / 0 warn / 0 fail / 0 needs-justification
**Audited harness:** `tools/harness-runner.js` (S51/S52 phase engine + review gate) + AGENTS surface + hooks.

## Auto checks (17/17 PASS — programmatic facts)

| Category | Item | Status | Evidence |
|---|---|---|---|
| agent-instructions | docs exist & synced | ✅ | AGENTS.md + CLAUDE.md + .gemini/GEMINI.md present |
| agent-instructions | tool permissions explicit | ✅ | `permissions{allow,deny,defaultMode}` in settings.json |
| agent-instructions | verification gates defined | ✅ | AGENTS.md `## Commands` with test/doctor commands |
| tool-design | harness-runner tests | ✅ | tools/harness-runner.test.js (82/82) |
| tool-design | consistent returns | ✅ | `validateSchema` in harness-runner |
| context-delivery | state in files | ✅ | `.planning/` non-empty |
| context-delivery | compaction strategy | ✅ | context-budget-gate / session-size-guard / active-window.js |
| context-delivery | secret protection | ✅ | secret-scanner Bash gate |
| planning-artifacts | PLAN/IMPLEMENT templates | ✅ | `.planning/harness/templates/` |
| planning-artifacts | recent ARCHITECTURE | ✅ | ARCHITECTURE-2026-05-29-harness-checklist.md |
| planning-artifacts | milestones have verify | ✅ | `verify:` in plan templates/plans |
| permissions-sandbox | permissions defined | ✅ | settings.json permissions |
| permissions-sandbox | destructive confirmation | ✅ | /careful, /freeze, secret-scanner |
| permissions-sandbox | fs scoped | ✅ | git-workflow-audit enforces `-- .` |
| verification-loop | tests exist | ✅ | harness-runner test suite |
| verification-loop | doctor runs | ✅ | tools/doctor.js (PASS=34) |
| verification-loop | verification gates in docs | ✅ | AGENTS.md Commands |

## Manual checks (8/8 justified)

Written justifications live in `.planning/harness-checklist-justifications.json`; summary:

- **no-ambiguous-instructions** — AGENTS.md canonical, mirrors byte-synced; Gotchas enumerate traps.
- **tool-name-unambiguous** — verb-noun, 1:1 with doctor check ids.
- **single-responsibility** — phase engine / audit / aggregation split; gatherFacts (I/O) vs buildChecklist (pure).
- **error-messages-actionable** — doctor `repair` field carries exact next command.
- **context-scoped** — RAG-first → Graphify → Read; bounded SessionStart; budget/size hooks.
- **scope-boundaries-written** — every ARCHITECTURE/PLAN has In/Out-of-scope.
- **minimum-permissions** — hard blocks only for freeze/secrets/destructive/commit-quality; rest advisory.
- **eval-criteria-upfront** — architect-first v2; acceptance tests written before code this sprint.

## When this harness component should be removed

> Each component exists because the model can't do something yet.

| Component | Exists because | Can be removed when |
|---|---|---|
| harness-checklist auditor | model doesn't guarantee harness invariants stay consistent across edits | harness invariants are enforced by types/schema at build time, not a post-hoc script |
| harness-runner phase engine | model needs an explicit state machine to not skip plan→test→review gates | model reliably self-sequences fetch→plan→implement→verify→review without an external ledger |
| doctor aggregation | model can't hold whole-repo health in context | health signals are surfaced inline by the runtime as the agent edits |
| compaction hooks (budget/size) | finite context window | context windows large enough that long sessions never need compaction |
| secret-scanner | model can leak secrets into tool output | provider-side guarantees that secrets never enter agent-readable context |

## Real gaps found

None blocking. All auto dimensions pass; the harness is strong on machine-verifiable structure (docs, permissions, tests, secret protection, planning, doctor). The honest weak spots are the 8 manual judgment items — now documented rather than left implicit. Next harness work: **P2.2 Agent Harness Gate Integration** (wire harness-runner into the real pipeline workflow).
