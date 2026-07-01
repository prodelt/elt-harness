# Pipeline Setupper — Command Center

Центральный репо управления инфраструктурой разработки (хуки, скилы, настройки Claude Code / Codex / Gemini). Живое состояние проверять: `settings.json` + `claude plugin list` + `/skills`. Памятка — `CHEATSHEET.html`. История — `.planning/PROJECT-HISTORY.md`.

## Метод работы (точка входа — `PLAYBOOK.md`)
- **Карта — `PLAYBOOK.md`** (корень): какой скилл когда, когда команда агентов. Непонятно — сюда.
- **Задача разработчика → `/elt-code`** (роутер). Автономная спек-драйвен петля → **`/elt-loop`**: следующая задача из `specs/*/tasks.md` → имплемент по конституции → тесты-оракул → self-heal → commit + `.planning/STATE.md`. Оракул = тесты, судья = advisory.
- **Офисная задача (нетехнарь) → `/elt-work`**: office-скилы (`docx`/`xlsx`/`pptx`/`pdf`/`doc-coauthoring`/`internal-comms`) + бизнес-скилы; оракул = verify-чеклист.
- **Эталонный/«мусорный» проект → `/project-bootstrap`** (идемпотентно: конституция + харнесс-зубы + codegraph-индекс + память-в-проект).
- Качество per-project — **`/harness-method`** (guide → sensor → блокирующий gate → live-fire).
- **Дизайн** — `design-studio` (DESIGN.md) → `frontend-ui-engineering` / `remotion-motion`. Клон URL → `reference-design-adaptation`.
- **Context7** — `ctx7` (PowerShell, on-demand) перед кодом с внешней либой (MCP-плагин OFF намеренно — токен-налог).

## Dogfood + память
- Строим систему самой системой: `constitution → spec → tasks → loop (механический оракул) → checkpoint`.
- **Память/состояние — В ПРОЕКТЕ**: `<project>/.planning/STATE.md` (хребет) + `CHECKPOINT-*.md`. НЕ в корень ПК.
- Дисциплина (codegraph перед Read, тесты-как-proof, checkpoint) — на пользователе; авто-гейтов нет.

## Активный слой (проверять живьём, не по этому файлу)
- Хуки — `~/.claude/settings.json` (базово PreCompact + git-guardrails/codegraph-гейты). Плагины — `claude plugin list`. Скилы — `/skills`.
- **codegraph MCP** — структурный поиск: `codegraph_context` первым, НЕ Read целых файлов. Индекс обновляется САМ (watcher); свежесть — `codegraph status .` (mtime `.db` ≠ свежесть из-за WAL; `.md` не индексируется).

## Commands
```bash
node tools/doctor.js       # health: docs/skills/git
codegraph status .         # codegraph-индекс свежий?
```
Полный список — `.planning/COMMANDS-REFERENCE.md`.

## Stack
Node.js 18+ (хуки .js), Claude Code hooks API (`~/.claude/settings.json`), Codex CLI hooks (`~/.codex/hooks.json`). Скилы зеркалятся в `~/.codex/skills`, `~/.gemini/skills`; нативные агенты — только Claude.

## Gotchas
- **C:\ — НЕ git-worktree** (2026-05-29): бывший `C:\.git` → `C:\_ARCHIVED-ui-ux-gitdir`.
- **`graphify` ≠ `codegraph`** — разные продукты/индексы (`graphify-out/graph.json` vs `.codegraph/codegraph.db`). `graphify claude install` = ЗАПРЕЩЕНО.
- **Codex не поддерживает** FileChanged/Notification (Claude Code only).
- **cwd в хуках** — из `input.cwd`, не `process.cwd()`. Windows: `path.join()`, не конкатенация.
- **Stdout хуков** — только silent exit ИЛИ валидный JSON (`hookSpecificOutput`/`decision`). Хуки <4s.
- **PS5.1 BOM** — `Set-Content -Encoding utf8` при записи файлов для др. тулов.

## Git Workflow
- Одна задача = одна ветка (`feature/<slug>` / `fix/<slug>`). Commit: `<type>: <description>`.
- PR title <70 chars; body = Summary + Test plan. No force-push to main.
- Не коммитить `.env`, секреты, `node_modules`, кэши, артефакты (`target/`, `.turbo/`).
