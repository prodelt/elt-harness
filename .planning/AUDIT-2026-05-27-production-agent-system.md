# Production Audit: Global Agent Development System

Date: 2026-05-27
Status: audit complete, implementation pending
Scope: `C:\Claude playground\Pipiline setupper`, global Claude Code / Codex / Gemini-Antigravity control plane

## Executive Verdict

The system is not production-ready yet. It has many strong building blocks, but the current behavior is still a collection of hooks, skills, and copied configs rather than one deterministic Agent Harness.

Current score: 72/100.

What works:
- Project AI docs in this repo are healthy: `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md` all exist and `project-docs verify` passes.
- Main control-plane modules have tests: `skill-search`, `project-docs`, `pipeline-state`, `codemap`, `hook-diet`.
- Graphify is usable as production fallback.
- CodeGraph MCP is healthy and indexed.
- Context7 CLI is available through `cmd /c npx.cmd ctx7`.

What blocks production readiness:
- Claude/Codex/Gemini are not capability-identical.
- Hooks are duplicated and event surfaces differ by client.
- Context counting is transcript-size based and not compact-aware.
- Skill routing still picks wrong local skills for some real tasks.
- Browser automation policy is stale compared to current CLI-first agent-browser tooling.
- Git state across registered projects is not normalized.
- Memory policy points at paths that do not currently contain the expected `MEMORY.md`.

## Evidence Commands

| Check | Result |
|---|---|
| `node tools/project-docs.js verify --root .` | PASS, core sections identical |
| `node tools/doctor.js --root .` | PASS=25 WARN=3 FAIL=0 |
| `node tools/skill-search.test.js` | PASS |
| `node tools/project-docs.test.js` | PASS |
| `node tools/pipeline-state.test.js` | PASS |
| `node tools/codemap.test.js` | PASS |
| `node tools/hook-diet.test.js` | PASS |
| `node ~/.claude/hooks/test-all-hooks.js` | initially 34/35 due `memory-discipline`; passes 35/35 when `CLAUDE_MEMORY_PATH` is cleared |
| `node ~/.codex/test-codex-hooks.js` | initially 45/46 due `memory-discipline`; passes 46/46 when `CLAUDE_MEMORY_PATH` is cleared |
| `node ~/.claude/hooks/test-hooks-behavior.js` | PASS 37/37 |
| `node ~/.gemini/hooks/test-all-hooks.js` | PASS 35/35 |
| `node ~/.gemini/hooks/test-hooks-behavior.js` | PASS 37/37 |
| `node tools/codemap.js --root . --json` | PASS, Graphify provider |
| `node tools/codemap.js --root . --provider codegraph --json` | FAIL, EPERM on `.tmp/codegraph/codegraph.lock` |
| CodeGraph MCP `codegraph_status` | PASS, 142 files, 2253 nodes, 4016 edges |
| `cmd /c npx.cmd ctx7 --help` | PASS |
| `cmd /c npx.cmd ctx7 docs /microsoft/playwright-mcp ...` | PASS |
| `git status --short` | dirty only by untracked `Методология Agent Harness.md` |

Doctor warnings:
- Codex defaults are expensive: `model=gpt-5.5`, `effort=xhigh`.
- GitHub auth invalid or missing.
- GitHub code search skipped.

## Finding 1: No Single Runtime Contract Across Clients

Severity: high

Claude and Gemini have 61 configured hook commands. Codex has 46. That difference is partly platform capability, but the repo does not model it as a compatibility matrix with equivalent guarantees.

Observed hook totals:
- Claude: 61
- Codex: 46
- Gemini/Antigravity config: 61

Codex does not expose the same event model as Claude/Gemini. Missing or different surfaces include `FileChanged`, `Notification`, `SessionEnd`, `PermissionRequest`, `PostToolUseFailure`, `SubagentStart`, and `SubagentStop`.

Production issue: current parity is file-copy parity, not semantic parity. The system needs one canonical capability contract:
- required guarantees;
- client-supported hook events;
- fallback mechanism per unsupported event;
- test per client.

## Finding 2: Skill Parity Is Broken

Severity: high

Skill counts:
- Codex: 58
- Claude: 56
- Gemini: 27

Claude and Codex are close, but Gemini is missing many production skills such as `auto-ship`, `clone-research`, `git-flow`, `gstack`, `tdd`, `to-prd`, `to-issues`, `research-autopilot`, and others. Gemini has extra local aliases such as `architect`, `autofix`, `frontend`, `backend`, `graphify`, `nextjs`, `security`, and `supabase`.

Production issue: a task can be routed differently depending on which CLI starts it. That defeats the stated goal of "same pipeline everywhere".

Required fix: build a `tools/sync-agent-surface.js` or extend existing sync tooling so skills are generated from one manifest into Claude, Codex, and Gemini target directories, with aliases declared explicitly.

## Finding 3: Context Is Still Too Noisy And Not Compact-Aware

Severity: high

Current hooks:
- `context-budget-gate.js` estimates tokens from transcript file size: `stat.size / charsPerToken`.
- `session-size-guard.js` warns from transcript file size in KB.

This does not prove active model context after compact. If the transcript file remains large after compaction, the hook can keep warning as if old context is still active.

Hook-diet evidence:
- 107 hook registrations.
- 79 advisory, 14 hard-block, 10 telemetry, 4 background.
- 16 duplicate matcher groups.

Production issue: advisory hooks are allowed to inject more text into already large sessions. The system needs a slim default where hooks log telemetry first and only inject when their signal is high.

Required fix:
- Add compact-aware session accounting.
- Store `lastCompactAt`, `activeWindowStart`, and `activeTranscriptBytes`.
- Make `context-budget-gate` use active transcript segment, not whole transcript file.
- Keep warnings short and deduplicated through a single context budget coordinator.

## Finding 4: Memory Contract Is Stale

Severity: high

Global Gemini/Antigravity docs state:
- canonical memory directory: `C:/Users/espad/.claude/projects/C--/memory/`
- session start should read `MEMORY.md`.

Observed:
- `C:\Users\espad\.claude\projects\C--\memory\MEMORY.md` does not exist.
- `C:\Users\espad\.codex\memories\MEMORY.md` also did not resolve during this audit.
- `memory_summary.md` exists.

Production issue: `memory-discipline.js` still guards a legacy `MEMORY.md` path, while current memory flow appears summary/rollout based. This explains flaky hook behavior: if an env override points at a large memory file, SessionStart blocks; if not, it silently passes.

Required fix:
- Replace `MEMORY.md` line-count discipline with provider health discipline.
- Track `memory_summary.md`, rollout registry, and ad-hoc notes explicitly.
- Never block session start because a historical memory registry is large; block only if a configured startup injector would exceed the startup context budget.

## Finding 5: Graphify And CodeGraph Are Split-Brain

Severity: high

Graphify:
- `node tools/codemap.js --root . --json` passes.
- Graph scope: 1033 nodes, 148 source files, no stale semantic/rationale nodes.

CodeGraph:
- MCP `codegraph_status` passes: 142 files, 2253 nodes, 4016 edges, WAL backend.
- `doctor` reports CodeGraph index OK.
- `tools/codemap.js --provider codegraph --json` fails with EPERM on `.tmp/codegraph/codegraph.lock`.

Production issue: the model-facing CodeGraph path works, but the repo's CLI provider wrapper can fail in the Codex sandbox. That means CodeGraph cannot yet replace Graphify as the production codemap provider.

Required fix:
- Move CodeGraph lock/cache to a writable and client-stable location.
- Add one lock-health test that runs under Codex sandbox.
- Keep Graphify as default until CodeGraph provider passes CLI, MCP, relevance, and stress tests.

## Finding 6: Skill Router Works, But Relevance Is Not Reliable Enough

Severity: medium-high

Good:
- `node tools/skill-search.test.js` passes.
- `node tools/skill-search.js "architecture refactor" --top 3` returns plausible local skills.

Bad:
- For `browser automation ai agent`, local top-3 were `init-project`, `sync-docs`, `clone-research`.
- Marketplace fallback returned browser-related candidates.
- For `security api input validation`, local top-3 were `cto-playbook`, `init-project`, `sync-docs`, missing `security-best-practices` from the top result set.

Production issue: if this router drives automatic task setup, it will load wrong skills for real work and burn context.

Required fix:
- Add evaluation prompts for browser, security, git, docs, frontend, backend, legal, research, QA.
- Gate on semantic relevance before total score.
- Return `no skill` when confidence is low.
- Use marketplace results as evidence, not interactive installer flow.

## Finding 7: Context7 CLI Is Available, But Automation Contract Is Incomplete

Severity: medium-high

Observed:
- `cmd /c npx.cmd ctx7 --help` works.
- `cmd /c npx.cmd ctx7 library "vercel ai" "agents tool calling browser automation"` works.
- `cmd /c npx.cmd ctx7 docs /microsoft/playwright-mcp ...` works.
- `cmd /c npx.cmd ctx7 skills search browser automation` opens an interactive selector and then cancels.

Production issue: Context7 docs/library commands are scriptable, but skills search is interactive by default and therefore unsuitable as a hard automation dependency unless wrapped with a non-interactive mode or timeout/parse contract.

Required fix:
- Standard command for docs: `cmd /c npx.cmd ctx7 library "<name>" "<query>"`, then `cmd /c npx.cmd ctx7 docs <libraryId> "<query>"`.
- Do not use `.ps1` shims for ctx7/npx on Windows.
- Add `tools/context7-cli.js` wrapper that captures stdout, strips ANSI, applies timeout, and records skip reasons.
- Treat interactive `ctx7 skills search` as research-only until a non-interactive output mode is available.

## Finding 8: Browser Automation Policy Is Outdated

Severity: medium-high

Local prior work already found browser tooling should be on-demand only. Current external research reinforces that.

Evidence:
- Microsoft Playwright MCP docs say CLI + skills are often more token-efficient for coding agents than always-loaded MCP tool schemas.
- Vercel Labs `agent-browser` is a browser automation CLI for AI agents and documents a skill install path that works with Claude Code, Codex, Gemini CLI, and other assistants.
- Browserbase Stagehand offers `act`, `extract`, `observe`, and `agent` primitives over Playwright, with local mode and optional cloud browser production mode.
- Browser Use offers open-source and cloud browser agents, but is heavier and more autonomous than deterministic QA flows.

Production decision:
- Default: `agent-browser` or Playwright CLI for browser automation through short CLI commands and refs/snapshots.
- Fallback: Playwright MCP only when persistent browser state and rich introspection are worth token cost.
- Optional production cloud: Stagehand/Browserbase or Browser Use Cloud for authenticated, stealth, CAPTCHA, or scaled browser tasks.
- Remove `browser-harness` from default global routing.

## Finding 9: Project Registry And Git Workflow Are Not Production Clean

Severity: high

Registry scan:
- Some registered paths no longer exist from the current runtime.
- Several `C:\Claude playground\...` projects resolve git root to `C:/`, not the project folder.
- Sample status from C-root projects shows unrelated deletes such as `../../.claude/...`, `../../.gitignore`, `../../CLAUDE.md`.
- Some D-drive projects trigger `dubious ownership` under Codex sandbox user.

Production issue: git status, branch, and ship gates can report global C-drive noise or fail under Codex sandbox. That makes "uncommitted code = incomplete" impossible to enforce reliably across projects.

Required fix:
- Project registry must store `projectRoot` and `gitRoot` separately.
- Hooks must scope git commands with `-- .` and must warn when git root is outside project root.
- Add `tools/git-workflow-audit.js` across registered projects.
- Add safe.directory guidance for Codex sandbox separately from real user git config.

## Finding 10: Agent Harness Methodology Is Only Partially Implemented

Severity: high

`Методология Agent Harness.md` defines five core principles:
- separate machine-readable artifacts;
- quality gates;
- feedback loops;
- tool integration;
- observability.

It also defines stages:
- Fetch/Input Gate;
- Plan & Design;
- Implement;
- Linter Gate;
- Test Gate;
- Code Review Gate;
- Git Push & PR.

Current system partially maps to this, but not fully:
- `/pipeline` has lifecycle state and ledger concepts.
- `/architect-first` requires architecture contracts.
- Tests and hooks exist.
- But implementation still depends on the assistant voluntarily following instructions, not a hard state machine with artifacts like `design.json`, `implementation_plan.json`, `qa_plan.json`, and `review_summary.md`.

Required fix:
- Introduce `.agent/` or `.planning/runs/<runId>/` as the durable Agent Harness run directory.
- Make every complex task produce structured artifacts before implementation.
- Gates must read machine artifacts and command exit codes, not prose claims.

## Production Readiness Criteria

The system can be called production-ready only when all are true:

- Claude, Codex, and Gemini have a generated parity report with no unexplained differences.
- All supported client hook suites pass.
- Skill sync is generated from one manifest.
- Context7 docs/library CLI wrapper is used and tested.
- Skill router has benchmark prompts and accuracy thresholds.
- Graphify and CodeGraph roles are explicit; CodeGraph provider does not fail lock creation.
- Browser automation is on-demand and CLI-first.
- Git workflow audit passes or records per-project blockers.
- Context budget is compact-aware.
- Agent Harness artifacts exist for complex tasks.
- Final session closeout includes verification proof and git state.

## Source Links

- Vercel Labs agent-browser: https://github.com/vercel-labs/agent-browser
- Vercel AI SDK computer-use demo: https://github.com/vercel-labs/ai-sdk-computer-use
- Microsoft Playwright MCP: https://github.com/microsoft/playwright-mcp
- Browserbase Stagehand: https://www.browserbase.com/stagehand
- Browser Use: https://github.com/browser-use/browser-use
