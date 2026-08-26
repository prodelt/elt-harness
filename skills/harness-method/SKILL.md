---
name: harness-method
description: Bootstraps a per-project harness (guide + sensor + enforcement + steering loop, Fowler-style, no global per-turn tax) for a new project, feature, or campaign — code, marketing, business, or design. Use when starting new work and you need real enforcement (a gate that blocks) instead of advisory nagging, or when asked to "apply the harness method" / "set up WORKING-SYSTEM" / "make this gate have teeth".
version: 1.0.0
requires: []
changelog:
  - 1.0.0 (2026-06-19): extracted from .planning/WORKING-SYSTEM.md after the AMOS decommission; proof case is <another-project> (live-fire 2026-06-19)
---

# /harness-method — Reusable Multi-Domain Harness Bootstrap

## Model (one line)
Agent = Model + **Harness**. Harness = **guide** (steers BEFORE) + **sensor** (catches AFTER)
+ **enforcement** (blocks at the right moment) + **steering loop** (grows from repeats).
Computational sensors are cheap/deterministic — run on every change. Inferential (LLM-judge)
and empirical (metrics) sensors are expensive — use only where computational isn't possible.

## Why this exists
This replaces the previous global AMOS hook layer, which degraded into advisory nagging
("fire-and-dismiss") instead of real enforcement. The fix: push the harness into *each
project*, keep it minimal, and make at least one sensor an actual blocking gate — proven with
a live-fire test, not just green CI.

## Quick start
1. Ask which domain this work is: Code / Marketing / Business / Design (can be more than one).
2. Open `REFERENCE.md` and use the matching playbook row (guide artifact, sensor types, where
   the gate sits).
3. Create the guide artifact for that domain (`constitution.md` / campaign brief / PRD /
   design-system doc) — this is what the agent reads *before* producing anything.
4. Wire the sensor(s). Prefer computational (lint/types/tests/dependency-graph for code;
   contrast/token checks for design). Fall back to inferential/empirical only when nothing
   computational fits.
5. Make ONE sensor a real **blocking** gate (pre-commit/CI for code; a pre-publish checklist
   that actually stops publishing for non-code). A guide with no gate is decoration.
6. **Live-fire the gate**: deliberately violate the rule, show the block with its exact output,
   then revert. This is the Definition of Done — not "tests are green."
7. Record the proof (command run + output) in the project's handoff/checkpoint. "Done" only
   with evidence — see global rule in `~/.claude/CLAUDE.md`.

## Red lines (anti-AMOS)
1. Never inject into context every turn (no docs, no nudges, on every single turn).
2. **Enforce, don't nag** — a control either blocks or stays silent.
3. Never auto-mutate config or install things in the background.
4. Config is per-project. Globally, only a PreCompact hook + codegraph MCP are allowed.
5. A dead or noisy control gets deleted (steering), not silenced/ignored.
6. "Done" only with proof (build/test output shown, not asserted).
7. Token budget (rounds × prefix size) is a design metric, not an afterthought.

## Proven case
**Code domain**, `<another-project>` (`<another-project>`):
Cargo workspace + `cargo-deny` + a crate-boundary script (`scripts/check-crate-boundaries.sh`,
via `cargo tree`) + husky blocking pre-commit. Live-fire 2026-06-19: adding a forbidden
`fixture-module` dependency to `crates/gateway/Cargo.toml` and committing was **rejected**
(`FITNESS VIOLATION ... Principle II`, exit 1); the change was then reverted. Full transcript
and remaining tasks: that project's `HANDOFF.md`. Full method writeup: this repo's
`.planning/WORKING-SYSTEM.md`.

## Details
See `REFERENCE.md` for the per-domain playbook table (guide artifact, sensor types, gate
placement, worked checklist per domain) and the spec-kit cycle used for the code domain.
