# Pipeline Setupper — Command Center

## Overview
Центральный репозиторий для управления глобальной инфраструктурой разработки: хуки, скиллы, настройки Claude Code / Codex CLI / Antigravity. Хранит аудиты, планы апгрейдов и документацию пайплайна.

## Stack
- Node.js 18+ (все хуки на .js)
- Claude Code hooks API (`~/.claude/settings.json`)
- Codex CLI hooks (`~/.codex/hooks.json`)
- Graphify (Python, `C:/Users/user/AppData/Local/Programs/Python/Python311/Scripts/graphify.exe`)
- Shared memory: provider-aware startup uses `memory_summary.md`; `MEMORY.md`, rollout summaries, and ad-hoc notes are on-demand sources under `~/.claude/projects/C--/memory/` (junction ↔ `~/.codex/memories/`)

## Commands
Полный список: `.planning/COMMANDS-REFERENCE.md`. Самые частые:
```bash
# Тесты хуков (три уровня)
node ~/.claude/hooks/test-all-hooks.js          # sanity (35/35)
node ~/.codex/test-codex-hooks.js               # codex sync (45/45)
node ~/.claude/hooks/test-hooks-behavior.js     # BLOCK/ALLOW (37/37)

# Здоровье / диагностика
doctor.cmd --root .                             # global wrapper from ~/.claude/bin
node tools/doctor.js                            # health: docs, skills, hooks, Graphify, RAG, git, state

# Graphify / codemap
cmd /c graphify update .                        # обновить граф
cmd /c graphify query "что делает X?"           # структурный поиск
node tools/codemap.js --root .                  # Graphify scope/relevance doctor

# Skills / harness
skill.cmd "<task>" --top 3                      # global skill-router wrapper
harness-runner create <taskId> --root . --json
harness-gates run-gate <runId> --root . --json

# AMOS (~/.amos, отдельный git-репо; синхронные копии в amos/)
node "%USERPROFILE%\.amos\bin\amos.js" doctor
node --test "%USERPROFILE%\.amos\tests\amos.test.js"
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
├── bin/agent-skills.cmd      ← global wrapper to central tools/agent-skill-supply-chain.js
├── bin/harness-runner.cmd    ← global wrapper to central tools/harness-runner.js; target project via --root
├── bin/harness-gates.cmd     ← global wrapper to central tools/harness-gates.js; target project via --root
├── projects-registry.json    ← registered project keys and paths
├── tools/project-docs*.js     ← init-project v2 / sync-docs v2 section-aware docs engine
├── tools/pipeline-state.js    ← canonical pipeline v3 state/ledger helper + acceptance logic
├── tools/codemap*.js          ← Graphify/codemap doctor: setup, scope, stale graph, relevance smoke
├── tools/memory-provider.js   ← project-rag/agentmemory pilot health, recall prompts, comparison, governance smoke
├── tools/agent-surface-audit.js ← Claude/Codex/Gemini hooks/skills/tooling parity audit; writes .planning latest reports
├── tools/sync-agent-surface.js  ← skill sync Claude→Gemini/Codex: dry-run + apply; sha256 conflict detection; doctor check surface:sync
├── tools/agent-skill-supply-chain.js ← governed skill manifest audit/install/rollout CLI for all clients/projects
├── tools/install-agent-skills-wrapper.js ← installs agent-skills.cmd into ~/.claude/bin (.ps1 opt-in)
├── config/agent-skill-sources.json ← approved local skills + reviewed GitHub candidate sources
├── tools/harness-checklist.js   ← harness self-audit vs ai-boost/awesome-harness-engineering (CC0): 6 categories, auto+manual(justification) items; writes .planning/harness-checklist-latest.{json,md}; doctor check harness:checklist
├── tools/harness-gates.js      ← gate-execution layer over harness-runner.js (P2.2): runGate/verifyCloseout/buildGatePlan; writes .planning/harness-run-latest.json; doctor check harness:run; Stop hook harness-run-gate.js (advisory)
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
- **C:\\ — НЕ git-worktree (вылечено 2026-05-29)** — бывший `C:\\.git` (клон `ui-ux-pro-max-skill` на весь диск, из-за чего любая папка под C:\\ показывалась как «ui-ux-pro-max») переименован в `C:\\_ARCHIVED-ui-ux-gitdir`; полная история — бандл `D:\\git-backups\\C-root-uiux-git-2026-05-29.bundle`. Глобальный конфиг теперь в **своём** репо `~/.claude` (ветка master). Проект — свой вложенный `.git`; хуки по-прежнему скоупят git через `-- .`. Детали: `.planning/PLAN-2026-05-29-relocate-global-config.md`
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
- **Score: ~97/100**. Полная история спринтов S1-S60: `.planning/PROJECT-HISTORY.md`.
- **48 hook-команд** в settings.json; workflow-discipline gates advisory-only, hard blocks reserved for freeze/secrets/destructive/commit quality.
- **S60 AMOS Sprint 0+1 + M4 closure (2026-06-10)**: AMOS (Agent Mini-OS) — v4 архитектура, заменяющая 109 хуков единым CLI-ядром (`C:\Users\user\.amos`, отдельный git-репо, ветка `amos/sprint1-kernel`). `bin/amos.js` (CLI: `event session-start|stop|pre-tool`, `status`, `report`, `doctor`, `version`; fail-soft, 2KB cap), `lib/db.js` (node:sqlite). `amos/` — синхронные копии в этом репо. Sprint 0+1-4 закрыты, следующий — Sprint 5.
- **S61 Context bloat surgical fix (2026-06-11)**: первая API-итерация сессии стоила ~60.5K токенов (cache_creation 38.3K + cache_read 22.2K). Источники: AMOS SessionStart hook давал невалидный `hookSpecificOutput` (без `hookEventName`) и AMOS Stop hook давал невалидный `decision:"allow"` — оба падали в hook_non_blocking_error (~5KB/сессия, Stop повторялся на каждом Stop-событии). Исправлено в `~/.amos/bin/amos.js` (+ синк в `amos/`): SessionStart теперь содержит `hookEventName:'SessionStart'`, Stop — silent allow (no stdout) при отсутствии block-условий, `decision:'block'` остаётся валидным. 60/60 AMOS-тестов PASS. Вторая по размеру причина — `CLAUDE.md`/`AGENTS.md`/`.gemini/GEMINI.md` были по 235-246 строк (37-38KB) при бюджете <150 строк: секция "Current State" (S1-S60, ~20KB) вынесена в `.planning/PROJECT-HISTORY.md`, секция "Commands" (~6.7KB) — в `.planning/COMMANDS-REFERENCE.md`.

## Git Workflow
- Work one task per branch; use `system-upgrade/<slug>` or `fix/<slug>`.
- Commit format: `<type>: <description>`.
- PR title: under 70 chars.
- PR body: Summary bullets + Test plan checklist.
- Never commit `.env`, secrets, `node_modules`, generated caches, or build artifacts.
- No force-push to main.

## Hook Infrastructure
- `config.json` — threshold'ы: `loopGuardian.repeatWarn=3`, `editEnforcer.warnAt=3/blockAt=9`, etc.
- `lib/config.js` — loader для config.json
- `lib/logger.js` — append-only errors.log
- `lib/metrics.js` — metrics.inc(hook, event) → metrics.json

## Claude Code Notes
- PreToolUse BLOCK: `{ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: '...' } }`
- SessionStart/PostToolUse advisory: `{ hookSpecificOutput: { additionalContext: '...' } }`
- Stop BLOCK: `{ decision: 'block', reason: '...' }` → stdout  (формат ДРУГОЙ!)
- Silent exit: `process.exit(0)` без stdout = разрешить без комментариев
- Hard block (SessionStart): `process.exit(2)` + stderr message
