# CHECKPOINT 2026-08-01 — T018: L2 включён живьём, оба прогона приложены

Предыдущий: `.planning/CHECKPOINT-2026-08-01-T018-approved-resume-impl.md`.
Ветка `feature/judge-bench-parallel-oracle`, база `324e0ea`.
Проект приёмки — `C:/Ametrin projects/Задача фузи музи` (Ametrin Web, Flask).

## Что сделано

**В их репо** (коммит `1cc930e` на их ветке `feat/004-silent-false-pairs`; `elt commit` чужой
репо не коммитит — закрыто вручную, как и планировалось):
- `smoke.py` — поднимает НАСТОЯЩИЙ WSGI-сервер (`werkzeug.make_server`, порт `0`, чтобы не
  драться с живым сервером на 5000) и проходит `/api/health` → `/api/validate-columns` →
  `/api/run-step` (шаг 1, ETL без AI) → поллинг `/api/logs/<sid>`; проверяет `exit_code == 0`,
  наличие `output_file` и артефакт `step1_filtered.parquet`. Продуктовый код не тронут.
- `.harness/harness.json` — поле `smoke`, гоняется венвовым питоном (тем же, которым сервер
  стартует человек через `start_server.bat`).

**У нас**: контракт-тест в `tools/fleet/fleet.test.js` — красный smoke валит fleet-гейт на
стадии `oracle`, т.е. воркеры слой проходят (см. ниже, чем это опровергает прошлый чекпоинт).

## Прогон 1 — зелёный (`node elt oracle`, exit 0)

```
======================= 113 passed in 214.24s (0:03:34) =======================
elt oracle: exit 0 (217s)
elt smoke: $env:PYTHONIOENCODING='utf-8'; $env:PYTHONUTF8='1'; .\venv\Scripts\python.exe smoke.py
smoke: сервер поднят на http://127.0.0.1:65369
smoke: файл принят → effb9e8a-ce4e-4471-b949-3060b7620e46.xlsx
  | ▶ Запуск скрипта: etl_pipeline.py (таймаут: 10 хв)
  | Усього рядків (raw): 38
  | Після фільтрації: 29 рядків
  | Записуємо 29 рядків → ...\data\output\step1\step1_filtered.parquet ...
  | ✅ Parquet записано успішно (0 МБ)
  | 🔍 Знайдено файл результату: step1_filtered.parquet
  | ✅ Крок 1 (фільтрація) завершено за 0.0s
smoke: OK — step1_filtered.parquet, 14756 байт
elt smoke: exit 0
```

Цена слоя — **~4 c** поверх 217 c оракула (1.8%). Зелёный smoke прогону не мешает.

## Прогон 2 — красный (входной файл убран, `node elt oracle`, exit 1)

```
======================= 113 passed in 252.62s (0:04:12) =======================
elt oracle: exit 0 (254s)
elt smoke: $env:PYTHONIOENCODING='utf-8'; $env:PYTHONUTF8='1'; .\venv\Scripts\python.exe smoke.py
SMOKE FAIL: нет входного файла: C:\...\Файлі для теста\34078368_PK — test.xlsx
elt smoke: exit 1
ORACLE_EXIT=1
```

`.harness/oracle-tail.log` (хвост — smoke уехал в ТОТ ЖЕ отчёт):

```
======================= 113 passed in 252.62s (0:04:12) =======================

--- smoke: $env:PYTHONIOENCODING='utf-8'; $env:PYTHONUTF8='1'; .\venv\Scripts\python.exe smoke.py (exit 1) ---
SMOKE FAIL: нет входного файла: C:\...\Файлі для теста\34078368_PK — test.xlsx
```

**Это и есть D0 на живом проекте**: 113 юнит-тестов зелены, продукт красный, гейт красный.
Входной файл возвращён на место, дерево их репо чистое.

## Опровергнуто (не догадка, а прогон)

Прошлый чекпоинт утверждал, что fleet-путь smoke не проходит. Неверно: `gate.js` спавнит
`node <elt> oracle`, а `runSmoke` живёт ВНУТРИ `runOracle` (`elt.js:362`). Контракт-тест
`T018: красный smoke валит fleet-гейт на стадии oracle` это фиксирует поведением (реальный
`elt.js`, реальный `harness.json`), чтобы догадка не вернулась ценой ещё одного слайса.
`node --test tools/fleet/fleet.test.js` → 25 pass / 0 fail.

## Осталось по роадмапу 011

- judge-bench на `claude/sonnet` + исторические блоки в набор (сейчас 3 pass-кейса, FPR
  неизмерим).
- **T014** — приёмка в том же проекте.
- **T015** — итоговый замер против baseline (77% / 100% / 185 c). В вердикт идёт измерение
  29.07 как есть: **N=2 из 3**, OCR-регресс этим слоем неловим by design.

## Гейт в НАШЕМ репо: `block` по `red-proof:green` — слайс не закоммичен

Цепочка (`oracle → judge run → commit`, судья `claude/sonnet`):

- оракул — `15/15 passed in 102.5s`, exit 0 (impact-выборка 15/68 файлов);
- судья — **`pass`**, 57 c, 5 обоснованных причин: обошёл дифф, прочитал `tools/elt.js` и
  `tools/fleet/gate.js` и подтвердил, что `gate.js` спавнит `node <elt> oracle`, а `runSmoke`
  зовётся внутри `runOracle`; `existing-test-modified` признал ложным срабатыванием на уровне
  файла (дифф — чистое добавление, `@@ -873,3 +873,20 @@`);
- **red-proof — `green` / `passes-on-base` → вердикт перевёрнут в `block`**, `elt commit` exit 4.

**Это не сбой, а верный ответ слоя.** Продукт T018 лежит в ЧУЖОМ репо (`smoke.py` +
их `harness.json`), поэтому в диффе НАШЕГО репо остаётся только контракт-тест — а он по
устройству характеризующий: фиксирует поведение, которое уже верно, и потому зелен на базе.
Люк `external-subject` (`red-proof.js:82`) заточен на `os.homedir()` в тексте теста; предмет
моего теста — `gate.js`/`elt.js`, файлы ЭТОГО дерева, так что люк не применяется и применяться
не должен.

Варианты для следующей сессии (в порядке лени):
1. **Снять контракт-тест из слайса** — тогда в диффе нет тест-файлов, red-proof даёт
   `no-test-files` → `skipped`, и T018 (чекпоинт + `[X]`) проходит. Тест доехать может
   попутчиком в любом будущем слайсе, который реально меняет fleet-путь. Сам тест написан,
   зелёный (`node --test tools/fleet/fleet.test.js` → 25 pass), лежит в дереве.
2. **Расширить признак «предмет вне репо»** в `red-proof.js` (например: `[files:]` задачи
   содержит абсолютные внешние пути ⇒ слой неприменим) — но это правка вне `[files:]` T018,
   т.е. отдельный слайс со своей рубрикой.

Люка самозаверения нет (удалён 011/T011) — обойти гейт нечем, и это правильно.

## Гочта, стоившая одного прогона судьи

`elt judge run --task T018` БЕЗ `--spec` привязался к `specs/006-elt-front-gate/tasks.md`
(там свой открытый T018) и выдал блок «дифф не делает live-fire нового цикла». Id уникальны
внутри спеки, но не между спеками. Для 011 всегда: `--spec specs/011-elt-v3-gate`.
**T014 и T015 — та же ловушка**, проверить перед прогоном.

## Resume Prompt

> Продолжаю Pipeline Setupper, ветка `feature/judge-bench-parallel-oracle`, база `324e0ea`.
> Читай `.planning/CHECKPOINT-2026-08-01-T018-live-smoke.md`.
> T018 сделан живьём (их репо — коммит `1cc930e`, оба прогона оракула приложены), но в НАШЕМ
> репо слайс не закоммичен: red-proof `green` на характеризующем контракт-тесте. Реши по
> варианту 1 (снять тест из слайса) и закрой T018.
> Дальше по роадмапу: judge-bench на `claude/sonnet`
> (`node tools/judge-bench.js --provider claude --model sonnet --concurrency 3`) + пополнить
> `tools/judge-bench/cases.js` pass-кейсами из реальных исторических ложных блоков
> (`.git/elt/run-log.jsonl`: 52 блока; кандидаты — авто-чекпоинт `.planning/CHECKPOINT-*-auto.md`,
> засчитанный как scope creep 24.07, и обрезанный до 800 символов дифф 29.07, который по 011
> должен давать `inconclusive`, а не `block`); затем T014 и T015.
> Все вызовы `elt` по 011 — с `--spec specs/011-elt-v3-gate`. Судья `--provider claude --model sonnet`.
