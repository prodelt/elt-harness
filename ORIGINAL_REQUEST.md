# Original User Request

## Initial Request — 2026-06-10T11:46:12Z

## Git Branch Strategy

Кожен агент працює у **власній ізольованій гілці** від `system-upgrade/amos-kernel`:

| Агент | Гілка | Зона відповідальності |
|---|---|---|
| Agent-0 (Baseline) | `amos/sprint0-baseline` | Sprint 0: гілка v3-legacy, замери, AMOS-BASELINE.md |
| Agent-1 (Kernel Core) | `amos/sprint1-kernel` | bin/amos.js, event router, профілі, fail-soft |
| Agent-2 (SQLite State) | `amos/sprint1-state` | state.sqlite, таблиці, metrics, `amos report` |
| Agent-3 (Tests & Wrappers) | `amos/sprint1-tests` | ≥40 unit-тестів, amos.cmd, amos.ps1 |

**Правила:**
- Кожен агент починає з `git checkout -b <своя-гілка> system-upgrade/amos-kernel`
- Коміти тільки у свою гілку — не в main, не в system-upgrade/amos-kernel напряму
- Після завершення роботи агент робить фінальний коміт і повідомляє координатора
- Злиття гілок виконує **координатор (Antigravity)** після верифікації всіх acceptance критеріїв
- При конфліктах між гілками — координатор вирішує вручну

AMOS (Agent Mini-OS) — переархітектура системи хуків/скіллів/пам'яті для агентів Claude/Codex/Antigravity.
Sprint 0 = Baseline freeze. Sprint 1 = Ядро CLI + SQLite state.

Working directory: `C:\Claude playground\Pipiline setupper` (Pipeline Setupper repo) + `C:\Users\espad\.amos` (нове ядро)

Integrity mode: development

## Обов'язкове читання перед стартом

Вся архітектура задокументована в:
- `C:\Claude playground\Pipiline setupper\.planning\ARCHITECTURE-2026-06-10-amos-agent-mini-os.md` — повний план (§3 схема, §5 спринти, §8 замери+KPI)
- `C:\Claude playground\Pipiline setupper\.planning\PROMPT-SPRINT-0-1-AMOS.md` — детальний промпт Sprint 0+1

## Requirements

### R1. Sprint 0 — Baseline & Freeze
Зафіксувати v3 системи: створити гілку `system-upgrade/amos-kernel` і тег `v3-legacy` від поточного HEAD в репо Pipeline Setupper. Закоммітити незакоммічені AMOS-файли (архітектура, промпт, замерщики). Провести baseline-замери в двох проектах (Pipeline Setupper і Law_assistant): розміри доків (CLAUDE.md, AGENTS.md, memory_summary.md, MEMORY.md), розмір SessionStart stdout хуків. Зберегти результати в `.planning/AMOS-BASELINE.md` таблицями і закоммітити.

### R2. Sprint 1 — AMOS Kernel + State
Створити `C:\Users\espad\.amos` як окреме git-репо з CLI-ядром:
- `bin/amos.js` — Node.js CLI (НУЛЬ зовнішніх залежностей): команди `event <name>`, `status`, `report`, `doctor`, `version`
- Event router: handlers `session-start` і `stop`. Вхід — JSON хука з stdin, вихід — `{hookSpecificOutput:{additionalContext}}` ≤2KB АБО silent exit 0
- SQLite через `node:sqlite` (Node 22+): таблиці `sessions`, `events_metrics`, `projects`, `handoffs`
- Профілі: `AMOS_PROFILE=minimal|standard|strict`; `AMOS_DISABLE=1` → silent exit 0
- Fail-soft: будь-яка помилка ядра → exit 0 без stdout, лог в `~/.amos/errors.log`
- Глобальні обгортки `~/.claude/bin/amos.cmd` (і amos.ps1)

### R3. Performance & Tests
`amos event session-start` холодний старт < 500ms (довести Measure-Command). Написати ≥40 unit-тестів (node:test або аналог): fail-soft при битій БД, бюджет 2KB, AMOS_DISABLE, запис метрики, невідома подія = silent exit, профілі.

### R4. Verification & Documentation
Показати реальний вивід кожного Acceptance критерію Sprint 1. Записати checkpoint + memory. Коміти в обох репо.

## Acceptance Criteria

### Sprint 0 Done When
- [x] Гілка `system-upgrade/amos-kernel` і тег `v3-legacy` існують (перевірити `git branch` і `git tag`)
- [x] Файл `.planning/AMOS-BASELINE.md` закоммічений з числами по обох проектах

### Sprint 1 Done When
- [x] `node C:\Users\espad\.amos\bin\amos.js event session-start` зі stdin-JSON `cwd=D:/Ametrin projects/Law_assistant` → ≤500ms, stdout ≤2KB валідного hook-JSON (~100-130ms, 185 bytes)
- [x] `amos.cmd status` працює з будь-якої папки (перевірено з `C:\`)
- [x] Всі тести зелені — показати N/N PASS (≥40) → 52/52 PASS
- [x] Бита `state.sqlite` → exit 0, порожній stdout (тестом + реальний CLI виклик з `TRIGGER_DB_ERROR=1`)
- [x] Після 3 викликів `amos report` показує події з `output_chars`/`duration_ms` (6→9 session-start)
- [x] `~/.amos` — git-репо з ≥2 осмисленими комітами (10 комітів, 2 merge)

**M4 Merge & Final Verification — DONE (2026-06-10):** 4 гілки агентів злиті в `amos/sprint1-kernel`, `amos/` копії в репо синхронізовані з канонічним `~/.amos`. Деталі: `.planning/AMOS-BASELINE.md` §5.

## Hard Constraints (не порушувати)
- **Git:** кожен агент у своїй гілці, ніколи не пушить в чужу гілку або main
- Windows PowerShell, НЕ `&&` → тільки `;` або окремі виклики
- НЕ редагувати `~/.claude/settings.json` і існуючі хуки (Sprint 6 це робить)
- AMOS будується ПАРАЛЕЛЬНО, v3-хуки продовжують працювати
- Без зовнішніх npm-залежностей в ядрі (node:sqlite, node:test — вбудовані OK)
- Якщо `node:sqlite` недоступний → `better-sqlite3` fallback (з поясненням)
