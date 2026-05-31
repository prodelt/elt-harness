# Global Harness Rollout

Date: 2026-05-31
Status: accepted

## Goal

Make the Agent Harness execution layer available from any project root through global commands, while keeping the canonical implementation in this repository.

## Problem

`pipeline v3.1.0` tells agents to run `node tools/harness-runner.js` and `node tools/harness-gates.js`. That only works in `Pipiline setupper`, because other registered projects do not have those files under their local `tools/` directory.

## Decision

Use global command wrappers in `~/.claude/bin`:

- `harness-runner.cmd` / `harness-runner.ps1`
- `harness-gates.cmd` / `harness-gates.ps1`

Each wrapper calls the canonical implementation in:

- `C:\Claude playground\Pipiline setupper\tools\harness-runner.js`
- `C:\Claude playground\Pipiline setupper\tools\harness-gates.js`

Agents must pass the target project explicitly with `--root <project>`. This keeps all harness state in the target project, under `.planning/runs/` and `.planning/harness-run-latest.json`, while avoiding per-project tool copies.

## Interfaces

Global commands:

```powershell
harness-runner create <taskId> --root . --json
harness-gates gate-plan <runId> --root . --json
harness-gates run-gate <runId> --root . --json
harness-gates closeout <runId> --root . --json
```

Runtime skill instructions:

- Claude, Codex, and Gemini `pipeline/SKILL.md` must reference the global commands above.
- Version remains `3.1.0`; this is a rollout fix for the same contract, not a new pipeline behavior.

Hook contract:

- Claude and Codex already run `harness-run-gate.js` on Stop.
- Gemini must also run `harness-run-gate.js` on Stop.
- Unsupported `Notification` and `FileChanged` events remain documented client limitations.

## Verification

- `harness-runner create ... --root <other-project>` works from a project without local harness tools.
- `harness-gates gate-plan ... --root <other-project>` reads/writes target project `.planning`.
- `agent-surface-audit` reports harness wrappers and Stop hook coverage.
- `doctor` reports global harness CLI availability.
- Existing unit suites pass: `harness-runner`, `harness-gates`, `agent-surface-audit`, `doctor`, Codex hook tests.

## Risks

- If `~/.claude/bin` is not on PATH, full wrapper paths still work but the shorthand commands do not. Doctor must warn.
- If Gemini settings drift, the skill may mention harness gates but the Stop advisory will be absent. Surface audit must warn.
- If the central repo path moves, wrappers must be regenerated.

## Rollback

Remove the four wrapper files from `~/.claude/bin`, remove the Gemini Stop `harness-run-gate.js` entry, and restore the previous `pipeline/SKILL.md` command snippets.
