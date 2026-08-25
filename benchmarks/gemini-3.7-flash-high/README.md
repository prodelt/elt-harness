# gemini-3.7-flash-high — versioned, resume-safe benchmark contour

Замена ручному прогону из session scratchpad (T002, `specs/021-gemini-benchmark-release-readiness`).
Всё, что здесь есть, — код и preregistration; сырых результатов ещё нет, они появляются
только когда T003 реально исполнит оба эксперимента.

## Контур

| файл | роль |
| --- | --- |
| `preregistration.json` | protocol + `runner.sha256` + claim limits, заморожено ДО первого результата |
| `runner.js` | исполняет одну (задача, рука) пару, append-only JSONL, resume-safe, retry только на transport-отказ |
| `build-gate-dataset.js` | детерминированный сборщик датасета: `polyglot-writer` (30 задач) и `swebench-gate` (30 инстансов, gold+broken патч на каждый) |
| `summarize.js` | machine-generated `summary.json` + markdown таблица, Wilson 95% CI, `claimEligible` только когда ОБЕ руки терминальны на КАЖДОМ элементе |
| `runner.test.js` | 20 discriminating regressions — детерминизм отбора, anti-tamper guard, transport-vs-content retry, CI-математика; ни один тест не зовёт живого агента |

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

## Запуск (T003, не выполнялся в T002)

```powershell
node runner.js --dataset dataset-writer.json --hand plain --out raw-writer.jsonl --model gemini-3.7-flash-high
node runner.js --dataset dataset-writer.json --hand elt   --out raw-writer.jsonl --model gemini-3.7-flash-high
node summarize.js --dataset dataset-writer.json --log raw-writer.jsonl --hands plain,elt --out summary-writer.json
```

Прервать и перезапустить безопасно: `runner.js` пропускает (id, hand) пары, уже терминальные в
логе (`pendingItems`); `transport-failure` не терминален и будет ретраён следующим запуском.

## Инвалидация старых данных

`../results-v5.0.0.json` и `../preregistration-v5.0.0.json` (корень `benchmarks/`) помечены
`invalid-for-claim` в `preregistration.json.priorRuns` — 3 пары ниже порога directional claim,
прогнаны до появления hash-locked runner'а этого контура. Файлы не удалены (честная запись
directional pilot), но не входят и не могут входить в headline-числа T003/T004.

Черновой three-arm (worker/brain, Rust) дизайн из более ранней сессии остался в session
scratchpad и никогда не исполнялся (заблокирован auth/бюджетом) — не является частью этой
preregistration и не порождает данных ни в каком виде.
