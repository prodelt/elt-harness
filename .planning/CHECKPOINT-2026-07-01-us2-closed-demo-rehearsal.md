# CHECKPOINT — US2 (AWE3) закрыта + демо-репетиция (2026-07-01)

> Мост на случай автокомпакта. Живой хребет: `.planning/STATE.md` (полный журнал).
> Дедлайн демо: вторник 07.07.2026 (6 дней).

## Build Status
- Compiles: yes (`cargo build --workspace`, `pnpm build`)
- Lint: pass (`cargo clippy --workspace -D warnings`, `pnpm lint` — ESLint max-warnings=0)
- Type check: pass (`tsc -b`)

## Test Metrics
- Rust: 11 contract + 2 integration + 2 unit + 2 sdk_smoke = 17 passed, 0 failed
- Frontend: vitest 1 passed; Playwright e2e 2 passed (composed-workflow + module-onboarding)
- Coverage: not measured
- New tests this session: 7 (registry_post_success, registry_post_version_mismatch,
  registry_delete ×2, module_onboarding integration, module-onboarding.spec.ts e2e)

## Code Modifications Since Last Checkpoint (T028-slice checkpoint, T034/T035)
- Files created (AWE3): `crates/gateway/src/registry/service.rs`,
  `crates/gateway/tests/contract/registry_post_success.rs`,
  `crates/gateway/tests/contract/registry_post_version_mismatch.rs`,
  `crates/gateway/tests/contract/registry_delete.rs`,
  `crates/gateway/tests/integration/module_onboarding.rs`,
  `tests/e2e/module-onboarding.spec.ts`
- Files modified (AWE3): `crates/gateway/src/lib.rs`, `crates/gateway/src/registry/{handlers,mod,repository}.rs`,
  `crates/contracts/src/module_contract.rs`, `apps/web/src/catalog/Catalog.tsx`,
  `playwright.config.ts`, `crates/gateway/tests/contract.rs`, `crates/gateway/tests/integration.rs`,
  `specs/001-service-aggregator-platform/tasks.md` (T036-T045 → `[X]`)
- Files modified (Pipeline Setupper): `.planning/STATE.md` (журнал, не закоммичен — по конвенции коммит только по явному запросу)

## Git State
- **AWE3** (`C:\Ametrin projects\Ametrin web ecosystem 3`), ветка `feature/us1-slice2-aggregation`:
  4 новых коммита этой сессии — `eb42eac` (T036/T037/T040/T041), `cf0837a` (T038/T042),
  `f26c007` (T039/T043), `09a2378` (T044/T045). Дерево чистое (только build-артефакт
  `apps/web/tsconfig.tsbuildinfo`, не часть изменений).
- **Pipeline Setupper** (этот репо), ветка `feature/elt-code-judge-teeth`: последний коммит
  `8a384e1`; `.planning/*` не закоммичены в этой сессии (не запрашивалось).

## Completed Tasks
- elt-loop (автономная петля) — Phase 4 / User Story 2 AWE3: T036-T045 все `[X]`, 4 зелёных
  коммита через полный husky pre-commit гейт (fmt→boundaries→deny→check→clippy→
  cargo test --workspace→pnpm build/test/lint)
- T043 обнаружен УЖЕ реализованным ahead-of-time (в T031, прошлая сессия) — просто
  верифицирован и отмечен `[X]` постфактум
- P7 (репетиция демо) — elt-code
- Найдена и **исправлена** (с подтверждения юзера) критическая проблема dev-БД: 132 мусорные
  test-suite записи → каталог показывал 120+ дублей. Каскадный DELETE
  (`workflow_composition_item` → `service_module` WHERE owner='test-suite') выполнен вручную
  через `docker compose exec db psql`.

## Remaining Work
- **Phase 5, US3** (T046-T052, "workflow survives one module being down") — не начата.
  Частично может быть уже готова ahead-of-time (module-sdk circuit breaker уже в
  `dispatch()`-стеке с T031; `view_for` уже не пропагирует `?` между items) — нужна
  проверка тестами (T046-T048), не обязательно новый код. T050 (join_all-конкурентность)
  и T051 (новый frontend-компонент `apps/web/src/unavailable/`) — реальные дизайн-решения.
- **Демо-стиль (НЕ решено, юзер отложил на потом)**: страница совсем без CSS — голый HTML,
  сырой JSON текстом. Функционально всё работает, но на проекторе будет выглядеть
  незаконченно. Обсудить отдельно перед 07.07.
- **DB-гигиена**: тесты используют ту же `DATABASE_URL`, что и dev-стенд (нет отдельного
  `TEST_DATABASE_URL`) → каждый `just test`/`cargo test` снова засоряет каталог тестовыми
  записями (owner='test-suite'). Перед РЕАЛЬНЫМ демо либо прогнать очистку ещё раз
  (см. SQL ниже), либо развести тестовую БД от dev.
- P5 (elt-onboard live-грилл) — скилл готов, живой прогон с юзером не проводился.

## Blockers
- Нет активных блокеров. US3 не начата не из-за блокера, а из-за осознанного решения
  переключиться на демо-подготовку (выбор юзера).

## Next Steps
1. Если продолжать петлю — Phase 5 US3, SLICE=T046 (contract test: `workflow/view` unavailable
   для недоступного модуля при ok для здорового).
2. Если демо-подготовка — обсудить визуальный стиль (юзер отложил), либо решить DB-гигиену
   (развести `TEST_DATABASE_URL`), либо провести P5 (elt-onboard грилл).
3. Перед реальным демо 07.07 — обязательно перепрогнать очистку dev-БД (см. SQL ниже), т.к.
   любой `just test` между сейчас и демо снова насыпет мусор в каталог.

## Demo Environment (оставлен запущенным в фоне на момент завершения сессии)
- `db`: docker compose (уже был поднят), здоров
- `fixture-module` #1: порт 4000, дефолтный ключ `fixture-module` (env `FIXTURE_PORT=4000`)
- `fixture-module` #2: порт 4001, `FIXTURE_KEY=demo-second-service` (ручной, для рехёрсла —
  НЕ то же самое, что e2e-тестовый `e2e-onboarding-fixture` на том же порту)
- `gateway`: порт 3000
- `web` (vite dev): порт 5173 — http://localhost:5173
- Эти 4 процесса — обычные `cargo run`/`pnpm dev`, запущены через `& disown` в Git Bash;
  просто закрыть терминалы/убить по порту, если больше не нужны.

### DB-очистка (повторить перед реальным демо, если между сейчас и 07.07 гонялся `just test`)
```sql
DELETE FROM workflow_composition_item WHERE service_module_id IN (SELECT id FROM service_module WHERE owner = 'test-suite');
DELETE FROM service_module WHERE owner = 'test-suite';
```
Через: `docker compose exec -T db psql -U postgres -d aw3 -v ON_ERROR_STOP=1 -c "..."`

## Resume Pointer
- **Focus**: US1+US2 (AWE3) полностью закрыты и протестированы живьём (agent-browser
  репетиция). Демо 07.07.2026 — открытые вопросы: визуальный стиль (отложено юзером),
  DB-гигиена тестов, US3 не начата.
- **Resume**: `/elt-code` → спросить юзера явно: продолжать петлю в US3 (SLICE=T046) ИЛИ
  візуальный стиль ИЛИ DB-гигиену (`TEST_DATABASE_URL`) ИЛИ P5 (elt-onboard грилл) —
  НЕ угадывать, юзер явно отложил стиль на «обсудим отдельно».
