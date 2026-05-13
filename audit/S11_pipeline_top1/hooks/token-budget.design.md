# Task 26 Design — Token-Budget Dashboard

## Goal

Generate daily markdown snapshots at `~/.claude/budget-YYYY-MM-DD.md` with columns:

- `project`
- `sessions`
- `avg_kb`
- `trend`

The dashboard must stay cheap enough for hook-adjacent CLI usage and must work on Windows paths.

## Current Constraints

- Session logs already live under `~/.claude/projects/<project>/*.jsonl`.
- `projects-dashboard.js` already uses a stat-first recursive walk and derives the project name from the first path segment under `~/.claude/projects`.
- Task 07 deferred the `Token trend` section because there was no historical window to compare against.
- No new external libraries are needed; Node built-ins are sufficient.

## Options

### A. Recompute trend only from raw JSONL every run

- Pros: no extra state; trend is derived directly from source logs.
- Cons: requires multi-window bucketing logic every run; more I/O; harder to keep output deterministic.

### B. Current snapshot from raw JSONL, trend from prior markdown snapshots

- Pros: cheap stat-only scan for current data; trend becomes explicit historical evidence; no hidden cache format.
- Cons: requires a small parser for previous `budget-*.md` reports.

### C. Persistent JSON cache beside the markdown reports

- Pros: easiest future analytics.
- Cons: adds mutable state and migration burden for a LOW/MED task.

## Decision

Choose **B**.

Implementation plan:

1. Walk `~/.claude/projects` recursively and collect `.jsonl` files newer than the configured window.
2. Group by project using the same first-path-segment rule as `projects-dashboard.js`.
3. Compute `sessions` and `avg_kb` from file sizes only.
4. Read older `budget-*.md` files, parse the markdown table, and recover the previous `avg_kb` per project.
5. Render trend as:
   - `new` if no previous row exists
   - `flat` when delta is within a small tolerance
   - `↑ +N%` or `↓ -N%` against the latest prior snapshot
   - `↑ 3d` / `↓ 3d` when the last three daily snapshots are monotonic

## Context7 Evidence

Context7 was only useful here for the **Node core FS primitives**, not for a ready-made dashboard architecture.

- `resolve_library_id("node")` selected `/nodejs/node`.
- `query_docs(/nodejs/node, ...)` confirmed these keep-decisions:
  - keep `fs.readdirSync(..., { withFileTypes: true })` for lightweight directory walking
  - keep `fs.statSync()` before file reads for metadata-first aggregation
  - keep `path.join()` / `path.relative()` for Windows-safe path handling
  - keep `fs.mkdirSync({ recursive: true })` + `fs.writeFileSync(..., "utf8")` for report output

Context7 did **not** provide a relevant higher-level “token budget dashboard” pattern, so architecture stays repo-local and follows the existing `projects-dashboard.js` / `weekly-analysis.js` style.

## Gold Standard Check

- No capability loss: this adds a new report and does not change existing hooks.
- Zero coupling: standalone CLI script plus apply script; no new shared mutable cache.
- Test strategy: deterministic fixture with synthetic budget history proving `new`, `flat`, and `3d` direction behavior.
