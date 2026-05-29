# Implementation Plan: Production-Ready Agent Harness

Date: 2026-05-27
Status: ready for sprint execution
Source artifacts:
- `.planning/AUDIT-2026-05-27-production-agent-system.md`
- `.planning/ARCHITECTURE-2026-05-27-agent-harness-production-pipeline.md`
- `.planning/BACKLOG-2026-05-27-production-agent-system.md`

## Executive Summary

Цель не в том, чтобы "починить все хуки", а в том, чтобы превратить текущий набор Claude/Codex/Gemini hooks, skills, docs и codemap tools в проверяемый локальный Agent Harness: deterministic state machine, machine-readable run artifacts, client parity reports, компактный startup context и доказуемый closeout.

Главный порядок внедрения:
1. P0.1 memory startup flakiness.
2. P0.2 CodeGraph lock/cache path.
3. P0.3 agent surface audit.
4. Только после этого: context budget, skill router, Context7 wrapper, git workflow, runner, browser tooling.

Browser tooling не трогаем первым. Пока SessionStart и parity не стабильны, добавление browser CLI/MCP только расширит surface area и увеличит хаос.

## Current Baseline

Последняя проверка перед планированием:

```powershell
git status --short
node tools\doctor.js --root .
node tools\project-docs.js verify --root .
```

Результат:
- `git status --short`: только untracked пользовательский файл `Методология Agent Harness.md`; не трогать без отдельного решения.
- `doctor`: PASS=25, WARN=3, FAIL=0.
- `project-docs verify`: PASS, core sections identical.

Текущие WARN из doctor:
- Codex defaults expensive: `model=gpt-5.5`, `effort=xhigh`.
- GitHub auth invalid or missing.
- GitHub code search skipped.

Эти WARN не блокируют P0.1/P0.2/P0.3, но должны быть видны в closeout каждого спринта.

## Global Implementation Rules

### Must Do

- Работать маленькими спринтами, один production blocker за раз.
- Windows-first commands: PowerShell/cmd, без `&&`.
- Для Context7 использовать CLI standard: `cmd /c npx.cmd ctx7 ...`.
- До любых external library API changes использовать Context7 docs.
- Сохранять Claude/Codex/Gemini semantic parity: если клиент не поддерживает событие, фиксировать fallback contract.
- Держать Graphify production fallback, пока CodeGraph provider не прошел CLI + sandbox + benchmark proof.
- Для git всегда различать `projectRoot` и `gitRoot`; учитывать, что `C:\` может быть git root.
- Все новые gates должны читать machine-readable artifacts и command exit codes, а не prose claims.

### Must Not Do

- Не удалять hooks без runtime evidence (`outputChars`, metrics, errors, behavior coverage).
- Не чинить все сразу в одном спринте.
- Не менять Claude/Codex/Gemini configs вручную без parity report.
- Не включать Browser MCP или agent-browser в global startup context.
- Не продвигать CodeGraph как default provider до успешного `tools/codemap.js --provider codegraph`.
- Не трогать untracked `Методология Agent Harness.md` без явного решения.
- Не коммитить `.env`, secrets, generated caches, `node_modules`, build artifacts.
- Не делать force push и не применять destructive git cleanup.

## Sprint Sequence

### Phase 0: Pre-Flight Before Every Sprint

Goal: не начинать спринт на ложной базе.

Files/modules:
- `AGENTS.md`
- `CLAUDE.md`
- `.gemini/GEMINI.md`
- `tools/doctor.js`
- `tools/project-docs.js`
- current sprint target files only

Actions:
- Run health baseline.
- Confirm dirty tree is understood.
- Create or use a scoped branch only when implementation starts.
- Record unchanged user files explicitly in closeout.

Verification commands:

```powershell
git status --short
node tools\doctor.js --root .
node tools\project-docs.js verify --root .
```

Acceptance criteria:
- No FAIL from doctor.
- Project docs verify PASS.
- Dirty files are either sprint-owned or explicitly excluded.

Rollback:
- No code changes in pre-flight.
- If baseline regresses, stop and diagnose before implementation.

Risks:
- `git status` can include C-root noise.
- Sandbox may block global hook tests.

## P0: Stabilize Production Blockers

P0 is done only when SessionStart is not flaky, CodeGraph provider has an explicit production/fallback status, and client surface gaps are measured as first-class artifacts.

### P0.1 Memory Startup Flakiness

Goal: SessionStart must not fail because legacy `MEMORY.md` path or oversized registry behavior diverges between environments.

Primary files/modules:
- `C:\Users\espad\.claude\hooks\memory-discipline.js`
- `C:\Users\espad\.claude\hooks\test-all-hooks.js`
- `C:\Users\espad\.codex\test-codex-hooks.js`
- `C:\Users\espad\.gemini\hooks\test-all-hooks.js`
- `tools\doctor-core.js` or related memory provider health code if needed
- `AGENTS.md`, `CLAUDE.md`, `.gemini\GEMINI.md` only if docs need corrected memory contract

Changes:
- Replace legacy line-count hard block on `MEMORY.md` with provider-aware startup memory health.
- Recognize current memory sources explicitly: `memory_summary.md`, `MEMORY.md` registry if present, rollout summaries, ad-hoc notes.
- Block only when configured startup injection would exceed budget, not because historical memory files are large.
- Add tests for:
  - missing `MEMORY.md`;
  - summary-only memory;
  - oversized registry not injected at startup;
  - explicit env override that points to oversized memory;
  - malformed memory provider path.
- Keep hook output short and machine-parseable.

Acceptance criteria:
- Claude sanity hooks pass without clearing memory env overrides.
- Codex hooks pass without clearing memory env overrides.
- Gemini sanity hooks pass.
- `doctor` reports memory provider health without FAIL.
- Docs no longer claim `MEMORY.md` is the only canonical startup memory source.

Verification commands:

```powershell
node C:\Users\espad\.claude\hooks\test-all-hooks.js
node C:\Users\espad\.codex\test-codex-hooks.js
node C:\Users\espad\.gemini\hooks\test-all-hooks.js
node tools\doctor.js --root .
node tools\project-docs.js verify --root .
git status --short
```

Rollback:
- Keep previous `memory-discipline.js` behavior recoverable via a feature flag such as `MEMORY_DISCIPLINE_LEGACY=1` for one sprint.
- If hook suites regress, revert only memory-discipline changes and leave docs/test additions for diagnosis if possible.

Risks:
- Hook tests may depend on env vars from the real machine.
- Over-relaxing memory discipline could allow large startup payloads.

Do not:
- Do not disable memory-discipline entirely.
- Do not move or rewrite memory stores.
- Do not inject RAG or rollout summaries by default.

### P0.2 CodeGraph Lock/Cache Path

Goal: CodeGraph provider wrapper must either pass under Codex sandbox or report a deterministic non-production fallback reason; no EPERM lock failure as an ambiguous state.

Primary files/modules:
- `tools\codemap-core.js`
- `tools\codemap.js`
- `tools\codemap.test.js`
- `tools\codemap-benchmark.js`
- `tools\doctor-core.js`
- `.tmp\codegraph\` only as generated cache, not committed

Changes:
- Move CodeGraph lock/cache to a writable, client-stable location.
- Prefer project-local writable cache when allowed; otherwise use a documented user temp fallback.
- Add stale lock cleanup with ownership/time checks.
- Add sandbox-safe provider health test.
- Ensure provider result includes:
  - `provider=codegraph`;
  - `status=pass|warn|fail`;
  - `cachePath`;
  - `lockPath`;
  - `fallback=graphify` when not promotable.
- Keep Graphify default until promotion gate passes.

Acceptance criteria:
- CodeGraph CLI provider no longer fails on `.tmp/codegraph/codegraph.lock` EPERM.
- Graphify still passes as default.
- Doctor can distinguish "CodeGraph MCP healthy" from "CodeGraph CLI provider promotable".
- Benchmark baseline remains available.

Verification commands:

```powershell
node tools\codemap.test.js
node tools\codemap.js --root . --json
node tools\codemap.js --root . --provider codegraph --json
node tools\codemap-benchmark.js --root . --provider graphify --json
node tools\doctor.js --root .
git status --short
```

Rollback:
- Keep `CODEMAP_PROVIDER=graphify` default.
- If CodeGraph repair regresses, remove only provider promotion path and preserve explicit fallback reporting.

Risks:
- Sandbox and real user may disagree on writable dirs.
- Parallel CodeGraph calls can still expose SQLite/WAL lock behavior.

Do not:
- Do not make CodeGraph default in this sprint.
- Do not delete Graphify paths or benchmarks.
- Do not solve browser/tooling in this slice.

### P0.3 Agent Surface Audit

Goal: Claude/Codex/Gemini parity must be measured as a production artifact, not inferred from copied files.

Primary files/modules:
- `tools\agent-surface-audit.js` new
- `tools\agent-surface-audit.test.js` new if test pattern supports it
- `tools\doctor-core.js`
- `C:\Users\espad\.claude\settings.json`
- `C:\Users\espad\.codex\hooks.json`
- `C:\Users\espad\.gemini\settings.json`
- `C:\Users\espad\.claude\skills\`
- `C:\Users\espad\.codex\skills\`
- `C:\Users\espad\.gemini\skills\`
- `.planning\agent-surface-audit-latest.json` generated report
- `.planning\agent-surface-audit-latest.md` generated report

Changes:
- Build a read-only audit tool that compares:
  - hook event support;
  - hook command inventory;
  - skill inventory and aliases;
  - command shims;
  - Context7 CLI availability;
  - codemap provider status;
  - memory paths;
  - browser tooling status;
  - known unsupported client events and fallback contract.
- Emit JSON for gates and Markdown for human review.
- Integrate doctor as "latest audit found / missing / stale" without making parity perfect a hard block yet.

Acceptance criteria:
- Audit runs without mutating client configs.
- JSON output has explicit unexplained gaps.
- Markdown report lists supported, unsupported, and fallback surfaces per client.
- Doctor links or points to latest audit.

Verification commands:

```powershell
node tools\agent-surface-audit.js --json
node tools\agent-surface-audit.js --markdown
node tools\doctor.js --root .
node tools\project-docs.js verify --root .
git status --short
```

Rollback:
- Remove doctor integration first if it causes false warnings.
- Keep standalone audit script for manual use.

Risks:
- Global config paths can differ per client install.
- Skill counts alone are misleading; aliases and semantic availability matter.

Do not:
- Do not auto-sync or delete skills in P0.3.
- Do not treat unsupported Codex events as bugs if fallback is documented.
- Do not write into Gemini/Codex/Claude configs from the audit.

## P1: Reduce Context Burn And Routing Risk

P1 starts only after P0.1-P0.3 are green or have explicit blockers with rollback applied.

### P1.1 Compact-Aware Context Budget

Goal: context warnings must reflect active model window, not historical JSONL size.

Primary files/modules:
- `C:\Users\espad\.claude\hooks\context-budget-gate.js`
- `C:\Users\espad\.claude\hooks\session-size-guard.js`
- `C:\Users\espad\.claude\hooks\lib\metrics.js`
- shared hook tests
- `tools\token-impact.js`

Changes:
- Introduce active-window accounting fields: `lastCompactAt`, `activeWindowStart`, `activeTranscriptBytes`.
- Use compact markers or persisted state to count only active segment.
- Deduplicate warnings through one coordinator.
- Keep telemetry even when advisory output is suppressed.

Acceptance criteria:
- Synthetic post-compact transcript counts only active segment.
- Warnings are short and non-repeating.
- Hook suites pass.

Verification commands:

```powershell
node C:\Users\espad\.claude\hooks\test-hooks-behavior.js
node C:\Users\espad\.claude\hooks\test-all-hooks.js
node C:\Users\espad\.codex\test-codex-hooks.js
node tools\token-impact.js measure-command --cmd "node tools\doctor.js --root ." --json
node tools\doctor.js --root .
```

Rollback:
- Feature flag new accounting and retain old file-size heuristic for one sprint.

Risks:
- Compact markers may differ by client.
- Too much suppression can hide useful budget warnings.

Do not:
- Do not enable RAG injection as part of budget changes.
- Do not remove metrics collection.

### P1.2 Skill Router Quality Gate

Goal: automatic skill selection must prefer `no skill` over wrong local skills.

Primary files/modules:
- `tools\skill-search.js`
- `tools\skill-search.test.js`
- skill registry/digests readers
- optional `.planning\skill-router-benchmark-*.json`

Changes:
- Add benchmark prompts for browser, security, git, docs, backend, frontend, research, legal, QA.
- Add expected winners and acceptable `no skill`.
- Gate on semantic relevance before total score.
- Expose marketplace status as evidence, not as an interactive dependency.

Acceptance criteria:
- Browser automation query does not select `init-project`, `sync-docs`, or `clone-research`.
- Security API validation query selects `security-best-practices` or a justified domain route.
- Low confidence returns `no skill`.

Verification commands:

```powershell
node tools\skill-search.test.js
node tools\skill-search.js "browser automation ai agent" --top 3
node tools\skill-search.js "security api input validation" --top 3
node tools\doctor.js --root .
```

Rollback:
- Keep old scoring behind a compatibility flag for one sprint.
- If benchmark is too strict, downgrade new cases to WARN but keep evidence.

Risks:
- Skill metadata quality may be uneven.
- Marketplace output may be unavailable or interactive.

Do not:
- Do not auto-install marketplace skills.
- Do not load large skill bodies during routing.

### P1.3 Context7 CLI Wrapper

Goal: Context7 usage becomes a scriptable Windows-first contract, not a remembered command pattern.

Primary files/modules:
- `tools\context7-cli.js` new
- `tools\context7-cli.test.js` new if feasible
- `tools\research-router.js`
- `AGENTS.md`, `CLAUDE.md`, `.gemini\GEMINI.md` docs if command contract changes

Changes:
- Implement wrapper around `cmd /c npx.cmd ctx7 ...`.
- Support library resolution and docs query.
- Strip ANSI, enforce timeout, capture command, stdout excerpt, stderr excerpt, exit code, skip reason.
- Explicitly mark interactive `ctx7 skills search` as research-only unless non-interactive mode exists.

Acceptance criteria:
- Wrapper resolves a library ID for Vercel AI or another stable library.
- Wrapper queries `/microsoft/playwright-mcp`.
- Network or auth failure produces a skip reason, not silent success.

Verification commands:

```powershell
node tools\context7-cli.js library "vercel ai" "agents tool calling"
node tools\context7-cli.js docs /microsoft/playwright-mcp "CLI usage for coding agents"
node tools\research-router.test.js
node tools\doctor.js --root .
```

Rollback:
- Research-router can keep direct command examples while wrapper matures.

Risks:
- Network restrictions can make tests flaky.
- `npx` can invoke PowerShell shims if command is not forced through `cmd /c npx.cmd`.

Do not:
- Do not depend on interactive Context7 skills search.
- Do not hard-fail offline planning tasks because Context7 network is unavailable.

### P1.4 Git Workflow Audit

Goal: closeout must distinguish project-local changes from C-drive git-root noise and sandbox ownership failures.

Primary files/modules:
- `tools\git-workflow-audit.js` new
- `tools\doctor-core.js`
- `tools\pipeline-state.js`
- `projects-registry.json`

Changes:
- Record `projectRoot`, `gitRoot`, branch, dirty files scoped to `-- .`, missing paths, dubious ownership.
- Warn when `gitRoot` is outside `projectRoot`.
- Add safe.directory guidance for Codex sandbox without mutating global git config automatically.
- Prepare closeout schema fields for future Agent Harness runner.

Acceptance criteria:
- C-root projects do not report unrelated global files as project-local dirty work.
- Missing/dubious registered projects are explicit WARN with repair guidance.

Verification commands:

```powershell
node tools\git-workflow-audit.js --root . --json
node tools\doctor.js --root .
git status --short -- .
```

Rollback:
- Keep audit read-only.
- Remove doctor integration if false positives block unrelated work.

Risks:
- Registered paths can be stale.
- Sandbox safe.directory guidance must not overwrite user git trust silently.

Do not:
- Do not run destructive cleanup.
- Do not auto-edit global git config without approval.

## P2: Build The Agent Harness Layer

P2 starts after P0 is stable and P1 routing/context/git foundations are acceptable. P2 introduces durable run artifacts and later browser tooling as on-demand adapters.

### P2.1 Agent Harness Run Schema

Goal: complex tasks must have machine-readable run artifacts before implementation.

Primary files/modules:
- `tools\agent-harness.js` new
- `tools\agent-harness-core.js` new if separation helps tests
- `tools\agent-harness.test.js` new
- `.planning\runs\<runId>\` generated, not manually edited
- `tools\pipeline-state.js`

Changes:
- Implement dry-run first.
- Create `.planning/runs/<yyyy-mm-dd>-<slug>-<shortid>/`.
- Generate required artifacts:
  - `run.json`;
  - `input.json`;
  - `design.json`;
  - `design.md`;
  - `implementation_plan.json`;
  - `qa_plan.json`;
  - `research.json`;
  - `review_summary.md`;
  - `closeout.json`.
- Validate allowed phase transitions.
- Block closeout if required gates are missing.

Acceptance criteria:
- Complex dry-run creates all required artifacts.
- Missing gate blocks `closed`.
- Run artifacts contain command evidence and next required gate.

Verification commands:

```powershell
node tools\agent-harness.test.js
node tools\agent-harness.js dry-run --root . --task "sample complex refactor" --json
node tools\doctor.js --root .
git status --short
```

Rollback:
- Keep runner dry-run only until tests and docs stabilize.
- Existing `/pipeline` remains the operational fallback.

Risks:
- Too much schema up front can slow normal tasks.
- Runner can duplicate pipeline-state unless boundaries are explicit.

Do not:
- Do not replace `/pipeline` behavior in the first runner sprint.
- Do not make runner mandatory for trivial tasks.

### P2.2 Agent Harness Gate Integration

Goal: lint/test/review/docs/git gates must consume artifacts and command results.

Primary files/modules:
- `tools\agent-harness.js`
- `tools\agent-harness-core.js`
- `tools\pipeline-state.js`
- `tools\project-docs.js`
- `tools\doctor.js`
- hook integration only if thin and telemetry-first

Changes:
- Add gate commands:
  - input gate;
  - design gate;
  - implementation plan gate;
  - lint/test gate;
  - semantic review gate;
  - docs sync gate;
  - git ready gate;
  - closeout gate.
- Record pass/fail and artifact pointers.
- Keep hooks as sensors/guards, not orchestrator.

Acceptance criteria:
- A sample run cannot close without verification evidence.
- High/Critical review finding blocks closeout.
- Docs delta requirement is explicit for architecture/commands/gotchas changes.

Verification commands:

```powershell
node tools\agent-harness.test.js
node tools\project-docs.test.js
node tools\pipeline-state.test.js
node tools\doctor.js --root .
```

Rollback:
- Disable mandatory gate enforcement and leave artifact generation.

Risks:
- False blocking can slow emergency fixes.
- Review severity schema must be simple enough for all clients.

Do not:
- Do not route every command through hooks.
- Do not block on prose-only review summaries.

### P2.3 Browser Tooling On-Demand Pilot

Goal: browser automation becomes CLI-first and on-demand, never global context payload.

Primary files/modules:
- `tools\browser-tooling-audit.js` or `.planning\BROWSER-TOOLING-DECISION-*.md`
- optional wrappers only after Context7 proof:
  - `tools\agent-browser-cli.js`
  - `tools\playwright-cli.js`
- docs after decision

Changes:
- Compare Vercel Labs `agent-browser`, Playwright CLI, Playwright MCP, Stagehand/Browserbase, Browser Use.
- Use Context7 wrapper for docs where available.
- Run one local dry-run only after P0/P1 are stable.
- Store snapshot/evidence artifact.
- Mark old browser-harness default routing as legacy only after replacement proof.

Acceptance criteria:
- One local dry-run opens a target, snapshots, interacts by refs, and writes evidence.
- Default global startup does not include Browser MCP schemas.
- Browser decision includes token cost, Windows support, determinism, auth handling, CI compatibility, local/cloud mode.

Verification commands:

```powershell
node tools\context7-cli.js docs /microsoft/playwright-mcp "CLI and snapshot usage"
node tools\browser-tooling-audit.js --json
node tools\doctor.js --root .
```

Rollback:
- Keep existing browser plugin/MCP available manually.
- Do not wire browser tooling into startup.

Risks:
- Browser tools evolve quickly; docs need fresh verification.
- Cloud browser options may need credentials and should remain optional.

Do not:
- Do not start with browser/tools before P0.
- Do not install global browser services as a default path.
- Do not store browser credentials in repo.

### P2.4 Generated Client Surface Sync

Goal: parity moves from audit-only to generated manifests, but only after P0.3 proves what differs.

Primary files/modules:
- `tools\agent-surface-audit.js`
- `tools\sync-agent-surface.js` new
- generated manifest, for example `agent-surface.manifest.json`
- client skill/config target dirs

Changes:
- Define canonical manifest for skills, aliases, hooks, commands, and known unsupported events.
- Generate target-specific outputs.
- Require explicit fallback for unsupported client events.
- Add dry-run diff before apply.

Acceptance criteria:
- Dry-run shows intended Claude/Codex/Gemini deltas without writing.
- Apply mode is gated by tests and user approval.
- No unexplained skill parity gaps remain.

Verification commands:

```powershell
node tools\sync-agent-surface.js --dry-run --json
node tools\agent-surface-audit.js --json
node tools\doctor.js --root .
```

Rollback:
- Generated sync is opt-in until proven.
- Existing configs remain authoritative fallback for one release cycle.

Risks:
- Auto-sync could erase intentional client-specific aliases.
- Gemini/Antigravity skill model may not match Claude/Codex exactly.

Do not:
- Do not auto-apply generated configs in the first sync sprint.
- Do not delete skills not represented in the manifest until manually reviewed.

## Release Gates

### P0 Release Gate

P0 can close when:
- P0.1, P0.2, P0.3 acceptance criteria pass or have explicit documented blockers.
- Hook sanity suites pass across Claude/Codex/Gemini.
- Doctor has FAIL=0.
- The untracked user file remains untouched.

Required bundle:

```powershell
node C:\Users\espad\.claude\hooks\test-all-hooks.js
node C:\Users\espad\.codex\test-codex-hooks.js
node C:\Users\espad\.gemini\hooks\test-all-hooks.js
node C:\Users\espad\.claude\hooks\test-hooks-behavior.js
node C:\Users\espad\.gemini\hooks\test-hooks-behavior.js
node tools\codemap.js --root . --provider codegraph --json
node tools\agent-surface-audit.js --json
node tools\doctor.js --root .
node tools\project-docs.js verify --root .
git status --short
```

### P1 Release Gate

P1 can close when:
- Context warnings are compact-aware.
- Skill router benchmark rejects known wrong matches.
- Context7 wrapper is scriptable through `cmd /c npx.cmd`.
- Git workflow audit reports scoped project dirtiness.

Required bundle:

```powershell
node tools\skill-search.test.js
node tools\research-router.test.js
node tools\git-workflow-audit.js --root . --json
node tools\doctor.js --root .
node tools\project-docs.js verify --root .
git status --short -- .
```

### P2 Release Gate

P2 can close when:
- Agent Harness dry-run creates all required artifacts.
- Missing gates block closeout.
- Browser tooling is on-demand and documented as CLI-first.
- Generated surface sync has dry-run proof.

Required bundle:

```powershell
node tools\agent-harness.test.js
node tools\agent-harness.js dry-run --root . --task "sample complex feature" --json
node tools\sync-agent-surface.js --dry-run --json
node tools\doctor.js --root .
node tools\project-docs.js verify --root .
git status --short
```

## First Implementation Sprint Contract

Start with P0.1 only.

Why:
- Current audit shows hook suites can fail because of memory path/env behavior.
- If startup is flaky, every later gate can produce false failures.
- Memory startup fix is narrow and reversible.

P0.1 done means:
- no env-clearing workaround needed for hook sanity suites;
- provider-aware memory health is tested;
- docs describe actual memory startup sources;
- no browser, CodeGraph promotion, or agent-surface sync changes are mixed into the commit.

Next sprint after P0.1:
- P0.2 CodeGraph lock/cache path.

Next sprint after P0.2:
- P0.3 agent surface audit.

Only after P0.3:
- P1 compact-aware context accounting.
- P1 skill router benchmark.
- P1 Context7 wrapper.
- P1 git workflow audit.
- P2 Agent Harness runner.
- P2 browser tooling pilot.

## Closeout Template For Each Sprint

Each sprint final response must include:
- changed files;
- commands run with PASS/FAIL summary;
- generated artifacts;
- dirty git state;
- user-owned files intentionally untouched;
- rollback path;
- remaining risks.

Do not claim production-ready until P0, P1, and P2 release gates pass with proof.
