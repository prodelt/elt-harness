# Pipeline Setupper — Command Center

## Overview
Центральный репозиторий управления глобальной инфраструктурой разработки: хуки, скиллы, настройки Claude Code / Codex CLI / Gemini. Хранит аудиты, планы апгрейдов, документацию пайплайна.

> ⚠ **AMOS-слой хуков СНЯТ 2026-06-18** (был advisory-спам). Бэкап `~/.claude/_backup-amos-full-2026-06-18/`, restore: `restore-amos.ps1`. Доки в `.planning/` про AMOS/гейты — **исторические**. Живое состояние — `settings.json` + `claude plugin list` + `/skills`. Памятка пользователю — **`CHEATSHEET.html`**.

## Stack
- Node.js 18+ (хуки на .js); Claude Code hooks API (`~/.claude/settings.json`); Codex CLI hooks (`~/.codex/hooks.json`).
- **CodeGraph (MCP)** — структурный поиск (экономит токены vs Read), npm-инструмент (`codegraph serve --mcp`). Индекс `.codegraph/codegraph.db` **обновляется САМ** (file-watcher вкл. по умолчанию, проверено live на Windows; `.md` не индексируется; mtime `.db` ≠ свежесть из-за WAL — проверять `codegraph status .`). ⚠ read-gate СНЯТ — codegraph не форсится, звать по привычке. **`graphify` — ОТДЕЛЬНЫЙ продукт** (Python, индекс `graphify-out/graph.json`), к codegraph-индексу отношения НЕ имеет — не путать.
- Скилы/диспетчеры зеркалятся в `~/.codex/skills`, `~/.gemini/skills`; нативные агенты — только Claude.

## Commands
Полный список — `.planning/COMMANDS-REFERENCE.md`. Частые:
```bash
npx claude-mem status         # worker памяти жив?
node tools/doctor.js          # health: docs/skills/git
codegraph status .            # codegraph-индекс свежий? (обновляется САМ — watcher в serve --mcp)
```

## Architecture
Трёхслойная рабочая система (см. `PLAYBOOK.md`), всё on-demand, без per-turn налога:
- **Глобально (тонко):** PreCompact-хук + codegraph MCP + плагины (ponytail, claude-mem). Ничего не инжектится каждый ход.
- **Карта (`PLAYBOOK.md`):** какой скилл когда / как совмещать / когда команда агентов — по всем доменам.
- **Роутер (`/pipeline`):** классификация задачи → маршрут → бюджет скилов.
- **Ритуал (`/project-bootstrap`):** делает проект эталонным (доки + харнесс с зубами + индекс + память + Context7).
Метод — Fowler harness (`/harness-method`): guide → sensor → блокирующий gate → steering. Per-project, не глобально.

## Gotchas
- **C:\ — НЕ git-worktree** (вылечено 2026-05-29): бывший `C:\.git` → `C:\_ARCHIVED-ui-ux-gitdir`. Детали: `project_git_cdrive_repo_2026-05-29.md`.
- **`graphify` ≠ `codegraph`** — разные продукты/индексы (`graphify-out/graph.json` vs `.codegraph/codegraph.db`). `graphify update` НЕ обновляет codegraph-индекс (codegraph сам через watcher). `graphify claude install` = ЗАПРЕЩЕНО.
- **Codex не поддерживает** FileChanged и Notification (Claude Code only).
- **cwd в хуках** — всегда из `input.cwd`, не `process.cwd()`. Windows: `path.join()`, не конкатенация.
- **Stdout хуков** — только silent exit ИЛИ валидный JSON (`hookSpecificOutput`/`decision`). Хуки <4s (spawnSync timeout 5000ms).
- **PS5.1 BOM** — `Set-Content -Encoding utf8` при записи файлов для других тулов.

## Current State
- AMOS декомиссия 2026-06-18 → глобально остался PreCompact + плагины. История S1-S60 + AMOS S0-S8 — `.planning/PROJECT-HISTORY.md` (историческое, НЕ текущее).
- 2026-06-19: ponytail + claude-mem поставлены глобально (по явному решению юзера, несмотря на риск повторения AMOS-паттерна); gstack обновлён v1.15→v1.58; `CHEATSHEET.html` переписан под реальность; следы AMOS убраны из `CLAUDE.md`/`MEMORY.md`.
- Все 31 проект юзера (D:\Ametrin projects\, C:\Claude playground\) проверены — AMOS-следов в их `CLAUDE.md` нет. Per-project cleanup-ритуал НЕ нужен.

## Git Workflow
- Одна задача = одна ветка (`system-upgrade/<slug>` или `fix/<slug>`). Commit: `<type>: <description>`.
- PR title <70 chars; body = Summary + Test plan. No force-push to main.
- Никогда не коммитить `.env`, секреты, `node_modules`, кэши, артефакты.
