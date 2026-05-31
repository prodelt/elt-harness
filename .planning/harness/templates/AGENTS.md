<!-- Adapted from ai-boost/awesome-harness-engineering (CC0 1.0). Tailored to Pipeline Setupper stack.
     NB: для НОВЫХ проектов используем `Skill(skill="init-project")`, который генерит AGENTS.md
     с 6 core-секциями. Этот шаблон — референс harness-уровня (tool permissions + verification gates). -->
# AGENTS.md (template)

> Инструкции для AI-агентов в репозитории. Кладётся в корень. Агент читает ПЕРЕД задачей.
> В нашей инфраструктуре AGENTS.md — **канонический** источник; CLAUDE.md и .gemini/GEMINI.md
> синхронизируются из него через `/sync-docs` (`AGENTS.md -> CLAUDE.md + .gemini/GEMINI.md`).

## Overview

<!-- Один абзац: что делает проект, стек, главные цели. -->

## Stack

<!-- Языки, рантайм, ключевые зависимости. -->

## Commands

```bash
# Тесты (показывать вывод как proof)
<test command>
# Линт/формат
<lint command>
# Health
node tools/doctor.js --root .
```

## Architecture

<!-- Карта дерева + ключевые модули. -->

## Tool permissions

> Явные границы работают лучше расплывчатых запретов.

Allowed:
- Read/edit под `tools/`, `.planning/`, docs
- Запуск тестов и `doctor`

Restricted (спросить перед действием):
- Правка `~/.claude/settings.json`, `config.json`, хуков
- Деструктив (`rm -rf`, reset --hard) — см. `/careful`, `/freeze`
- Push в `main`

Not allowed:
- Менять CI без явной инструкции
- Ставить зависимости без явной инструкции
- `graphify claude install` (только `cmd /c graphify update .`)

## Gotchas

<!-- То, что удивит агента впервые здесь. См. реальный AGENTS.md проекта. -->

## Verification gates

Перед «done» агент обязан проверить:

- [ ] Тесты pass (`<command>`) — **с выводом**
- [ ] Линт pass
- [ ] `node tools/doctor.js --root .` без новых FAIL
- [ ] Изменённые файлы в рамках разрешённого scope
- [ ] Docs синхронизированы при изменении архитектуры (`/sync-docs`)

## Current State

<!-- Где сейчас проект: последний спринт, оценка, NEXT. -->
