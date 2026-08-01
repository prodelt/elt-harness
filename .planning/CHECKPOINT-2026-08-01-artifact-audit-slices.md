# CHECKPOINT 2026-08-01 — сверка с артефактом ELT v3 + 8 новых слайсов (T019–T028)

Предыдущий: `.planning/CHECKPOINT-2026-08-01-T018-live-smoke.md`.
Ветка `feature/judge-bench-parallel-oracle`, база `324e0ea`. Дерево грязное намеренно.

## Что сделано в этой сессии

Сверка **живого кода** (не CLAUDE.md, не спеки) со схемами артефакта
`ELT v3 — протокол замера и три схемы харнесса.html` (схемы A и C, §04–§07).
Результат — дополнение `specs/011-elt-v3-gate/tasks.md`: **T019–T028**, четыре фазы J/K/L/M
плюс раздел «Осознанно НЕ включено».

## Три вывода сверки (по коду)

1. **Схема A по слоям есть, лестницы доверия нет.** `verify` снят (T001), но в цепочке
   по-прежнему **4 вето**: `L0.verdict → grounding → судья → red-proof`. Два выносят `block` без
   качественного суждения. `red-proof` со схемы A артефакта просто исчез, хотя живьём он
   переворачивает `pass` в `block` — именно этим заблокирован T018.
   Не починено также: **полного сьюта перед merge нет вовсе** (грепом); L2 smoke в НАШЕМ репо не
   включён; базовой линии одной командой нет; FPR судьи не измерен (бенч мерил `agy`).
2. **Граф несущим не стал.** Из трёх функций схемы C (scope/impact/риск) живёт одна — impact, и та
   на обратном **текстовом скане** (`elt-oracle-select.js:108`, глубина 2). `codegraph affected` в
   этом репо возвращает пусто (43 import-узла на 288 файлов). Scope — регулярка по `[files:]`
   (`gate.js:641`), риск — глобы `hotPaths`. Убери codegraph из `selectTests` — выборка не изменится.
3. **Эволюции нет, есть первое звено.** `harness-watch.js` = узел `D` схемы C, но
   `.harness/health.jsonl` — **1 запись за месяц** (27.07): его никто не зовёт. `P → RG → AP/RB` и
   обратного ребра в гейт нет. `judge-bench` существует, ни с чем не связан.

Прочее неучтённое из артефакта: разделение capability/regression evals; waggle (дифф через argv →
ENAMETOOLONG как класс); топология `[P]` из графа; оркестратор без центра; HMAC-цепь пруфов;
«summary в контекст, детали в файл» доведено только до `oracle-tail.log`.

## Новые слайсы

| # | Фаза | Суть | Зависимости |
|---|---|---|---|
| T019 | J | `red-proof:green` и `grounding:no-reasons` → `inconclusive`, не `block` | **разблокирует T018** |
| T020 | J | Полный сьют перед merge (сеть под impact-выборкой) | — |
| T021 | J | L2 smoke в ЭТОМ репо (dogfood; smoke = deploy-копия `~/.claude/bin/elt.js`) | — |
| T022 | J [P] | `elt stats` — базовая линия одной командой (шаг 0 артефакта) | предусловие T015 |
| T023 | J [P] | judge-bench на `claude/sonnet` + исторические pass-кейсы → FPR | предусловие T015 |
| T024 | K | L0-триггер `out-of-scope` (файловый, не символьный — графа нет) | — |
| T025 | K [P] | L0-триггер `high-fanin` через `dependents()` вместо глобов | — |
| T026 | L | `harness-watch` зовётся из `elt commit` + детектор `block-pattern` | — |
| T027 | L | `elt harness propose` — регресс-гейт правки харнесса | T022, T023 |
| T028 | M | Промпт судьи через файл, не argv (waggle) — ENAMETOOLONG как класс | — |

## ⚠ Approval стал stale — первое действие следующей сессии

```
node tools/elt.js spec status --spec specs/011-elt-v3-gate
→ {"status":"stale","approvedAt":"2026-07-31T22:31:04.530Z"}
```

`tasksHash` входит в approval (`elt.js:259`), поэтому `slice next`/`commit` откажут exit 4.
Нужно явное «утверждаю» от пользователя → `node tools/elt.js spec approve --spec specs/011-elt-v3-gate`.
Заодно решить, дополнять ли `spec.md` критериями AC14–AC17 под новые фазы — если да, править ДО
approve, чтобы re-approve был один.

## Рекомендуемый порядок

T019 (разблокирует T018) → T018 закрыть → T022 ∥ T023 → T020, T021 → T024 ∥ T025 → T026 → T027 →
T028. T014/T015 — после T022/T023, иначе вердикт снова будет без чисел.

## Ловушки, унаследованные

- Все вызовы `elt` по 011 — **с `--spec specs/011-elt-v3-gate`** (id уникальны внутри спеки, не
  между; T018 без флага привязался к 006 и заблокировал по чужой рубрике).
- Судья: `--provider claude --model sonnet` (в `harness.json` уже он, но флаг дешевле проверки).
- `tools/elt.js` → `~/.claude/bin/elt.js` копируется ВРУЧНУЮ; `sync-bin.js` кладёт только
  замыкание судьи. Новый `require()` в `elt.js` убивает `elt oracle` во всех проектах.
- В дереве лежит незакоммиченный контракт-тест в `tools/fleet/fleet.test.js` (T018, зелёный).

## Resume Prompt

> Продолжаю Pipeline Setupper, ветка `feature/judge-bench-parallel-oracle`, база `324e0ea`.
> Читай `.planning/CHECKPOINT-2026-08-01-artifact-audit-slices.md`, затем
> `specs/011-elt-v3-gate/tasks.md` — раздел «Дополнение 01.08.2026» (T019–T028, выведены сверкой
> живого кода со схемами артефакта ELT v3).
> **Первое: approval спеки стал `stale`** (tasksHash изменился). Спроси у меня явное «утверждаю» и
> прогони `node tools/elt.js spec approve --spec specs/011-elt-v3-gate`; предложи заодно, нужны ли
> AC14–AC17 в `spec.md` под новые фазы (тогда правим ДО approve).
> Дальше по порядку: **T019** (`red-proof:green` и `grounding:no-reasons` → `inconclusive` вместо
> `block`) — он разблокирует T018, который сейчас стоит на `red-proof:green` при обоснованном
> `pass` судьи. Затем закрыть T018, потом T022 ∥ T023 (числа и FPR — предусловия T014/T015).
> Все вызовы `elt` — с `--spec specs/011-elt-v3-gate`, судья `--provider claude --model sonnet`.
> Гейт гнать ОДНОЙ фоновой цепочкой `oracle → judge run → commit` (любая запись в дерево между
> шагами = `stale-tree`).
