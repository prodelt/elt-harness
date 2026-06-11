# Pipeline Setupper — Command Center

## Overview
Центральный репозиторий управления глобальной инфраструктурой разработки: хуки, скиллы, настройки Claude Code / Codex CLI / Antigravity. Хранит аудиты, планы апгрейдов, документацию пайплайна.

## Stack
- Node.js 18+ (хуки на .js); Claude Code hooks API (`~/.claude/settings.json`); Codex CLI hooks (`~/.codex/hooks.json`)
- Graphify (Python codemap) + CodeGraph (MCP) — структурный поиск
- Shared memory: `memory_summary.md` (startup payload) под `~/.claude/projects/C--/memory/` (junction ↔ `~/.codex/memories/`)

## Commands
Полный список — `.planning/COMMANDS-REFERENCE.md`. Частые:
```bash
node ~/.claude/hooks/test-all-hooks.js          # sanity (35/35)
node ~/.claude/hooks/test-hooks-behavior.js     # BLOCK/ALLOW (37/37)
node tools/doctor.js                            # health: docs/skills/hooks/Graphify/git
cmd /c graphify query "что делает X?"           # структурный поиск (вместо чтения файлов)
node "%USERPROFILE%\.amos\bin\amos.js" doctor   # AMOS ядро
```

## Architecture
Детальная карта хуков и tools — **`.planning/HOOKS-ARCHITECTURE.md`**. Кратко:
- `~/.claude/hooks/` — 48 хуков (SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop). Workflow-gates advisory; hard-block только для freeze/secrets/destructive/commit-quality.
- `~/.claude/tools/` — doctor, pipeline-state, codemap, harness-runner/gates, agent-surface-audit, token-impact и др.
- `~/.claude/skills/` — 47 скилов + mattpocock. `settings.json` — конфиг/permissions.
- `~/.codex/hooks.json` — 44 команды (те же .js, без FileChanged/Notification — Codex их не поддерживает).
- AMOS (`~/.amos`, отдельный git-репо) — CLI-ядро v4, синк-копии в `amos/`.

## Gotchas
- **C:\ — НЕ git-worktree** (вылечено 2026-05-29): бывший `C:\.git` → `C:\_ARCHIVED-ui-ux-gitdir`. Конфиг в своём репо `~/.claude`. Детали: `project_git_cdrive_repo_2026-05-29.md`.
- **`graphify claude install` = ЗАПРЕЩЕНО** — только `cmd /c graphify update .`
- **Codex не поддерживает** FileChanged и Notification (Claude Code only).
- **loop-guardian** ловит ОДИНАКОВЫЕ едиты (same old_string), не «3 едита одного файла».
- **cwd в хуках** — всегда из `input.cwd`, не `process.cwd()`. Windows: `path.join()`, не конкатенация.
- **Stdout хуков** — только silent exit ИЛИ валидный JSON с `hookSpecificOutput`/`decision`. Хуки <4s (spawnSync timeout 5000ms).
- **Codex sandbox** — тесты, спавнящие child node, могут падать `spawnSync EPERM`; запускать вне sandbox.

## Current State
- **Score ~97/100**. Полная история S1-S60: `.planning/PROJECT-HISTORY.md`. Форматы вывода хуков: `.planning/HOOKS-ARCHITECTURE.md`.
- **48 hook-команд** в settings.json; workflow-discipline advisory-only.
- **AMOS** (Agent Mini-OS, v4): CLI-ядро заменяет хуки единым `bin/amos.js` (SQLite state, cross-client resume). Спринты 0-4 закрыты, следующий — Sprint 5.
- **Context-fix 2026-06-11**: системный промпт ужат (MCP-чистка, CLAUDE.md 13.7→5KB, MEMORY архив, токен в env). Источник раздувания — не хуки (UserPromptSubmit/PostToolUse инжектят 0Б), а раздутый промпт в cache_read каждый ход.

## Git Workflow
- Одна задача = одна ветка (`system-upgrade/<slug>` или `fix/<slug>`). Commit: `<type>: <description>`.
- PR title <70 chars; body = Summary + Test plan. No force-push to main.
- Никогда не коммитить `.env`, секреты, `node_modules`, кэши, артефакты.
