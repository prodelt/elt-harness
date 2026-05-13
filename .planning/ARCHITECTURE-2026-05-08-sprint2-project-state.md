# Architecture 2026-05-08 - Sprint 2 Project State

## Goal

Remove cross-project pipeline state leakage by moving active state from one global file to a project capsule.

## Current State

- Active pipeline state is documented as `~/.claude/pipeline-state.json`.
- `doctor` already has deterministic `projectKey(root)` based on normalized absolute path and an 8-character sha1 suffix.
- The legacy global state can point to another project and accidentally drive resume behavior.

## Decision

Use `~/.claude/projects/<projectKey>/pipeline-state.json` as the canonical active state path.

The legacy `~/.claude/pipeline-state.json` remains read-only:

- never rewrite it as the active state;
- report it separately in `doctor`;
- allow migration/resume only when `cwd` matches, timestamp is valid, and the state is not stale;
- reject future timestamps with a one-minute clock-skew allowance.

## Options Considered

- Keep one global file and validate `cwd`: simplest, but every tool must remember to reject wrong project state.
- Store state inside each repository: portable, but pollutes project trees and risks commits of transient state.
- Store state under `~/.claude/projects/<projectKey>`: keeps transient state out of repos and matches existing global project registry.

Chosen: project capsule under `~/.claude/projects/<projectKey>`.

## Context7 Evidence

- MCP Context7 failed because the local API key is invalid.
- CLI fallback succeeded via `cmd /c npx ctx7 docs /nodejs/node ...`.
- Relevant Node docs confirmed `fs.mkdirSync(path, { recursive: true })`, `fs.readFileSync(file, 'utf8')`, and `fs.writeFileSync(file, data, 'utf8')` semantics used by existing doctor code.

## Test Plan

- Unit-test deterministic project key stability.
- Unit-test canonical project state pass.
- Unit-test missing project state while legacy exists for a different project.
- Unit-test future timestamp rejection for legacy state.
- Run `node tools\doctor.test.js`.
- Run `node tools\doctor.js --no-graphify` for live smoke output.
