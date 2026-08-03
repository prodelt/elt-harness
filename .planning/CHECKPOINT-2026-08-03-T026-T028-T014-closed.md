# CHECKPOINT 2026-08-03 — T026, T027, T028, T014 закрыты

Предыдущий: `.planning/CHECKPOINT-2026-08-03-T021-T024-T025-closed.md`.
Ветка `feature/judge-bench-parallel-oracle`, HEAD **`e32d222`** (+ этот чекпоинт). Режим: соло.

## Что закрыто

**T026 — `4e911bb`.** `harness-watch` зовётся сам из `elt commit` (после записи run-log,
тихо — сбой не валит коммит) + новый детектор `block-pattern`: 3+ блока с одним источником
(`classifyBlockSource` из T022, переиспользован, не задублирован) или одним L0-триггером в
окне → инцидент в `health.jsonl`. Деплой-фолбэк тем же паттерном, что у L0 (T017):
`~/.claude/bin/harness-watch.js` — ручной сосед `elt.js`, как `elt-stats.js`/`elt-config.js`.
Интегральный тест реально спавнит `judge run` (3× block + 1× pass) + `commit`, проверяет
живой `health.jsonl`.

**T027 — `c26dc2a`.** `elt harness propose`: правка судьи/гейта обязана нести
evidence+rootCause+predictedImpact (дёшево, без сети — правка без них отвергается ДО вызова
judge-bench) и пройти judge-bench (T023) против baseline (`.planning/JUDGE-BENCH-*.json`,
самый свежий по mtime, либо явный `--baseline`). Не улучшила recall/FPR → `rejected` в
`.harness/learnings.jsonl`, улучшила → `accepted`. `runBench` инъецируется (как `runTests` у
elt-mutate.js/T008) — тесты не бьют по реальному судье. **Гочта сессии:** `elt.js` — плоский
синхронный скрипт с безусловным `process.exit()` в хвосте; async-ветка (`.then()`) проигрывала
гонку с этим хвостом и падала на usage вместо ответа — блок пришлось сделать ПОСЛЕДНИМ в файле,
обернув старый хвост в `else`.

**T028 — `e0cb3c5`.** Промпт судье-agy — файлом (`.harness/fleet/prompts/<uuid>.txt`), не
argv: `-p` теперь несёт короткую ссылку-инструкцию вместо самого промпта. Снимает
`spawn ENAMETOOLONG` на живом диффе (DIFF_CAP 60K бьёт о лимит длины командной строки Windows
раньше самого капа, T017б лечила только симптом failover'ом). Тест — argv <2000 символов на
промпте >200K, файл несёт полный текст побайтово.

**T014 — `cd07c6d` + `e32d222`, приёмка живьём.** Живой блок/pass в
`C:/Ametrin projects/Задача фузи музи` (Ametrin Web) через ГЛОБАЛЬНЫЙ резолв моста
(`~/.claude/bin/elt.js` + `~/.claude/bin/judge/*`), без локального checkout tools/.
Судья — **agy** (не Claude, R3 спеки 010) на block, **codex** на промежуточном прогоне.

Живьём найдены и починены ДВА побочных дефекта T028 (dogfood, ровно как T017/T018/T021 раньше):
1. **`cd07c6d`** — `treeHash()` в `elt.js` не игнорил новый `.harness/fleet/prompts/`: в
   ЭТОМ репо каталог гитигнорен, но в ЛЮБОМ ДРУГОМ проекте — нет, и untracked prompt-файл
   agy сдвигал treeHash между `oracle` и `judge-proof write` → честный судья получал ложный
   `stale oracle proof`. Фикс — та же allowlist-функция `runtimeLog()`, что уже игнорит
   `.harness/loop-logs/`/`.harness/fleet/logs/`, расширена на `.harness/fleet/prompts/`.
2. **`e32d222`** — тот же корень, другая точка: `.harness/fleet/` (логи ВСЕХ провайдеров,
   не только agy-промпты) без гитигнора в целевом проекте виден `git status`/`ls-files
   --exclude-standard` как untracked → судья реально ПОЛУЧАЛ его как «файл диффа» и вписывал
   в grounding (живой пример: `filesReviewed: [".harness/fleet/", "..."]`). Фикс —
   `providers.js` теперь сам пишет `.harness/fleet/` в `.git/info/exclude` целевого репо при
   первом обращении (`gitExcludeFleet()`, тот же приём, что `gitExclude()` в elt.js для
   `parked.json`) — не полагается на то, что КАЖДЫЙ проект помнит добавить строку в свой
   `.gitignore`.

Оба фикса закоммичены как `--task T014 --keep-task-open` (T014 сама без `[files:]` — это
приёмка, не слайс кода; чекбокс не трогался до самого конца).

### Пруф — `.git/elt/run-log.jsonl` проекта Ametrin Web

```
18:42:25 T005 l0-clean  pass   (ДО дефекта: диф ещё не задевал .harness/fleet/, случайно чисто)
18:57:20 T005 judge-block block  agy/gemini-3.6-flash-high — ослабленный tests/test_api.py
                                 ("assert 'columns' in data" → "assert data is not None"),
                                 триггер existing-test-modified, судья поймал и ослабление,
                                 и scope creep, живой ENAMETOOLONG-класс НЕ всплыл (T028 держит)
19:02:25 T005 judge-block block  codex/gpt-5.6-sol — тот же чистый диф, судья честно прочитал
                                 self-declared "не несёт продуктового содержания" в пробной
                                 заметке и заблокировал как невыполнение задачи (до фикса
                                 e32d222 grounding видел ".harness/fleet/" мусором)
19:11:09 T005 l0-clean  pass   (ПОСЛЕ обоих фиксов, чистый диф строго в [files: .planning/])
```

Тест-файл `tests/test_api.py` и пробная заметка `.planning/MEASUREMENTS-2026-08-03-T014-gate-probe.md`
откачены после проверки — рабочее дерево Ametrin Web чистое, продуктовый код не тронут (условие
AC12: правки ограничены `smoke.py`/`.harness/harness.json`, оба — T018, T014 их не трогала).

## Состояние

- Дерево этого репо чистое. Открытых слайсов 011: **1** — T015 (итоговый замер против baseline).
- Деплой синхронизирован: `~/.claude/bin/elt.js`, `~/.claude/bin/harness-watch.js`,
  `~/.claude/bin/judge/*` (11 файлов, CLOSURE) — все актуальны на HEAD `e32d222`.
- `sync-bin.js` CLOSURE не менялся (11 файлов, как после T025).

## Resume Prompt

> Продолжаю Pipeline Setupper, ветка `feature/judge-bench-parallel-oracle`, HEAD `e32d222`
> (+ этот чекпоинт). Читай `.planning/CHECKPOINT-2026-08-03-T026-T028-T014-closed.md`.
> T026/T027/T028/T014 закрыты. Остался последний слайс спеки 011:
> **T015** — итоговый замер против baseline: `elt stats` + judge-bench числа против
> 77%/100%/185c baseline (T022/T023 дали инструменты, T015 сводит их в
> `.planning/GATE-011-VERDICT.md` + `tools/gate-verdict.test.js`). Предусловия T022/T023 уже
> закрыты. После T015 — спека 011 закрыта целиком.
> Цепочка гейта: `git add` файлы слайса → ОДНИМ вызовом `node tools/elt.js oracle && node
> tools/elt.js judge run --task T015 --spec specs/011-elt-v3-gate && node tools/elt.js commit
> --task T015 --spec specs/011-elt-v3-gate --skip-oracle -m "..."`.
> **Критично (T027 гочта):** если правишь `tools/elt.js` — новый top-level async-код клади
> ПОСЛЕДНИМ блоком файла (перед хвостовым usage-принтером, обёрнутым в `else`), иначе
> `process.exit()` в хвосте выигрывает гонку с `.then()`.
> После правки `elt.js`/файла из `sync-bin.js` CLOSURE — `node tools/sync-bin.js` (+`cp
> tools/elt.js ~/.claude/bin/elt.js`, он вне CLOSURE) ДО следующего `elt oracle`. `elt.js`
> теперь также требует `harness-watch.js` рядом в деплое (T026) — синхронизируй вручную, как
> `elt-stats.js`/`elt-config.js`/`run-log.js`.
> **НЕ смешивать слайсы в одном коммите** (гочта этой сессии — T026/T027/T028 трижды ловились
> судьёй на scope creep, потому что следующий слайс начинался, пока фоновый гейт предыдущего
> ещё бежал): дожидаться `elt commit` текущего слайса ПЕРЕД началом кода следующего, не просто
> перед его коммитом.
