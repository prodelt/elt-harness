# 011 — ELT v3: гейт по риску: слайсы

Спека: `specs/011-elt-v3-gate/spec.md`. Repo `specApproval:true` — без `elt spec approve`
`slice next`/`commit` откажут (exit 4).

**Dogfood (§3.1 брифа):** каждый слайс закрывается уже построенной частью v3. Как только L0
написан — он решает по следующему слайсу; как только L1 готов — им гоняется следующий. Отказ
нового слоя на живом слайсе = пруф дефекта, а не повод вернуться к старому пути.

## Фаза A — снять шум (первым, иначе всё остальное едет через block-rate 77%)

- [X] **T001** Убрать `judge.verify` из `.harness/harness.json` этого репо (конъюнкция двух
  REJECT-default судей исчезает; код-путь не трогаем — им пользуется fleet). Прогнать
  `node tools/judge-bench.js --out .planning/JUDGE-BENCH-011-T001.json` одиночным первичным
  (`agy`/`gemini-3.6-flash-high`) на 14 кейсах — число ДО того, как на нём поедут слайсы.
  Проверяемо: контракт-тест — `verifySettings` для корня репо возвращает `null`; структура
  отчёта бенча парсится (кейсы, recall, false-positive). [AC1]
  [files: .harness/harness.json, tools/elt-gate-l0.test.js]

- [X] **T016** red-proof не виснет и не молчит. Замер 2026-07-31 на живом T004: судья дал `pass`
  за 15 c, а `red-proof.js:80` повис на `node --test -- tools/doctor.test.js` — >180 c без
  завершения (тот же файл под `node -- <file>` зелёный за 22 c), и `spawnSync` там **без
  `timeout`**, поэтому гейт висел 25 минут молча. Два фикса: (а) `.harness/harness.json` →
  `"testCmd": "node"` (механизм явного `testCmd` в `resolveTestCmd` уже есть, дефолт `node --test`
  для этого репо ложен); (б) `spawnSync` получает `timeout` (потолок из конфига, дефолт 5 мин) и
  превышение даёт ЯВНЫЙ `skipped: test-cmd-timeout` с хвостом вывода, а не молчаливое зависание.
  Проверяемо: тест на обе ветки — зависающий testCmd упирается в таймаут и отдаёт причину;
  `node`-testCmd из конфига реально подхватывается вместо дефолта. Блокер хвоста 010: без него
  T004/T006/T007/T008 не проходят гейт физически. [R2]
  [files: .harness/harness.json, tools/red-proof.js, tools/red-proof.test.js]

> **Гейт между T001 и T002:** сначала **T016** (иначе red-proof виснет), затем хвост 010 —
> `specs/010-judge-delivery/tasks.md` T004, T006, T007, T008 (написаны, зелёные, лежат в дереве,
> 3/3 PASS). По одному слайсу, уже облегчённым гейтом. Батч из 8 упёрся в `DIFF_CAP` — не
> повторять. 010 закрывается этим целиком.

## Фаза B — L0: механика вместо LLM (0 вызовов, менее 5 c)

- [X] **T002** `tools/elt-gate-l0.js`: чистая функция `evaluate({diff, status, config, cwd})` →
  `{triggers: [], judgeNeeded: bool}`. Триггеры: `existing-test-modified` (правится тест-файл,
  существовавший на baseHead), `new-code-no-check` (новый прод-код без нового/изменённого
  runnable-чека), `hot-path` (список глобов из `harness.json.hotPaths`, дефолт — гейт/auth/
  секреты), `diff-size` (порог строк, дефолт из конфига). Ни LLM, ни сети. Тест на каждый
  триггер по отдельности и на пустой набор. [AC2]
  [files: tools/elt-gate-l0.js, tools/elt-gate-l0.test.js]

- [X] **T003** Проводка L0 в гейт: нет триггеров → судья НЕ зовётся, вердикт `pass`, запись
  `l0-clean` в run-log с пустым списком триггеров; есть триггеры → путь к судье как раньше, но
  список триггеров едет в run-log и в промпт судьи как контекст «почему тебя позвали».
  Тест: судья-стаб не вызван ни разу на чистом слайсе, вызван ровно один раз на рисковом. [AC3]
  Зона расширена при реализации: `tools/judge-invoke.js` — мост solo-пути, без проброса `l0`
  через него `elt judge run` физически не может отличить `l0-clean` от обычного `judge-pass`;
  `tools/fleet/gate.test.js` — механическое следствие проводки: его фикстуры (`slice2.txt`,
  `out/alpha.txt`) не дают ни одного риск-триггера, судья на них перестал зваться, и два теста
  стали мерить не то, что заявляют. Фикстурам добавлен `l0.hotPaths:['**']` (тесты про путь
  ЧЕРЕЗ судью), поведение самих тестов не ослаблено; `tools/sync-bin.js` — `elt-gate-l0.js`
  входит в замыкание моста, иначе `elt judge run` падает MODULE_NOT_FOUND во всех проектах
  (поймано контракт-тестом `sync-bin.test.js`, не рассуждением); `tools/fleet/fleet.test.js` —
  та же причина, что у `gate.test.js`; `tools/elt-judge-attest.test.js` — запись `l0-clean` в
  run-log проверяется на готовой фикстуре `elt judge run` вместо её дубля в третьем файле.
  [files: tools/elt.js, tools/fleet/gate.js, tools/judge-invoke.js, tools/sync-bin.js, tools/fleet/gate.test.js, tools/fleet/fleet.test.js, tools/elt-judge-attest.test.js, tools/elt-gate-l0.test.js]

## Фаза C — третий исход вместо осцилляции

- [X] **T004** Вердикт `inconclusive` в парсере и гейте: коммит проходит с меткой в сообщении,
  строка в `.harness/review-queue.jsonl` (`task`, `commit`, `reason`, `ts`), повторный прогон
  судьи на том же слайсе НЕ запускается. Тест на все три исхода (`pass`/`block`/`inconclusive`)
  и на отсутствие второго раунда. [AC4]
  Зона расширена: `.gitignore` — очередь это рантайм-состояние (как run-log); в дереве её строка
  попадала бы в дифф следующего слайса и двигала `treeHash` под оракул-пруфом.
  [files: tools/fleet/gate.js, tools/elt.js, .gitignore, tools/elt-inconclusive.test.js]

- [ ] **T005** `elt review`: печатает очередь (`--json` машиночитаемо) и закрывает записи
  (`elt review close --task Txxx`); закрытая не возвращается. `doctor` показывает длину очереди
  (WARN при превышении порога, работу не стопорит — R4). Тест на печать/закрытие/идемпотентность.
  [AC5]
  [files: tools/elt.js, tools/doctor-core.js, tools/elt-review.test.js]

## Фаза D — L1: оракул по impact-выборке (предусловие мутатора)

- [ ] **T006** Impact-выборка тест-файлов: из диффа → задетые символы через codegraph →
  тест-файлы, которые их покрывают. `harness.json.oracleSelect: "impact" | "all"` (дефолт `all` —
  обратная совместимость). Fallback на «все» при недоступном/устаревшем индексе, с ЯВНОЙ причиной
  в отчёте (не тихо). Тест на обе ветки + на fallback. [AC6]
  **Замер 2026-07-31 (два живых слайса, T016 и 010/T004): это крупнейший рычаг по времени.**
  Оракул 196–213 c из ~230 c всего гейта = **~90% слайса**; судья после снятия verify — 16–18 c,
  red-proof — до 120 c потолка. 61 тест-файл гоняется целиком на каждый слайс независимо от зоны;
  хвост держат три файла со spawn'ами внутри: `fleet.test.js` 135–146 c, `harness-watch.test.js`
  106–116 c, `doctor.test.js` 70–79 c. Т.е. по времени фаза D бьёт фазу B (L0 экономит 16 c).
  [files: tools/elt-oracle-runner.js, tools/elt-oracle-select.js, tools/elt-oracle-select.test.js]

## Фаза E — качество тестов перестаёт быть слепой зоной (§3.2)

- [ ] **T007** `red-proof` на ВСЕ изменённые тест-файлы, не только новые: сейчас
  `red-proof.js:60` даёт `skipped: no-new-tests`, и правка существующего теста проскакивает слой
  целиком. Изменённый тест обязан падать на baseHead. Тест на новый файл, на изменённый и на
  слайс вовсе без тестов. [AC7]
  [files: tools/red-proof.js, tools/red-proof.test.js]

- [ ] **T008** `tools/elt-mutate.js`: мутатор по ИЗМЕНЁННЫМ строкам диффа (stdlib, без
  зависимостей — в репо нет `package.json`). Мутации: инверсия условия, подмена возвращаемого
  значения, снятие оператора сравнения. Прогон — по impact-выборке из T006. Мутация выжила (ни
  один тест не упал) → `block` с файлом и строкой. Бюджет: максимум мутаций на слайс + таймаут,
  превышение = `inconclusive` с причиной, не блок и не тихий пропуск (R2). Тест на выжившую и на
  убитую мутацию + на исчерпанный бюджет. [AC8]
  [files: tools/elt-mutate.js, tools/elt-mutate.test.js]

## Фаза F — внешние либы без галлюцинаций (§3.3)

- [ ] **T009** `.harness/ctx7-proof.jsonl` пишет `tools/context7-cli.js` при каждом успешном
  вызове (library-id, запрос, ts). L0-триггер `external-import-no-ctx7`: новый внешний
  импорт/зависимость в диффе без свежей записи → `block`. Недоступность самого ctx7 (а не
  отсутствие пруфа) → `inconclusive` с причиной, не `block` (R5). Тест на все три ветки. [AC9]
  [files: tools/context7-cli.js, tools/elt-gate-l0.js, tools/elt-ctx7-proof.test.js]

## Фаза G — L2 smoke: то, чем пользуется человек (D0)

- [ ] **T010** `harness.json.smoke` — строка команды по форме существующего `oracle`. Пусто/нет
  поля → слоя нет (старое поведение). Задана → исполняется после оракула, ненулевой код возврата
  = `block`, вывод (хвост) в отчёт. Тест на три случая: поля нет / зелёный smoke / красный smoke.
  [AC10]
  [files: tools/elt.js, tools/elt-config.js, tools/elt-smoke.test.js]

## Фаза H — хвост 010: люк и периметр

- [ ] **T011** Удалить люк самозаверения целиком: флаги `--skip-attest` И `--attested-by` не
  распознаются, ветка `attest-skipped` и поля `attestSkipped`/`attested` уходят из run-log и
  proof. При `attest:true` ручной `judge-proof write` отвергается безусловно (exit 4 с подсказкой
  про `elt judge run`). Fleet пишет proof вызовом той же функции, что `elt judge run`, in-process,
  а не через CLI. Тест: оба старых флага больше не проводят вердикт. (Было 010/T005; форма
  изменена решением 6 — codex-судья заблокировал прежнюю по делу.) [AC11]
  [files: tools/elt.js, tools/fleet/gate.js, tools/elt-judge-attest.test.js]

- [ ] **T012** Авто-чекпоинт молчит во время гейта: `elt` выставляет маркер на время
  оракул→судья→commit, `checkpoint-writer.js` его уважает и не пишет в `.planning/`. Тест на обе
  стороны (маркер есть → не пишет; снят → пишет). (Было 010/T009.)
  [files: tools/elt.js, tools/checkpoint-writer.js, tools/elt-checkpoint.test.js]

- [ ] **T013** Скиллы точечно: убрать из `elt/SKILL.md`, `elt-onboard`, `harness-method` ветки,
  разрешающие писать вердикт руками при `attest:true`, и ссылки на `--skip-attest`/`--attested-by`;
  описать три исхода судьи и очередь ревью. Контракт-тест на текст скиллов. Зеркала —
  `sync-agent-surface`. (Было 010/T010.)
  [files: tools/elt-skill-frontgate-contract.test.js]

## Фаза I — приёмка

- [ ] **T014** Живой блок в чужом проекте: в `C:/Ametrin projects/Route_API_1C` без единой правки —
  новый гейт через глобальный резолв моста: `block` на диффе с внесённым нарушением и
  `pass`/`l0-clean` на чистом. Судья не Claude (R3 спеки 010). Пруф — записи в его
  `.git/elt/run-log.jsonl`, приложить в чекпоинт. (Было 010/T011, теперь приёмка НОВОГО гейта.)
  [AC12]

- [ ] **T015** Итоговый замер против baseline: block-rate нового контура на judge-bench, доля
  слайсов, дошедших до L3, доля `inconclusive`, время гейта p50/p90 — числами против 77% / 100% /
  185 c. Порог по `inconclusive` назвать явно: превышение = дефект контура, а не норма (R3).
  Отчёт — `.planning/GATE-011-VERDICT.md`. Проверяемо: тест валидирует структуру отчёта. [AC13]
  [files: .planning/GATE-011-VERDICT.md, tools/gate-verdict.test.js]
