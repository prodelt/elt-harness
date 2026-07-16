# S8 Changes — Final Sprint

**Date:** 2026-04-18
**Scope:** B12 + B16 + B17 + token-burn measurement + final audit report

## Files changed

### New files

| Path | Purpose |
|---|---|
| `~/.claude/CONFIG_MAP.md` | B12 — documents config split across settings.json/hooks/config.json |
| `~/.claude/ISOLATION_POLICY.md` | B17 — documents shared-hooks design decision |
| `audit/S8_final/CHANGES.md` | This file |
| `audit/S8_final/AUDIT_COMPLETE.md` | Final audit retrospective — 19 bugs → 16 resolved / 2 deferred / 1 design decision |
| `audit/S8_final/token-burn-measurement.md` | Baseline (196K/session) → projected (124K/session) = 1.6× efficiency |

### Modified files

| Path | Change |
|---|---|
| `~/.claude/hooks/config.json` | Added `_related` cross-ref pointing to settings.json + CONFIG_MAP.md. Bumped `_version` to 1.0.1. |
| `~/.claude/hooks/stop-verification.js` | Added B16 test-run check: scans last 256KB of transcript for `npm test`/`pytest`/`go test`/`cargo test`/`test-all-hooks` when code files are modified. Hoisted `os` import to top. |

## B12 — Config consolidation

**Decision:** Variant B (explicit cross-ref), not Variant A (unified file).
**Reason:** Claude Code `settings.json` is schema-validated and rejects custom keys (`additionalProperties`). Attempting to add `_configFiles` there fails schema check. So we:
1. Added `_related` metadata block in `hooks/config.json` pointing to the runtime settings file.
2. Created `~/.claude/CONFIG_MAP.md` as the single source of truth documenting the split, key thresholds, and editing workflow.

## B16 — Stop verification test enforcement

**Implementation:** `stop-verification.js` now:
1. Resolves transcript path from `session_id` if `transcript_path` not in input (same pattern as context-budget-gate).
2. If there are modified code files (`.js|.ts|.go|.py|.rs|.java|.cs|.rb|.php|.vue|.svelte` in `git diff`) AND no test-runner pattern in the last ~50 tool_use events → warn.
3. Pattern covers: `npm test`, `npm t`, `yarn test`, `pnpm test`, `pytest`, `go test`, `cargo test`, `jest`, `vitest`, `mocha`, `phpunit`, `rspec`, plus our own `test-all-hooks`, `test-hooks-behavior`, `test-codex-hooks`.
4. Metrics: `stop-verification.tests_not_verified` counter incremented per warn.

Non-blocking (stay advisory). ship-gate.js remains the sole blocker.

## B17 — Codex/Antigravity isolation

**Decision:** Document as design choice, not isolate.
**Reason:**
- Shared hooks = single source of truth across 3 tools = fewer fixes, no drift.
- `hooks/lib/` already delivers the useful subset of option (b) (shared utils + thin entries).
- Fail-safe patterns (exit 0 on error, bounded timeouts, no external deps) mitigate the shared-failure risk.
- 80/80 test suite catches breakage before commit.

`~/.claude/ISOLATION_POLICY.md` records the rationale, fail-safe patterns, and kill-switches.

## Token burn measurement

**Baseline:** S1 empirical (72 sessions, 14.1M tokens) = 196K/session average.
**Projected post-S7:** ~124K/session (−37%, 1.6× efficiency).
**Gap to 2–5× target:** dominated by B03 (Edit tool `originalFile` duplication — runtime-level, cannot hook-fix).
**Mitigations that closed what we could:** project-docs-gate hard-block, loop-guardian frequency cap, tool-results TTL, ctxBudget/autocompact tuning, pipeline-state shared context.

See `audit/S8_final/token-burn-measurement.md` for full model.

## Test results

```
node ~/.claude/hooks/test-all-hooks.js          →  26/26 PASS
node ~/.codex/test-codex-hooks.js               →  25/25 PASS
node ~/.claude/hooks/test-hooks-behavior.js     →  29/29 PASS
─────────────────────────────────────────────────────────────
                                                   80/80 PASS
```

## Audit closure

After S8, `audit/NEXT_SESSION_PROMPT.md` flips to **"Pipeline audit finished"** marker. No S9 planned. Residual work is upstream feature requests (diff-only Edit) or operational monitoring.
