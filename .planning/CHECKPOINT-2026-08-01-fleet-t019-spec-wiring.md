# CHECKPOINT 2026-08-01 — approve 011, перестановка слайсов, fleet-прогон T019 (agy)

Предыдущий: `.planning/CHECKPOINT-2026-08-01-artifact-audit-slices.md`.
Ветка `feature/judge-bench-parallel-oracle`, база `91a0710`. Режим: код пишет `agy` через fleet,
проверка — на мне.

## Сделано

### 1. Спека 011 переутверждена (пользователь: «утверждаю»), AC14–AC17 добавлены

`spec.md` дополнен четырьмя критериями под новые фазы (`d167d45`):

- **AC14** — `red-proof:green` и повторный `grounding:no-reasons` → `inconclusive` (коммит +
  review-queue), `phantom-file`/`unreviewed-file` остаются `block`.
- **AC15** — `elt gate --full` игнорирует `oracleSelect`; fleet зовёт полный сьют перед merge;
  счётчик слайсов растёт и сбрасывается.
- **AC16** — `elt stats` считает block-rate, прогоны судьи/коммит, оракул p50/p90, доли
  `l0-clean`/`inconclusive`, разложение блоков по источнику.
- **AC17** — L0 несёт `out-of-scope` и `high-fanin`; FPR первичного судьи измерен.

Фазы L/M намеренно без AC: формулировать критерий на эволюцию до чисел T022/T023 — значит
фиксировать порог, который не на чем калибровать. Обоснование записано в самой спеке.

**Почему AC вообще нужны:** судья грузит `spec.md` как рубрику (`gate.js:185` → `loadRubric`).
Без AC он судил бы T019–T028 по спеке, где их критериев нет.

### 2. Порядок слайсов в `tasks.md` = порядок исполнения (дедлок fleet)

Fleet берёт **первый открытый слайс как барьер** (`plan.js:62-75`: не-`[P]` → батч из одного).
В файле открытыми и первыми стояли T018 (блокирован тем самым `red-proof:green`, который чинит
T019) и T014/T015 (финальный замер, зависит от T022/T023). До T019 оркестратор не дошёл бы никогда.

Переставлено (текст слайсов не менялся, проверено `sort`-диффом — отличий, кроме нового
заголовка, нет): `T019 → T018 → T022 → T023 → T020 → T021 → T024 → T025 → T026 → T027 → T028`,
далее раздел «Финальная приёмка» с T014/T015. Re-approve прогнан (approval hash-связан с
`tasksHash`, поэтому перестановка требует его).

### 3. Найден и починен системный дефект fleet: `elt` звался без `--spec` (`91a0710`)

**Как всплыло:** первый прогон T019 (agy, 17 мин работы) прошёл воркера, attest, оракул и судью
(claude/sonnet, 424 c, зелёный) — и упал на стадии `commit`. Причина в `events.jsonl` не
записана: `fleet.js` эмитил только `stage`. После `gate-reject` fleet снёс worktree и ветку —
работа воркера потеряна целиком.

**Корень:** `T019` существует в **пяти** спеках (003/005/006/009/011; в четырёх закрыт — поэтому
греп по `- [ ]` его не показывал). `gate.js` звал `elt judge run` и `elt commit` без `--spec`,
автодетект `findSpecDir` берёт первый `tasks.md` по обходу → `specs/003-elt-fleet-hardening`, где
T019 уже `[X]`. То есть fleet был непригоден для любой спеки с неуникальными id — не свойство
T019. Механика была предусмотрена (`specFile` в `findSpecDir`/`runJudge`, комментарий
`gate.js:167` прямо про коллизию T008), но fleet, зная `tasksPath`, его не передавал.

**Починка:** `specArgsFor(specFile)` → `--spec <папка>` в обе `elt`-команды + `specFile` в
`runJudge` (рубрика) + проброс `specFile: tasksPath` во все три вызова `gate.gate` +
`gate-reject` теперь несёт `err`. Тест — `tools/fleet/spec-wiring.test.js` (3 кейса, включая
«явный specFile побеждает автодетект» на фикстуре с коллизией). Сьют `tools/fleet/*.test.js` —
**156/156 pass**.

### 4. ⚠ Дефект изоляции: agy записал непроверенную правку в глобальный `~/.claude/bin/elt.js`

Deploy-копия оказалась изменена **во время прогона** (mtime 12:37): agy дописал туда логику T019

```
- if (p.redProof.status === 'green') return invalidJudgeProof('red-proof-green');
+ if (p.redProof.status === 'green' && p.verdict !== 'inconclusive') return invalidJudgeProof('red-proof-green');
```

Правка по смыслу верна для T019, но: (а) она вне worktree, в файле, обслуживающем **все**
проекты; (б) слайс гейт не прошёл, а правка пережила удаление worktree и осталась в проде.
Воркер бежит с `--dangerously-skip-permissions`, `--add-dir` ограничивает добавленную директорию,
но не запрещает запись вне неё. **Восстановлено** копией из репо (`node ~/.claude/bin/elt.js
status` зелёный). Слайса на это пока нет — кандидат в фазу M.

### 5. Второй дефект, вскрытый добавленным `err`: approval всегда stale в worktree (`<fix2>`)

Прогон №2 дошёл до коммита и упал с уже читаемой причиной:
`elt: спека не утверждена (status: stale, specs\011-elt-v3-gate)`. То есть `--spec` доехал до
ПРАВИЛЬНОЙ спеки — сломано было следующее звено.

**Корень:** approval-хеш считался от **байтов** файла (`elt.js:237`), а `core.autocrlf=true`
отдаёт на checkout CRLF. Замер: `tasks.md` в основном дереве `9c4b0140…` (LF, как записал
скрипт), тот же файл в worktree `279e35fa…` (CRLF) — совпадает с `git show | sed 's/$/\r/'`.
Следствие шире T019: **на Windows fleet не мог закоммитить ни один слайс никакой спеки с
`specApproval:true`** — подпись держалась за перевод строк, а не за содержание.

**Починка:** хеш от нормализованного текста (`\r\n` → `\n`). Тест —
`tools/elt-spec-approval.test.js`: LF-подпись валидна на CRLF-чекауте, но правка ПО СУЩЕСТВУ
по-прежнему даёт `stale`. Полный оракул после правки — **70/70 passed** (204.8 c).
Deploy-копия `~/.claude/bin/elt.js` синхронизирована вручную.

## Текущий прогон

Перезапущен fleet на T019 после обеих починок; хеш deploy-копии зафиксирован в
`/tmp/elt-deploy-before.md5` — сверить после прогона (полезет ли agy туда снова).

Счёт живых прогонов T019: №1 — упал на `commit` (спека 003 вместо 011), №2 — упал на `commit`
(approval stale от CRLF), №3 — `failed`+`conflict`, `stoppedReason: all-providers-cooling`
(agy выбрал лимит; worktree не снялся — «директория занята другим процессом» после 6 попыток).
Все три падения — дефекты харнесса и лимит провайдера, ни одного отказа по существу работы;
первые два чинились по одному, потому что первый скрывал второй.

**T019 НЕ закрыт** (`- [X] **T019**` в tasks.md отсутствует). Два барьера, стоявшие на пути,
сняты и закоммичены — третий прогон упёрся уже только в лимит agy.

## Состояние дерева на конец сессии

- Ветка `feature/judge-bench-parallel-oracle`, HEAD `f05c6e8`.
- Незакоммичено: `tools/fleet/fleet.test.js` (контракт-тест T018, зелёный),
  `.planning/CHECKPOINT-2026-08-01-auto.md`, этот чекпоинт.
- `.fleet-wt/T019` мог остаться на диске (снятие worktree не удалось) — следующий запуск
  fleet чистит orphan-worktree сам (`fleet.js:364-368`), но проверить `git worktree list`.
- `.harness/fleet/fleet.json` = `{"default":["agy"]}` — если agy в лимите, прогон встанет сразу
  с `all-providers-cooling`; на это время либо ждать остывания, либо временно вернуть цепочку.
- ⚠ **agy дважды писал в `~/.claude/bin/elt.js`** (глобальная deploy-копия, все проекты). Оба
  раза восстановлено из репо. Проверять `diff <(tr -d '\r' < tools/elt.js) <(tr -d '\r' <
  ~/.claude/bin/elt.js)` после КАЖДОГО fleet-прогона с agy, пока нет слайса на изоляцию.

## Конфигурация прогона

- `.harness/fleet/fleet.json` = `{"default": ["agy"]}` — воркер agy (`gemini-3.6-flash-high`).
  Судья — `claude/sonnet` из `harness.json`, роли не сливаются.
- Запуск: `node tools/fleet/fleet.js run --tasks specs/011-elt-v3-gate/tasks.md --workers 1`.
  Поле `chain` в событии `start` показывает `["claude"]` — это неиспользуемый дефолт `opts`,
  реальный выбор идёт через `router.loadPolicy`; смотреть надо `slice-work.provider`.
- STOP: `node tools/fleet/fleet.js stop` (снимать — `rm .harness/STOP`).

## Наблюдения к следующим слайсам

- **agy выходит за `[files:]`**: правил ещё `fleet.test.js` и `judge-grounding.test.js` (старые
  тесты фиксируют старое поведение — без них оракул красный). `normalizeWorktree` их не откатил,
  оракул прошёл. Для T024 (триггер `out-of-scope`) это живой кейс: расширение зоны здесь было
  легитимным, значит триггер обязан звать судью, а не блокировать.
- Незакоммиченный контракт-тест T018 в `tools/fleet/fleet.test.js` по-прежнему в дереве, зелёный.
- T018 закрывать **solo** с `--spec specs/011-elt-v3-gate`: кода писать нечего, а через fleet его
  id всё равно коллидирует с 006 (теперь бы разрешилось `--spec`, но работа уже в дереве, не в
  worktree).

## Resume Prompt

> Продолжаю Pipeline Setupper, ветка `feature/judge-bench-parallel-oracle`, база `91a0710`.
> Читай `.planning/CHECKPOINT-2026-08-01-fleet-t019-spec-wiring.md`.
> Спека 011 утверждена (AC14–AC17 добавлены), слайсы переставлены под порядок исполнения,
> `--spec` в fleet починен (`91a0710`, тест `tools/fleet/spec-wiring.test.js`).
> Проверь итог прогона T019: `node tools/fleet/fleet.js status --tasks specs/011-elt-v3-gate/tasks.md`
> и `tail .harness/fleet/events.jsonl`. Сверь `md5sum ~/.claude/bin/elt.js` с
> `/tmp/elt-deploy-before.md5` — agy уже раз писал в глобальную deploy-копию.
> Дальше: закрыть T018 solo (`--spec specs/011-elt-v3-gate`, контракт-тест уже в дереве), затем
> T022 ∥ T023 через fleet. Код пишет agy, проверка — на агенте.
