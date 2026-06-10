# Project: AMOS (Agent Mini-OS) — Sprint 0 & 1

## Architecture
AMOS is a unified CLI kernel (`amos`) that consolidates hooks, metrics, settings, and handoffs under a single SQLite-backed state store.
- **Client hooks**: Simple delegation (`amos event <name>`) in Claude Code, Codex, and Gemini.
- **Event Router**: Parses JSON from stdin, logs execution time, duration, and output characters.
- **State Store**: SQLite (`~/.amos/state.sqlite`) containing:
  - `sessions`: Session continuity logs.
  - `events_metrics`: Fired events, durations, characters.
  - `projects`: Project registry.
  - `handoffs`: Handoff records.
- **Profiles**: Configures behavior profile via `AMOS_PROFILE=minimal|standard|strict`.
- **Bypass**: Configures bypass via `AMOS_DISABLE=1`.
- **Fail-soft**: Any kernel crash must write to `~/.amos/errors.log` and exit 0 silently.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| M0 | Sprint 0: Baseline Freeze | Create `system-upgrade/amos-kernel` branch + tag `v3-legacy`, commit uncommitted AMOS files, perform baseline measurements. | none | DONE |
| M1 | Sprint 1: Kernel Core CLI | Create `~/.amos` repo, build event router CLI `bin/amos.js`, fail-soft, and profiles. | M0 | DONE |
| M2 | Sprint 1: SQLite State Store | Integrate SQLite (`node:sqlite` / `better-sqlite3`), define database schema, implement metric insertion and `amos report`. | M1 | DONE |
| M3 | Sprint 1: Tests & Wrappers | Develop `amos.cmd` / `amos.ps1` wrappers, write >=40 unit tests, verify cold start speed. | M1, M2 | DONE |
| M4 | Merge & Final Verification | Sequentially merge all branches, run E2E test verification, run checks. | M0, M1, M2, M3 | DONE |

**Verification (2026-06-10, coordinator re-check):** all M0-M4 acceptance criteria reproduced live — see `.planning/AMOS-BASELINE.md` §5 for proof (52/52 tests, 100-130ms cold start, 185B stdout, fail-soft DB error, `amos.cmd status` from arbitrary cwd, `amos report` event counts). 4 agent branches (`amos/sprint0-baseline`, `amos/sprint1-kernel`, `amos/sprint1-state`, `amos/sprint1-tests`) merged into `amos/sprint1-kernel`; `amos/` in-repo copy resynced with canonical `~/.amos`. Sprint 0+1 closed; Sprint 2 spec in `.planning/PROMPT-SPRINT-2-AMOS.md`.

## Interface Contracts
### CLI Event Input format (stdin)
JSON structure:
```json
{
  "session_id": "string",
  "cwd": "string",
  "hook_event_name": "string",
  "data": {}
}
```
### CLI Event Output format (stdout)
- `session-start` handler:
  ```json
  {
    "hookSpecificOutput": {
      "additionalContext": "string"
    }
  }
  ```
  Note: Output must be under 2KB.
- `stop` handler:
  ```json
  {
    "decision": "allow|block",
    "reason": "string"
  }
  ```
- Other event handlers: empty or silent stdout, exit code 0.

### Database Schema (SQLite)
- `sessions` (id TEXT PRIMARY KEY, project_path TEXT, active BOOLEAN, created_at TIMESTAMP)
- `events_metrics` (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT, project TEXT, fired_at TIMESTAMP, duration_ms INTEGER, output_chars INTEGER)
- `projects` (path TEXT PRIMARY KEY, key TEXT, last_active TIMESTAMP)
- `handoffs` (session_id TEXT PRIMARY KEY, data TEXT, created_at TIMESTAMP)

## Code Layout
```
~/.amos/ (separate git repository)
├── bin/
│   └── amos.js          # CLI entry point and event router logic
├── lib/
│   ├── db.js            # SQLite database initialization and metrics logging
│   └── config.js        # Profile and environment configs
├── tests/
│   └── amos.test.js     # Comprehensive unit tests (>=40)
└── errors.log           # Fail-soft log output

~/.claude/bin/
├── amos.cmd             # Windows Command wrapper
└── amos.ps1             # PowerShell wrapper
```
