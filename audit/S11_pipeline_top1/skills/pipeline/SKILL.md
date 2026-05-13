---
name: pipeline
description: >-
  Pipeline v2 routes work with minimal ceremony. It extracts a checklist,
  protects project-local state, chooses the smallest useful route, enforces a
  skill budget, and finishes with a criteria/proof check.
trigger: start task, new feature, implement, fix bug, refactor, pipeline
version: 2.0.0
requires: []
changelog:
  - 2.0.0 (2026-05-08): add checklist extraction, project guard, minimal route, skill budget, per-project state, and final criteria check
  - 1.4.0 (2026-04-28): integrate mattpocock skills for BUG/ARCH buckets
  - 1.3.0 (2026-04-27): add open-source discovery for new tool/library tasks
  - 1.2.0 (2026-04-26): add interview gate for complex tasks
  - 1.1.0 (2026-04-22): add declarative dependency gate
  - 1.0.0 (2026-04-22): initialize semver metadata
---

# /pipeline v2

Use `/pipeline` as the single orchestrator for a new task. It should make the
next action obvious, not add ceremony. Simple tasks bypass heavy workflow.

## Success Criteria

Return `success: true` only when all applicable predicates below are true:
- The requested outcome is produced in the expected file, branch, PR, report, or deployed resource.
- The extracted checklist is satisfied or each unchecked item is explained.
- Required verification command(s) complete successfully and the final response includes exact command names plus pass/fail evidence.
- Any required user approval, dependency gate, or handoff checkpoint is explicitly satisfied.
- Final response reports `success`, `criteria_checked`, `proof`, and `remaining_work`.
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
- Keep active state at `~/.claude/projects/<projectKey>/pipeline-state.json`.
- Treat `~/.claude/pipeline-state.json` as read-only legacy fallback only.

`projectKey` is lowercase basename slug plus `-` plus the first 8 sha1 hex chars
of the normalized absolute cwd lowercased with `/` separators.

## Per-Project State

Write `~/.claude/projects/<projectKey>/pipeline-state.json` once after
classification and before invoking any sub-skill:

```json
{
  "cwd": "<absolute cwd>",
  "task": "<user task, <=300 chars>",
  "complexity": "TRIVIAL | MEDIUM | COMPLEX | BUG | ARCH",
  "checklist": ["<criteria>"],
  "commands": { "test": "<cmd>", "lint": "<cmd>", "build": "<cmd>" },
  "domain": "frontend | backend | security | architect | qa | devops",
  "phase": "classified",
  "checkpoints": [{ "phase": "classified", "skill": "pipeline", "ts": "<ISO>" }],
  "ts": "<ISO>"
}
```

Sub-skills read this file first and append checkpoints when they finish.

## Minimal Route

Choose the smallest route that can satisfy the checklist:

- ULTRA-TRIVIAL: one tiny edit or answer; no state file after completion.
- TRIVIAL: edit directly, run the relevant verification, then final criteria check.
- MEDIUM: use `tdd` if behavior changes, then `inline-review`, verification, and `ship`.
- BUG: use `diagnose`, then a regression test/fix loop, then `inline-review` and `ship`.
- ARCH: use `architect-first`, then implementation slices, then `inline-review` and `ship`.
- COMPLEX: use `architect-first`, plan approval if needed, `sprint` slices, `inline-review`, and `ship`.

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

## Final Criteria Check

Before the final response:

- Re-read the extracted checklist.
- Confirm each item is satisfied, not merely attempted.
- Run the relevant test/build/lint or explain why none applies.
- Scan changed files for `console.log`, hardcoded secrets, and missing input validation at boundaries.
- Report exact proof: commands, outputs summarized, created/changed artifact paths.
- If anything remains, return `success: false` and name the blocker.

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
