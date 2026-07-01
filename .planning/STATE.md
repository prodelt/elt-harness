# STATE — elt-code (петля) + elt-work (офис)

> Живой хребет работы (loop-engineering STATE.md паттерн). Память В ПРОЕКТЕ, не в корне ПК.
> План: `~/.claude/plans/imperative-churning-oasis.md`. Дедлайн демо: **вторник 07.07.2026** (проектор, машина юзера).

## Метод (dogfood — по требованию юзера)
Строим систему самой системой: constitution → spec.md → tasks.md → loop (механический оракул) → checkpoint.
Оракул для этой мета-работы: `node --check tools/*.js`, `node tools/doctor.js`; для AWE3 — `just test` / `just fitness`.
Красные линии: собирать из готового (новый скилл <100 строк), оракул=тесты не судья, «done» только с выводом команды.

## Задачи (P1–P8)
| # | Задача | Статус |
|---|---|---|
| P1+P2 | elt-loop: автономная спек-драйвен петля | ✓ ЖИВОЙ ПРОГОН: слайс T027/T031/T032 зелёный (`cargo test -p gateway` 7/7), commit через husky-гейт |
| P3 | память/чекпоинты В проект (`.planning/STATE.md`) | ✓ ЖИВОЙ (этот файл) |
| P4 | project-bootstrap reconcile «мусорного» репо | ✓ v1.3.0 (память-в-проект + git-гигиена); AWE3 в порядке |
| P5 | elt-onboard: грилл + анализ проекта → self-config v1 | СКИЛЛ ✓; live-test грилла = нужен юзер |
| P6 | elt-work: офиц. Anthropic office-скилы + роутер + чеклист | ✓ ДОКАЗАН: report.xlsx+docx на диске |
| P7 | loop-engineering черри-пик (STATE spine + loop-audit score) | STATE-хребет ✓; loop-audit заблокирован auto-mode (юзер); репетиция впереди |
| P8 | обрезать CLAUDE.md → actionable-ядро | ✓ (CLAUDE.md ~46 строк; живое состояние — не хардкод) |

## Демо-репо
`C:\Ametrin projects\Ametrin web ecosystem 3` (AWE3) — Rust+Node, spec-kit стоит, `justfile` оракул, husky-зубы (live-fire 2026-06-19), `specs/001-service-aggregator-platform/tasks.md` = источник слайсов.

## Текущий фокус
P1 live-fire — env ✓, baseline зелёный (`f39fae3`, ветка `feature/us1-slice2-aggregation`).
Упёрлись в **design-развилку** внутри T031 — решить до имплемента.

## Design-развилка (блокирует T031 — нужно решение юзера)
`AggregationService` (T031) зовёт `/capabilities/{capability}` каждого модуля, НО в схеме `ServiceModule`
capabilities НЕ хранятся (только key/manifest_health_endpoint/status). Откуда брать, какую capability звать?
- **A (рекоменд.):** в момент view звать `sdk.fetch_manifest(base_url)` → первая capability из манифеста → `get_capability`. Без миграции схемы, минимально. Минус — доп. вызов на модуль.
- **B:** мигрировать схему (хранить capabilities при регистрации, T040/US2). Чище рантайм, но тянет US2 в US1.
+ base_url деривится из `manifest_health_endpoint` (стрип `/health`) — хелпер.

## Следующее действие (после решения развилки)
Слайс T027→T031→T032:
1. T027: контракт-тест с in-test mock-модулем (axum на рандом-порту: `/manifest` + `/capabilities/{cap}`) → `cargo test -p gateway` красный.
2. T031: `AggregationService` (item → find_by_id → base_url → capability по A/B → `sdk.get_capability` → map `ModuleOutcome`/`ModuleCallError` → state ok/forbidden/unavailable; `join_all` параллель, US3-ready).
3. T032: handler `GET /api/v1/workflow/view` + смонтировать роут в `gateway::router`.
4. Зелёный → commit (husky-гейт) + `[X]` T027/T031/T032 в tasks.md + строка в STATE.

## Разблокировано ✓
`just 1.55.1` установлен. Docker поднят. AWE3 baseline закоммичен (`f39fae3`), дерево чистое, весь husky-гейт зелёный (fmt→boundaries→deny→check→clippy→cargo test --workspace→pnpm).

## Журнал
- 2026-07-01: grill (7 вопросов) → план утверждён → dogfood-харнесс поднят (STATE.md). Офисные скилы подтверждены (anthropics/skills: docx/xlsx/pptx/pdf/doc-coauthoring/internal-comms).
- 2026-07-01: P1 — `elt-loop` SKILL.md собран (тонкий, из auto-ship, оракул=тесты, судья=advisory, close→STATE.md). `elt-code` провёден на `/elt-loop` для автономного маршрута.
- 2026-07-01: Дожфуд `elt-loop` (предусловия) на AWE3 поймал 3 env-блокера ДО тяжёлого Rust-слайса. `.gitignore` починен (+/target). AWE3 на 28/56 задач, следующая = T027.
- 2026-07-01: `just 1.55.1` установлен ✓. Пока Docker down — параллельно закрыт **P6 MVP** (6 office-скилов + роутер `elt-work` + шортлист) и **P5** (`elt-onboard` собран) и **P8** (CLAUDE.md обрезан).
- 2026-07-01: Docker поднят → AWE3 baseline-коммит `f39fae3` на ветке `feature/us1-slice2-aggregation`. Husky-гейт СРАБОТАЛ (зубы!): первый коммит блокнут на `cargo fmt --check` → `cargo fmt` → повторный коммит прошёл весь гейт (fmt→boundaries→deny→check→clippy→**cargo test --workspace**→pnpm) зелёным. Дерево чистое.
- 2026-07-01: Прочитаны движущие части слайса (module-sdk API, contracts, repositories, router). **Найдена design-развилка**: capabilities не в схеме `ServiceModule`. Юзер выбрал **A** (fetch_manifest в момент view).
- 2026-07-01: **P1 LIVE-FIRE ✓** — слайс US1-2 реализован по A: `AggregationService` + handler + роут `GET /api/v1/workflow/view` + контракт-тест с in-test mock-модулем. Оракул `cargo test -p gateway` = **7 passed / 0 failed**. T027/T031/T032 `[X]`. Closeout-коммит `99625c7` через полный husky-гейт (fmt→clippy→cargo test --workspace→pnpm) зелёным. **Петля elt-code доказана end-to-end.**
- 2026-07-01: **P6 ДОКАЗАН** — office-libs (`openpyxl`,`python-docx`) в системный Python311; сгенерены `.planning/office-demo/report.xlsx`+`report.docx` с контентом. ⚠ DEMO-ГОТЧА: ambient `python`=Hermes-venv без libs → office на демо через `py -3` (см. `elt-work-office-research.md`).
- 2026-07-01: **P4 ✓** — `project-bootstrap` v1.3.0: шаг 5 память→`.planning/STATE.md` В ПРОЕКТЕ (не корень ПК); шаг 3 git-гигиена (артефакты в .gitignore + baseline на ветке). **P8 ✓** ранее. loop-audit (P7) заблокирован auto-mode классификатором — юзер запустит сам.
- 2026-07-01: ИТОГ сессии — 7/8 пунктов сделаны (P1,P3,P4,P5-скилл,P6,P8 + P7 частично). Осталось: live-test грилла P5 (нужен юзер) + репетиция демо (P7). Точка чекпоинта.
- 2026-07-01: **Коммит-политика** (решение юзера) зашита в скилы: `elt-loop`/elt-code = АВТО-коммит-на-зелёном (автономность); `elt-work`/нетехнари = ВСЕГДА ручное подтверждение, без авто-коммита/перезаписи.
