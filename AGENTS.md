# Pipeline Setupper — Command Center (Codex)

## Overview
Центральный репозиторий для управления глобальной инфраструктурой разработки: хуки, скиллы, настройки Claude Code / Codex CLI / Antigravity. Хранит аудиты, планы апгрейдов и документацию пайплайна.

## Stack
- Node.js 18+ (все хуки на .js)
- Claude Code hooks API (`~/.claude/settings.json`)
- Codex CLI hooks (`~/.codex/hooks.json`)
- Graphify (Python, `C:/Users/espad/AppData/Local/Programs/Python/Python311/Scripts/graphify.exe`)
- Shared memory: provider-aware startup uses `memory_summary.md`; `MEMORY.md`, rollout summaries, and ad-hoc notes are on-demand sources under `~/.claude/projects/C--/memory/` (junction ↔ `~/.codex/memories/`)

## Commands
```bash
# Тесты хуков (три уровня)
node ~/.claude/hooks/test-all-hooks.js          # sanity: exit 0 + valid JSON (35/35)
node ~/.codex/test-codex-hooks.js               # codex sync (45/45)
node ~/.claude/hooks/test-hooks-behavior.js     # BLOCK/ALLOW поведение (37/37)

# Анализ расхода токенов
node ~/.claude/hooks/analyze-session.js <jsonl> # разбор затрат по событиям

# Метрики
node ~/.claude/hooks/hook-stats.js              # статистика вызовов
node ~/.claude/hooks/hook-stats.js --errors     # только ошибки
node ~/.claude/hooks/hook-stats.js --reset      # сброс
node ~/.claude/hooks/weekly-analysis.js         # weekly pipeline-proposals из metrics/errors

# Graphify
cmd /c graphify --help                          # smoke: CLI доступен
cmd /c graphify query "что делает edit-enforcer?"
cmd /c graphify update .                        # обновить граф (в проекте)
node tools/doctor.js                            # health: docs, skills, hooks, Graphify, RAG, git, state
node tools/pipeline-state.test.js               # pipeline v3 acceptance helpers: state/mode/ledger/closeout
node tools/project-docs.js verify --root .      # verify 6 AI-doc core sections
node tools/project-docs.test.js                 # init/sync v2 regression tests
node tools/codemap.js --root .                  # Graphify scope + relevance doctor
node tools/codemap.js --root . --provider codegraph --json # optional CodeGraph provider health
node tools/codemap.js setup --root . --no-relevance # create/update .graphifyignore + scope/stale checks
node tools/codemap-benchmark.js --root . --provider graphify --json # 10-question relevance benchmark
node tools/codemap-measure.js --root . --json   # codemap task-level tool/read measurement plan
node tools/memory-provider.js status --root . --json # project-rag / agentmemory provider health
node tools/memory-provider.js recall --root . --json # 20 recall prompts for memory-provider comparison
node tools/memory-provider.js compare --root . --json # project-rag vs agentmemory promotion report
node tools/agent-surface-audit.js --json       # Claude/Codex/Gemini parity artifact
node tools/agent-surface-audit.js --markdown   # human-readable parity report
node tools/hook-diet.js --summary --out .planning/HOOK-DIET-INVENTORY-2026-05-20.json # hook diet inventory/evidence
node tools/token-impact.js measure-command --cmd "node tools/research-router.js design research router --root . --github --architecture --json" --json # command output/token proxy
node tools/project-bootstrap.js --root <project> --json # dry-run bootstrap: docs/codemap strategy and safe actions
node tools/project-bootstrap.js --root <project> --apply --json # apply safe docs + graphifyignore only
node audit/S11_pipeline_top1/skills/pipeline-check.js # verify pipeline v2 runtime skill copies
node audit/S11_pipeline_top1/skills/architect-first-check.js # verify architect-first v2 runtime skill copies
python tools/rag-ingest.py --project pipeline-setupper --queue-stats
doctor.cmd --root .                             # global wrapper from ~/.claude/bin
skill.cmd "architecture refactor" --top 3       # global skill wrapper from ~/.claude/bin
node tools/skill-search.js "architecture refactor" --top 3
node tools/skill-search.js --benchmark --json   # skill-router quality gate
node tools/context7-cli.js library "vercel ai" "agents tool calling"  # resolve library ID
node tools/context7-cli.js docs /microsoft/playwright-mcp "CLI usage" # query library docs
node tools/context7-cli.js skills-search         # manual-only interactive note (no spawn)
node tools/research-router.js "design research router" --root . --github --architecture --json
node tools/github-research.js "claude code hooks" --limit 5
python tools/rag-ingest.py --project pipeline --queue AGENTS.md
python tools/rag-ingest.py --project pipeline --queue-stats
python tools/rag-ingest.py --project pipeline --quarantine-index-backlog
python tools/rag-ingest.py --project pipeline --process-queue --llm ollama
```

## Architecture
```
~/.claude/
├── hooks/                    ← 48 хуков (все PASS; 48 команд в settings.json)
│   ├── SessionStart (9):     project-docs-gate, session-focus-gate, autoskills-check,
│   │                         graphify-session-init, memory-discipline, session-branch-advisor,
│   │                         harvest-injector, projects-dashboard, rag-context-injector
│   ├── UserPromptSubmit (2): context-budget-gate, session-size-guard
│   ├── PreToolUse (11):      graphify-read-gate[Read], graphify-preuse[Glob|Grep],
│   │                         settings-schema-guard[Edit|Write], write-over-edit-guard[Write],
│   │                         config-protection[Edit|Write], domain-agent-gate[Edit|Write],
│   │                         edit-enforcer[Edit|Write], secret-scanner[Bash], quality-gate-runner[Bash],
│   │                         tool-policy-gate[mcp__claude-in-chrome],
│   │                         skill-selector-gate[Skill] (ranker integration)
│   ├── PostToolUse (13):     post-edit-combined, context7-reminder, inline-review-gate [Edit|Write]
│   │                         verification-tracker, loop-guardian [Edit|Write|Bash]
│   │                         secret-output-scanner [Bash], bash-output-advisor [Bash],
│   │                         graphify-post-commit [Bash], graphify-auto-update [Edit|Write],
│   │                         inline-review-tracker [Agent],
│   │                         scope-guard [TaskCreate], context7-tracker [Context7],
│   │                         pipeline-tracker [Skill]
│   ├── Stop (3):             stop-verification, ship-gate, stop-auto-checkpoint
│   ├── Notification (1):     task-completed-gate          ← Claude Code only
│   └── FileChanged (1):      env-change-watcher           ← Claude Code only
├── hooks/skill-distiller.js  ← дистилляция SKILL.md → digests.jsonl (TTL 48h)
├── hooks/skill-ranker.js     ← ранжування скилов по 6 критериям
├── hooks/lib/                ← config.js, logger.js, metrics.js
├── hooks/config.json         ← все threshold'ы (loopGuardian, editEnforcer, etc.)
├── bin/doctor.cmd            ← global doctor wrapper to this repo's tools/doctor.js
├── bin/skill.cmd             ← global skill-search wrapper to tools/skill-search.js
├── projects-registry.json    ← registered project keys and paths
├── tools/project-docs*.js     ← init-project v2 / sync-docs v2 section-aware docs engine
├── tools/pipeline-state.js    ← canonical pipeline v3 state/ledger helper + acceptance logic
├── tools/codemap*.js          ← Graphify/codemap doctor: setup, scope, stale graph, relevance smoke
├── tools/memory-provider.js   ← project-rag/agentmemory pilot health, recall prompts, comparison, governance smoke
├── tools/agent-surface-audit.js ← Claude/Codex/Gemini hooks/skills/tooling parity audit; writes .planning latest reports
├── tools/hook-diet.js          ← hook inventory, classification, failure policy, rollback/evidence fields
├── tools/token-impact.js       ← JSONL/session and command-output proxy measurement for token/file-read impact
├── tools/project-bootstrap.js  ← fail-soft project bootstrap: docs/codemap setup and bounded-grep strategy
├── tools/research-router.js   ← compact research evidence router with provider skip reasons and token budgets
├── hooks/hook-stats.js       ← CLI метрик
├── skills/                   ← 47 скілів: pipeline/ship/sprint/architect-first/cto-playbook/etc.
│                                + mattpocock/skills (tdd/grill-me/diagnose/domain-model/zoom-out/
│                                  caveman/github-triage/to-prd/to-issues/triage-issue/qa/...)
├── settings.json             ← глобальная конфигурация + разрешения
└── projects/C--/memory/      ← shared memory: memory_summary.md startup; MEMORY.md/rollouts/ad-hoc on demand

~/.codex/
├── hooks.json                ← 44 hook-команды (те же .js, без FileChanged/Notification)
├── test-codex-hooks.js       ← динамический тест из hooks.json
└── memories/ → junction → ~/.claude/projects/C--/memory/
```

## Gotchas
- **git root = C:\\** — весь C: в одном git-репо. Хуки должны использовать `-- .` для CWD
- **`graphify claude install` = ЗАПРЕЩЕНО** — только `cmd /c graphify update .`
- **Codex не поддерживает** FileChanged и Notification — это Claude Code only события
- **loop-guardian**: ловит ОДИНАКОВЫЕ едиты (same old_string), не просто "3 едита одного файла"
- **rag-context-injector**: SessionStart hook is opt-in/silent by default (`ragContextInjector.enabled=false`) to avoid global startup token burn; use RAG on demand via `python tools/rag-ingest.py --query ...`
- **graphify-read-gate**: пропускает партиальные рида (any explicit limit), для full read >120 строк дает максимум 1 advisory Graphify query per session, не блокирует
- **Graphify scope**: noisy corpora excluded via `.graphifyignore`; if old `rationale` nodes persist, delete/regenerate `graphify-out/graph.json` before `cmd /c graphify update .`
- **memory-discipline**: provider-aware SessionStart check. Default startup payload is `memory_summary.md`; `MEMORY.md` is a registry and rollout summaries/ad-hoc notes are on-demand, so oversized historical memory does not block unless explicitly configured as startup payload. Rollback flag for one sprint: `CLAUDE_MEMORY_DISCIPLINE_LEGACY=1`.
- **cwd в хуках**: всегда из `input.cwd`, не `process.cwd()`
- **Windows paths**: использовать `path.join()`, не строковую конкатенацию
- **Stdout хуков**: только silent exit OR валидный JSON с `hookSpecificOutput`/`decision`
- **spawnSync timeout = 5000ms**: хуки должны работать <4s. Stat-only для больших коллекций JSONL

- **Codex sandbox**: hook test suites that spawn child `node` processes can fail with `spawnSync node EPERM`; run verification outside sandbox / with approval.

## Current State
- **Score: ~97/100** (S12 verified: 33/33 sanity, 37/37 behavior, 43/43 codex; WORKING_RULES.md written)
- **S14 hook/RAG update (2026-04-29)**: live verification outside sandbox: 35/35 Claude sanity PASS, 45/45 Codex hooks PASS, 37/37 behavior PASS.
- **S15 Sprint 1 doctor (2026-05-08)**: `tools/doctor.js` + `~/.claude/bin/doctor.cmd`/`doctor.ps1` installed; `~/.claude/bin` added to User PATH; `~/.claude/projects-registry.json` created with project key `pipiline-setupper-eb257e8d`; global `skill.cmd`/`skill.ps1` installed. Doctor currently reports known FAIL/WARN for invalid `ship/SKILL.md`, suspicious git ref, invalid global pipeline-state, and red-team Defender-risk files.
- **S16 Sprint 2 state isolation (2026-05-08)**: active pipeline state moved to `~/.claude/projects/<projectKey>/pipeline-state.json`; `~/.claude/pipeline-state.json` is legacy read-only fallback. `doctor` now reports project state and legacy global state separately, rejects stale/wrong/future state, and accepts UTF-8 BOM in `SKILL.md` frontmatter.
- **S17 Sprint 3 docs v2 (2026-05-08)**: `tools/project-docs-core.js` + `tools/project-docs.js` added for section-aware `init-project`/`sync-docs`: create/upgrade/noop, protected blocks, `.rag/manifest.json`, `.planning/`, registry registration, and 6-section verification.
- **S18 Sprint 4 codemap/RAG slice (2026-05-08)**: `tools/codemap-core.js` + `tools/codemap.js` added; `doctor` now routes Graphify checks through codemap scope/relevance. `.graphifyignore` scopes Graphify away from red-team/recon/cache corpora; fresh rebuild is 810 nodes / 1301 edges / 0 noisy nodes. Serena/Aider repo-map preflight saved in `.planning/EVAL-2026-05-08-serena-aider-repomap.md`; Graphify remains primary, Serena is future candidate. `rag-ingest.py` discovers projects from `~/.claude/projects-registry.json`; queue stats now report total/pending/indexed/failed/skipped/processing/stale.
- **S19 Sprint 5 Graphify automation (2026-05-08)**: `node tools/codemap.js setup --root <project>` now creates/updates project-local `.graphifyignore`, `doctor` includes stale semantic/rationale node detection, and codemap reports a fresh rebuild repair path when old `graphify-out/graph.json` carryover remains.
- **S20 Sprint 5 skills simplification (2026-05-08)**: `pipeline` and `architect-first` runtime skills upgraded to v2 across Claude/Codex/Gemini. `pipeline v2` now enforces checklist extraction, project guard, minimal route, skill budget, per-project state, and final criteria check. `architect-first v2` now requires `.planning/ARCHITECTURE-<date>-<slug>.md`, acceptance tests before code, sprint slices, and docs/codemap delta. Regression checks added in `audit/S11_pipeline_top1/skills/*-check.js`.
- **S29 Sprint 1 pipeline v3 closure (2026-05-20)**: `pipeline` runtime skills upgraded to v3 across Claude/Codex/Gemini; `tools/pipeline-state.js` now owns canonical project key/state path, auto vs interview routing, stale-state replacement, session ledger append, and closeout proof validation. Coverage added in `tools/pipeline-state.test.js`; `pipeline-check` now enforces v3 contract fields.
- **S30 Sprint 2 skill-router (2026-05-20)**: `tools/skill-search.js` now acts as skill-router preflight: top-3 budget, hard relevance gate before total score, `no skill` direct-work option, visible marketplace attempted command/errors, cached marketplace status, and optional `--ledger` JSONL router event. Coverage added in `tools/skill-search.test.js`.
- **S31 Sprint 3 research-router (2026-05-20)**: `tools/research-router.js` added for compact evidence blocks: project-docs/codemap/RAG provider selection, Context7/GitHub health skips with attempted commands, top-5 findings, per-source token budgets, and optional `--ledger` JSONL event. Coverage added in `tools/research-router.test.js`.
- **S32 Sprint 4 CodeGraph pilot start (2026-05-20)**: `tools/codemap-core.js` now has a codemap provider interface with default `graphify` and optional `codegraph` health checks via `--provider codegraph` / `CODEMAP_PROVIDER=codegraph`; Graphify remains the production fallback. `.graphifyignore` now excludes planning/RAG/tmp/graph output and generated cache corpora from codemap scope.
- **S33 Sprint 4 CodeGraph pilot closure (2026-05-20)**: CodeGraph wrapper now uses project-local `.tmp/codegraph` cache env and a lock file to serialize CLI calls. `tools/codemap-benchmark.js` adds a 10-question relevance benchmark; current Graphify baseline is 7 PASS / 3 WARN. `tools/codemap-measure.js` records Claude/Codex command-level tool/read measurements. Real CodeGraph promotion is blocked until `codegraph status` is available in PATH.
- **S34 Sprint 5 agentmemory pilot (2026-05-20)**: `tools/memory-provider.js` added with `MEMORY_PROVIDER=project-rag|agentmemory`, project-rag default health, agentmemory CLI/port checks for 3111/3113, 20 recall prompts, comparison report, and governance smoke. `doctor` now reports memory provider health; keep default `project-rag` until agentmemory CLI/server passes.
- **S35 Sprint 6 hook diet evidence (2026-05-20, refreshed 2026-05-21)**: `tools/hook-diet.js` added for no-removal inventory. Current inventory: 107 hook registrations; class split is 79 advisory / 14 hard-block / 10 telemetry / 4 background, with 16 duplicate matcher groups. Full inventory written to `.planning/HOOK-DIET-INVENTORY-2026-05-20.json`.
- **S36 Sprint 6 runtime evidence join (2026-05-20, refreshed 2026-05-21)**: `tools/hook-diet.js` now joins inventory with `~/.claude/hooks/metrics.json` and `errors.log`. Current evidence coverage: 16/107 hook registrations have runtime metrics, 91/107 are missing runtime metrics; `errors.log` has 971 lines and 0 `[ERROR]` lines. No hooks removed yet.
- **S37 Sprint 6 closure (2026-05-20, refreshed 2026-05-21)**: candidate report written to `.planning/HOOK-DIET-CANDIDATES-2026-05-20.json`. Result: 107 hooks evaluated, 0 eligible for removal, 107 blocked by missing `output_chars`, missing runtime metrics, hard-block status, or safety evidence. Sprint 6 closes with no hook removals.
- **S38 token impact measurement (2026-05-20)**: `tools/token-impact.js` added to measure JSONL/session proxies: tool output chars, file-read events, risky full-file reads, and real token usage when present. Current measured command outputs: `research-router` evidence block 1752 chars / 53 lines; `hook-diet --summary` 3776 chars / 188 lines. Token savings remain unclaimed until matched before/after session telemetry exists.
  - **S39 project bootstrap (2026-05-20)**: `tools/project-bootstrap.js` added. Dry-run scans project size/docs/codemap/RAG and chooses `bounded-grep-first` for small repos. It now detects stack (`Next.js App Router`, `Vite React`, `Electron`, `Node.js`) and emits bounded recommended probes. `--apply` only performs safe setup: AI docs init and `.graphifyignore`; RAG/LLM ingestion remains manual.
  - **S40 bootstrap advisor hook (2026-05-20)**: `project-bootstrap-advisor.js` installed into Claude/Codex SessionStart. It is dry-run only: reports project strategy and bounded probes, and suggests `project-bootstrap --apply` when safe setup is missing. Verified Codex hooks 46/46 PASS.
  - **S41 Sprint 7 docs/git workflow (2026-05-21)**: `AGENTS.md` is now explicit canonical source for AI docs; `project-docs-core.js` exports `CANONICAL_DOC` and regression coverage proves `AGENTS.md` wins sync ties. `project-docs-gate.js` runtime warning now says `AGENTS.md -> CLAUDE.md + .gemini/GEMINI.md`.
- **S42 Sprint 8 measured hook diet (2026-05-21)**: `~/.claude/hooks/lib/metrics.js` now records `outputChars` / `_lastOutputChars` by patching `process.stdout.write` after `metrics.inc()` / `metrics.timing()`. Evidence refreshed to `.planning/HOOK-DIET-INVENTORY-2026-05-21.json` and `.planning/HOOK-DIET-CANDIDATES-2026-05-21.json`; registered smoke shows `session-focus-gate` outputChars=204 and candidate report now has 2 measured manual-review candidates / 105 blocked.
- **S43 P0.1 memory startup flakiness (2026-05-27)**: `memory-discipline.js` no longer hard-blocks SessionStart on oversized historical `MEMORY.md`. It recognizes `memory_summary.md`, optional `MEMORY.md` registry, rollout summaries, and ad-hoc notes; only explicit oversized startup payload overrides can block.
- **S44 P0.2 CodeGraph lock/cache path (2026-05-27)**: CodeGraph CLI provider wrapper now probes writable runtime cache, falls back from project `.tmp\codegraph` to stable user temp cache when sandbox blocks lock creation, records `cachePath`/`lockPath`, cleans stale same-owner locks, and reports `fallback=graphify` when not promotable. Graphify remains default; doctor reports CodeGraph MCP/index health separately from CLI provider promotability.
- **S45 P0.3 Agent Surface Audit (2026-05-27)**: `tools/agent-surface-audit.js` added as a read-only Claude/Codex/Gemini surface audit for hook event support, hook command inventory, skill inventory, shims, Context7 CLI, codemap providers, memory paths, and browser tooling. It writes `.planning/agent-surface-audit-latest.json` + `.md`; `doctor` reports the latest audit as PASS/WARN without requiring perfect parity.
- **S46 P1.1 Compact-Aware Context Budget (2026-05-27)**: `context-budget-gate.js` and `session-size-guard.js` now use shared `lib/active-window.js` to estimate active transcript bytes after the latest compact marker, while preserving legacy full-file behavior when no marker exists. Behavior coverage now proves legacy warning, post-compact silence, and active-window warning paths.
- **S51 P5.1 Agent Harness Runner (2026-05-27)**: `tools/harness-runner.js` added — run.json schema + phase-transition engine for Agent Harness pipelines. Phases: `fetch_context → plan_design → implement → linter → tests → code_review → git_push → complete`. Quality gates: pass/fail per phase; fix-loop phases increment `fixAttempts`; `fixAttempts >= maxRetries → failed` guard. Schema: `runId`, `taskId`, `phase`, `status`, `fixAttempts`, `maxRetries`, `failReason`, `phases[]`, `artifacts{}`, `config{}`. CLI: `create`/`transition`/`status`/`artifact`/`list`. 63 unit tests. Manual smoke: create→7×transition(pass)→complete. Verification: harness-runner 63/63 PASS.
- **S50 P4.2 Docs automation gate (2026-05-27)**: `tools/docs-gate.js` added — classifies git diff complexity (TRIVIAL/MEDIUM/COMPLEX), checks docs delta (AGENTS.md/CLAUDE.md/.gemini/GEMINI.md/ADR/ARCHITECTURE), exits 2 with `--strict` when COMPLEX change has no docs update (P5.1 Agent Harness hookup pending). `doctor` now reports `docs:gate` check; `stop-verification.js` advisory surfaces WARN/FAIL when `.planning/docs-gate-latest.json` is fresh (<4h). 42 unit tests. Verification: docs-gate 42/42, Claude hooks 35/35, Codex 46/46, behavior 44/44 PASS.
- **S47 P1.2 Skill Router Quality Gate (2026-05-27)**: `tools/skill-search.js` now has a `--benchmark --json` quality gate, domain-hint re-ranking for browser/security/QA prompts, and marketplace relevance filtering so weak marketplace matches do not beat `no skill`. Regression coverage proves browser automation avoids `init-project`/`sync-docs`/`clone-research`, security API validation selects `security-best-practices`, and low-confidence junk returns `no skill`.
- **S28 global context fix (2026-05-15)**: `rag-context-injector.js` is silent by default, Graphify PreToolUse advisories are capped at 1/session, `contextBudget.thresholdTokens=90000`, `session-size-guard` warns at 350KB/700KB, and Claude settings now compact earlier (`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80`). Verified: Claude hooks 35/35 PASS, Codex hooks 45/45 PASS, behavior 37/37 PASS.
- **48 hook-команд** в settings.json; workflow-discipline gates advisory-only, hard blocks reserved for freeze/secrets/destructive/commit quality.
- **graphify-auto-update.js** — PostToolUse Edit|Write, non-blocking `graphify update .` with 5min debounce when graph exists.
- **auto-branch.js** — создаёт `session/YYYY-MM-DD-HHmm` при первом Edit/Write на main/master
- **mattpocock/skills**: 22 новых скила (tdd/grill-me/diagnose/zoom-out/caveman/github-triage и др.)
- **skill-registry**: `~/.claude/skill-registry/digests.jsonl` (89 entries: 47 base + 42 gstack, TTL 48h)
- **RAG система**: 4 проекти (pipeline 52, izi-tracker 12, law-assistant 30, sudoviy-master 2 chunks); incremental queue: `.rag/queue.json` via `tools/rag-ingest.py --queue/--process-queue --llm ollama`; `rag-queue-enqueue.js` PostToolUse hook only enqueues, never runs LLM extraction. Embeddings still use Google 3072-dim until index rebuild.
- **bun**: v1.3.13 — gstack /browse, /qa, /open-gstack-browser доступні
- **Token burn**: ~90K / session

## Shared Rules
Global rules: `~/.claude/rules/rules.md`
Windows: use `;` not `&&`. Use `fs.readFileSync(0, 'utf8')` not `/dev/stdin`.

## Git Workflow
- Work one task per branch; use `system-upgrade/<slug>` or `fix/<slug>`.
- Commit format: `<type>: <description>`.
- PR title: under 70 chars.
- PR body: Summary bullets + Test plan checklist.
- Never commit `.env`, secrets, `node_modules`, generated caches, or build artifacts.
- No force-push to main.

## Hook Infrastructure
- `config.json` — threshold'ы: `loopGuardian.repeatWarn=3`, `editEnforcer.warnAt=3/blockAt=9`
- `lib/config.js` — loader для config.json
- `lib/logger.js` — append-only errors.log
- `lib/metrics.js` — metrics.inc(hook, event) → metrics.json

## Codex Notes
- hooks.json поддерживает: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop
- НЕ поддерживает: Notification (TaskCompleted), FileChanged — только Claude Code
- PostToolUse matcher "Skill", "Context7" — только Claude Code (в codex → "Bash")
- Stop хуки: `{ decision: 'block', reason }` формат — идентично Claude Code
- config.json загружается через lib/config.js — те же threshold'ы что и в Claude Code хуках
- secret-scanner: min token length — GitHub ≥36 симв, Bearer ≥20 симв (короткие пропускает)
