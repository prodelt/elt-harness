# Architecture Contract: Production Agent Harness Pipeline

Date: 2026-05-27
Status: proposed architecture, not implemented
Owner: Pipeline Setupper

## Problem

The global agent system must behave consistently across Claude Code, Codex, and Gemini/Antigravity. Today it has useful parts, but orchestration is distributed across instructions, hooks, skills, copied configs, and user discipline.

Smallest useful outcome: one deterministic pipeline contract with machine-readable run artifacts, client parity checks, compact context policy, and reproducible verification gates.

Non-goals:
- Do not delete hooks without measured evidence.
- Do not replace Graphify with CodeGraph until CodeGraph passes CLI and sandbox checks.
- Do not globally enable heavy browser tooling.
- Do not require cloud services for local development workflow.

## Current Map

Current control-plane components:
- `tools/pipeline-state.js`: project key, lifecycle state, ledger helpers.
- `tools/project-docs*.js`: AI docs init/sync/verify.
- `tools/skill-search.js`: local skill ranking and marketplace visibility.
- `tools/research-router.js`: compact evidence routing.
- `tools/codemap*.js`: Graphify and optional CodeGraph provider checks.
- `tools/hook-diet.js`: hook inventory and evidence classification.
- `~/.claude/hooks/*.js`: runtime enforcement/advisory hooks.
- `~/.codex/hooks.json`: Codex hook mirror with fewer event types.
- `~/.gemini/settings.json`: Gemini/Antigravity-like hook mirror plus separate skill surface.

Current pain points:
- Hooks are not a state machine.
- Some warnings add context instead of reducing it.
- Skill routing can misclassify.
- Git status can escape project roots.
- Browser tooling is not settled around modern CLI-first agent tools.

## Constraints

- Windows-first: prefer `.cmd` and `cmd /c npx.cmd`, avoid PowerShell shim dependency.
- Network can be restricted; every external research provider needs a visible skip reason.
- Client event models differ; parity must be semantic, not identical files.
- Existing project docs and memory must not be destroyed.
- Git commands must be scoped to the project and must preserve unrelated user changes.

## Options

### Option A: Keep Hook-Heavy System And Patch Failures

Pros:
- Least disruptive.
- Existing tests mostly pass.

Cons:
- Does not solve root problem: hooks are still the orchestrator.
- Context bloat and client divergence continue.
- Complex tasks still rely on agent discipline.

Rejected as the target architecture. Useful only for emergency P0 fixes.

### Option B: Central Agent Harness Runner

Pros:
- One state machine owns task lifecycle.
- Hooks become thin sensors and guards.
- Complex tasks produce durable artifacts before implementation.
- Client parity can be tested through the same runner.

Cons:
- Requires new runner and migration path.
- Existing skills need adapters.

Selected.

### Option C: Adopt External Agent Framework Wholesale

Pros:
- Could provide orchestration, browser, and deployment primitives.

Cons:
- Higher risk.
- Likely fights existing Claude/Codex/Gemini workflows.
- Does not automatically solve Windows and project-specific git issues.

Rejected for now. External tools should inform adapters, not replace the control plane yet.

## Decision

Build a local Agent Harness runner as the production orchestration layer.

Target flow:

```text
User prompt
  -> input gate
  -> task classifier
  -> context/artifact collector
  -> skill-router
  -> research-router
  -> plan/design artifacts
  -> design review gate
  -> implementation slices
  -> lint gate
  -> test gate
  -> semantic review gate
  -> docs sync gate
  -> git/ship gate
  -> closeout + checkpoint
```

Hooks remain, but their role changes:
- hard-block only for secrets, destructive commands, corrupt config, protected git misuse;
- telemetry for everything else;
- short advisory only when a decision is immediately actionable.

## Contracts

### Run Directory

Use `.planning/runs/<yyyy-mm-dd>-<slug>-<shortid>/`.

Required files:
- `run.json`: canonical state machine.
- `input.json`: extracted user request, scope, doneWhen, risks.
- `design.json` and `design.md`: architecture and affected components.
- `implementation_plan.json`: ordered file-level plan.
- `qa_plan.json`: verification commands and expected evidence.
- `research.json`: Context7/GitHub/browser/codemap evidence and skip reasons.
- `review_summary.md`: semantic review findings.
- `closeout.json`: final proof, git state, remaining work.

### State Machine

Allowed phases:
- `input_checked`
- `classified`
- `context_collected`
- `planned`
- `design_reviewed`
- `implementing`
- `linted`
- `tested`
- `reviewed`
- `docs_synced`
- `git_ready`
- `closed`
- `blocked`

Every transition records:
- timestamp;
- actor/client;
- command or tool evidence;
- pass/fail;
- next required gate.

### Context Policy

Startup default:
- project docs summary;
- session focus;
- slim codemap status;
- no RAG injection unless explicitly enabled;
- no browser MCP schemas unless requested.

On demand:
- CodeGraph/Graphify for code structure;
- rg for literal text;
- memory/RAG for history;
- Context7 CLI for library docs;
- web/GitHub search for current external tools.

Compact-aware accounting:
- state file stores `activeContextStart`, `lastCompactAt`, and `lastKnownTranscriptBytes`.
- budget warnings use active segment size, not full JSONL size.

### Skill Routing

Router output must support:
- `selected`;
- `top3`;
- `noSkillReason`;
- `confidence`;
- `marketplaceStatus`;
- `estimatedTokenCost`;
- `clientAvailability`.

Low confidence must choose `no skill`, not a weak match.

### Browser Tooling

Default:
- Vercel Labs `agent-browser` or Playwright CLI as short command adapters.

Fallback:
- Playwright MCP for persistent introspection.

Cloud production:
- Stagehand/Browserbase or Browser Use Cloud for stealth, CAPTCHA, profile, and scale needs.

Rule:
- Browser tools are project/on-demand, never global startup payload.

### Codemap

Roles:
- CodeGraph: preferred structural intelligence when provider wrapper is healthy.
- Graphify: production fallback and relevance benchmark baseline.
- rg: literal text search.

Promotion gate:
- CodeGraph provider must pass CLI wrapper under Codex sandbox, MCP status, relevance benchmark, and parallel stress test.

### Git

Required fields in `closeout.json`:
- `projectRoot`;
- `gitRoot`;
- `branch`;
- `dirtyFiles`;
- `commit`;
- `pr`;
- `uncommittedReason`.

If `gitRoot` is outside `projectRoot`, the system must warn and scope all commands with `-- .`.

## Acceptance Tests Before Code

1. `node tools/project-docs.js verify --root .` passes.
2. `node tools/doctor.js --root .` reports no FAIL.
3. `node ~/.claude/hooks/test-all-hooks.js` passes without environment-specific overrides.
4. `node ~/.codex/test-codex-hooks.js` passes without environment-specific overrides.
5. `node ~/.gemini/hooks/test-all-hooks.js` passes.
6. `node tools/skill-search.test.js` passes plus benchmark prompts for browser/security/git/docs.
7. `node tools/codemap.js --root . --provider codegraph --json` passes or records a non-prod provider status.
8. Context7 wrapper resolves `/vercel/ai` and `/microsoft/playwright-mcp`.
9. Git workflow audit distinguishes project root from git root for registered projects.
10. A complex dry-run creates all run artifacts and blocks if any gate is missing.

## Sprint Slices

### Sprint 1: Parity And Health Matrix

Deliver:
- `tools/agent-surface-audit.js`
- client hook matrix;
- skill matrix;
- command availability matrix;
- memory path matrix.

Verify:
- run against Claude, Codex, Gemini configs;
- produce JSON and Markdown report.

### Sprint 2: Compact-Aware Context Budget

Deliver:
- replace transcript-total warnings with active-context accounting;
- single context budget coordinator;
- tests for post-compact state.

Verify:
- synthetic transcript with compact marker does not count old segment.

### Sprint 3: Memory Provider Contract

Deliver:
- stop relying on legacy `MEMORY.md` line count;
- provider health check for `memory_summary.md`, rollout summaries, ad-hoc notes;
- no SessionStart hard block unless injected context exceeds budget.

Verify:
- memory-discipline tests pass with missing, summary-only, and oversized registry cases.

### Sprint 4: Skill Router Quality Gate

Deliver:
- benchmark prompts;
- `no skill` threshold;
- security/browser/git/docs expected winners;
- non-interactive Context7/marketplace handling.

Verify:
- browser query does not select `init-project`;
- security query selects `security-best-practices` or explains `no skill`.

### Sprint 5: CodeGraph Provider Repair

Deliver:
- stable lock/cache path;
- Codex sandbox-safe lock creation;
- stress test;
- fallback reason in doctor.

Verify:
- `node tools/codemap.js --root . --provider codegraph --json` passes.

### Sprint 6: Browser Tooling Replacement

Deliver:
- pilot `agent-browser` vs Playwright CLI vs Playwright MCP vs Stagehand/Browser Use;
- choose default and fallback;
- remove browser-harness from default routing.

Verify:
- local dry-run opens, snapshots, clicks/fills by refs, saves evidence artifact without loading global MCP schemas.

### Sprint 7: Git Workflow Normalization

Deliver:
- registry-wide git audit;
- git root vs project root warnings;
- branch/commit/PR closeout schema;
- safe.directory guidance for Codex sandbox.

Verify:
- C-root projects no longer report unrelated global changes as project dirty state.

### Sprint 8: Agent Harness Runner

Deliver:
- `tools/agent-harness.js`;
- run directory schema;
- state transition validation;
- dry-run mode.

Verify:
- complex dry-run creates `input/design/plan/qa/review/closeout` artifacts.
- missing gate blocks closeout.

## Docs And Codemap Delta

Docs to update after implementation:
- `AGENTS.md`
- `CLAUDE.md`
- `.gemini/GEMINI.md`
- `README.md`
- new architecture/backlog docs in `.planning`

Codemap:
- update Graphify after adding runner files.
- rerun CodeGraph index/doctor after provider fix.

## Rollback

Every sprint must be separately reversible:
- keep current hooks as fallback;
- keep Graphify default until CodeGraph promotion;
- keep browser MCP/plugin disabled by default but available on demand;
- preserve existing skills while generated manifest parity is introduced.
