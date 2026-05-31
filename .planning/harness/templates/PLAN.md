<!-- Adapted from ai-boost/awesome-harness-engineering (CC0 1.0). Tailored to Pipeline Setupper stack. -->
# PLAN-YYYY-MM-DD-<slug>.md

> Артефакт планирования задачи. Создаётся в начале, обновляется по мере прохождения milestones.
> Агент обновляет файл по ходу выполнения, а не только в конце.
> В этом репо живёт в `.planning/`.

## Task

<!-- Одно предложение: что строится или чинится. -->

## Context

<!-- Зачем задача. Что её спровоцировало. Как выглядит успешное состояние. -->

## Approach

<!-- Стратегия. Что изменится и почему. Ключевые trade-offs. Какие существующие
     tools/* и хуки переиспользуются (RAG-first → Graphify → Read). -->

## Milestones

Помечай `[x]` только когда verification-gate прошёл. Не помечай по «написал код».

- [ ] **M1: <name>** — <что значит done> | verify: `<команда>`
- [ ] **M2: <name>** — <что значит done> | verify: `<команда>`
- [ ] **Final: все тесты + doctor** | verify: `node tools/<x>.test.js; node tools/doctor.js --root .`

## Scope boundaries

In scope:
-

Out of scope (явно исключено):
-

## Open questions

<!-- - [ ] Вопрос — где/как разрешить -->

## Risks

<!-- Что может пойти не так. На каких допущениях держится план. -->

## Notes

<!-- Журнал значимых решений по ходу. Append-only, не перезаписывать. -->

---
*Created: YYYY-MM-DD*
