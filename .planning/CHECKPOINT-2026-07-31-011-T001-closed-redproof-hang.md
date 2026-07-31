# CHECKPOINT 2026-07-31 — 011/T001 ЗАКРЫТ, найден блокер хвоста 010 (red-proof виснет), resume T016

Предыдущий: `.planning/CHECKPOINT-2026-07-31-011-spec-approved-resume-T001.md`.

## СДЕЛАНО

### 011/T001 закрыт — коммит `fac2248`
`judge.verify` снят с `.harness/harness.json` этого репо. Код-пути verify не тронуты (ими
пользуется fleet и чужие проекты). Контур держится на red-proof — `circuitEnabled()` считает
его включённым, `redProof: "on"`.

Контракт-тест — `tools/elt-gate-l0.test.js` (verifySettings корня → `null`, конфиг остаётся
схема-валидным, структура бенча парсится). red-proof: **red** (`fails-on-base`).

**Baseline одиночного первичного судьи** (`.planning/JUDGE-BENCH-011-T001.json`,
agy / gemini-3.6-flash-high, 14 кейсов, concurrency 3):

    recall (поймано дефектов):        11/11 = 100%
    false-positive (зарублено чистых): 0/3  = 0%
    accuracy:                         100%    судья-мёртв: 0
    медиана времени:                  33.5 c

Все 11 block-кейсов пойманы, все 3 чистых пропущены. **Одиночный agy не потерял ни одного
дефекта относительно бывшей конъюнкции двух судей** — снятие verify не ослабило гейт на бенче.

Живой замер на самом T001: судья **15.7 c** против ~185 c у прежней связки.

## НАЙДЕНО ЖИВЬЁМ — блокер хвоста 010 (это и есть новая задача T016)

Гейт T004 висел **25 минут молча**. Разобрано по процессам:

    node tools/elt.js judge run --task T004
      └ node tools/judge-invoke.js
          └ node --test -- tools/doctor.test.js     ← ВИСИТ, CPU ~0

Судья при этом дал **`pass` ещё через 15 c** (лог
`.harness/fleet/logs/agy-2026-07-31T09-48-24-679Z-31672.log` — вердикт с filesReviewed на месте).
Повис слой ПОСЛЕ судьи — red-proof.

Замер, воспроизводится:

| файл | `node --test -- <file>` (дефолт red-proof) | `node -- <file>` |
|---|---|---|
| `tools/elt-config.test.js` | ok | ok |
| `tools/doctor.test.js` | **>180 c, exit 124 (timeout)** | 22 c, exit 0 |

Два независимых дефекта:
1. `red-proof.js:43 resolveTestCmd` без явного `testCmd` детектит `node --test` — для этого репо
   это ложный дефолт (тесты здесь — самозапускающиеся `main()`-скрипты со spawn'ами внутри,
   оракул гоняет их как `node <file>`).
2. `red-proof.js:80 spawnSync` — **без `timeout`**. Зависание получается молчаливым и
   бесконечным; `JUDGE_TIMEOUT_MS = 8 мин` в `gate.js:24` этот слой не покрывает.

Хвост 010 (T004/T006/T007/T008) физически не проходит гейт, пока это не починено: все четыре
слайса трогают ровно тяжёлые тест-файлы (`doctor.test.js`, `project-bootstrap.test.js`,
`project-docs.test.js`).

## СОСТОЯНИЕ ДЕРЕВА

**Закоммичено:** `fac2248` (011/T001).

**Грязно намеренно — 010/T004**, зелёный (`node tools/doctor.test.js` → PASS):
- `tools/doctor-core.js` + `tools/doctor.test.js` — `checkJudgeBridge` + тест на 5 ветвей.
- `specs/010-judge-delivery/approval.json` — уже перевыпущен, `spec status` = `approved`.
- Лишний `checkLoopJudgePath` **вырезан** из T004 (был вне зоны и без теста) — код ниже.

**`stash@{0}` = `010-T006-T007-T008`** — `project-bootstrap.js`/`.test.js`,
`project-docs-core.js`/`.test.js`. `stash@{1}` = `batch2-T005-T009-T010-T011` (цел, из 29.07).

**Спека 011 обновлена и утверждена** (юзер сказал «утверждаю» на T016):

    specHash  21b37eec47c7d5dc90ad96444a496844b2c9622480cc9d8200003a8ea8a8dfdd
    tasksHash 86c396e1a8b4521cf22ed95f0c7888fae7d56ce01e595faa3ef30de2feb62c70

## ДАЛЬШЕ (строго в этом порядке)

1. **011/T016** — расшить red-proof (`testCmd: "node"` в harness.json + `timeout` в `spawnSync`
   с явным `skipped: test-cmd-timeout`). Без него следующие четыре слайса не проходят.
2. **Хвост 010** — T004 (уже в дереве, зелёный), затем T006, T007, T008 **по одному слайсу**.
   Батчи не повторять. Перед T006 — `git stash pop`.
3. **Отдельным слайсом: вернуть `checkLoopJudgePath`** (ниже) вместе с ТЕСТОМ и фиксом самого
   драйвера — `tools/elt-loop.ps1:397` действительно пишет вердикт через `judge-proof write`
   при `judge.attest: true`, то есть автономный драйвер сломан прямо сейчас. Задачи под это ещё
   нет; детектор без фикса драйвера сделает `doctor` этого репо красным.
4. **011/T002+** по `specs/011-elt-v3-gate/tasks.md`.

### Вырезанный из T004 код (вставлять в `doctor-core.js` после `checkJudgeBridge`; плюс `...checkLoopJudgePath(root),` в `runDoctor` и `checkLoopJudgePath,` в `module.exports`)

```js
// Инцидент 2026-07-30 (проект «Задача фузи музи»): elt-loop.ps1 писал вердикт судьи через
// `judge-proof write`, а harness.json стоял judge.attest=true — ручная запись там закрыта
// наглухо (exit 4). Драйвер встал на первом же слайсе: код написан, оракул зелёный, 0 коммитов
// за 16 минут. Молчаливый разъезд драйвера с CLI — ровно то, что доктор обязан ловить механически.
function checkLoopJudgePath(root) {
  const loop = path.join(root, 'tools', 'elt-loop.ps1');
  const text = readText(loop);
  if (!text.ok) return [];
  const manual = /judge-proof\s+write/.test(text.value);
  const viaRun = /judge\s+run\b/.test(text.value);
  if (manual && !viaRun) {
    return [result('fail', 'harness:loop-judge', 'Driver writes judge verdict manually', 'tools/elt-loop.ps1 uses `judge-proof write`, which is rejected (exit 4) whenever a project has judge.attest=true', 'Switch the driver to `elt judge run --task Txxx` and commit with --skip-oracle.', { file: loop })];
  }
  return [result('pass', 'harness:loop-judge', 'Driver invokes judge via elt judge run', loop, '', { file: loop })];
}
```

## ГОЧТЫ (к прежним из предыдущего чекпоинта)

- **Зависший гейт диагностируется по дереву процессов**, а не по логам:
  `Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,CommandLine`. Лог судьи
  уже содержал `pass` — молчал слой после него.
- Перед гейтом слайса **стэшить всё чужое** (`git stash push -m … -- <files>`), иначе судья
  законно ловит scope creep. Возвращать `git stash pop` сразу после коммита.
- `elt spec approve` на 010 после `[X]` T002/T003 прошёл тихо («уже утверждена») — файл
  `approval.json` в дереве уже был актуален из стэша.
- Оракул репо: **61/61 зелёный**, 204–212 c.
