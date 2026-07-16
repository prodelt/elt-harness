# Pipeline audit finished

**Status:** COMPLETE (2026-04-18, S9 wave 2 closed)

Full audit retrospective: `audit/S8_final/AUDIT_COMPLETE.md` + `audit/S9_burn_wave2/CHANGES.md`.

## Outcome

- **19 bugs catalogued → 16 resolved, 2 deferred (runtime-level), 1 design decision.**
- **86/86 hook tests PASS** (`test-all-hooks.js` 29/29 + `test-codex-hooks.js` 28/28 + `test-hooks-behavior.js` 29/29).
- **Token burn:** 196K/session baseline → ~90K/session projected (≈2.2× efficiency). Residual gap = B03 Edit tool `originalFile` (needs upstream fix).
- **Score:** 40→82 / 100.
- **Public README** (`Pipiline setupper/README.md`) ready for GitHub share.

## Sprint archive

| Sprint | Commit | Focus |
|---|---|---|
| S1 | `c5710f0` | Evidence gathering from 3 projects |
| S2 | `c5710f0` | 19-bug catalog |
| S3 | `b41d941` | Token optimization wave 1 (B02, B13) |
| S4 | `3570047` | Hook bugfixes (B01, B05-B07, B10, B11, B15) |
| S5 | `3bdc8af` | Skills + docs automation (B04, B08, B14) |
| S6 | `eac0e51` | File-size rule (B03 partial) |
| S7 | `d67bf41` | Red-team / prime / learn polish |
| S8 | (prior) | Config consolidation + test enforcement + final report (B12, B16, B17) |
| S9 | (this) | Token burn wave 2 — evidence-driven (schema-guard, write-over-edit, bash-advisor, analyze-session tool) |

## S9 highlights

- **New hooks:** `settings-schema-guard.js` (prevents 223K schema-error round trip), `write-over-edit-guard.js` (forces Edit on existing files ≥150 LOC), `bash-output-advisor.js` (suggests output limiters).
- **New tool:** `analyze-session.js` — reproducible token-burn breakdown for any JSONL transcript.
- **Modified:** `loop-guardian.js` Layer B → advisory (exit 0, threshold 5→8). `graphify-session-init.js` silent when no graph. `project-docs-gate.js` removed duplicate Graphify advisory.
- **Config:** `skillOverrides` for 20+ rarely-used skills = `user-invocable-only`. `skillListingMaxDescChars: 512`. Saves ~15K/session.
- **Docs:** `rules/rules.md` compressed 141→64 LOC.

## Post-audit roadmap (non-urgent)

1. **Upstream feature request:** diff-only Edit tool payload (unlocks another 2× burn efficiency).
2. **Upstream feature request:** native per-project skill filtering (closes B09/B18 fully).
3. **Operational monitoring:** `node ~/.claude/hooks/hook-stats.js` at end of each real work session.
4. **Periodic audit:** run `node ~/.claude/hooks/analyze-session.js <latest.jsonl>` monthly to spot new leaks.

## If you land here looking for S10 work

Audit objectives met. If new bugs surface, start a fresh `PIPELINE_AUDIT_YYYY-MM-DD.md` catalog. Do not append to the 2026-04-17 one.
