---
description: ELT v3 — Antigravity writes; external Codex or Claude reviews, fixes, judges, and closes the slice.
---

# /elt — Antigravity IDE adapter

Before any task action, open `C:\Users\user\.gemini\skills\elt\SKILL.md` directly with ReadFile and read it completely. Do not search for it and do not claim that ELT is loaded until that read succeeds. Treat the text after `/elt` as the user's goal and follow the skill, with this adapter:

- Antigravity is the writer/orchestrator. It must never review, fix, judge, or attest its own code.
- For a code slice, use the existing `C:\Claude playground\Pipiline setupper\tools\elt-loop.ps1` driver with `-WriterProvider agy` and `-Slices 1` unless the user explicitly requests an autonomous multi-slice run.
- Use external Codex (`-JudgeProvider codex -JudgeModel gpt-5.6-sol`) as fixer/judge by default. If the user explicitly chooses Claude, use `-JudgeProvider claude -JudgeModel sonnet` instead.
- Pass the current workspace as `-Project` and the selected plan as `-SpecDir`. Create or select the task/plan first as required by the ELT skill.
- Do not invoke deprecated `/pipeline`, `harness-runner`, `harness-gates`, or `pipeline-state`. Preserve CodeGraph, the project oracle, harness config, and opt-in Fleet.

Start the first response with `elt → <mode>`.
