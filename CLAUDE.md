# Pipeline Setupper — Command Center

Центральный репо управления инфраструктурой разработки (хуки, скилы, настройки Claude Code / Codex / Gemini). Живое состояние проверять: `settings.json` + `claude plugin list` + `/skills`. Памятка — `CHEATSHEET.html`. История — `.planning/PROJECT-HISTORY.md`.

## Метод работы (точка входа — `PLAYBOOK.md`)
- **Карта — `PLAYBOOK.md`** (корень): какой скилл когда, когда команда агентов. Непонятно — сюда.
- **Задача разработчика → `/elt`** (v2, elt-code+elt-loop слиты; старые имена = алиасы). Слайс закрыт ⇔ `elt commit` прошёл (CLI `~/.claude/bin/elt.js`: оракул exit 0 → авто-ветка → `[X]` → commit → `.git/elt/run-log.jsonl`). Судья обязателен (sonnet, REJECT-default). **Этот репо: `specApproval:true`** — крупная спека утверждается юзером явным «утверждаю» ДО первого слайса (`elt spec approve`, hash-связано; без approve `slice next`/`commit` отказывают exit 4; `--skip-approval` — громкий след в run-log). Автономно → драйвер `tools/elt-loop.ps1` (fresh `claude -p` на слайс); стоп = файл `.harness/STOP`. Параллельно (≥3 [P]-слайсов) → fleet `tools/elt-fleet.ps1` (N воркеров claude/codex/agy в git worktree, гейт неизменен, merge-очередь; `specs/002-elt-fleet`). ⚠ **Fleet: `specs/003-elt-fleet-hardening` закрыта** (verdict 2.66×/3.31× на синтетич. бенчах, все MVP-дефекты из аудита 2026-07-10 починены) — **но живой прогон на реальном проекте ещё не завершён** (Fleet-vs-solo A/B на Ametryn Protocol Bot, пауза на Claude rate-limit, `.planning/CHECKPOINT-2026-07-11-fleet-vs-solo-ab-ametryn.md`). Experimental-метка держится до его вердикта, не потому что 003 «не закрыта».
- **⚠ Deprecated — не активные route.** `/elt` — единственный active code route. Pipeline v3 / `/pipeline`, Agent Harness v1 (`harness-runner`/`harness-gates`/`pipeline-state`), `install-harness-teeth` — прямой запуск CLI падает с deprecated-ошибкой (exports пока живут ради doctor/git-workflow-audit). Миграция и удаление: `specs/005-elt-control-plane-convergence/spec.md §9` (delete-слайсы T019/T020).
- **Офисная задача (нетехнарь) → `/elt-work`**: office-скилы (`docx`/`xlsx`/`pptx`/`pdf`/`doc-coauthoring`/`internal-comms`) + бизнес-скилы; оракул = verify-чеклист.
- **Эталонный/«мусорный» проект → `/project-bootstrap`** (идемпотентно: конституция + харнесс-зубы + codegraph-индекс + память-в-проект).
- Качество per-project — **`/harness-method`** (guide → sensor → блокирующий gate → live-fire).
- **Дизайн** — `design-studio` (DESIGN.md) → `frontend-ui-engineering` / `remotion-motion`. Клон URL → `reference-design-adaptation`.
- **Context7** — `ctx7` (PowerShell, on-demand) перед кодом с внешней либой (MCP-плагин OFF намеренно — токен-налог).

## Memory
- **Указатель, не журнал.** Живая память/состояние — `.planning/STATE.md` (хребет) + `CHECKPOINT-*.md`; история — `.planning/PROJECT-HISTORY.md`. НЕ в корень ПК, НЕ инлайн сюда.
- Dogfood: строим систему самой системой — `constitution → spec → tasks → loop (механический оракул) → checkpoint`.
- Дисциплина (codegraph перед Read, тесты-как-proof, checkpoint) — в интерактиве на пользователе/агенте; авто-гейтов нет. В автономном драйвере (`elt-loop.ps1`) — гейт есть (см. ниже).

## Активный слой (проверять живьём, не по этому файлу)
- Хуки — `~/.claude/settings.json` (базово PreCompact + git-guardrails/codegraph-гейты). Плагины — `claude plugin list`. Скилы — `/skills`.
- **codegraph MCP** — структурный поиск: `codegraph_context` первым, НЕ Read целых файлов — это дисциплина интерактивной сессии, не мехгейт (замер 2026-07-12: adoption 4/993 вызовов). Индекс обновляется САМ (watcher); свежесть — `codegraph status .` (mtime `.db` ≠ свежесть из-за WAL; `.md` не индексируется). Для автономного драйвера (`elt-loop.ps1`) есть жёсткий pre-slice гейт на здоровье индекса — `.harness/harness.json` → `"codegraphGuard": true` (T009, `tools/codegraph-guard.js`); он ловит только мёртвый/устаревший индекс, не проверяет что агент реально вызвал codegraph.

## Commands
```bash
node tools/doctor.js       # health: docs/skills/git (+ fleet-воркеры, если проект их юзает)
codegraph status .         # codegraph-индекс свежий?
node --test tools/fleet/*.test.js                       # тесты fleet-оркестратора
powershell -File tools/elt-fleet.ps1 -Action status -Tasks specs/002-elt-fleet/tasks.md  # статус fleet-прогона
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
