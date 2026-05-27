# Backlog: Production Agent System

Date: 2026-05-27
Status: ready for implementation planning

## P0: Stop Production Instability

### P0.1 Fix memory startup flakiness

Problem: `memory-discipline.js` can fail sanity suites when runtime memory path points at an oversized file, while normal path currently lacks `MEMORY.md`.

Tasks:
- Replace hardcoded `MEMORY.md` line-count block with provider-aware memory health.
- Add tests for missing memory, summary-only memory, oversized injected context, and env override.
- Update docs to name the actual canonical memory files.

Acceptance:
- `node ~/.claude/hooks/test-all-hooks.js` passes without clearing env vars.
- `node ~/.codex/test-codex-hooks.js` passes without clearing env vars.

### P0.2 Fix CodeGraph provider lock path

Problem: MCP CodeGraph works, but `tools/codemap.js --provider codegraph` fails with EPERM on `.tmp/codegraph/codegraph.lock`.

Tasks:
- Move lock/cache to a location writable by Codex sandbox and real user.
- Add lock stale cleanup.
- Add a provider health test.

Acceptance:
- `node tools/codemap.js --root . --provider codegraph --json` passes under Codex.

### P0.3 Add agent surface audit

Problem: client parity is not measured as a first-class health check.

Tasks:
- Create `tools/agent-surface-audit.js`.
- Compare hooks, skills, commands, docs, memory paths, Context7, codemap, browser tooling across Claude/Codex/Gemini.
- Emit JSON and Markdown.

Acceptance:
- `node tools/agent-surface-audit.js --json` returns explicit parity gaps.
- `doctor` links to the latest surface audit.

## P1: Reduce Context Burn

### P1.1 Compact-aware context counting

Tasks:
- Add compact marker detection or active-window state.
- Replace full transcript file-size estimate.
- Consolidate `context-budget-gate` and `session-size-guard` warnings.

Acceptance:
- synthetic post-compact transcript counts only active segment.

### P1.2 Hook diet coordinator

Tasks:
- Convert advisory-only repeated hooks into telemetry-first mode.
- Keep hard-block hooks only for secrets, destructive operations, protected config, and git safety.
- Use `outputChars` as removal/merge evidence.

Acceptance:
- hook-diet report lists clear keep/merge/remove candidates with runtime evidence.

## P2: Make Routing Reliable

### P2.1 Skill router benchmark

Tasks:
- Add benchmark queries for browser, security, git, docs, backend, frontend, research, legal, QA.
- Add expected winners and acceptable `no skill`.
- Make marketplace path non-interactive or research-only.

Acceptance:
- browser automation query does not route to `init-project`.
- security validation query routes to `security-best-practices` or a clearly justified domain route.

### P2.2 Context7 CLI wrapper

Tasks:
- Implement `tools/context7-cli.js`.
- Use `cmd /c npx.cmd ctx7 ...`.
- Strip ANSI, timeout safely, capture skip reason.
- Add docs/library commands, not interactive skill install.

Acceptance:
- wrapper resolves `/vercel/ai`.
- wrapper queries `/microsoft/playwright-mcp`.

## P3: Browser Tooling Replacement

### P3.1 Pilot modern browser automation

Candidates:
- Vercel Labs `agent-browser`
- Playwright CLI
- Playwright MCP
- Stagehand/Browserbase
- Browser Use

Decision criteria:
- token cost;
- deterministic repeatability;
- credentials/auth handling;
- Windows support;
- local vs cloud;
- CI compatibility;
- artifact output.

Acceptance:
- one local dry-run produces snapshot and evidence artifact.
- default browser-harness routing is removed or marked legacy.

## P4: Git And Project Hygiene

### P4.1 Registry-wide git audit

Tasks:
- Record `projectRoot`, `gitRoot`, branch, dirty status, missing path, dubious ownership.
- Warn when `gitRoot` is `C:/` for a project.
- Teach hooks to scope commands with `-- .`.

Acceptance:
- no project closeout reports unrelated C-drive changes as project-local work.

### P4.2 Docs automation

Tasks:
- Add project structure contract: docs, planning, ADR, tests, scripts, source, artifacts.
- Make docs update a gate in Agent Harness runner.
- Keep AGENTS canonical and sync CLAUDE/GEMINI.

Acceptance:
- complex dry-run blocks closeout when docs delta is missing.

## P5: Agent Harness Runner

### P5.1 Implement run artifact schema

Tasks:
- Add `.planning/runs/<runId>/run.json`.
- Add `input.json`, `design.json`, `implementation_plan.json`, `qa_plan.json`, `research.json`, `review_summary.md`, `closeout.json`.
- Validate phase transitions.

Acceptance:
- dry-run complex task creates all required artifacts.
- missing gate blocks closeout.

### P5.2 Review agent contract

Tasks:
- Define reviewer inputs: `design.json`, initial code map, final diff.
- Record severity threshold.
- Block on High/Critical/Blocker.

Acceptance:
- sample review with High finding blocks `closed`.

## Suggested Implementation Order

1. P0.1 memory startup flakiness.
2. P0.2 CodeGraph provider lock.
3. P0.3 agent surface audit.
4. P1.1 compact-aware context counting.
5. P2.1 skill router benchmark.
6. P2.2 Context7 CLI wrapper.
7. P3.1 browser tooling replacement pilot.
8. P4.1 registry-wide git audit.
9. P5.1 Agent Harness runner.
10. P4.2 docs automation and final docs sync.

## Required Verification Bundle

Run after each implementation sprint:

```powershell
node tools/project-docs.js verify --root .
node tools/doctor.js --root .
node tools/skill-search.test.js
node tools/project-docs.test.js
node tools/pipeline-state.test.js
node tools/codemap.test.js
node tools/hook-diet.test.js
node C:\Users\user\.claude\hooks\test-all-hooks.js
node C:\Users\user\.codex\test-codex-hooks.js
node C:\Users\user\.claude\hooks\test-hooks-behavior.js
node C:\Users\user\.gemini\hooks\test-all-hooks.js
node C:\Users\user\.gemini\hooks\test-hooks-behavior.js
```

Git proof required:
- `git status --short`
- current branch
- changed files list
- commit or explicit reason why not committed
