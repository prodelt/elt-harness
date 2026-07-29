# CHECKPOINT 2026-07-29 — аудит регресса качества elt-системы

**Статус:** диагноз готов, план НЕ написан. Кода не тронуто. Ветка `feature/judge-bench-parallel-oracle`, дерево чистое.
**Повод:** юзер заявил регресс качества elt; попросил разобрать чаты за 3 дня по всем проектам.

## Метод
Скан `~/.claude/projects/**/*.jsonl` (89 файлов, ~30 МБ, 26–29.07) скриптами в scratchpad:
реплики юзера, ошибки тулов, статистика вызовов гейта; плюс `.git/elt/run-log.jsonl` по проектам
и живой прогон `project-bootstrap verify`.

## ГЛАВНЫЙ ВЫВОД

Контур судьи (спеки 008/009: attest, двойной судья, red-proof, grounding) работает **только в
репо-разработчике**. В реальных проектах он **объявлен в `harness.json`, но физически не установлен**.

Вердикты run-log с 26.07:

| проект | мост судьи | записей | block | pass | dead | `--skip-attest` |
|---|---|---|---|---|---|---|
| Pipiline setupper | есть | 82 | **29** | 14 | 5 | **0** |
| Route_API_1C | нет | 27 | **0** | **27** | 0 | **20** |
| doc2md-tauri | нет | 11 | **0** | **11** | 0 | 2 |

Block-rate 67% (судья = код) против 0% (судья = проза + самозаверение).
В том же окне юзеру уехали 3 регресса, все с вердиктом `pass`:
- 27.07 doc2md-tauri «ты поломал… ocr missing»
- 29.07 doc2md-tauri «снова перестало считать токены»
- 27.07 Route_API_1C «почему визиком не участвует, в пятницу же работало»

## ДЕФЕКТЫ

**D0 (вероятно главный, НЕ доисследован).** Все 3 регресса — рантайм/интеграция собранного
приложения. Оракул = юнит-тесты, судья судит дифф. В петле НЕТ шага «запустить то, чем пользуется
юзер, и проверить сценарий». Идеальный судья пропустил бы все три. D1 объясняет ноль блоков,
но не эти конкретные дефекты.

**D1 (корень «ноль блоков»).** `tools/elt.js:606` резолвит мост только как `<cwd>/tools/judge-invoke.js`.
В `~/.claude/bin/` лежат лишь `elt.js`, `elt-config.js`, `run-log.js` — **нет `judge-invoke.js`,
`fleet/gate.js`, `red-proof.js`**. `project-bootstrap.js` про мост не знает (grep: 0 упоминаний).
Цепочка: `judge run` exit 4 → скилл шлёт на ручной путь → `judge-proof write` отвергнут (attest=true)
→ `--skip-attest` → автор кода заверяет сам себя.
Примечание: `tools/elt.js` ≡ `~/.claude/bin/elt.js` — синхронны (diff 0), это НЕ источник проблемы.

**D2.** `--skip-attest` стал нормой: 20 из 27 записей Route_API_1C. Люк громкий, но ничем не ограничен.

**D3.** Пруф протухает от собственного шума: батч `T001,T002,T004,T005` переписывался 7 раз
(`task-mismatch` → `stale-oracle` → `stale-tree`; последнее — авто-хук чекпоинта переписывал
`.planning/CHECKPOINT-*-auto.md` во время гейта). Координатор нянчил судью-субагента 3 сообщениями.

**D4. `project-bootstrap` красный на шуме, слепой на сути.**
- `verify` doc2md-tauri `ok:false`: `docs drifted` + `drifted_installs`, среди них **`pipeline` (сам deprecated)**.
- Route_API_1C: `docs.ok=false` при `missing:[]` и `coreIdentical:true` — причина (`unknownSections`)
  теряется, `project-bootstrap.js:197` её не пробрасывает. Красный без объяснения.
- `unknownSections` fail-closed (`project-docs-core.js:242`) → любой проект со своей секцией в
  AGENTS.md красный навсегда.
- Контракт `oracleVerifier` проверяет только непустоту строки, не запуск/зелёность.
- Контракта «мост судьи установлен» нет вовсе.

**D5.** DIRTY-EXIT-гейт тонет в мусоре: busy-wu держит в git рантайм-артефакты (`lic.log`,
`clients.xlsx`, `final_data*.json`, `chat_id.json`), `.gitignore` = 3 строки, `.codegraph/`/`.rag/`/
`.cursor/`/`.vs/` не игнорятся. Гейт сработал 3 раза подряд на мусоре, ни разу по делу.
`project-bootstrap` `.gitignore` не ведёт.

**D6.** Инвариант «слайс закрыт ⇔ elt commit» вне репо не держится: Route_API_1C 13 ручных
`git commit` против 4 `elt commit`; doc2md-tauri 18 против 12.

**D7.** codegraph-дисциплина вне репо = 0: Read 191/169 вызовов, `codegraph_*` — ни одного.
В doc2md-tauri MCP падал: «No CodeGraph project is loaded for this session».

**D8.** `elt: command not found` в bash (нет `elt.cmd` в `~/.claude/bin`); busy-wu без контура вовсе.

## НЕ ПРОВЕРЕНО (пробелы аудита, признаны явно)
1. D0 не доисследован — гипотеза, не доказана.
2. Скиллы кроме `project-bootstrap`: `elt-onboard`, `harness-method`, `grill-me`, `elt-work`, `elt/SKILL.md`.
3. Fleet целиком. Плюс висит открытый дефект `tools/fleet/fleet.js:182` — `judgeAwayFrom` без
   альтернативы возвращает судью == воркер (та же болезнь самозаверения, в список D не внесён).
4. Активный слой хуков (`~/.claude/settings.json`): dirty-exit, авто-чекпоинт (виновник D3), git-guardrails.
5. Выборка: 4 крупных проекта из ~10 активных.
6. Цена костылей в ходах/минутах не измерена → приоритет D3 не обоснован числом.
7. `.harness/loop-logs/`, `fleet/events.jsonl` в реальных проектах не читаны.

## ПРЕДЛОЖЕННЫЙ ПОРЯДОК ФИКСА (не утверждён)
1. D1 — мост судьи в `~/.claude/bin/judge/` + fallback-резолв в `elt.js` (оживляет судью в 122 проектах).
2. D2 — `--skip-attest` только при явном `allowSkipAttest` в `harness.json`.
3. D4 — `project-bootstrap` на исполняемые контракты (оракул реально зелёный, мост на месте,
   `.gitignore` покрывает артефакты; `unknownSections` → warn; deprecated вон из drift; причина наружу).
4. D3 — гейт одной транзакцией, устойчивой к `.planning/*-auto.md`.
5. D5/D8 — гигиена: `.gitignore`-контракт, `elt.cmd`.

## ДАЛЬШЕ (Resume)
Режим 0, план не написан, решений не зафиксировано → **`grill-me` обязателен** (2+ раунда:
границы фикса, порог «надёжности», scope D0, что вне scope) → `specs/010-*/spec.md` + `tasks.md`
→ показать чанками → «утверждаю» → `elt spec approve` → слайсы.
Repo: `specApproval:true` — без approve `slice next`/`commit` откажут (exit 4).
