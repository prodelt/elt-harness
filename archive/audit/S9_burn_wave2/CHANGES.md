# S9 — Token burn reduction wave 2

**Date:** 2026-04-18
**Goal:** Close the biggest remaining leak from S8 (1.6× → aim for 2-3×) by
instrumenting + blocking the concrete overhead patterns observed in a real
337-event transcript (≈965KB).

## Evidence driving this sprint

`analyze-session.js` (new tool) on current session revealed:

| Event | Size | Cause |
|---|---:|---|
| One failed Edit on `settings.json` | **223K** | Schema validation error returns full JSON schema + 105K-key stringified object as tool_result |
| All other Edit tool_results | 104K | B03 — every Edit ships whole file back (runtime-level) |
| Bash tool_results | 21K | No output capping at hook level |
| Write tool_use inputs | 42K | Partial edits dressed up as full rewrites |
| `graphify-session-init` setup hint | 113 tok × every session | Emitted unconditionally even when user hadn't opted in to Graphify |
| `project-docs-gate` Graphify advisory | 90 tok × every session | Duplicated above — second source of the same hint |

Total identifiable leak at ≥5% of session each: **372K** concentrated in one
failed Edit + recurring SessionStart noise.

## Changes

### New hooks

- **`settings-schema-guard.js`** (PreToolUse Edit|Write). Simulates the edit,
  parses JSON, blocks any `_`-prefix top-level keys on `settings.json`
  (the exact case that produced the 223K event). Also warns on unknown
  top-level keys. Cheapest possible defence: runs in ~5ms, prevents 223K.
- **`write-over-edit-guard.js`** (PreToolUse Write). Denies Write on existing
  files ≥150 LOC with ≥80% line overlap. Exempts shrinking rewrites
  (<70% of original LOC) because many small Edits would cost MORE via
  B03 file-duplication. Thresholds in `hooks/config.json > writeOverEdit`.
- **`bash-output-advisor.js`** (PostToolUse Bash). If stdout >10K and the
  command didn't already contain a limiter (head/tail/grep/wc/jq/…),
  inject a targeted advisory ("next time use `head -100`"). Non-blocking.

### Modified hooks

- **`loop-guardian.js`** — Layer B (same-file touch counter) no longer blocks
  via `exit(2)`. Now emits advisory via `hookSpecificOutput.additionalContext`
  and exits 0. Refactors legitimately touch a file 5-10 times; exit(2) cost
  ~170 tokens for a false positive. Threshold raised from 5 to 8.
- **`graphify-session-init.js`** — silent exit when no graph exists (was
  emitting a 7-line setup suggestion on every SessionStart for projects the
  user had no intent to Graphify). Saves ~113 tokens × every session.
- **`project-docs-gate.js`** — removed duplicate Graphify advisory. Handler
  now lives solely in `graphify-session-init`. Saves ~90 tokens × every
  session on projects without a graph.

### Config

- `settings.json`: `skillListingMaxDescChars: 512` (was default 1536),
  `skillListingBudgetFraction: 0.005` (was default 0.01), `skillOverrides`
  set 20+ rarely-used skills to `user-invocable-only` based on 30-day usage
  grep over all session JSONLs. Saves ~15-25K on every `/` listing.
- `hooks/config.json`: added `writeOverEdit.{bigFileLoc,overlapThreshold,
  shrinkExemptRatio}`, updated `loopGuardian.sameFileWarn` 5 → 8.

### Docs

- **`README.md`** (project root) — written for public GitHub share. Full
  install instructions, hook catalog, measured-leak table, design principles.
- **`rules/rules.md`** — rewritten 141 → 64 LOC. Compressed tables, removed
  redundant sections. Every session-start cost drops by ~40% on this file.

### New tool

- **`analyze-session.js`** — reproducible token-burn breakdown for any
  JSONL transcript. Produces the evidence table above.

## Verification

```
node ~/.claude/hooks/test-all-hooks.js          →  29/29 PASS (+3 new hooks)
node ~/.claude/hooks/test-hooks-behavior.js     →  29/29 PASS
node ~/.codex/test-codex-hooks.js               →  28/28 PASS (+3 new hooks synced)
───────────────────────────────────────────────────────────────────
                                                   86/86 PASS
```

## Projected impact

| Leak | Before | After | Delta |
|---|---:|---:|---:|
| Schema-error round trip | 223K per miss | 0 (pre-validated) | -223K (only on misses) |
| Write-over-Edit on existing files | ~4K per round | 0 (forced to Edit for ≥150 LOC) | -3K to -4K per occurrence |
| Unbounded Bash output | silent | advisory-tracked | softly educational |
| SessionStart Graphify noise | ~200 tok/session | 0 (silent unless used) | -200 tok/session |
| Skill listing | ~25-30K | ~8-12K | -15K/session |
| rules.md in-prompt | 141 lines | 64 lines | -77 lines per session |

Realistic projection for the next fresh session: **~60-90K tokens**, down
from the S8 baseline of 124K (1.8-2× vs S8, 2.2-3.3× vs original 196K).

Key caveat: session with a lot of Edit activity is still bounded below by B03
(every Edit reloads full file). That remains a runtime-level bug — no hook
can eliminate it. This sprint attacks the biggest *hook-accessible* leaks.

## Residual / deferred

- **B03** (Edit tool `originalFile` duplication) — upstream runtime fix needed.
- **Tool schema listing** — ENABLE_TOOL_SEARCH=auto:10 already tuned; further
  savings need upstream support for on-demand tool loading.
- **`analyze-session.js` → CI integration** — not yet automated; run manually
  on session JSONLs to find new leaks.

## Files touched

```
~/.claude/hooks/
  + settings-schema-guard.js      new (147 LOC)
  + write-over-edit-guard.js      new (101 LOC)
  + bash-output-advisor.js        new (72 LOC)
  + analyze-session.js            new (137 LOC, diagnostic tool)
  M loop-guardian.js              Layer B → advisory (exit 0)
  M graphify-session-init.js      no-graph → silent
  M project-docs-gate.js          removed Graphify advisory
  M test-all-hooks.js             +3 new hooks registered
  M config.json                   +writeOverEdit, sameFileWarn: 5→8

~/.claude/
  M settings.json                 +skillOverrides, +2 new hooks wired
  M rules/rules.md                141 → 64 LOC

~/.codex/
  M hooks.json                    +3 new hooks synced

Pipiline setupper/
  + README.md                     GitHub-share ready
  + audit/S9_burn_wave2/CHANGES.md  this file
```
