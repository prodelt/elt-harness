# Pipeline Setupper — Command Center (Codex)

## Shared Rules
Global rules: `~/.claude/rules/rules.md`
Windows: use `;` not `&&`. Use `fs.readFileSync(0, 'utf8')` not `/dev/stdin`.

## Overview
Центральный репозиторий для управления глобальной инфраструктурой разработки: хуки, скиллы, настройки Claude Code / Codex CLI / Antigravity. Хранит аудиты, планы апгрейдов и документацию пайплайна.

## Stack
- Node.js 18+ (все хуки на .js)
- Claude Code hooks API (`~/.claude/settings.json`)
- Codex CLI hooks (`~/.codex/hooks.json`)
- Graphify (Python, `C:/Users/user/.../graphify.exe`) — knowledge graph
- Shared memory: `~/.claude/projects/C--/memory/` (junction ↔ `~/.codex/memories/`)

## Commands
```bash
# Запуск тестов хуков
node ~/.claude/hooks/test-all-hooks.js

# Проверка graphify (ВАЖНО: cmd /c prefix на Windows)
cmd /c graphify --version
cmd /c graphify query "что делает edit-enforcer?"
cmd /c graphify update .

# Hook metrics CLI
node ~/.claude/hooks/hook-stats.js
node ~/.claude/hooks/hook-stats.js --errors
```

## Architecture
```
~/.claude/
├── hooks/           ← 24 хука (24/24 PASS в test suite)
│   ├── SessionStart:    session-focus-gate, project-docs-gate, autoskills-check, graphify-session-init
│   ├── UserPromptSubmit: context-budget-gate
│   ├── PreToolUse:      graphify-preuse, config-protection, domain-agent-gate, edit-enforcer,
│   │                    secret-scanner (+ careful mode), quality-gate-runner
│   ├── PostToolUse:     post-edit-combined, context7-reminder, inline-review-gate,
│   │                    verification-tracker, loop-guardian, secret-output-scanner,
│   │                    inline-review-tracker, pipeline-tracker, scope-guard, context7-tracker
│   ├── Stop:            stop-verification, ship-gate
│   ├── Notification:    task-completed-gate
│   └── FileChanged:     env-change-watcher (.env|.envrc)
├── hooks/lib/       ← config.js, logger.js, metrics.js
├── hooks/config.json ← центральные threshold'ы
├── hooks/hook-stats.js ← CLI метрик
├── skills/          ← pipeline, ship, sprint, architect-first, careful, freeze, prime, fix-issue, etc.
└── projects/C--/memory/ ← shared memory (junction с Codex)
```

## Gotchas
- **git root = C:\\** — все git команды в хуках должны использовать `-- .` (scope to CWD)
- **Graphify в bash**: `cmd /c graphify query "..."` (не напрямую)
- **Codex hooks.json**: ссылается на те же .js файлы что и Claude Code settings.json — изменения в .js propagate автоматически
- **Shared memory**: Windows Junction — не трогать напрямую
- **Port 3000 занят** — всегда 3001+
- **/careful + /freeze**: on-demand гарды — tmpdir state.json TTL 8h

## Current State
- Score: ~82/100 (Sprint 1-5 partial выполнены, 2026-04-15)
- Sprint 4 ✅: graphify-session-init auto-update >6h, domain-agent-gate v2, pipeline-tracker, env-change-watcher
- Sprint 5 partial ✅: BUG-5 fix, /careful + /freeze + /prime + /fix-issue skills, learn.md dedup
- test-all-hooks.js: **24/24 PASS**
- Next: Sprint 5 remaining — integration tests + /check-pipeline-drift
- Аудит: PIPELINE_AUDIT_2026-04-15.md

## Codex Notes
- hooks.json поддерживает: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop
- НЕ поддерживает: Notification (TaskCompleted), FileChanged — только Claude Code
- PostToolUse matcher "Skill" — только Claude Code
- Stop хуки: `{ decision: 'block', reason }` формат — идентично Claude Code
- config.json загружается через lib/config.js — те же threshold'ы что и в Claude Code хуках
