# CHECKPOINT 2026-08-03 — T021, T024, T025 закрыты (7 слайсов за сессию)

Предыдущий: `.planning/CHECKPOINT-2026-08-03-T018-T022-T023-T020-closed.md`.
Ветка `feature/judge-bench-parallel-oracle`, HEAD **`d7204c5`**. Режим: соло.

## Что закрыто

**T021 — `0f68b18`.** L2 smoke в ЭТОМ репо (dogfood §3.1): единственный слой v3, который харнесс
не ел сам. `tools/smoke-elt-deploy.js` — прогоняет `~/.claude/bin/elt.js` без аргументов из
пустой temp-директории (снаружи репо-разработчика): без args elt.js падает через ВСЕ top-level
`require()` замыкания до первой развилки команды и печатает usage/exit 0 — единственный путь,
не требующий git/harness.json в cwd. `MODULE_NOT_FOUND` в выводе → `reason: broken`. Живая
проверка: временно удалил `~/.claude/bin/elt-stats.js` → красный smoke с реальным
`MODULE_NOT_FOUND`, вернул → снова зелёный. Поле `smoke` включено в `.harness/harness.json`
этого репо. Тесты дописаны в СУЩЕСТВУЮЩИЙ `tools/elt-smoke.test.js` (T010), не в новый файл —
файл уже был занят другим слоем `smoke`.

**T024 — `9f1c5ac`.** Scope-триггер `out-of-scope` в L0: файл в диффе вне `[files:]` И вне
харнесс-владений (`.harness/**`, `tasks.md`) → судья зовётся с явной причиной, НЕ block
(барьерные слайсы легитимно расширяют зону). Форма ФАЙЛОВАЯ, не символьная — намеренно:
`codegraph affected` в этом репо возвращает пусто (43 import-узла / 288 файлов). Задача без
`[files:]` — триггер молчит вовсе (тот же принцип, что у ctx7 при нуле импортов).
`taskScopeFiles`/`inTaskScope`/`isHarnessOwned` продублированы в `elt-gate-l0.js` (не
`require()` из `gate.js`/`plan.js`) — файл живёт в deploy-замыкании судьи (sync-bin CLOSURE),
а `fleet/plan.js` в него не входит; тривиальные 3 строки дублировать дешевле, чем тащить в
деплой новый файл. `gate.js`'s `runJudge` теперь прокидывает `taskText` в `evaluateL0(...)`
(было в файлах T024) — `elt.js`'s `preOracleL0` НЕ тронут (не в списке `[files:]`), значит
scope-триггер молчит в чисто-соло пути без `--task`, но работает в fleet/judge-run пути.

**T025 — `19d26bf`.** Риск из связности вместо глобов `hotPaths` по имени: артефакт — «узел с
высокой входящей степенью = дорогая ошибка». Дефолтный `hot-path` ловит по подстроке (`*auth*`
цепляет `author.js`), реально центральный модуль без «горячего» слова не ловит никак.
Переиспользованы существующие `walkJs`+`dependents()` из `elt-oracle-select.js` (тот же обратный
скан, что кормит impact-выборку) — нового источника данных не заведено. Архитектурно: `evaluate()`
остаётся ЧИСТОЙ (AC2, fs недопустим внутри) — фактический fs-скан живёт в НОВОЙ `computeFanIn(cwd)`
рядом с `loadConfig`, возвращает ГЕТТЕР с ленивым кэшем (директория сканируется сразу, дёшево;
содержимое файлов читается только для реально изменённых, обычно 1-5, а не для всех ~288 на
каждый гейт). Недоступен сосед (устаревший деплой без `elt-oracle-select.js`) → `null`, триггера
нет, не ложный block — та же дисциплина, что у codegraph. **Побочное следствие, обязательное:**
`elt-gate-l0.js` теперь требует `./elt-oracle-select` — добавлен в `sync-bin.js` CLOSURE (11
файлов вместо 10), иначе deploy-копия в чужих проектах падала бы `MODULE_NOT_FOUND` (класс T017).

## Паттерн сессии (продолжается с прошлого чекпоинта)

Апрув спеки протухает после КАЖДОГО слайса (`tasksHash` считает чекбоксы). Паттерн
`commit --skip-oracle` → `elt spec approve` → отдельный `docs:`-коммит — применён единообразно
для всех трёх слайсов этой сессии, без повторных вопросов юзеру (решение зафиксировано в
прошлом чекпоинте).

## Гочта сессии (T021, единожды)

`node --test tools/doctor.test.js` ВИСИТ (файл не в формате `node:test`, script-style с
собственным `main()`). Правильный вызов — `node tools/doctor.test.js` напрямую (уже было в
памяти `feedback`-раздела, но забылось на middle слайсе — стоило одного отменённого фонового
вызова). То же верно для `tools/elt-gate-l0.test.js` — прогоняется `node tools/elt-gate-l0.test.js`,
не `node --test`.

## Состояние

- Дерево чистое. Открытых слайсов 011: **4** (было 7): T026, T027, T028, приёмка T014/T015.
- `sync-bin.js` CLOSURE — 11 файлов (был 10, +`elt-oracle-select.js`).
- `~/.claude/bin/elt.js`/`elt-stats.js`/`elt-config.js` синхронизированы вручную (вне
  CLOSURE — elt.js деплоится отдельным `cp`, `doctor.test.js:testEltSingleSource` сверяет
  только его).

## Resume Prompt

> Продолжаю Pipeline Setupper, ветка `feature/judge-bench-parallel-oracle`, HEAD `d7204c5`.
> Читай `.planning/CHECKPOINT-2026-08-03-T021-T024-T025-closed.md`.
> T018/T020/T021/T022/T023/T024/T025 закрыты (7 слайсов 011 за сессию). Дальше по tasks.md:
> **T026** (`harness-watch` зовётся сам и разбирает блоки — звено P→RG→AP/RB схемы C) →
> **T027** (регресс-гейт правки харнесса — без него эволюция самообман) → **T028** (дифф судье
> файлом, не argv — практика `waggle`) → приёмка **T014** (живой блок в чужом проекте) →
> **T015** (итоговый замер против baseline на judge-bench).
> Цепочка гейта: `git add` файлы слайса → ОДНИМ вызовом `node tools/elt.js oracle && node
> tools/elt.js judge run --task Txxx --spec specs/011-elt-v3-gate && node tools/elt.js commit
> --task Txxx --spec specs/011-elt-v3-gate --skip-oracle -m "..."`.
> После правки `elt.js`/файла из `sync-bin.js` CLOSURE — `node tools/sync-bin.js` (+`cp
> tools/elt.js ~/.claude/bin/elt.js` для elt.js, он вне CLOSURE) ДО следующего `elt oracle`.
> После каждого коммита апрув протухает — `elt spec approve --spec specs/011-elt-v3-gate` +
> отдельный `docs:`-коммит, тем же паттерном, без переспроса.
> `node tools/doctor.test.js` и `node tools/elt-gate-l0.test.js` — script-style, гонять
> НАПРЯМУЮ (`node <file>`), НЕ через `node --test` (виснет).
