# Agent Harness v2 Architecture Contract

Date: 2026-06-03
Status: Proposed

## Problem

The current global Agent Harness has useful pieces: project docs, doctor, hooks,
CodeGraph/Graphify checks, skill sync, harness-runner, and harness-gates. It is
not yet a reliable control plane because too many gates are advisory, skill
routing is not mandatory at task start, and global rollout is not proven across
all registered projects.

Goal: preserve the working pieces, replace ad-hoc hook behavior with one
policy-driven control plane, and add a governed skill supply chain that can
install, update, audit, and roll out approved skills for Claude Code, Codex, and
Gemini across every registered project.

Non-goals for the first slice:
- Do not auto-install unreviewed third-party skills.
- Do not rewrite every hook at once.
- Do not mutate every registered project during design; rollout stays dry-run
  until an explicit `--apply` command is approved.

## Current Map

- Global client surfaces:
  - `~/.claude/skills`
  - `~/.codex/skills`
  - `~/.gemini/skills`
- Registered projects:
  - `~/.claude/projects-registry.json`
- Current sync:
  - `tools/sync-agent-surface.js` copies Claude skills to Codex/Gemini.
- Current harness:
  - `tools/harness-runner.js`
  - `tools/harness-gates.js`
  - wrappers in `~/.claude/bin`
- Current weakness:
  - important gates can still approve continuation when evidence is missing.

## External Implementation Scan

Context7:
- MCP Context7 failed with invalid API key.
- CLI fallback succeeded for zod docs:
  `node tools/context7-cli.js docs /colinhacks/zod "safeParse object validation for Node CLI JSON manifest"`.

GitHub/practice scan:
- OpenHands: large composable agent SDK/CLI model with GitHub/Slack/Jira
  integration and evaluation infrastructure.
- OpenHarness: loop model of permission check, hook, execute, hook, result.
- Superpowers: mandatory workflow skills; the agent checks for relevant skills
  before every task, not as suggestions.
- Agent-Skills Kit: governed capability control plane with source ownership,
  runtime reachability, audit state, eval/workout evidence, and completion proof.
- agent-eval-harness: schema-driven JSONL eval pipeline with run, grade,
  compare, and calibrate modes.
- Trail of Bits skills: security-focused differential review, insecure default
  detection, and false-positive verification.
- CSA SKILL.md security note: third-party skill/context files must be reviewed
  like dependencies, with allowlist, hash verification, Unicode filtering, and
  behavior monitoring.

## Options

### A. Patch existing hooks

Fastest, but keeps logic distributed across many scripts. This is the path that
created the current maintenance problem.

### B. Replace everything with one external framework

Clean in theory, risky in practice. Existing Windows-first wrappers, project
docs, memory, CodeGraph/Graphify, and user-specific project registry would be
lost or need a migration anyway.

### C. Build a local control plane and import patterns selectively

Selected. Keep local assets that work, but route them through one manifest,
policy matrix, and rollout CLI. External projects inform patterns and candidate
skills; third-party SKILL.md content is not trusted until reviewed.

## Decision

Adopt Option C.

The new control plane has four contracts:

1. Policy contract: one matrix decides advisory vs blocking behavior.
2. Harness contract: complex work must have machine-readable gate evidence.
3. Skill supply chain contract: approved skills are sourced, hashed, synced,
   and rolled out through a manifest and CLI.
4. Project rollout contract: every registered project gets a visible
   `.planning/agent-control-plane.json` pointer so drift is inspectable.

## Contracts

### Skill Manifest

File: `config/agent-skill-sources.json`

The manifest separates:
- `skills`: approved local skills that can be installed/synced automatically;
- `externalCandidates`: GitHub skills/projects that require review or are
  pattern-only.

External skills default to `review-required`. Promotion to `approved` requires:
- full `SKILL.md` review;
- publisher and license check;
- command/network scope review;
- Unicode control character scan;
- SHA-256 capture;
- explicit reason for pipeline inclusion.

### Skill Supply Chain CLI

File: `tools/agent-skill-supply-chain.js`

Commands:
- `audit --json`: validate manifest, inspect global clients, inspect registered
  projects.
- `install-skills --target all --apply --json`: copy approved skills from the
  canonical source client to Claude/Codex/Gemini roots.
- `rollout-projects --apply --json`: write project-level control-plane pointers
  for every registered project.

Default behavior is read-only. Writes require `--apply`.

### Future Hard-Gate Policy

P0 hard gates:
- no docs in project: block;
- complex/arch task without harness run: block at Stop;
- code edits past threshold without pipeline: block;
- inline review threshold exceeded: block;
- unapproved external skill: block install;
- Graphify/CodeGraph unavailable: deterministic fallback reason, not silent
  success.

## Acceptance Tests Before Code

- `node tools/agent-skill-supply-chain.test.js`
- `node tools/agent-skill-supply-chain.js audit --json`
- `node tools/agent-skill-supply-chain.js install-skills --target all --json`
- `node tools/agent-skill-supply-chain.js rollout-projects --json`
- Existing regression:
  - `node tools/harness-runner.test.js`
  - `node tools/harness-gates.test.js`
  - `node tools/skill-search.js --benchmark --json`

## Sprint Slices

1. Skill supply chain foundation:
   - add manifest;
   - add audit/install/rollout CLI;
   - add tests.
2. Hard-gate policy matrix:
   - centralize advisory vs blocking decisions;
   - flip complex harness closeout from advisory to blocking.
3. Project rollout:
   - run dry-run across registry;
   - apply only after reviewing paths and permissions.
4. External skill intake:
   - review Superpowers, Trail of Bits, Playwright skill, Anthropic skills;
   - promote only vetted skills to approved manifest entries.
5. Eval harness:
   - add JSONL trajectory/eval smoke inspired by agent-eval-harness.

## Docs/Codemap Delta

- Add `config/agent-skill-sources.json`.
- Add `tools/agent-skill-supply-chain.js`.
- Add `tools/agent-skill-supply-chain.test.js`.
- Update AI docs with the new command after the first slice is verified.
- Refresh codemap/doctor checks in a later slice.

## Rollback

- Delete `config/agent-skill-sources.json`.
- Delete `tools/agent-skill-supply-chain*.js`.
- Remove `.planning/agent-control-plane.json` only from projects where rollout
  was explicitly applied.
- Existing skills, hooks, and harness wrappers remain untouched by this first
  slice.
