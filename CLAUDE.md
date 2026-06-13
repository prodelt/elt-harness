# Pipeline Setupper — Command Center

## Overview
Центральный репозиторий управления глобальной инфраструктурой разработки: хуки, скиллы, настройки Claude Code / Codex CLI / Antigravity. Хранит аудиты, планы апгрейдов, документацию пайплайна.

## Stack
- Node.js 18+ (хуки на .js); Claude Code hooks API (`~/.claude/settings.json`); Codex CLI hooks (`~/.codex/hooks.json`)
- **CodeGraph (MCP)** — единственный движок структурного поиска (read-gate блокирует полное чтение кодовых файлов >80 строк). Graphify (Python codemap) — legacy fallback.
- Shared memory: `memory_summary.md` (startup payload) под `~/.claude/projects/C--/memory/` (junction ↔ `~/.codex/memories/`)

## Commands
Полный список — `.planning/COMMANDS-REFERENCE.md`. Частые:
```bash
node ~/.claude/hooks/test-all-hooks.js          # sanity (35/35)
node ~/.claude/hooks/test-hooks-behavior.js     # BLOCK/ALLOW (44/44)
node tools/doctor.js                            # health: docs/skills/hooks/Graphify/git
# структурный поиск → codegraph MCP (codegraph_context первым); НЕ читать файлы целиком
node "%USERPROFILE%\.amos\bin\amos.js" doctor   # AMOS ядро
```

## Architecture
Детальная карта хуков и tools — **`.planning/HOOKS-ARCHITECTURE.md`**. Кратко:
- `~/.claude/hooks/` — 48 хуков (SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop). Workflow-gates advisory; hard-block только для freeze/secrets/destructive/commit-quality.
- `~/.claude/tools/` — doctor, pipeline-state, codemap, harness-runner/gates, agent-surface-audit, token-impact и др.
- `~/.claude/skills/` — ~60 скилов (база + 12 curated gap-скилов + `hindsight-docs`) + 2 on-demand диспетчера (`/pm` → 68 PM-скилов, `/lifecycle` → 24 addyosmani). `settings.json` — конфиг/permissions.
- `~/.claude/agents/` — 16 НАТИВНЫХ субагентов (haiku по умолч.; sonnet для architect/security/reviewer), генерит `tools/agent-library.js`. Вызов: `/agents`, Task(subagent_type), Team/SendMessage, `/company`. **Активируются после рестарта** (реестр subagent_type грузится на старте сессии).
- `~/.claude/skill-packs/` — глобальные vendored-паки (pm-skills 68, addyosmani 24) для диспетчеров; провенанс — в `config/agent-skill-sources.json`.
- `tools/skill-scan.js` — обёртка SkillSpector (static); честный гейт (exec-код/malware → block, markdown-паттерны → advisory). `tools/agent-skill-supply-chain.js scan-candidates` — гейт ДО установки.
- `~/.codex/hooks.json` — 44 команды (те же .js, без FileChanged/Notification — Codex их не поддерживает). Скилы/диспетчеры зеркалятся в `~/.codex/skills`, `~/.gemini/skills`; агенты — только Claude.
- AMOS (`~/.amos`, отдельный git-репо) — CLI-ядро v4, синк-копии в `amos/`.
- `vendor/` (gitignored) — shallow-клоны 5 внешних skill-репо + SkillSpector venv (py3.12/uv); в git идёт только провенанс в манифесте.

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
- **AMOS** (Agent Mini-OS, v4→v5): CLI-ядро заменяет хуки единым `bin/amos.js` (SQLite state, cross-client resume). Спринты 0-8 закрыты. S6: `amos graph ensure` (авто-граф через `graphify update .`) + SessionStart-хинт. S7: таблица `instincts` + Stop-hook запись повторённых команд + `amos evolve` (PR-style SKILL.md, без авто-коммита). S8: `amos roster [--write]` — 12 ролей (триада persona/process/metrics, только haiku|sonnet) в `~/.claude/skills/agents`. Roadmap: `.planning/ARCHITECTURE-AGENT-OS-V5.md`.
- **Context-fix 2026-06-11**: системный промпт ужат (MCP-чистка, CLAUDE.md 13.7→5KB, MEMORY архив, токен в env). Источник раздувания — не хуки (UserPromptSubmit/PostToolUse инжектят 0Б), а раздутый промпт в cache_read каждый ход.
- **Skill-packs + agent-library 2026-06-12**: интегрированы 5 внешних репо (addyosmani/agent-skills, phuryn/pm-skills, NVIDIA/SkillSpector, vectorize-io/hindsight, mattpocock/skills). SkillSpector вётит кандидатов перед установкой (0 blocking). Анти-bloat: 12 curated gap-скилов always-available, большие паки (PM 68, lifecycle 24) — через on-demand `/pm`+`/lifecycle` (per-turn = 2 описания вместо 92). 16 нативных haiku-агентов в `~/.claude/agents/`. Hindsight — только doc-skill, сервер не поднят.

## Git Workflow
- Одна задача = одна ветка (`system-upgrade/<slug>` или `fix/<slug>`). Commit: `<type>: <description>`.
- PR title <70 chars; body = Summary + Test plan. No force-push to main.
- Никогда не коммитить `.env`, секреты, `node_modules`, кэши, артефакты.
