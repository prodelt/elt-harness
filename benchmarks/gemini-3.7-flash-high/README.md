# gemini-3.7-flash-high — versioned, resume-safe benchmark contour

Замена ручному прогону из session scratchpad (T002/T003, `specs/021-gemini-benchmark-release-readiness`).
Оба эксперимента выполнены живьём: `writer-plain-vs-elt` (30+30 вызовов `agy`, 2026-08-25) и
`gate-bare-vs-judgeDiff` (60 клеток, 60 вызовов судьи, 2026-08-26).

**Короткий ответ на вопрос «есть ли разница с харнесом и без него»: в писателе — нет, в гейте —
есть.** Это два разных места конвейера, и мерить их одним числом нельзя.

## Результат — writer-plain-vs-elt (30 пар, 2026-08-25)

| hand | pass/graded | pass rate [95% CI] | invalid | incomplete |
| --- | --- | --- | --- | --- |
| plain | 30/30 | 100.0% [88.6, 100.0] | 0 | 0 |
| elt | 30/30 | 100.0% [88.6, 100.0] | 0 | 0 |

`claimEligible=true` — обе руки терминальны на всех 30 задачах, 0 transport failures, 0 guard-tamper.

**Что это доказывает:** тот же ceiling-эффект, что и v5.0.0 (3/3 против 3/3), но теперь на
статистически значимой выборке (Wilson 95% CI [88.6%, 100%]) — gemini-3.7-flash-high решает
python-задачи `Aider-AI/polyglot-benchmark` этого уровня с первой попытки в обеих руках, и
разницы в pass rate по построению быть не может (гейт не меняет промпт, см.
`preregistration.json.writerExperiment.protocol`).

**Чего не доказывает:** превосходства ELT в pass rate. Задачи слишком лёгкие, чтобы что-то
различить. Отрицательный результат записан как отрицательный.

## Результат — gate-bare-vs-judgeDiff (30 инстансов × 2 патча, 2026-08-26)

Preregistration: [`preregistration-gate.json`](preregistration-gate.json), заморожена ДО первой
строки `gate-results.jsonl`. Сводка машинная — [`summary-gate.json`](summary-gate.json).

| arm | correct/cells | accuracy [95% CI] | природа |
| --- | --- | --- | --- |
| bare | 30/60 | 50.0% | аналитическая (гейта нет — пропускает всё) |
| judgeDiff | 51/60 | **85.0% [73.9%, 91.9%]** | измерено, 60 живых вызовов |

| режим отказа судьи | сколько | цена |
| --- | --- | --- |
| fail-open (broken пропущен) | **9/30** | битый патч уехал бы в main |
| false-block (gold отклонён) | **0/30** | верная работа остановлена |
| вызовов модели | 60 | латентность p50 21,0 с / p90 25,3 с |

`claimEligible=true` — 60/60 клеток измеряемой руки терминальны, 0 transport failures,
0 guard-tamper, 0 `inconclusive`.

**Что это доказывает:** на многохунковых патчах SWE-bench Verified гейт ELT ловит 21 битый
патч из 30, **не отклонив при этом ни одного верного**. Нижняя граница CI (73,9%) лежит выше
аналитических 50% руки без гейта, поэтому directional claim здесь законен — в отличие от
writer-плеча.

**Чего не доказывает:** ничего про долю решённых задач. Тесты SWE-bench не запускались ни в
одной руке (см. отклонение ниже). Это замер РАЗЛИЧАЮЩЕЙ способности гейта, а не resolve rate.

**Где гейт слеп — поимённо.** Все 9 fail-open — случаи, где урезанный патч остался связным и
читается как законченная работа: `astropy-8707`, `astropy-8872`, `seaborn-3187`,
`requests-2931`, `pylint-4661`, `pytest-7236`, `scikit-learn-11310`, `sphinx-9461`,
`sympy-14531`. Судья сверяет дифф с постановкой задачи, и когда снесённый hunk был вторичным
случаем или тестом, оставшийся код честно выглядит решением. Это ровно та архитектурная дыра,
которая записана незакрытой в корневом README: судья судит против задания, а не против внешней
реальности.

`inconclusive` не встретился ни разу, поэтому спорное решение «`inconclusive` = accept» на этих
данных ни на что не повлияло — но оно всё равно зафиксировано в preregistration, потому что
влияло бы на другой выборке.

## Отклонения от замороженной регистрации — читать до цитирования чисел

`preregistration.json#gateExperiment` заморожен (в `writer-results.jsonl` уже были результаты) и
описывает gate-эксперимент в форме, неисполнимой в этом репозитории. Вместо переписывания
замороженного файла заведена отдельная, СУЖАЮЩАЯ регистрация — `preregistration-gate.json`.
Каждое отклонение сужает claim, ни одно не расширяет:

1. **Рука `bare` аналитическая, а не измеренная.** Настоящий grader требует per-instance
   SWE-bench окружения (docker на репозиторий при `base_commit`, прогон `FAIL_TO_PASS`) —
   его здесь нет. «bare» = «гейта нет», а конвейер без гейта пропускает любой патч по
   определению; каждая строка помечена `analytic: true`. **Цена: resolve rate исчезает из
   эксперимента совсем.**
2. **Одно-hunk инстансы исключены из выборки.** `stripLastHunk` сносит у них всю секцию файла,
   и негатив вырождается в ПУСТОЙ дифф. На первой сборке таких оказалось **9 из 30** — 30%
   негативного плеча судья отверг бы даром, не читая. Фильтр введён до первого результата.
   **Цена: вывод относится к многохунковым патчам, а не ко всем.**
3. **Headline считается по 2N клеткам обеих половин вместе.** Гейт, отвергающий всё подряд,
   даёт 100% на broken-половине и 0% на gold — только объединённое число это показывает
   (`gate-runner.test.js`: «a judge that blocks EVERYTHING does not score above bare»).
4. **Судья не адаптировался под бенчмарк.** Прежняя запись «judgeDiff не адаптирован под внешний
   дифф, `checkGrounding` читает живой git-статус» была неверна про код: `judgePrompt()` не
   читает диск, а `status` и `diff` — параметры. Единственная правка в `tools/judge-core.js` —
   экспорт `judgeDiffRetryNoReasons` (гейт зовёт судью через него, значит и замер обязан).
   Промпт судьи не менялся, включая формулировки про слайс — измеряется гейт, который реально
   стоит в ELT, а не идеализированный судья.

Замороженный `preregistration.json#gateExperiment` остаётся в силе как **неисполненный**: то,
что сделано здесь, его не заменяет и не закрывает.

## Контур

| файл | роль |
| --- | --- |
| `preregistration.json` | protocol + `runner.sha256` writer-эксперимента, заморожено ДО первого результата |
| `preregistration-gate.json` | то же для gate-эксперимента + список отклонений и границ claim |
| `runner.js` | одна (задача, рука) пара writer-эксперимента, append-only JSONL, resume-safe |
| `gate-runner.js` | одна (инстанс, рука) клетка gate-эксперимента; отдельный файл, чтобы не ломать hash-lock уже завершённого writer-прогона |
| `build-gate-dataset.js` | детерминированный сборщик: `polyglot-writer` (30 задач) и `swebench-gate` (30 инстансов, gold+broken на каждый) |
| `export-swebench.py` | чистая конверсия HF-кеша SWE-bench Verified в `instances.jsonl` — без отбора и фильтрации |
| `summarize.js` / `gate-summarize.js` | машинные сводки, Wilson 95% CI, `claimEligible` |
| `runner.test.js` (26) / `gate-runner.test.js` (24) | discriminating regressions; живого агента не зовёт ни один |

Тесты этого каталога с 021/T003 входят в механический оракул (`TEST_ROOTS` третьим корнем) —
до этого они не гонялись ни разу ни на одном коммите.

## Воспроизведение

```powershell
# 1. датасеты (агент не вызывается)
python export-swebench.py <hf-cache>\swe-bench_verified-test.arrow instances.jsonl
node build-gate-dataset.js --kind swebench-gate --instances instances.jsonl `
  --count 30 --seed elt-021-gate-30-2026-08-26 --out dataset-gate.json
node build-gate-dataset.js --kind polyglot-writer --repo <polyglot-clone> `
  --lang python --ext py --count 30 --seed elt-021-writer-30-2026-08-26 --out dataset-writer.json

# 2. writer-эксперимент (60 вызовов агента)
node runner.js --dataset dataset-writer.json --hand plain --out writer-results.jsonl --model gemini-3.7-flash-high
node runner.js --dataset dataset-writer.json --hand elt   --out writer-results.jsonl --model gemini-3.7-flash-high
node summarize.js --dataset dataset-writer.json --log writer-results.jsonl --hands plain,elt --out summary-writer.json

# 3. gate-эксперимент (60 вызовов судьи; bare-руки бесплатны)
node gate-runner.js --dataset dataset-gate.json --hand bare-gold         --out gate-results.jsonl
node gate-runner.js --dataset dataset-gate.json --hand bare-broken       --out gate-results.jsonl
node gate-runner.js --dataset dataset-gate.json --hand judgeDiff-gold    --out gate-results.jsonl --model gemini-3.7-flash-high --timeout-ms 480000
node gate-runner.js --dataset dataset-gate.json --hand judgeDiff-broken  --out gate-results.jsonl --model gemini-3.7-flash-high --timeout-ms 480000
node gate-summarize.js --dataset dataset-gate.json --log gate-results.jsonl --out summary-gate.json
```

Тот же источник + count + seed обязаны дать байт-идентичный `dataset.json` — это проверяемое
свойство, а не обещание (`runner.test.js`, `gate-runner.test.js`). `datasetSha256` gate-выборки —
`db914ad41dcb…`, зафиксирован в `preregistration-gate.json`.

Прервать и перезапустить безопасно: обе руны пропускают (id, hand) с терминальным результатом;
`transport-failure` не терминален и ретраится следующим запуском. В обоих прогонах ретраев не
понадобилось — 0 transport failures на 120 вызовов.

`results.json` — канонический выход (обе сводки внутри + `claimEligibleOverall`).
`checksums.sha256` — sha256 всех файлов-свидетельств. `dataset-gate.json` не версионируется
(содержит патчи SWE-bench); его хеш записан в обоих местах.

## Инвалидация старых данных

`../results-v5.0.0.json` и `../preregistration-v5.0.0.json` помечены `invalid-for-claim` в
`preregistration.json.priorRuns` — 3 пары ниже порога directional claim, прогнаны до появления
hash-locked контура. Файлы не удалены (честная запись directional pilot), но не входят и не
могут входить в headline-числа.

Черновой three-arm (worker/brain, Rust) дизайн из более ранней сессии никогда не исполнялся
(заблокирован auth/бюджетом) — данных не порождает ни в каком виде.
