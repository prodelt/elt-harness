---
name: pipeline
description: >-
  Pipeline v3 classifies first, refreshes project state, chooses auto or
  interview mode, records a session ledger, and closes with proof.
trigger: start task, new feature, implement, fix bug, refactor, pipeline
version: 3.2.0
requires: []
changelog:
  - 3.2.0 (2026-06-03): add agent skill supply-chain preflight before non-trivial routing
  - 3.1.0 (2026-05-30): add Agent Harness section for COMPLEX/ARCH -- runId link, gate-backed evidence, verifyCloseout
  - 3.0.0 (2026-05-20): add auto/interview routing, lifecycle refresh, session ledger, and mandatory closeout proof
  - 2.0.0 (2026-05-08): add checklist extraction, project guard, minimal route, skill budget, per-project state, and final criteria check
  - 1.4.0 (2026-04-28): integrate mattpocock skills for BUG/ARCH buckets
  - 1.3.0 (2026-04-27): add open-source discovery for new tool/library tasks
  - 1.2.0 (2026-04-26): add interview gate for complex tasks
  - 1.1.0 (2026-04-22): add declarative dependency gate
  - 1.0.0 (2026-04-22): initialize semver metadata
---

# /pipeline v3

Use `/pipeline` as the front door for non-trivial work. It must classify first,
refresh state before any deeper routing, and make the next action obvious.
Trivial work stays cheap; complex work earns structured discovery.

## Success Criteria

Return `success: true` only when all applicable predicates below are true:
- The requested outcome is produced in the expected file, branch, PR, report, or deployed resource.
- The extracted checklist is satisfied or each unchecked item is explained.
- Required verification command(s) complete successfully and the final response includes exact command names plus pass/fail evidence.
- Any required user approval, dependency gate, or handoff checkpoint is explicitly satisfied.
- Final closeout reports `success`, `criteria_checked`, `proof`, and `remaining_work`.
- If any predicate cannot be verified, return `success: false` with `remaining_work` and the blocking reason.

## Checklist Extraction

Before routing, extract a short checklist from the user request:

- outcome: the artifact or behavior the user expects;
- scope: files, modules, or systems in and out of scope;
- verification: commands or observable checks that prove the outcome;
- risk: data loss, API contract, security, dependency, or deployment risk;
- docs: whether AGENTS/CLAUDE/GEMINI, ADR, README, changelog, or codemap needs an update.

If the request is ambiguous, ask at most one focused question. If the next step
is clear, proceed without asking.

## Project Guard

Run these guards before any edit:

- Confirm `AGENTS.md` or `CLAUDE.md` exists at the project root.
- Read project commands and gotchas from the docs.
- Inspect `git status --short` and do not revert unrelated user changes.
- Use Context7 before writing code that uses an external library.
- For non-trivial routes, run the Agent Skill Supply-Chain Preflight before
  invoking any domain, verifier, or ship skill.
- Keep active state at `~/.claude/projects/<projectKey>/pipeline-state.json`.
- Treat `~/.claude/pipeline-state.json` as read-only legacy fallback only.

`projectKey` is lowercase basename slug plus `-` plus the first 8 sha1 hex chars
of the normalized absolute cwd lowercased with `/` separators.

### Agent Skill Supply-Chain Preflight

For any route above ULTRA-TRIVIAL, audit the agent skill supply chain before
loading sub-skills or starting implementation:

```bash
agent-skills.cmd audit
# If the wrapper is unavailable:
node <central>/tools/agent-skill-supply-chain.js audit
```

Record the command and result in the session ledger. Run repair commands only
when explicitly applying a rollout:

```bash
agent-skills.cmd install-skills --target all --apply
agent-skills.cmd rollout-projects --apply
```

Without explicit apply approval, use audit-only mode and report required repair
actions as remaining work.

## Classification

Classify before any skill body is loaded or any broad code search starts.

- `TRIVIAL`: one small direct change or answer.
- `MEDIUM`: bounded task with known scope.
- `BUG`: failure reproduction or regression work.
- `ARCH`: architectural decision or refactor shape.
- `COMPLEX`: multi-file, multi-step, or cross-system work.
- `RESEARCH`: evidence gathering before implementation.

Also decide the route mode:

- `auto` mode for trivial or already-clear tasks.
- `interview` mode for complex, ambiguous, architectural, security, or multi-file work.

Rules:

- One active goal per session.
- Store `goal` and `doneWhen` explicitly in state.
- At most one focused question at a time, with 2-3 answer variants plus free-form override.
- Required state refresh at classification.

## State Lifecycle

Lifecycle phases:

- `classified`
- `planned`
- `implementing`
- `verified`
- `shipped`
- `closed`

Refresh active state before deeper routing:

- If project-local state exists and is fresh, read it first.
- If state is stale, closed, or points at another project, replace it before continuing.
- If state is active but no longer matches the goal, close it and write a fresh state.

Write `~/.claude/projects/<projectKey>/pipeline-state.json` once after
classification and before invoking any sub-skill:

```json
{
  "cwd": "<absolute cwd>",
  "projectKey": "<slug-hash>",
  "task": "<user task, <=300 chars>",
  "goal": "<single active goal>",
  "doneWhen": "<completion criteria>",
  "complexity": "TRIVIAL | MEDIUM | BUG | ARCH | COMPLEX | RESEARCH",
  "mode": "auto | interview",
  "phase": "classified | planned | implementing | verified | shipped | closed",
  "routers": {
    "skill": { "selected": "<skill or none>", "alternatives": ["<alt>"] },
    "research": { "selected": "<provider or none>", "alternatives": ["<alt>"] }
  },
  "commands": {
    "build": "<cmd>",
    "test": "<cmd>",
    "lint": "<cmd>",
    "doctor": "<cmd>",
    "hooks": "<cmd>"
  },
  "ledgerPath": "<project-local session-ledger.jsonl>",
  "checkpoints": [{ "phase": "classified", "skill": "pipeline", "ts": "<ISO>" }],
  "ts": "<ISO>",
  "expiresAt": "<ISO>",
  "closedAt": null
}
```

Sub-skills read this file first and append checkpoints when they finish.

## Session Ledger

Maintain a project-local session ledger JSONL. Each notable step appends one
small record, not a transcript.

Required ledger events:

- task classification and confidence;
- chosen skills and rejected alternatives;
- research sources used;
- model/effort selection;
- hook warnings, blocks, and errors;
- verification commands and result summary;
- docs and Git actions;
- final outcome.

## Minimal Route

Choose the smallest route that can satisfy the checklist:

- ULTRA-TRIVIAL: one tiny edit or answer; no state file after completion.
- TRIVIAL: edit directly, run the relevant verification, then final closeout.
- MEDIUM: use `tdd` if behavior changes, then `inline-review`, verification, and `ship`.
- BUG: use `diagnose`, then a regression test/fix loop, then `inline-review` and `ship`.
- ARCH: enter `interview` mode, use `architect-first`, then implementation slices, `inline-review`, and `ship`.
- COMPLEX: enter `interview` mode, use `architect-first`, `sprint` slices, `inline-review`, and `ship`.
- RESEARCH: keep changes minimal, route through compact evidence collection, then decide whether implementation should start.

Do not run heavyweight flow for a small config tweak, typo, or one-file
mechanical edit.

## Skill Budget

Default budget: no more than one orchestrator + one domain + one verifier.

- Orchestrator: `pipeline` only.
- Domain: one of `architect-first`, `diagnose`, `tdd`, `sprint`, or a specific domain skill.
- Verifier: `inline-review`, `security-best-practices`, or `ship`.

Use more skills only when the user asks, the task is explicitly multi-domain, or
verification exposes a concrete risk. State the reason before expanding the
budget.

## Interview Mode

Use `interview` mode only when it lowers execution risk more than it costs.

- Ask one focused question at a time.
- Offer 2-3 answer variants plus free-form override.
- Write or refresh state before asking the next question.
- Stop interviewing once the route is clear enough to act.

## Final Closeout

Before the final response:

- Re-read the extracted checklist.
- Confirm each item is satisfied, not merely attempted.
- Run the relevant test, build, lint, doctor, or hook verification, or explain why none applies.
- Scan changed files for `console.log`, hardcoded secrets, and missing input validation at boundaries.
- Record final verification and outcome in the session ledger.
- Set active state to `closed` with `closedAt`.
- Final response cannot claim success without artifact and verification proof.

## Output Shape

End with:

```json
{
  "success": true,
  "criteria_checked": ["<check>"],
  "proof": ["<command or artifact>"],
  "remaining_work": []
}
```

Use prose around the JSON only when it helps the user understand the result.

## Agent Harness (COMPLEX/ARCH)

For COMPLEX or ARCH tasks, drive verification through the harness gate layer.
This ensures every quality gate produces machine-readable evidence before transition.

### Setup

After classification, create a harness run and link it to pipeline state:

```bash
harness-runner create <taskId> --root . --json
# -> { "runId": "run-YYYYMMDDHHMMSS-xxxxxx", "phase": "fetch_context" }
```

Link `runId` in pipeline-state via the pipeline-state helper (`attachHarnessRun`)
or the existing pipeline integration so the session ledger tracks it.

### Drive phases

Run one gate per completed phase. Do not call `transition` directly:

```bash
harness-gates run-gate <runId> --root . --json
```

| Phase | What the gate checks |
|---|---|
| `fetch_context` | auto-pass |
| `plan_design` | ARCHITECTURE-*.md or artifacts.design |
| `implement` | auto-pass (always forwards) |
| `linter` | `commands.lint` exit code |
| `tests` | `commands.test` exit code |
| `code_review` | docs-delta + submitReview (COMPLEX -> high finding if no docs) |
| `git_push` | git-workflow-audit artifact |

Inspect the gate plan before starting:

```bash
harness-gates gate-plan <runId> --root . --json
```

### Closeout

Before declaring `success: true`, verify all gates passed:

```bash
harness-gates closeout <runId> --root . --json
# -> { "ok": true } required
```

`verifyCloseout` returns `ok: false` if any phase record is missing `gateEvidence`
(proof that the phase went through a real gate, not a manual transition).

Do not claim success without `verifyCloseout ok: true`.
