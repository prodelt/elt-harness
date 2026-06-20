# Фаза 2 prep — constitution.md (контент-сид)

> Подготовлено агентом A (Sonnet) в команде Фазы 1, 2026-06-20. **НЕ живой файл.**
> Lead-поправка: `constitution.md` генерится **spec-kit'ом** (`specify init → /speckit-constitution`),
> а не пишется руками (источник: `harness-method/REFERENCE.md:18`). Этот черновик — **контент-сид**:
> когда в Фазе 2 запустим spec-kit, скармливаем эти инварианты в `/speckit-constitution`, а секцию
> `## Quality rubric (project extensions)` оставляем под расширения рубрики судьи.

## Путь (когда станет живым)
spec-kit положит в корень репо: `C:\Claude playground\Pipiline setupper\constitution.md`
(сейчас файла нет — подтверждено `ls`).

## Черновик (инварианты из реальных доков)

```markdown
# Constitution — Pipeline Setupper (Code Domain)

> Архитектурные инварианты проекта. Enforced судьёй `/elt-code` (Фаза 1) + сенсорами (pre-commit/CI).

## Архитектурные инварианты

### I. Anti-AMOS: без авто-injection per-turn
Никакие доки/нуджи/контекст не инжектятся каждый ход. Глобально — только PreCompact hook + codegraph MCP.
Почему: token-налог + advisory-спам (AMOS decay 2026-06-18). Proof: `settings.json` — ровно один hook.

### II. Per-project конфиг вместо глобального
Харнессы (guide+sensor+gate) — project-local. `constitution.md`+`spec.md`+`.claude/` в репо, под git.
Почему: разные проекты — разные инварианты; one-size-fits-all ломает context-switching.

### III. Скилы, не плагины
Automation = skills (markdown в `~/.claude/skills/`, зеркало в codex/gemini), не Claude-specific плагины.
Почему: портируемость (Claude/Codex/Antigravity); плагины = lock-in + maintenance-долг.

### IV. CodeGraph query раньше Read
Структурные запросы (`codegraph_context`/`explore`) до Read. Индекс: `cmd /c graphify update .`.
Почему: sub-ms vs file I/O, токен-эффективно. НЕ `graphify claude install`.

### V. "Done" только с proof
Никакого completion без evidence (тесты/build-log/lint/скриншоты). Failed tests = прислать output.

### VI. Windows gotchas
- C:\ — НЕ git-worktree (single repo; `C:\.git` → архив 2026-05-29).
- PS5.1 BOM: `Set-Content -Encoding utf8` при записи файлов для других тулов.
- Hook cwd: `input.cwd`, не `process.cwd()`; пути — `path.join()`.
- Хуки: silent exit или валидный JSON; <4s.

### VII. Дисциплина вместо автоматизации (post-AMOS)
Manual gates (`/checkpoint`, `/pipeline` closeout), не auto-nudge. AMOS auto-gates decayed → сняты.

## Quality rubric (project extensions)

Судья `/elt-code` читает сюда per-project расширения базовой рубрики (H0-H2 твёрдый пол + S1-S4 совет).
Сейчас пусто — база достаточна. Добавлять домен-специфику (напр. S5 UI/дизайн для фронт-проектов) здесь.
```

## Источники
CLAUDE.md (Gotchas, Windows/BOM/hook-cwd) · PLAYBOOK.md:71 (красные линии анти-AMOS) ·
ELT-CODE-DESIGN.md узлы 5-6 (spec-kit per-project, constitution = принципы + рубрика).
