# Pipeline Setupper — Command Center

Центральный репо управления инфраструктурой разработки (хуки, скилы, настройки Claude Code / Codex / Gemini). Живое состояние проверять: `settings.json` + `claude plugin list` + `/skills`. Памятка — `CHEATSHEET.html`. История — `.planning/PROJECT-HISTORY.md`.

## Метод работы (точка входа — `PLAYBOOK.md`)
- **Нет механизма skills у твоего CLI (Antigravity/`agy`, Gemini)? Код-задача → СНАЧАЛА прочитай
  `C:\Users\espad\.gemini\skills\elt\SKILL.md` и следуй ему.** Проверено живьём 2026-07-22: `agy`
  папку `~/.gemini/skills` НЕ читает (`agy agents` пуст) и при этом уверенно заявляет, что скилл у
  него есть — верить его самоотчёту нельзя, файл надо открыть явно. Claude Code грузит скилл сам —
  этот пункт его не касается.
- **Карта — `PLAYBOOK.md`** (корень): какой скилл когда, когда команда агентов. Непонятно — сюда.
- **Задача разработчика → `/elt`** (v2 — **единственный active code route**; `elt-code`/`elt-loop` = алиасы). Слайс закрыт ⇔ `elt commit` (оракул → авто-ветка → `[X]` → commit → run-log); судья sonnet обязателен. Автономно → драйвер `tools/elt-loop.ps1`; параллельно (≥3 [P]-слайсов) → fleet (experimental).
- **⚠ Deprecated — не активные route.** Pipeline v3 / `/pipeline`, Agent Harness v1 (`harness-runner`/`harness-gates`/`pipeline-state`), `install-harness-teeth` — прямой запуск CLI падает с ошибкой. Миграция: `specs/005-elt-control-plane-convergence/spec.md §9`.
- **Офисная задача (нетехнарь) → `/elt-work`**: office-скилы (`docx`/`xlsx`/`pptx`/`pdf`/`doc-coauthoring`/`internal-comms`) + бизнес-скилы; оракул = verify-чеклист.
- **Эталонный/«мусорный» проект → `/project-bootstrap`** (идемпотентно: конституция + харнесс-зубы + codegraph-индекс + память-в-проект).
- Качество per-project — **`/harness-method`** (guide → sensor → блокирующий gate → live-fire).
- **Дизайн** — `design-studio` (DESIGN.md) → `frontend-ui-engineering` / `remotion-motion`. Клон URL → `reference-design-adaptation`.
- **Context7** — `ctx7` (PowerShell, on-demand) перед кодом с внешней либой (MCP-плагин OFF намеренно — токен-налог).

## Memory
- **Указатель, не журнал.** Живая память/состояние — `.planning/STATE.md` (хребет) + `CHECKPOINT-*.md`; история — `.planning/PROJECT-HISTORY.md`. НЕ в корень ПК, НЕ инлайн сюда.
- Dogfood: строим систему самой системой — `constitution → spec → tasks → loop (механический оракул) → checkpoint`.
- Дисциплина (codegraph перед Read, тесты-как-proof, checkpoint) — на пользователе; авто-гейтов нет.

## Активный слой (проверять живьём, не по этому файлу)
- Хуки — `~/.claude/settings.json` (базово PreCompact + git-guardrails/codegraph-гейты). Плагины — `claude plugin list`. Скилы — `/skills`.
- **codegraph MCP** — структурный поиск: `codegraph_context` первым, НЕ Read целых файлов. Индекс обновляется САМ (watcher); свежесть — `codegraph status .` (mtime `.db` ≠ свежесть из-за WAL; `.md` не индексируется).

## Commands
```bash
node tools/doctor.js       # health: docs/skills/git (+ fleet-воркеры, если проект их юзает)
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
