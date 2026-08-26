# gemini-3.7-flash-high — versioned, resume-safe benchmark contour

Замена ручному прогону из session scratchpad (T002/T003, `specs/021-gemini-benchmark-release-readiness`).
`writer-plain-vs-elt` реально выполнен (30+30 живых вызовов `agy`, gemini-3.7-flash-high,
2026-08-25). `gate-bare-vs-judgeDiff` — не выполнен, см. «Известное ограничение» ниже; T003
оставлена открытой ([ ] в tasks.md), а не отмечена закрытой — честно неполна.

## Результат — writer-plain-vs-elt (30 пар, 2026-08-25)

| hand | pass/graded | pass rate [95% CI] | invalid | incomplete |
| --- | --- | --- | --- | --- |
| plain | 30/30 | 100.0% [88.6, 100.0] | 0 | 0 |
| elt | 30/30 | 100.0% [88.6, 100.0] | 0 | 0 |

`claimEligible=true` (`results.json`, `summary-writer.json`) — обе руки терминальны на всех 30
задачах, 0 transport failures (`transport-failures.jsonl` пуст), 0 guard-tamper (`invalid`).

**Что это доказывает:** тот же ceiling-эффект, что и v5.0.0 (3/3 против 3/3), но теперь на
статистически значимой выборке (Wilson 95% CI [88.6%, 100%] вместо ненадёжной 3-парной оценки) —
gemini-3.7-flash-high решает python-задачи `Aider-AI/polyglot-benchmark` этого уровня с первой
попытки в обеих руках, разницы между `plain` и `elt` в pass rate по построению быть не может
(primary endpoint не меняется гейтом, см. `preregistration.json.writerExperiment.protocol`).

**Чего не доказывает:** превосходства ELT в pass rate — тот же потолок, что и раньше, теперь
подтверждённый на 30 парах, а не 3. Overhead сертификации (время судьи поверх кода) не измерялся
в этом прогоне — вне primary endpoint этой preregistration.

## Контур

| файл | роль |
| --- | --- |
| `preregistration.json` | protocol + `runner.sha256` + claim limits, заморожено ДО первого результата |
| `runner.js` | исполняет одну (задача, рука) пару, append-only JSONL, resume-safe, retry только на transport-отказ |
| `build-gate-dataset.js` | детерминированный сборщик датасета: `polyglot-writer` (30 задач) и `swebench-gate` (30 инстансов, gold+broken патч на каждый) |
| `summarize.js` | machine-generated `summary.json` + markdown таблица, Wilson 95% CI, `claimEligible` только когда ОБЕ руки терминальны на КАЖДОМ элементе |
| `runner.test.js` | 24 discriminating regressions — детерминизм отбора, anti-tamper guard, transport-vs-content retry, CI-математика, реальный (не мокнутый) pytest-грейдер; живого агента зовёт только сам T003-прогон |

## Два эксперимента

**writer-plain-vs-elt** — 30 пар на `Aider-AI/polyglot-benchmark@7e0611e` (python), рука `plain`
(agy без харнеса) против `elt` (тот же агент, гейт поверх того же кода). Прямое масштабирование
протокола `../preregistration-v5.0.0.json` (3 пары → 30).

**gate-bare-vs-judgeDiff** — 30 SWE-bench инстансов, у каждого пара gold-патч (ожидание: принят)
и синтетический broken-патч (ожидание: отклонён) — механическая порча последнего hunk последней
секции диффа. Рука `bare` кормит оба патча grader'у напрямую; рука `judgeDiff` сперва прогоняет
`tools/judge-core.js`. Точный протокол ЭТОГО эксперимента не был зафиксирован текстом задачи T002
дословно — решения записаны в `preregistration.json.designDecisionsNotInTaskText` до первого
результата, не задним числом.

### Известное ограничение — gate-эксперимент не исполним прямо сейчас

Дата-сет и синтетический broken-патч для `gate-bare-vs-judgeDiff` строятся и тестируются
(`stripLastHunk`, `selectSweBenchInstances`), но у `runner.js` **нет реального грейдера** для
этого эксперимента — `graderFor('swebench-gate')` намеренно бросает ошибку вместо того, чтобы
подделать вердикт (`runner.test.js`: «throws a clear not-implemented error instead of faking a
verdict»). Причина по рукам:

* `bare-*` — нужен настоящий per-instance SWE-bench test harness (docker/venv на repo при
  `base_commit`, запуск `FAIL_TO_PASS`/`PASS_TO_FAIL`). Такого харнеса в этом репозитории нет.
* `judgeDiff-*` — нужен `tools/judge-core.js:judgeDiff()`, но его `checkGrounding` читает
  реальный git-статус и контекст задачи ELT в `cwd`; он рассчитан на дифф собственной задачи
  ELT, а не на произвольный внешний SWE-bench патч. Безопасная адаптация (или отдельная
  standalone diff-only точка входа для судьи) — самостоятельная задача, не однопроходная стыковка.

Инфраструктура датасета готова, чтобы эту работу можно было сделать отдельным слайсом. До тех
пор T003 реалистично исполняет только `writer-plain-vs-elt`.

## Воспроизведение (сборка датасета, БЕЗ прогона агента)

```powershell
node build-gate-dataset.js --kind polyglot-writer --repo <path-to-polyglot-benchmark-clone> `
  --lang python --ext py --count 30 --seed elt-021-writer-30-2026-08-26 --out dataset-writer.json

node build-gate-dataset.js --kind swebench-gate --instances <path-to-instances.jsonl> `
  --count 30 --seed elt-021-gate-30-2026-08-26 --out dataset-gate.json
```

Тот же repo/instances + count + seed обязаны дать байт-идентичный `dataset.json`
(`datasetSha256` совпадает) — это и есть детерминизм, не обещание, а проверяемое свойство
(`runner.test.js`).

## Запуск (как реально исполнено в T003)

```powershell
node runner.js --dataset dataset-writer.json --hand plain --out writer-results.jsonl --model gemini-3.7-flash-high
node runner.js --dataset dataset-writer.json --hand elt   --out writer-results.jsonl --model gemini-3.7-flash-high
node summarize.js --dataset dataset-writer.json --log writer-results.jsonl --hands plain,elt --out summary-writer.json
```

Прервать и перезапустить безопасно: `runner.js` пропускает (id, hand) пары, уже терминальные в
логе (`pendingItems`); `transport-failure` не терминален и будет ретраён следующим запуском. В
реальном прогоне ретраев не понадобилось — 0 transport failures на 60 вызовов.

`results.json` — канонический выход: `writer` (полный `summary-writer.json` внутри) +
`gate` (`status: not-run` с причиной) + `claimEligibleOverall` (false — T003 просила ОБА
эксперимента, выполнен один). `checksums.sha256` — sha256 всех файлов-свидетельств.

## Инвалидация старых данных

`../results-v5.0.0.json` и `../preregistration-v5.0.0.json` (корень `benchmarks/`) помечены
`invalid-for-claim` в `preregistration.json.priorRuns` — 3 пары ниже порога directional claim,
прогнаны до появления hash-locked runner'а этого контура. Файлы не удалены (честная запись
directional pilot), но не входят и не могут входить в headline-числа T003/T004.

Черновой three-arm (worker/brain, Rust) дизайн из более ранней сессии остался в session
scratchpad и никогда не исполнялся (заблокирован auth/бюджетом) — не является частью этой
preregistration и не порождает данных ни в каком виде.
