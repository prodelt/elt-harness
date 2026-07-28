# CHECKPOINT 2026-07-28 — 009 T008 закрыт, resume T009

**Спека:** `specs/009-elt-v3-thinking-harness` · **ветка:** `feature/judge-bench-parallel-oracle` · **HEAD:** `930f192`

## Сделано в этой сессии
T008 (авто-фиксы watchdog + проводка `oracle.durationSec`) прошёл гейт и закоммичен — `930f192`.
Заходил после block'а судьи codex; починены три заявленных дефекта маршрутизации плюс два,
найденных судьёй в раундах 2–3.

**Маршрутизация cooldown (три заявленных дефекта):**
1. `to` больше не подаётся как маршрут там, где он им не является. У действия есть `subject`:
   `worker` → `to: null` (куда уйдёт следующий слайс, решает `router.pick` по приоритету
   цепочки размера — остывший codex в `[agy,codex,claude]` уступает здоровому agy, и это верно);
   `judge` → `to` настоящий маршрут (судья один и сам себя не заменит).
2. `nextProvider` по `chainFor(null)` удалён. Замена: `hasWorkerAlternative` (есть ли вообще
   кем заменить) + `fallbackJudge` по цепочке СУДЕЙ (`judge.verify` → `JUDGE_PROVIDERS`).
3. Тест на фактический следующий выбор при остывшей СЕРЕДИНЕ цепочки: `applyWatchdog` →
   `router.pick(chainFor('S'))` = `agy`; после остывания agy = `claude`.

**Найдено судьёй сверх задания (тоже починено):**
- watchdog считал судью по статическому `harness.json` — мимо `-JudgeProvider` и мимо уже
  применённого фолбэка. Прокинут фактический судья: CLI `--judge-provider`,
  `watch.runOnce(cwd, { judgeProvider })` во fleet, `$JudgeProvider` в драйвере.
- `judge-dead-streak` был слеп на fleet: тот пишет `{phase:'judge', verdict:'judge-unavailable'}`
  (logSpawn), а не `status:'judge-dead'`. Теперь распознаются оба формата (`judgeVerdictOf`).
- живой fleet-цикл покрывал только park → один прогон доказывает все три решения, включая
  смену провайдера судьи, видимую в ledger-записи фазы.

**Гейт:** оракул 57/57 (`elt oracle` exit 0), судьи agy=pass + codex=pass, red-proof `red (fails-on-base)`.
Тесты `tools/harness-watch.test.js` — 21/21.

## Гочты сессии
- Первый прогон оракула дал flake `tools/fleet/gate.test.js` (изолированно 21/21, повторно 57/57).
  Причина не искалась — под параллельной нагрузкой jobs=8. Если повторится — карантин.
- Авто-хук чекпоинта переписывает `.planning/CHECKPOINT-*-auto.md` во время слайса → судья
  видит его как scope creep. Перед `judge run` проверять `git status` и откатывать.
- Драйверные тесты (`spawnSync powershell`) требуют ≥2 открытых задач в `tasks.md`, если
  прогонов два: первый закрывает T001 и второй падает на «нет открытых задач».
- Стабы провайдеров: `FLEET_BIN_CLAUDE` / `FLEET_BIN_CODEX` = JSON-массив argv-префикса.

## ДАЛЬШЕ — T009 (Фаза D)
Worker-attestation, 0 LLM-вызовов: воркер обязан закончить JSON `{"filesChanged":[…],"testsAdded":[…]}`;
`tools/fleet/attest.js` сверяет заявку с реальным диффом worktree — `hallucinated-file`,
`undeclared-file`, `phantom-work`, `no-attestation`. Любое расхождение: слайс НЕ идёт к судье,
пишется в ledger, перевыдаётся следующему провайдеру цепочки. `workerPrompt` дополнен требованием
заявки. Тесты на четыре отказа + честную заявку.
Зона: `tools/fleet/attest.js`, `tools/fleet/attest.test.js`, `tools/fleet/fleet.js`.

Открытые после него: T010 (failover воркера + цепочка имплементатора solo-драйвера, вынесенная
из T008), T012/T013 (Фаза F, ускорение), T011 (живой прогон — закрывает спеку).

## Стеши (не разобраны)
`stash@{0}`, `stash@{1}` — planning-артефакты, отложенные вне зоны T008. Разобрать до следующего
docs-коммита. `stash@{2}`, `stash@{3}` — чужие ветки AMOS, не трогать.
