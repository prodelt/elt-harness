# CHECKPOINT — elt-loop автономный прогон, US1 MVP закрыта (2026-07-01)

> Мост на случай автокомпакта. Живой хребет: `.planning/STATE.md` (журнал слайсов).
> Дедлайн демо: вторник 07.07.2026.

## Что произошло в этом ходе
`/elt-code продолжай` → `/elt-loop` на репо `C:\Ametrin projects\Ametrin web ecosystem 3`,
ветка `feature/us1-slice2-aggregation`. Два слайса подряд без остановки:

**T034** — `apps/web/src/workflow/WorkflowView.tsx`: рендерит каждый `items[]` из
`GET /api/v1/workflow/view` независимо (`ok`→JSON `data`, `unavailable`/`forbidden`→`reason`,
Principle III). Коммит `fe027d4`.

**T035** — Playwright e2e quickstart Scenario 1. По пути найден и закрыт реальный
инфра-пробел: у vite dev-сервера не было `proxy /api`→gateway:3000 (без этого браузерные
запросы 404-лись бы у самого vite, не долетая до бэкенда) — добавлено в
`apps/web/vite.config.ts`. `playwright.config.ts` расширен до 3 процессов
(`fixture-module`:4000, `gateway`:3000, `web`:5173). `POST /api/v1/registry` ещё не
реализован (US2/T036+), поэтому `tests/e2e/composed-workflow.spec.ts` сидит `service_module`
напрямую SQL-инсертом через `docker compose exec db psql` — тот же паттерн, что у Rust
contract-тестов через `RegistryRepository`, только с TS-стороны против реальной dev-БД.
Оракул `just e2e` зелёный с первого прогона. Коммит `e01ca01`.

## Итог: User Story 1 (MVP) ПОЛНОСТЬЮ ЗАКРЫТА
Все задачи Phase 3 (`T020`–`T035`) отмечены `[X]` в
`specs/001-service-aggregator-platform/tasks.md`. `just test` и `just e2e` зелёные.
Петля elt-loop прошла end-to-end от контракт-тестов до браузерного e2e без вмешательства
пользователя (кроме одного design-решения по T031 в предыдущей сессии).

## Следующий слайс (по порядку файла tasks.md)
Phase 4, **User Story 2** («добавить новый внутренний сервис без изменения core», P2):
`T036 [P] [US2] Contract test for POST /api/v1/registry success path (fetches /manifest +
/health, persists) in crates/gateway/tests/contract/registry_post_success.rs`.

Это новая фаза (не продолжение US1) — вероятно потребует ещё контракт-тестов на ошибочные
пути (`T037`+) перед имплементацией хендлера. Дальше по спеку — весь registration handshake
(манифест-валидация, health-check при регистрации, персист capabilities — та самая "чистая"
альтернатива B из design-развилки T031, теперь можно реализовать без блокировки US1).

## Resume, если чат обрубился автокомпактом
`/elt-code` → продолжаем roadmap на AWE3 → SLICE = первая `[ ]` в
`specs/001-service-aggregator-platform/tasks.md` (сейчас T036) → обычный цикл elt-loop.

## Коммит-политика (напоминание)
elt-loop = АВТО-коммит-на-зелёном, без спроса — это и есть автономность в этом прогоне.

## Build/Test Status (AWE3, на момент чекпоинта)
- `just test`: pass (cargo test --workspace 12/12 + vitest 1/1)
- `just e2e`: pass (Playwright 1/1, `select, reload, still selected and rendered`)
- `pnpm build` / `pnpm lint` (apps/web): pass

## Git State
- **AWE3** (`C:\Ametrin projects\Ametrin web ecosystem 3`), ветка `feature/us1-slice2-aggregation`:
  последний коммит `e01ca01` (`test(e2e): T035 ...`); незакоммичено — только
  `apps/web/tsconfig.tsbuildinfo` (build-артефакт, не часть изменений).
- **Pipiline Setupper** (этот репо), ветка `feature/elt-code-judge-teeth`:
  последний коммит `8a384e1`; `.planning/*` не закоммичены в этой сессии (не запрашивалось) —
  накопленная правка STATE.md + этот чекпоинт остаются рабочим деревом, коммит по явному
  запросу юзера.

### Ответ на вопрос юзера в этом ходе
Юзер спросил, не ушёл ли я в «просто разработку» вместо работы над elt-code/харнесом.
Ответ зафиксирован: код в AWE3 — это доказательный прогон харнес-петли (`/elt-loop`),
не самоцель; сам харнес (`SKILL.md` elt-code/elt-loop) собран в прошлых сессиях, сейчас
фаза live-fire/proof согласно `.planning/STATE.md` P1 acceptance criteria.

## Next Steps
1. Решить: продолжать петлю в US2 (T036+, `POST /api/v1/registry`) или переключиться на
   P7 (репетиция демо) / P5 (live-test грилла) — оба ещё не закрыты, дедлайн 07.07.2026.
2. Если продолжать US2 — новая фаза, вероятна новая design-развилка (registration handshake),
   элт-луп должен по протоколу остановиться на первой неоднозначности и спросить.

## Resume Pointer
- **Focus**: AWE3 US1 (MVP) закрыта; harness-петля `/elt-loop` доказана 3 сессии подряд
  (T027-T032, T033, T034-T035). Демо 07.07.2026 — осталось P5 live-test + P7 репетиция.
- **Resume**: `/elt-code продолжай` (роутит на `/elt-loop`, SLICE=T036, US2) — ИЛИ, если
  приоритет сместился на демо-готовность, явно попросить P7 (репетиция) / P5 (грилл).
