# Harness Method — Per-Domain Playbooks

> Detail layer for `SKILL.md`. Each row follows the same shape: **guide** (what the agent reads
> before producing anything) → **brief** (the per-task instance of the guide) → **sensor**
> (what catches a violation, and how expensive it is to run) → **gate** (where enforcement
> actually blocks something).

## Domain table

| Domain | Guide (≈ constitution) | Brief | Sensor (type) | Gate |
|---|---|---|---|---|
| Code | architectural invariants | `spec.md` | tests/lint/types/dependency-graph — computational | block at pre-commit/CI |
| Marketing | brand voice, ICP, positioning | campaign brief | LLM-judge against a rubric + SEO/fact-check (inferential) → A/B (empirical) | block before publish |
| Business | principles, goals, market | PRD/GTM/decision doc | grill-me / red-team (inferential) → unit economics (empirical) | block before spending resources |
| Design | design system, brand | design brief | contrast/token checks (computational) + review rubric + gstack (inferential) | block before handoff to code |

## Code — concrete (via spec-kit)
- **New project**: `specify init` → `/speckit-constitution` → per feature:
  `specify → clarify → plan → checklist → tasks → analyze → implement`.
- **Teeth first**: foundational tasks = sensors + a **blocking** pre-commit + CI, written
  *before* feature code, not after.
- **Sensors by stack**:
  - TS: `tsc` + eslint-boundaries + dependency-cruiser + vitest.
  - Rust: `cargo check`/clippy + `cargo-deny` + `cargo test`, crate boundaries enforced by the
    **compiler** (a script walking `cargo tree`, exit 1 on a forbidden edge).
  - Python: ruff + mypy + import-linter + pytest.
- **Legacy code**: don't retrofit everything — cheap sensors in a blocking pre-commit plus a
  short `constitution.md`; run the full spec cycle only for *new* features.
- **Windows note**: pre-commit hooks run inside git-bash — call `.sh` sensors via `bash`, and
  verify they actually execute (don't assume `sh` semantics match PowerShell).

## Non-code (marketing / business / design)
- Sensors are mostly inferential + empirical → lean on **guide quality** + a
  **gate-before-publish** + feeding metrics back in, not on an automatic code-level block.
- **Ceremony scales with irreversibility**: expensive/irreversible (prod, ad spend, hiring) →
  heavier gate; draft/idea stage → light guide, don't choke off creativity.
- Skill plugins to reach for: `pm`, `research-autopilot`, `cto-playbook`,
  `design-an-interface`, `grill-me`, `gstack`/`agent-browser`, `obsidian-vault`.

## Worked checklist (any domain)
1. Write or update the guide artifact. If one already exists for the project, read it first —
   don't regenerate from a generic template (this would erase project-specific decisions).
2. Write the brief for the current task/feature/campaign, scoped to that guide.
3. Pick the cheapest sensor type that can actually catch the violation. Don't reach for an
   LLM-judge when a lint rule or a type check would do the job deterministically.
4. Decide *where* the gate sits (pre-commit, CI, pre-publish, pre-handoff) and wire it so it
   actually stops the bad outcome, not just logs it.
5. Live-fire: deliberately trigger the violation, capture the exact block output, revert.
   Without this step you have a guide, not a harness.
6. Note the proof in the project's checkpoint/handoff doc.

## Steering / self-evolve (human-gated)
A pain repeats N times → draft a new sensor/rule (e.g. via `/learn`) → **the user reviews and
merges it**. No autonomous config mutation, no background auto-pull. A dead or noisy sensor
gets deleted, not muted.

## Memory model (durable, on-demand — not injected every turn)
- **Long-lived**: `constitution.md` + `specs/*/` + `research.md` + `AGENTS.md`/`CLAUDE.md` + git.
- **Session**: `tasks.md` (progress) + git + a manual checkpoint on session handoff.
- **Auto on compact**: a PreCompact hook writing a one-shot briefing (git state + focus + working
  tree) — the one global hook this method keeps.

## Source
Full method writeup: `.planning/WORKING-SYSTEM.md` (this repo). Proof case: `HANDOFF.md` in
`<another-project>` (live-fire 2026-06-19).
