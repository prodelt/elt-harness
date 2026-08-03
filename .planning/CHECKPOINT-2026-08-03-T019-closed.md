# CHECKPOINT 2026-08-03 — T019 закрыт (вето перестали перемножаться)

Предыдущий: `.planning/CHECKPOINT-2026-08-01-fleet-t019-spec-wiring.md`.
Ветка `feature/judge-bench-parallel-oracle`, HEAD **`932139f`**. Режим: соло (agy был в лимите).

## Что закрыто

**T019 — коммит `932139f`, `[X]` в `specs/011-elt-v3-gate/tasks.md`.** Оракул 57/57 (211 c),
судья claude/sonnet `pass`, red-proof `red` (fails-on-base — слайс доказан).

### (а) `red-proof: green` → `inconclusive`, не `block`

Правило вынесено в **одну чистую функцию** `applyRedProof(verdict, reasons, result)`
(`tools/red-proof.js`), потому что жило в двух копиях — solo `judge-invoke.js:62` и fleet
`gate.js:732` — и уже начинало расходиться. `pass` + `green` → `inconclusive` (коммит с меткой
+ строка в `review-queue.jsonl`); `red`/`skipped` вердикт не трогают; `block` не смягчается.

`tools/elt.js:481` — пруф с `inconclusive` + green проходит валидацию, `pass` + green
по-прежнему `red-proof-green` (такая пара может прийти только с пути, не прогнавшего T019).

### (б) `grounding:no-reasons` → одна перевыдача, повтор = `inconclusive`

`judgeDiffRetryNoReasons()` в `gate.js` обёрнут вокруг ВСЕХ четырёх вызовов `judgeDiff`
(primary, alt после смерти, secondary, alt secondary). `phantom-file`/`unreviewed-file`
не ретраятся и остаются `block` — это враньё судьи о прочитанном, а не транспорт.

### (в) Дефект, найденный СУДЬЁЙ на первом прогоне этого же слайса

`gate.js:626` — свёртка вердиктов с verify-судьёй была бинарной
(`secondary.verdict === 'pass' ? 'pass' : 'block'`) и возвращала `inconclusive` обратно в
`block`. То есть ровно в двухсудейском сценарии — который спека 011 называет главным
источником 77% block-rate («verify заблокировал при pass первичного 36 из 48») — заявленное
T019 НЕ выполнялось. Тесты этого не ловили: их фикстура была без `judge.verify`, второй слой
не включался вовсе. Починено + 3 теста с фикстурой `verifyRepo()`.

**Это первый случай в проекте, когда судья поймал реальный дефект в слайсе, который его же и
чинит.** Аргумент за REJECT-default на живых данных.

### Тесты (10 новых, 1 переписан)

- `red-proof.test.js` +3 — `applyRedProof` (pass+green, red/skipped/null, block не смягчается)
- `gate.test.js` +6 — no-reasons ретрай со счётчиком вызовов стаба (ровно 2), «перевыдача
  помогла → pass», phantom не ретраится; и три на verify-путь (inconclusive/block/no-reasons)
- `elt-judge-contract.test.js` +1 — `inconclusive` + green проходит validate
- `fleet.test.js` — переписан `T010: зелёный red-proof режет слайс` → теперь `T010+T019:
  inconclusive, метка в git log, строка в очереди`

## Два системных дефекта, найденные попутно (не слайсы, но стоили 3 прогонов оракула)

1. **Deploy-копия = ЗАМЫКАНИЕ из 10 файлов**, а не один `elt.js`. Ручной
   `cp tools/elt.js ~/.claude/bin/` даёт красный `doctor.test.js` с дампом кода, при том что
   `diff` по elt.js показывает IDENTICAL. Синхронизировать **только** `node tools/sync-bin.js`.
   → память `reference_deploy_closure_sync_bin.md`.
2. **`elt commit` в цепочке обязан идти со `--skip-oracle`.** Без него он перегоняет оракул,
   перезаписывает файл оракул-пруфа, и `judge-proof.oracleProofHash` (sha256 ФАЙЛА, `elt.js:454`)
   перестаёт совпадать → `judge proof invalid (stale-oracle)` на зелёном же прогоне.
   Правильная форма: `oracle && judge run && commit --skip-oracle` (ровно так делает fleet).
   → память `feedback_elt_commit_skip_oracle_chain.md`.

Прочее: снесены orphan-worktree `.fleet-wt/T001..T003` (ветки `fleet/T00x` остались — хук
блокирует `git branch -D`, снять вручную). `node --test tools/doctor.test.js` ВИСИТ вечно —
файл не в формате node:test; оракул зовёт его напрямую (`node <file>`) и он проходит за ~70 c.

## Состояние

- Дерево чистое. Открытых слайсов 011: **11** (было 12).
- ⚠ **`git stash@{0}`** — контракт-тест T018 в `tools/fleet/fleet.test.js` (+17 строк в конец)
  и обновлённый `.planning/elt-system-audit-latest.md`. Отложен перед гейтом T019, **не
  возвращён**. `fleet.test.js` с тех пор правился в середине файла — pop должен пройти чисто
  (правки в разных местах), но проверить.
- Порядок исполнения в tasks.md: **T018 → T022 → T023 → T020 → T021 → T024 → T025 → T026 →
  T027 → T028**, далее приёмка T014/T015.
- T018 в чужом проекте УЖЕ сделан живьём: `C:/Ametrin projects/Задача фузи музи` несёт
  `smoke.py` и поле `smoke` в `.harness/harness.json`; чекпоинт с двумя прогонами есть
  (`.planning/CHECKPOINT-2026-08-01-T018-live-smoke.md`). Осталось вернуть контракт-тест из
  стэша и провести слайс через гейт — блокировал его именно `red-proof:green`, снятый T019.

## Resume Prompt

> Продолжаю Pipeline Setupper, ветка `feature/judge-bench-parallel-oracle`, HEAD `932139f`.
> Читай `.planning/CHECKPOINT-2026-08-03-T019-closed.md`.
> T019 закрыт (вето больше не перемножаются). Дальше по порядку tasks.md: **T018** —
> `git stash pop` (контракт-тест L2 для fleet-пути уже написан, лежит в stash@{0}), затем
> цепочка `node tools/elt.js oracle && node tools/elt.js judge run --task T018 --spec
> specs/011-elt-v3-gate && node tools/elt.js commit --task T018 --spec specs/011-elt-v3-gate
> --skip-oracle -m "..."` — **`--skip-oracle` обязателен**, иначе `stale-oracle`.
> После правки любого файла харнесса — `node tools/sync-bin.js` (deploy = замыкание 10 файлов).
> Далее T022 (`elt stats`) → T023 (judge-bench FPR) → T020 (`elt gate --full`) → T021 (smoke
> deploy-копии) → T024/T025 (L0-триггеры) → T026/T027 (эволюция) → T028 (дифф судье файлом) →
> T014/T015 (приёмка). Цель пользователя: закрыть роадмап 011 целиком и получить стабильную
> версию для соло и fleet.
