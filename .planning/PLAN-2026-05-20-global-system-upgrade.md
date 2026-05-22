# Global System Upgrade Plan

Date: 2026-05-20  
Status: architecture plan  
Sources:
- `.planning/AUDIT-2026-05-20-global-claude-codex-efficiency.md`
- `.planning/AUDIT-2026-05-20-codegraph-agentmemory-evaluation.md`

## Goal

Upgrade the global Claude Code / Codex control plane so routine work spends less context before it is correctly routed, while complex work gets better up-front research, clearer Git discipline, and measurable verification.

Done when:
- P0 startup and routing defects are fixed and verified.
- `/pipeline` v3 owns classification, interview mode, state lifecycle, verification, and closeout.
- `skill-router` and `research-router` run before expensive skill/code exploration.
- CodeGraph and agentmemory are piloted as candidates for primary providers, with Graphify/RAG fallbacks kept until they win by data.
- Hook count and hook output are reduced only after evidence proves low value, failure, duplication, or token cost.
- Docs and Git/PR workflow have one source of truth and one repeatable ship path.

## User Decisions

- Use the two `2026-05-20` audit documents as the base evidence.
- Produce a detailed implementation backlog with sprint slices and acceptance checks.
- Optimize first for token burn and startup overhead.
- Apply aggressive hook diet, but disable or merge hooks only after proving they do not work, duplicate other checks, or cost more than they return.
- Treat CodeGraph and agentmemory as candidates for the future primary path, not just research toys.
- Include branch, commit, PR, and verification workflow in the architecture plan.

## Evidence Baseline

Hard failures and risks:
- Codex hook suite is `44/45 PASS`; `projects-dashboard.js` fails with `EPERM` writing `~/.claude/projects-dashboard.md`.
- `skills-sh` marketplace search is blocked on Windows by PowerShell execution policy.
- `skill-search.js` hides marketplace errors and uses total score fallback, so nonsense queries can suppress marketplace search.
- Local Claude settings include a secret-like literal in an allowed command and a broad 242-entry allowlist.
- `gh auth status` has an invalid token; public repo search works, code search fails with HTTP 401.
- Project pipeline state is stale from `2026-05-13`, phase `implementing`, and includes mojibake.
- Global Codex default is `gpt-5.5` with `xhigh` reasoning, which is too expensive for normal work.

Scale/cost evidence:
- Claude has 60 configured hook handlers; Codex has 45 hook commands.
- Skill registry has 94 digest rows and about 651,910 estimated tokens.
- Largest skills are 18k-36k tokens, so a wrong skill load is a major cost.
- Usage increased from 101.6 to 108.2 messages/day in the latest audit window.

Pilot evidence:
- CodeGraph indexed this project successfully: 665 files, 3735 nodes, 6015 edges, 6.58 MB DB.
- CodeGraph returned relevant project-docs context, but parallel query/context calls hit `database is locked` on the WASM backend.
- `affected tools\project-docs-core.js --json` returned no affected tests, so affected-test mapping is not useful yet.
- agentmemory direct `npx` invocation timed out because it likely starts long-running services; a real pilot needs lifecycle and port checks.
- agentmemory must start with auto-compress off and strict top-K injection, or it can recreate token burn.

Context7 note:
- Context7 MCP lookup for `@colbymchenry/codegraph` failed with an invalid API key. The implementation phase must either restore Context7 or record an explicit fallback source before changing code that uses external APIs.

## Target Architecture

```text
User prompt
  -> lightweight task classifier
  -> skill-router
  -> research-router
  -> pipeline state + session ledger
  -> auto route or interview route
  -> implementation / audit / research / docs workflow
  -> verification gate
  -> docs sync + Git/PR workflow
  -> state closed + telemetry retained
```

Provider boundaries:
- `skill-router`: chooses local skills, marketplace skills, or no skill before a skill body is loaded.
- `research-router`: chooses Graphify/CodeGraph, RAG/agentmemory, Context7, GitHub CLI, or project docs based on the task.
- `codemap provider`: `graphify | codegraph`, selected by feature flag.
- `memory provider`: `project-memory-rag | agentmemory`, selected by feature flag.
- hooks: enforce safety, collect telemetry, and provide tiny advisories; hooks must not be the primary orchestration layer.

Non-goals:
- No full Graphify removal until CodeGraph passes stress, relevance, and tool-call reduction tests.
- No full RAG/MEMORY replacement until agentmemory proves lower startup cost and acceptable recall.
- No new hard-blocking hook unless it protects secrets, destructive actions, commits, or corrupt config.
- No broad dependency or service installation without an explicit pilot flag and rollback.

## Sprint 0 - P0 Stabilization

### S0.1 Make `projects-dashboard.js` fail-soft

Problem: Codex SessionStart can fail because a non-critical dashboard writes outside the sandbox.

Plan:
- Wrap all final dashboard writes in `try/catch`.
- If running under Codex sandbox or receiving `EPERM`, write to a project-local/temp cache or skip with telemetry.
- Exit `0` for dashboard write failures.
- Add a regression test that simulates `EPERM` for SessionStart dashboard writes.

Acceptance checks:
- `node ~/.codex/test-codex-hooks.js` returns `45/45 PASS`.
- `node ~/.claude/hooks/test-all-hooks.js` remains `35/35 PASS`.
- Dashboard failure emits no startup-blocking output.

Rollback:
- Disable dashboard hook or mark it background-only in Codex hooks.

### S0.2 Remove secret-like local allowlist entries

Problem: a literal Google API key-like value appears in local settings allowlist.

Plan:
- Remove all allowed commands containing literal credentials from `.claude/settings*.json` and Codex config.
- Rotate the key if it was real.
- Add a settings scanner path to `doctor`.
- Convert one-off historical allows into scoped command families.

Acceptance checks:
- Secret scanner finds no key-like values in `.claude/settings*.json`, `.codex/config.toml`, project docs, or changed files.
- `doctor --root .` reports no secret/config warning.

Rollback:
- Restore only non-secret command families from backup.

### S0.3 Fix Windows marketplace skill search

Problem: marketplace search is installed but effectively dead on Windows.

Plan:
- In `tools/skill-search.js`, call `skills-sh.cmd` or `cmd /c npx skills-sh`, not the unsigned `.ps1` shim.
- Return marketplace errors in `--json` output instead of silently returning `[]`.
- Split `relevanceScore` from `totalScore`.
- Trigger marketplace fallback when top relevance is below threshold or all top-N relevance scores are zero.
- Cache marketplace results with `{ status, error, ts, ttl }`.

Acceptance checks:
- `skill.cmd "architecture refactor" --top 3 --json` returns relevant local candidates.
- `skill.cmd "zzzzzz" --top 3 --json` either calls marketplace or reports a visible marketplace error.
- A test covers unsigned PowerShell wrapper fallback.
- A test covers nonsense query fallback by relevance, not total score.

Rollback:
- Keep local-only search but surface `marketplaceUnavailable` in JSON.

### S0.4 Close stale pipeline state and fix encoding

Problem: stale `implementing` state from `2026-05-13` can pollute future sessions.

Plan:
- Define lifecycle: `classified -> planned -> implementing -> verified -> shipped -> closed`.
- Auto-expire non-paused states after 24h.
- On session start with stale state, show one tiny choice: resume, close, or replace.
- Write all state/docs as UTF-8 without mojibake.

Acceptance checks:
- `node tools/doctor.js --root .` no longer warns about stale state after close/replace.
- State JSON includes lifecycle phase and close timestamp.
- Encoding regression covers Cyrillic text round-trip.

Rollback:
- Preserve legacy state as read-only fallback and create a fresh project-local state.

### S0.5 Add GitHub CLI health to `doctor`

Problem: GitHub repo search works but authenticated code search fails.

Plan:
- Add `gh --version` and `gh auth status` checks to doctor.
- Classify unauthenticated `gh search code` as warning, not failure.
- Add remediation text: re-authenticate before research-router uses code search.

Acceptance checks:
- `node tools/doctor.js --root .` reports GitHub CLI state.
- Research-router skips code search when auth is invalid and records why.

Rollback:
- Keep GitHub discovery optional until auth is healthy.

### S0.6 Right-size default model and reasoning effort

Problem: Codex defaults to `gpt-5.5` with `xhigh` reasoning, so ordinary work pays architecture-level cost before classification.

Plan:
- Change the default route for normal coding/debugging/docs work to medium reasoning.
- Keep `xhigh` only for architecture, security, deep audits, complex multi-module refactors, and explicit user requests.
- Record model and reasoning effort in the session ledger.
- Add doctor/audit output that flags expensive defaults when no classifier override exists.
- Keep a documented escape hatch for one-off high-reasoning sessions.

Acceptance checks:
- Routine task classification chooses medium effort.
- Architecture/security classifications can still choose high or xhigh.
- Usage audit can report model/effort by session after the change.
- Config/docs explain the routing rule in one place.

Rollback:
- Restore previous model/effort defaults and keep classifier logging for later analysis.

## Sprint 1 - Pipeline v3

Decision: Pipeline v3 becomes the front door for non-trivial sessions. It must classify first, ask structured questions only when useful, and close state at the end.

Core behavior:
- `auto` mode for trivial/known tasks.
- `interview` mode for complex, ambiguous, architectural, security, or multi-file work.
- One active goal per session.
- At most one focused question at a time, with 2-3 answer variants plus free-form override.
- Required state refresh at classification.
- Required final closeout with proof and remaining work.

State schema:
- `cwd`, `projectKey`, `task`, `goal`, `doneWhen`.
- `complexity`: `TRIVIAL | MEDIUM | BUG | ARCH | COMPLEX | RESEARCH`.
- `mode`: `auto | interview`.
- `phase`: lifecycle state.
- `routers`: selected skill/research providers and alternatives.
- `commands`: build, test, lint, doctor, hook tests.
- `ledgerPath`: project-local session ledger.
- `ts`, `expiresAt`, `closedAt`.

Session ledger JSONL:
- task classification and confidence;
- chosen skills and rejected alternatives;
- research sources used;
- model/effort selection;
- hook warnings/blocks/errors;
- verification commands and result summary;
- docs/Git actions;
- final outcome.

Acceptance checks:
- A trivial task bypasses interview and heavy skills.
- A complex architecture task enters interview mode and writes state before planning.
- Stale state is closed or replaced before new work.
- Final response cannot claim success without artifact and verification proof.

Implementation candidates:
- Runtime skill: `~/.claude/skills/pipeline/SKILL.md`, `~/.codex/skills/pipeline/SKILL.md`, `~/.gemini/skills/pipeline/SKILL.md`.
- Checks: `audit/S11_pipeline_top1/skills/pipeline-check.js`.
- State helpers should live in repo tooling first, then sync to runtime copies.

Verification commands:
- `node audit/S11_pipeline_top1/skills/pipeline-check.js`
- `node tools/doctor.js --root .`
- `node ~/.codex/test-codex-hooks.js`

## Sprint 2 - `skill-router`

Decision: skill ranking must happen before any expensive skill body is loaded.

Inputs:
- user prompt;
- project docs and domain rules;
- local skill metadata/digests;
- marketplace search when relevance is low;
- prior install/use counts;
- token estimate and risk label.

Output budget:
- top 3 skills only;
- one-line reason each;
- token estimate;
- local/marketplace/source status;
- `no skill` option when direct work is cheaper.

Scoring:
- Relevance is a separate hard gate.
- Total score may include install count, verified source, risk, and token cost, but cannot override zero relevance.
- Marketplace fallback triggers on low relevance or all-zero top-N relevance.

Failure policy:
- Router failures are advisory, not blocking, unless the task requires a specific unavailable skill.
- Errors must be visible in JSON and ledger.
- Windows wrapper failures must include the exact command attempted.

Acceptance checks:
- Nonsense query does not return confident local recommendations.
- A known local query returns local candidates without marketplace overhead.
- Marketplace errors are visible and cached.
- Skill router record appears in session ledger before skill invocation.

Rollback:
- Fall back to local `skill-search.js` with explicit `marketplaceUnavailable`.

## Sprint 3 - `research-router`

Decision: research must be one small evidence block, not a pile of unbounded searches.

Provider selection:
- Local code structure: Graphify now, CodeGraph when pilot flag passes.
- Project memory/history: current RAG/session-harvest now, agentmemory when pilot flag passes.
- External library docs: Context7 first; if unavailable, record fallback and source.
- Similar implementations: GitHub CLI repo/code search when auth is valid.
- Stable project truth: AGENTS/CLAUDE/GEMINI docs.

Evidence block format:
- `question`;
- `sources_used`;
- `top_findings` up to 5 bullets;
- `keep/change decisions`;
- `skipped_sources` with reason;
- `token_budget`.

Budgets:
- No unbounded command output.
- Main session gets summaries, not large code dumps.
- Heavy context fetches go to a bounded explorer route only when needed.

Acceptance checks:
- With invalid Context7 or GitHub auth, the router records a skip reason and continues.
- Architecture plans include a compact evidence block.
- Research commands use limits.
- No source can inject more than its configured token budget.

Rollback:
- Use current Graphify/RAG/manual docs path and mark missing providers in the ledger.

## Sprint 4 - CodeGraph Pilot

Decision: CodeGraph is the primary candidate to replace Graphify for code intelligence, but Graphify remains production fallback until CodeGraph wins by measurement.

Feature flag:
- `codeMapProvider = graphify | codegraph`

Pilot tasks:
- Add provider interface around current codemap queries.
- Tighten excludes for `audit/**`, `.planning/**` where appropriate, `.tmp/**`, `graphify-out/**`, `.rag/**`, generated reports, and copied docs.
- Force Windows-safe execution through `cmd /c npx` or installed `.cmd` shims.
- Use writable cache paths.
- Test native backend or MCP/server serialization to avoid `database is locked`.
- Add single-flight wrapper if CLI parallelism remains unsafe.
- Build a 10-question relevance benchmark against Graphify.
- Measure file reads/tool calls on at least one Claude and one Codex task.

Promotion criteria:
- Parallel query stress test has no DB locks.
- CodeGraph beats or matches Graphify on 10 fixed project questions.
- Controlled task reduces file reads/tool calls by at least 40%.
- `doctor` can report CodeGraph health without startup token bloat.
- Provider can be disabled with one flag.

Acceptance checks:
- `codegraph status` succeeds on this repo.
- `codegraph query` and `context` run through serialized wrapper under parallel load.
- `tools/codemap.js` can use either provider.
- Graphify remains available as fallback.

Rollback:
- Set `codeMapProvider=graphify`.
- Delete CodeGraph runtime hook registrations while keeping pilot files.

## Sprint 5 - agentmemory Pilot

Decision: agentmemory is the primary candidate for long-term memory consolidation, not code graph replacement.

Feature flag:
- `memoryProvider = project-rag | agentmemory`

Pilot constraints:
- Auto-compress off.
- Injection budget: 1000-2000 tokens max.
- No duplicate RAG/session-harvest injection while agentmemory injection is enabled.
- Explicit service lifecycle: start, health, port check, stop.
- Default ports from audit: server 3111, viewer 3113; verify before use.
- No PostToolUse LLM compression in the initial pilot.

Pilot tasks:
- Build a Windows service wrapper or command recipe that returns quickly after health check.
- Add `doctor` checks for server status and port conflicts.
- Create 20 recall prompts from existing project memory/checkpoints.
- Compare current memory/RAG against agentmemory for recall relevance and startup tokens.
- Add governance delete/export smoke test.

Promotion criteria:
- Session-start injection is lower than current memory/RAG while preserving recall.
- Recall quality is acceptable on the 20-prompt set.
- Startup overhead is bounded and visible in ledger.
- No background service remains orphaned after tests.
- Current memory junction remains recoverable.

Acceptance checks:
- agentmemory pilot starts and passes health check.
- SessionStart context stays within configured budget.
- Duplicate memory hooks are disabled under the pilot flag.
- Rollback restores current RAG/session-harvest behavior.

Rollback:
- Set `memoryProvider=project-rag`.
- Disable agentmemory hooks/services.
- Keep existing `~/.claude/projects/C--/memory` and `.codex/memories` junction as canonical.

## Sprint 6 - Evidence-Based Hook Diet

Decision: aggressively reduce hook count and hook output, but only after evidence.

Hook classes:
- `hard-block`: secrets, destructive actions, corrupt config, commit quality.
- `advisory`: skill/research hints, context budget warnings, docs reminders.
- `background`: dashboards, graph updates, telemetry aggregation.
- `telemetry`: metrics only, no user-facing output.

Required evidence before disabling or merging:
- run count in last N sessions;
- block/warn count;
- false positive or nuisance count;
- error count and stack class;
- average wall time;
- output size/token estimate;
- overlap with another hook;
- whether the hook prevented a real failure;
- rollback path.

Diet rules:
- Non-critical hooks must never fail startup/session flow.
- Background hooks must catch filesystem and sandbox errors.
- Advisory hooks must have per-session output caps.
- Duplicate `Bash` PostToolUse groups should be consolidated into one runner where possible.
- Any hook that cannot prove value after the measurement window moves to disabled-by-default.

Initial candidates for measurement:
- dashboard generation hooks;
- duplicate Bash PostToolUse hooks;
- Graphify advisory hooks once CodeGraph provider exists;
- repeated docs reminders after docs verify passes;
- context warnings that do not include actionable next step.

Targets:
- Reduce configured hook handlers materially after the evidence window.
- Reduce startup-visible hook output to near zero on healthy projects.
- Keep hard-block coverage for secrets/destructive/config/commit quality.

Acceptance checks:
- Hook inventory file lists every hook, class, owner, failure policy, and rollback.
- `hook-stats.js` or successor records evidence fields.
- A removal/merge PR includes before/after metrics.
- Claude and Codex hook suites pass after each diet slice.

Rollback:
- Restore previous hook registration file from the prior commit.
- Keep removed hooks available but disabled for one release cycle.

## Sprint 7 - Docs And Git Workflow

Decision: for this project, `AGENTS.md` is canonical. `CLAUDE.md` and `.gemini/GEMINI.md` sync from it.

Docs plan:
- Update gate messages that still claim `CLAUDE.md -> AGENTS.md`.
- Keep the six core sections identical across all three docs.
- Update docs only when architecture, commands, gotchas, or current state change.
- Keep audit/plan/checkpoint docs in `.planning`, not root clutter.

Git workflow:
- One task per branch.
- Branch format: `system-upgrade/<slug>` or `fix/<slug>`.
- Commit format: `<type>: <description>`.
- PR title under 70 chars.
- PR body includes Summary bullets and Test plan checklist.
- Never commit `.env`, secrets, `node_modules`, generated caches, or build artifacts.
- No force-push to main.

Suggested commit slices:
1. `fix: make codex startup hooks fail-soft`
2. `fix: restore windows marketplace skill search`
3. `refactor: add pipeline v3 state lifecycle`
4. `feat: add skill router preflight`
5. `feat: add research router evidence budget`
6. `feat: pilot codegraph codemap provider`
7. `feat: pilot agentmemory provider`
8. `refactor: reduce hook surface by evidence`
9. `docs: align global workflow documentation`

Verification gate per PR:
- relevant unit tests;
- `node tools/doctor.js --root .`;
- `node tools/project-docs.js verify --root .`;
- applicable hook suites;
- no secret scan findings;
- changed docs synced when core sections change.

Rollback:
- Each PR must be independently revertible.
- Provider pilots must be disabled by config before revert is required.

## Cross-Cutting Security And Quality Rules

- Use env vars only for credentials and tokens.
- Validate new JSON/config boundaries with schema validation.
- Do not interpolate shell commands from untrusted input.
- Any new filesystem writes must be sandbox-aware and fail-soft unless they are the requested artifact.
- Keep functions small and split files before they exceed maintainable size.
- No production `console.log`; structured diagnostics or test-only output only.
- Do not mutate shared config objects in place.

## Master Acceptance Checklist

P0:
- Codex hooks are `45/45 PASS`.
- Claude hook sanity and behavior remain green.
- Secret-like local allowlist entry is removed or rotated.
- Marketplace search failure is visible and fallback uses relevance.
- Stale pipeline state is closed/replaced.

Pipeline v3:
- Auto/interview modes are documented and tested.
- State lifecycle closes at final response.
- Ledger records routing, research, verification, and outcome.

Routers:
- `skill-router` runs before skill body loading.
- `research-router` emits compact evidence with skip reasons.
- Context7/GitHub auth failures are explicit, not silent.

Pilots:
- CodeGraph has stress, relevance, and tool-call reduction data.
- agentmemory has lifecycle, recall, and token budget data.
- Neither pilot increases hook count without retiring duplicate old hooks.

Hook diet:
- Every disabled/merged hook has evidence.
- Healthy startup is quiet.
- Hard-block safety remains intact.

Docs/Git:
- `AGENTS.md`, `CLAUDE.md`, and `.gemini/GEMINI.md` agree on canonical source wording.
- PR workflow is documented and followed.
- Verification proof is recorded before ship.

## Recommended Execution Order

1. Stabilize P0 defects.
2. Add ledger and measurement required for hook diet.
3. Right-size default model/effort routing.
4. Upgrade Pipeline v3 state/interview behavior.
5. Add `skill-router`.
6. Add `research-router`.
7. Run CodeGraph pilot behind a flag.
8. Run agentmemory pilot behind a flag.
9. Execute measured hook diet.
10. Align docs and Git workflow.

This order prevents the main failure mode from the audits: adding more tools before proving that routing, state, and hooks are under control.
