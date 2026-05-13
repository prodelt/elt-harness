# Sprint 1 Architecture Contract - Global Doctor

## Current Map

The command center already has project docs, `.rag/manifest.json`, skill search wrappers in `tools/`, and global Claude/Codex state under `~/.claude` / `~/.codex`. The missing layer is a read-mostly health command that can run from any project and report whether the local project and global agent toolchain agree.

Known weak points from the audit:

- `~/.claude/pipeline-state.json` is global and can point to another project.
- `~/.claude/projects-registry.json` does not exist yet.
- `tools/skill.cmd` works only inside this repo.
- RAG and Graphify have no single health summary.
- Red-team vendored trees can contain Defender-risk file types.

## Options

### Option A - Shell-only Doctor

PowerShell scripts call `git`, `graphify`, and ad hoc file checks.

Trade-off: simplest to install on Windows, but harder to test, quote safely, and reuse from Codex/Claude hooks.

### Option B - Node Core + Thin Wrappers

Use a Node core module with `doctor.js`, plus `.cmd` / `.ps1` wrappers.

Trade-off: one portable implementation and easy tests; requires Node, which is already part of this project.

### Option C - Fold Doctor Into Existing Hooks

Add checks into SessionStart hooks and expose summaries there.

Trade-off: automatic, but couples health checks to hook runtime and makes failures noisier.

## Chosen Design

Use Option B.

`tools/doctor-core.js` owns pure checks and output formatting. `tools/doctor.js` handles CLI args. `tools/doctor.test.js` covers project key normalization, pipeline-state validation, and frontmatter parsing. Thin wrappers call the Node entrypoint.

Global installation copies wrappers into `~/.claude/bin` and writes or updates `~/.claude/projects-registry.json`; it does not delete or quarantine anything.

## Context7 Evidence

MCP Context7 failed with `Invalid API key`. CLI fallback succeeded:

`npx.cmd ctx7 docs /nodejs/node "fs path child_process process argv JSON file IO on Windows"`

Useful decisions from the docs:

- Use `process.argv` for CLI arguments.
- Use `child_process.spawnSync`/argument arrays for subprocesses.
- On Windows, `.cmd` can be executed through `cmd.exe /c`.
- Avoid passing unsanitized user input into shell command strings.

## Acceptance Tests

- `node tools/doctor.test.js` passes.
- `node tools/doctor.js --register --json` creates/updates the registry entry for this project.
- `node tools/doctor.js` returns pass/warn/fail with repair commands.
- `doctor.cmd` works from a cwd outside this repository after installation.
- No destructive cleanup is performed for red-team or invalid git refs.

## Rollback

Remove `~/.claude/bin/doctor.cmd`, `~/.claude/bin/doctor.ps1`, and the command-center entry from `~/.claude/projects-registry.json`. Workspace files are normal git changes.
