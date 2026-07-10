# CHECKPOINT — Prompt Party talk (Harness+Loop eng) собран, ждёт ревью (2026-07-06)

> Мост для нового чата. Это ОТДЕЛЬНЫЙ дедиверабл от `presentation/index.html`.
> `index.html` = дек для нетехнаря-начальника (v3, закрыт ранее). ЭТОТ = 20-мин доклад
> на Prompt Party (Zoom), аудитория = коллеги Ametrin (полу-технари), с живым демо.

## Задача (от начальника)
Доклад на 20 мин про **Harness Engineering + Loop Engineering**. Материал начальника —
`presentation/prompt_party_materials/part1|part2` (теория: 12 компонентов каркаса, цикл,
Ralph Loop, framework-сравнение, thin/thick, 7 решений + 8 hand-drawn диаграмм).
Требование: разбор реального кейса из работы + **живая демонстрация** harness-системы и elt-loop.

## Build Status
- Compiles: n/a (статический HTML). `node --check` инлайн-скрипта — PASS.
- Рендер верифицирован agent-browser (слайды 3/9/13): картинки начальника встроены,
  наша box-схема с тегами компонентов ок, демо-карточки+терминал ок. Все пути к картинкам резолвятся.

## Созданные файлы (оба untracked, в git НЕ коммичены — не запрашивалось)
1. **`presentation/harness-loop-talk.html`** — дек 14 слайдов, ~20 мин. Дизайн-система скопирована
   из `index.html`. Диаграммы начальника встроены как `<img>` (пути с %20 для пробелов):
   - Спина: (1-2) гачок+проблема [LangChain/TerminalBench] → (3-5) ОС-аналогия[part1/image copy.png] +
     12 компонентов[part1/image copy 2.png] + цикл[part2/image.png] → (6) Loop Eng/Ralph Loop +
     Cherny-цитата → (7) 7 решений[part2/image copy 4.png]+thin/thick[part2/image copy 3.png] →
     (8) переход elt-code/elt-loop → (9) **НАША box-схема** (адапт. из index.html сл.3, каждый бокс
     подписан компонентом каркаса) → (10) **таблица-мапинг 12 компонентов→наша реализация** →
     (11) ставка: оракул закрывает петлю, судья advisory (0/46 театр) → (12) реальный кейс AWE3
     US2 4 коммита → (13) **ЖИВА ДЕМО** карта → (14) подытог+5 вопросов.
   - Сквозная фраза (начало+конец): «Якщо ти не модель — ти каркас», последнее слово о качестве — за машиной.
2. **`presentation/DEMO-RUNBOOK.md`** — шпаргалка на 2-й экран: тайминг (демо=5 мин из 20) +
   5-мин префлайт + 4 акта живого показа с ТОЧНЫМИ командами + fallback + очистка.

## Реальный кейс / демо-факты (ВСЕ верифицированы живьём этой сессией)
- **AWE3 = `C:\Ametrin projects\Ametrin ecosystem old\Ametrin web ecosystem 3`** (ПЕРЕЕХАЛ под
  `ecosystem old\` — старый путь `C:\Ametrin projects\Ametrin web ecosystem 3` уже НЕ существует).
  Ветка `feature/us1-slice2-aggregation`. Rust workspace (axum gateway+module-sdk+contracts+
  fixture-module) + React/Vite. spec-kit `specs/001-service-aggregator-platform/`.
- Оракул: `just test` = `cargo test --workspace` + `pnpm --filter @platform/web test` + `…contracts-ts test`.
- Гейт: `.husky/pre-commit`, 8 сенсоров, `set -e`: lint-staged→check-crate-boundaries.sh→cargo deny→
  cargo check→**cargo fmt --check**→cargo clippy -D warnings→cargo test --workspace→pnpm test.
- Кейс T038: soft-delete (status=removed), коммит `cf0837a`. US2 серия: eb42eac→cf0837a→f26c007→09a2378.
- 11 открытых `[ ]` задач от **T046** (US3 degraded view) — для опц. живого прогона `/elt-loop`.
- Тулинг весь стоит: just 1.55.1, cargo 1.93, pnpm 9.15.9, docker 29.5.3, node 24.
- Полный стек НЕ поднимал (засоряет dev-БД test-suite мусором — предупреждение в
  CHECKPOINT-2026-07-01-us2-closed-demo-rehearsal.md). Runbook делает это в 5-мин префлайте.
- Демо Акт 3 (money-shot): сломать формат в `crates/gateway/src/registry/mod.rs` → git commit
  отклонён на `cargo fmt --check` → `git checkout --` откат. Совет в runbook: сперва standalone
  `cargo fmt --check` (мгновенный ред, т.к. fmt = 5-й из 8 сенсоров, коммит «думает» ~30с).

## Git State
- Branch `main`, last commit `d9413aa` (не этой сессии). `presentation/` целиком untracked.
- Ничего не коммичено этой сессией.

## Remaining Work / открытые решения (СПРОСИТЬ юзера, не угадывать)
1. Коммитить ли `presentation/` в git (сейчас untracked)?
2. Акт 4b (живой `/elt-loop` на T046 на сцене) — оставить опцией или убрать? Эффектно но рискованно
   на Zoom; акты 1-3+4a показывают тот же каркас надёжно.
3. Предложено но не сделано: прогнать Акт 3 (`cargo fmt --check` reject) сейчас, показать юзеру
   точный вывод для экрана.

## Blockers
- Нет. Чисто ждёт реакции юзера на дек + 2 решения выше.

## Resume Pointer
- Focus: 20-мин Prompt Party доклад Harness+Loop eng СОБРАН (2 файла в `presentation/`),
  рендер верифицирован, ждёт ревью юзера.
- Resume: открыть `presentation/harness-loop-talk.html` (start "" "<path>"), спросить реакцию;
  решить 2 вопроса (git-коммит, Акт 4b). При желании — живьём прогнать Акт 3 fmt-reject на AWE3.
- НЕ путать с `index.html` (нетехнарь-дек, отдельный, не трогать).
