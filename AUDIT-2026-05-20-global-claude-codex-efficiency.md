# Global Claude Code / Codex Efficiency Audit

Date: 2026-05-20  
Scope: global Claude Code + Codex settings, hooks, skill routing, pipeline discipline, docs workflow, Git/GitHub discovery, token efficiency.  
Phase: audit only. No architecture fixes applied in this pass.

## Goal

Reduce token burn and operational friction while making Claude Code/Codex reliably:

- find the right local and marketplace skills before work starts;
- follow one explicit pipeline from interview to implementation to verification;
- maintain project docs automatically without conflicting sources of truth;
- use Git and GitHub discovery deliberately;
- avoid hooks that block normal work or silently fail.

## Sources Checked

Local evidence:

- `C:/Users/espad/.claude/usage-data/report-2026-05-20-084725.html`
- `C:/Users/espad/.claude/settings.json`
- `C:/Users/espad/.claude/hooks/config.json`
- `C:/Users/espad/.codex/config.toml`
- `C:/Users/espad/.codex/hooks.json`
- `C:/Users/espad/.claude/skill-registry/digests.jsonl`
- `C:/Users/espad/.claude/skill-registry/skillsh-installs.json`
- `C:/Users/espad/.claude/projects-registry.json`
- runtime skills under `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`
- project docs: `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`

Official docs consulted:

- Anthropic Claude Code overview: https://docs.anthropic.com/en/docs/claude-code/overview
- Anthropic hooks reference: https://docs.anthropic.com/en/docs/claude-code/hooks
- Anthropic skills reference: https://docs.anthropic.com/en/docs/claude-code/skills
- Anthropic settings reference: https://docs.anthropic.com/en/docs/claude-code/settings
- Anthropic subagents reference: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Anthropic memory reference: https://docs.anthropic.com/en/docs/claude-code/memory
- OpenAI Codex overview: https://developers.openai.com/codex/explore/
- OpenAI Codex hooks: https://developers.openai.com/codex/hooks
- OpenAI Codex AGENTS.md: https://developers.openai.com/codex/guides/agents-md
- OpenAI Codex reusable skills: https://developers.openai.com/codex/use-cases/reusable-codex-skills
- OpenAI Codex update docs workflow: https://developers.openai.com/codex/use-cases/update-documentation

## Executive Summary

The system is close to useful, but it is currently a stack of separate gates, not a coherent control plane. The biggest architectural issue is that the intended behavior happens too late: skill ranking happens after a skill has already been chosen, pipeline tracking happens after invocation, and several hook checks run after the agent has already spent context.

Token burn is also structurally high. Codex is configured globally as `gpt-5.5` with `xhigh` reasoning, Claude has 60 configured hook handlers across event groups, Codex has 45 hook commands, the local permission allowlist has 242 entries, and the skill registry estimates 651,910 total tokens across 94 skills. The largest skills are 18k-36k tokens each, so any wrong skill load is expensive.

The most concrete breakage found today: Codex hook tests are failing `44/45` because `projects-dashboard.js` tries to write `~/.claude/projects-dashboard.md` and exits with `EPERM` in the Codex sandbox. Also, `skills-sh` exists but is blocked by PowerShell execution policy, and `skill-search.js` hides that failure while its scoring threshold prevents marketplace fallback for nonsense queries.

The docs pipeline is stronger than before: `project-docs verify` passes, and `doctor --root .` reports `PASS=20 WARN=1 FAIL=0`. The remaining warning is stale project pipeline state from 2026-05-13. That stale state is not harmless because downstream skills are supposed to trust this state instead of re-reading docs.

## Hard Evidence

Usage report:

- Current report range: 2026-04-19 to 2026-05-20.
- Current messages: 3,137 over 29 days, 108.2 messages/day.
- Previous audit: 2,540 messages over 25 days, 101.6 messages/day.
- Persistent frictions: shallow first pass, hard blockers from usage/context/hooks, pushback/fabrication before evidence.

Verification:

- `node tools/project-docs.js verify --root .`: PASS, core sections identical, missing none.
- `node tools/doctor.js --root .`: PASS=20 WARN=1 FAIL=0.
- `node ~/.claude/hooks/test-all-hooks.js`: 35/35 PASS.
- `node ~/.claude/hooks/test-hooks-behavior.js`: 37/37 PASS.
- `node ~/.codex/test-codex-hooks.js`: 44/45 PASS, failed `projects-dashboard.js`.

Skill system:

- Local registry: 94 digest rows, no duplicate names.
- Total estimated token load across skills: 651,910 tokens.
- Largest skills: `gstack/ship` 36,752 tokens, `gstack/plan-ceo-review` 29,792, `gstack/office-hours` 26,230, several more above 18k.
- `skills-sh search "architecture refactor" --json` fails in PowerShell because `skills-sh.ps1` is unsigned under current execution policy.
- `skill.cmd "zzzzzz" --top 3 --json` returns local skills with zero relevance and does not call marketplace. Top score remains 0.455 because verified/cheap/low-risk weights dominate relevance.

Git/GitHub:

- `gh --version`: 2.88.1.
- `gh auth status`: active account token invalid.
- Public `gh search repos` works.
- `gh search code` returns HTTP 401 without valid auth.

Global config:

- Codex config: `model = "gpt-5.5"`, `model_reasoning_effort = "xhigh"`.
- Codex config trusts 13 projects and includes trust for root `C:\`.
- Codex config contains mojibake/encoding corruption.
- Claude global settings: 60 hook handlers across configured event groups.
- Codex hooks: 45 hook commands.
- Local Claude settings allowlist: 242 entries, including broad historical commands.
- Local allowlist contains a hardcoded Google API key-like value in an allowed `export` command. The value is not repeated here; treat it as compromised and rotate if real.

## Findings

### P0 - `projects-dashboard.js` Can Break Codex SessionStart

Evidence:

- Codex hook test result: `44/45 PASS`.
- Failure: `projects-dashboard.js`, `exit=1`.
- Direct run error: `EPERM: operation not permitted, open 'C:\Users\espad\.claude\projects-dashboard.md'`.

Root cause:

`projects-dashboard.js` has a side effect during `SessionStart` and writes to `~/.claude` without a `try/catch` around the final write. In Codex sandboxed execution, this can fail even if the hook is non-critical.

Recommendation:

- Make dashboard generation fail-soft: all write operations wrapped, exit `0` on `EPERM`.
- Move dashboard writes to a project-local or temp cache when running under Codex.
- Add a Codex sandbox regression test for SessionStart hooks that write outside cwd.
- Classify dashboards as background telemetry, never startup-critical context.

### P0 - `skills.sh` Marketplace Search Is Effectively Dead

Evidence:

- `skills-sh` command exists, but PowerShell blocks `skills-sh.ps1` because it is unsigned.
- `skill-search.js` calls `spawnSync('skills-sh', ...)` and returns `[]` on any nonzero status.
- Marketplace fallback condition is `ranked.length === 0 || ranked[0].score < 0.3`.
- A nonsense query returns zero-relevance local skills with score `0.455`, so fallback is not triggered.

Root cause:

There are two independent bugs: Windows execution policy blocks the marketplace command, and ranker scoring makes the marketplace threshold unreachable in normal conditions.

Recommendation:

- On Windows, call the `.cmd` shim or `npx skills-sh` instead of the unsigned `.ps1` shim.
- Surface marketplace errors in `--json` output instead of silently returning an empty list.
- Change fallback condition to use relevance, not total score. Example: fallback if top relevance is `<0.25`, or if all top-N have relevance `0`.
- Cache marketplace results separately with error metadata and TTL.

### P0 - Skill Routing Happens After Selection, Not Before It

Evidence:

- Claude has `skill-selector-gate.js` on `PreToolUse` matcher `Skill`.
- Codex has only `pipeline-tracker.js` on `PostToolUse` matcher `Skill`.
- `skill-selector-gate.js` compares a chosen skill against alternatives, but only after a skill is already selected.
- Official Claude Code skill docs describe progressive disclosure: the agent first sees only skill metadata and loads a skill body when appropriate.
- Official Codex skill docs likewise depend on concise skill metadata and `AGENTS.md` instructions to guide selection.

Root cause:

The current ranker is advisory after the fact. It is not part of the first decision the model makes when choosing a skill. In Codex, the `Skill` matcher is especially suspect because Codex hooks match tool names and MCP tool names; this local test suite can pass syntactically without proving that a real Codex skill invocation triggers the hook.

Recommendation:

- Build a first-class `skill-router` prompt layer: on user prompt, rank local skills, marketplace skills, and project/domain rules before any skill is invoked.
- Keep output tiny: top 3 skills, one-line reason, token estimate, risk, and whether marketplace/GH was used.
- In Claude Code, use `UserPromptSubmit` for task-aware routing context.
- In Codex, prefer AGENTS.md + concise skill descriptions + a preflight command, because PostToolUse is too late.
- Add an E2E test that proves real Claude/Codex skill invocation updates routing state, not just synthetic hook execution.

### P0 - Hardcoded Secret-Like Value in Local Permissions

Evidence:

- `.claude/settings.local.json` allowlist has 242 entries.
- A suspicious allowed command contains a hardcoded Google API key-like token.

Root cause:

Historical command approvals accumulated into a large local allowlist. One-off debugging commands were persisted as policy.

Recommendation:

- Rotate the key if it was ever real.
- Remove all commands containing literal credentials from local settings.
- Collapse broad historical allows into small command families.
- Add a settings scanner that checks `.claude/settings*.json`, `.codex/config.toml`, and project docs for secret patterns before ship.

### P1 - Default Codex Model/Effort Is Too Expensive

Evidence:

- `~/.codex/config.toml`: `model = "gpt-5.5"`, `model_reasoning_effort = "xhigh"`.
- Current usage report increased from 101.6 to 108.2 messages/day.

Root cause:

The default route spends frontier/highest-effort reasoning on all tasks. That conflicts with the stated goal of minimal token spend.

Recommendation:

- Default to medium effort for ordinary coding/debugging.
- Use xhigh only for architecture, security, complex multi-module refactors, and deep audits.
- Encode routing in `AGENTS.md` and a `task-classifier` preflight, not by relying on user memory.
- Track model/effort per session in usage audit history.

### P1 - Hook Surface Is Too Broad and Duplicative

Evidence:

- Claude settings contain 60 hook handlers across event groups.
- Codex hooks contain 45 commands.
- Codex docs state matching hooks run in parallel and do not override other configuration layers.
- Current Codex PostToolUse has duplicate `Bash` groups for `secret-output-scanner`, `bash-output-advisor`, `graphify-post-commit`, and `context7-tracker`.

Root cause:

The hook system grew feature-by-feature. There is no current hard split between critical blockers, advisory context, background telemetry, and optional dashboards.

Recommendation:

- Classify every hook as one of: `hard-block`, `advisory`, `background`, `telemetry`.
- Only `hard-block` hooks may return nonzero or `decision: block`.
- Background hooks must never write outside an allowed cache without catching failures.
- Consolidate duplicate `Bash` PostToolUse hook groups into one runner where possible.
- Put all high-token advisory hooks behind a per-session budget.

### P1 - Pipeline v2 Is Good but Too Passive for Your Desired Workflow

Evidence:

- Runtime `pipeline/SKILL.md` is synced across Claude/Codex/Gemini and passes checks.
- Pipeline v2 says: "If the request is ambiguous, ask at most one focused question."
- User goal asks for ongoing interview with answer variants, like Codex interaction style.
- Pipeline v2 does not include GitHub CLI discovery.
- `architect-first` has Context7 top-3 scan, but not `gh search repos` / `gh search code`.

Root cause:

Pipeline v2 optimizes for minimal ceremony. Your current requirement is different: deep upfront clarification for non-trivial tasks, with controlled choices and evidence collection.

Recommendation:

- Create Pipeline v3 with two modes:
  - `auto`: minimal route for trivial/medium tasks;
  - `interview`: recurring 1-question checkpoints with 2-3 options until done criteria, constraints, risks, and verification are stable.
- Add `research gate` for complex/unknown tasks: Context7 docs, local Graphify/RAG, `gh search repos`, and `gh search code` when auth is valid.
- Add a hard rule: pipeline state is refreshed at classification and completed/closed at final response.

### P1 - Project State Is Stale and Encoding-Corrupted

Evidence:

- `doctor --root .`: `Project Pipeline state is stale`.
- State timestamp: 2026-05-13.
- State phase: `implementing`.
- State task contains mojibake.

Root cause:

Pipeline state is created but not reliably finalized or refreshed. Downstream skills are instructed to trust state within 24h, but stale state still causes doctor warnings and may confuse resumptions.

Recommendation:

- Make state lifecycle explicit: `classified -> planned -> implementing -> verified -> shipped -> closed`.
- Expire state automatically after 24h unless phase is `paused`.
- On session start, if stale state exists, output a 1-line choice: resume, close, or replace.
- Fix encoding handling for all state/docs writes.

### P1 - Documentation Source of Truth Is Internally Conflicting

Evidence:

- Project AGENTS instructions say: if both `AGENTS.md` and `CLAUDE.md` exist, `AGENTS.md` takes precedence.
- `project-docs-gate.js` warning text says: source of truth is `CLAUDE.md -> syncs to AGENTS.md + .gemini/GEMINI.md`.
- Verification currently passes, but policy text conflicts.

Root cause:

Claude-era source-of-truth assumptions survived after Codex-native AGENTS.md became primary.

Recommendation:

- Choose one canonical source per project type.
- For this project, use `AGENTS.md` as canonical and sync `CLAUDE.md` / `.gemini/GEMINI.md` from it.
- Update `project-docs-gate.js`, `sync-docs`, and docs text to say the same thing.

### P1 - GitHub Discovery Is Available but Not Reliable Enough

Evidence:

- `gh --version`: 2.88.1.
- `gh auth status`: token invalid.
- Public `gh search repos` works.
- `gh search code` fails with HTTP 401.

Root cause:

GitHub CLI is installed, but auth is broken. Repo search works anonymously; code search and private repo access do not.

Recommendation:

- Re-authenticate `gh`.
- Add `gh doctor`/`gh auth status` to `doctor`.
- Add pipeline research commands:
  - `gh search repos "<problem>" --limit 5`
  - `gh search code "<symbol or pattern>" --limit 10` when auth is valid
- Record links and one keep/change decision per useful repo, not raw search dumps.

### P2 - Graphify/RAG Improvements Help, but They Are Not Yet a Unified Knowledge Layer

Evidence:

- Graphify active: 837 nodes, 1352 edges.
- `doctor --root .` reports codemap graph scope OK and relevance smoke OK.
- `ragContextInjector.enabled=false`, so RAG is silent by default.

Root cause:

Graphify, RAG, Context7, skills, and GitHub discovery are separate routes. The agent must remember which one to use.

Recommendation:

- Put all discovery behind one `research-router`:
  - local structure: Graphify;
  - project memory/docs: RAG;
  - library API: Context7;
  - similar implementations: GitHub CLI;
  - reusable procedures: skill router.
- Emit a tiny evidence block into the architecture doc or final response.

### P2 - Usage Telemetry Is Not Correlated With Hook Decisions

Evidence:

- Usage report identifies hooks/context/limits as a top friction.
- `hook-stats.js` shows current metrics but does not directly map usage spikes to hook output, model effort, skill loads, or session outcomes.

Root cause:

Telemetry exists in fragments: usage report, hook metrics, errors log, skill history, project state. There is no joined session ledger.

Recommendation:

- Add a per-session `pipeline-ledger.jsonl` with:
  - task class;
  - chosen skills and alternatives;
  - model/effort;
  - hook blocks/warnings;
  - verification commands;
  - token/context warnings;
  - final outcome.
- Feed that ledger into `/usage-audit`.

## Architecture Diagnosis

Current architecture:

```text
User prompt
  -> model guesses route from giant instruction/context surface
  -> optional hooks advise or block at different lifecycle points
  -> skill may be loaded after model decides
  -> pipeline state may or may not be fresh
  -> docs/checkpoint/ship happen through separate gates
```

Target architecture:

```text
User prompt
  -> lightweight classifier
  -> skill-router + research-router
  -> interview gate when task is complex or ambiguous
  -> pipeline state created/refreshed
  -> implementation / audit / research route
  -> verification gate
  -> docs sync + git/ship gate
  -> state closed + telemetry ledger
```

The biggest change is not "more hooks". It is moving decision-making earlier and making hooks thinner. Hooks should enforce safety and collect telemetry; they should not be the main orchestration mechanism.

## Recommended Next Plan After Review

1. P0 stabilization sprint:
   - Fix `projects-dashboard.js` fail-soft behavior.
   - Fix Windows `skills-sh` invocation and marketplace error reporting.
   - Fix ranker fallback logic so irrelevant local hits do not suppress marketplace search.
   - Remove/rotate hardcoded secret-like value from local settings.

2. Pipeline v3 architecture contract:
   - Define `auto` vs `interview` mode.
   - Add `skill-router` and `research-router`.
   - Add GitHub CLI discovery with auth health checks.
   - Define state lifecycle and ledger schema.

3. Hook diet:
   - Classify hooks by severity.
   - Consolidate duplicate hook groups.
   - Make all non-critical hooks fail-soft.
   - Add bounded-output discipline and sandbox-aware tests.

4. Docs source-of-truth cleanup:
   - Pick `AGENTS.md` as canonical for this project.
   - Sync hook messages and docs tools to that rule.
   - Refresh stale pipeline state and close old `implementing` sessions.

5. Token optimization:
   - Change default Codex reasoning effort away from `xhigh`.
   - Keep heavy model/effort for architecture/security/deep audits only.
   - Add model/effort usage to audit history.

## Verification Log

Commands run:

```text
node ~/.claude/skills/usage-audit/scripts/parse-report.js C:/Users/espad/.claude/usage-data/report-2026-05-20-084725.html
node tools/project-docs.js verify --root .
node tools/doctor.js --root .
node ~/.claude/hooks/test-all-hooks.js
node ~/.codex/test-codex-hooks.js
node ~/.claude/hooks/test-hooks-behavior.js
skill.cmd "architecture refactor" --top 3 --json
skill.cmd "mikrotik audit" --top 5 --json
skill.cmd "zzzzzz" --top 3 --json
skills-sh search "architecture refactor" --json
gh --version
gh auth status
gh search repos "claude code hooks" --limit 3
gh search code "AGENTS.md Codex skills" --limit 5
node audit/S11_pipeline_top1/skills/pipeline-check.js
node audit/S11_pipeline_top1/skills/architect-first-check.js
```

Important results:

```text
project-docs verify: PASS
doctor --root .: PASS=20 WARN=1 FAIL=0
Claude hook sanity: 35/35 PASS
Claude hook behavior: 37/37 PASS
Codex hook sync: 44/45 PASS, projects-dashboard.js FAIL
Pipeline runtime skill copies: OK, checked 3
Architect-first runtime skill copies: OK, checked 3
skills-sh direct call: blocked by PowerShell execution policy
gh auth status: invalid token
gh repo search: public search works
gh code search: HTTP 401
```

## Audit Conclusion

The current system is not fundamentally broken, but its control flow is backward. It spends context before classification, selects skills before ranking can help, and relies on many hooks to correct behavior after the fact. The next upgrade should reduce hooks, not add more, and should centralize early routing in a small pipeline state machine.

The minimum viable improvement is: fix Codex startup hook failure, make skills.sh actually callable on Windows, make ranker fallback relevance-based, rotate/remove the local secret-like setting, and upgrade `/pipeline` into an interview-capable router with GitHub discovery.
