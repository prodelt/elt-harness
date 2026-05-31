<!-- Adapted from ai-boost/awesome-harness-engineering (CC0 1.0). Tailored to Pipeline Setupper stack. -->
# Harness Review Checklist

> Пройти перед отгрузкой harness в продакшн или передачей.
> Проваленный пункт = блокер; пропущенный пункт = нужно письменное обоснование.
> Машинная проверка: `node tools/harness-checklist.js --root . --write`.
> Колонка **A/M** — auto (проверяется скриптом) / manual (требует обоснования в
> `.planning/harness-checklist-justifications.json`).

## Agent instructions (AGENTS.md)

- [ ] (A) AGENTS.md / CLAUDE.md / .gemini/GEMINI.md существуют и синхронны
- [ ] (A) Tool permissions явные (`permissions` в settings.json)
- [ ] (A) Verification gates определены, команды корректны (секция Commands)
- [ ] (M) Нет неоднозначных инструкций, допускающих несколько трактовок

## Tool design

- [ ] (A) Тесты harness-runner проходят (`tools/harness-runner.test.js`)
- [ ] (A) Возврат tools консистентен (есть `validateSchema`)
- [ ] (M) Имя каждого tool однозначно
- [ ] (M) Ни один tool не делает больше одной концептуальной вещи
- [ ] (M) Сообщения об ошибке говорят, что делать дальше

## Context delivery

- [ ] (A) Долгоживущее состояние в файлах (`.planning/` непустой)
- [ ] (A) Стратегия компакции определена (context-budget-gate / session-size-guard / active-window.js)
- [ ] (A) Защита от утечки секретов (secret-scanner Bash-gate)
- [ ] (M) Контекст ограничен задачей, не всем кодом

## Planning artifacts

- [ ] (A) Шаблоны PLAN/IMPLEMENT существуют (`.planning/harness/templates/`)
- [ ] (A) Есть свежий `ARCHITECTURE-*.md`
- [ ] (A) Milestones содержат verify-команды
- [ ] (M) Границы scope (in/out) записаны

## Permissions & sandbox

- [ ] (A) `permissions` определён в settings.json
- [ ] (A) Деструктив требует подтверждения (`/careful`, `/freeze`, secret-scanner)
- [ ] (A) FS-доступ ограничен проектом (хуки скоупят git `-- .`)
- [ ] (M) Агент работает с минимально нужными правами

## Verification loop

- [ ] (A) Тесты на выходы агента существуют
- [ ] (A) `doctor` запускается и агрегирует проверки
- [ ] (A) Verification-gates присутствуют в docs
- [ ] (M) Eval-критерии записаны ДО начала задачи, не после

## When this harness component should be removed

> Каждый компонент harness существует потому, что модель чего-то ещё не умеет.
> Документируй, какое улучшение модели сделает компонент ненужным.

| Component | Exists because | Can be removed when |
|---|---|---|
| | | |

---

*Reviewed: YYYY-MM-DD*
*Reviewer:*
