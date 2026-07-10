# CHECKPOINT 2026-07-10 — ELT Fleet: реализация фаз A–E ЗАКРЫТА (осталось только live-fire)

## ЧТО СДЕЛАНО (эта сессия — автономный прогон /elt по specs/002-elt-fleet)
Спек-драйвен харнесс-петлёй закрыто **14 из 17 слайсов** (T001–T002, T004–T015).
Каждый слайс: код → оракул (`node tools/doctor.test.js && node --test tools/fleet/*.test.js`) →
судья (свежий субагент sonnet, REJECT-default) → `elt commit`. Ветка `feature/elt-loop-driver`.
Оракул на закрытии: **56 тестов зелёные**. Судья вызван на 100% код-слайсов; **3 слайса
получили BLOCK** (T007, T008, T011) → само-хил → повторный судья pass (дисциплина сработала живьём).

### Модуль `tools/fleet/` (оркестратор, 0 LLM-токенов на управление)
- **T001** — `elt init` репо (`--shell bash`, оракул glob `tools/fleet/*.test.js`: Node v24 грузит голую директорию как модуль) + smoke.
- **T002** `providers.js` — headless-executor run({provider,prompt,cwd,model})→{exit,ok,reason,logPath,lastMsg}; промпт через STDIN у ВСЕХ (Windows .cmd-шимы), hard-таймаут, empty-stdout@exit0=fail, лог в `.harness/fleet/logs/`. Тесты на node-стабах.
- **T004** `worktree.js` — create/remove/list `.fleet-wt/<Tid>` + ветка `fleet/<Tid>`; resume переиспользует ветку.
- **T005** `plan.js` — парс `[P]/[S|M|L]/[cli:]/[files:]`; nextBatch: подряд идущие [P] с disjoint files, не-[P]=барьер.
- **T006** `claims.js` — claim/release/stale по живости pid (kill(pid,0), EPERM=жив); sweep для resume.
- **T007** `gate.js` — ГЕЙТ в worktree: elt oracle → судья (claude -p sonnet, парсер вердикта REJECT-default портирован из elt-loop.ps1) → `elt commit` **БЕЗ [X]** (метку ставит merge). Само-хил: r.ok И verdict:pass; env-гард; тест инварианта «tasks.md не тронут».
- **T008** `merge.js` — merge --no-ff → [X] в merge-commit → smoke-оракул; конфликт → abort + requeue-serial; идемпотентный re-merge (MERGE_HEAD-детект, проверка commit).
- **T009** `fleet.js run` — планер+claims+worktree(сериально)+воркер+gate(параллельно)+merge(сериально); events.jsonl, STOP-файл, resume-sweep; **интеграционный тест: 2 воркера, 3 слайса, 1 конфликт → всё закрыто, конфликт дожат serial** (критерий приёмки №1 на стабах).
- **T010** `router.js` — fleet.json policy (size→цепочка), cooldown, ledgerEntry.
- **T011** — detectLimit (эвристич. сигнатуры, T003 уточнит) + failover (лимит→cooldown+следующий провайдер).
- **T012** `heal.js` — красный оракул → 1 heal свой провайдер → 1 heal claude → failed; вплетён в fleet.js (провал→слайс failed, петля продолжает).
- **T013** `fleet.js status`/`renderStatus` + CLI-вход + обёртка **`tools/elt-fleet.ps1`** (run/status/stop, -Panes = wt split-pane + Get-Content -Wait).
- **T014** `doctor-core.js checkFleetWorkers` — в ДЕФОЛТНЫЙ doctor (не --fleet): stale claims / брошенные worktrees / CLI `--version` pre-flight; ТИХО без fleet (guard по claim-файлам, не пустой папке).
- **T015** доки — SKILL.md v2.3.0 fleet-режим (≥3 [P]) + PLAYBOOK.md + CLAUDE.md Commands.

## ОСТАЛОСЬ (всё [live] — ТРЕБУЕТ ЮЗЕРА)
- **T003** [live] live-fire каждого провайдера (claude -p / codex exec / agy -p): снять РЕАЛЬНЫЕ
  инвокации, exit-коды, сигнатуры лимитов. **PREREQ: юзер логинится в agy браузером**
  (`!agy` → `agy models` с таймаутом). Результат → уточнить `providers.js` argv/каналы и
  `router.js LIMIT_SIGNATURES` (сейчас эвристика).
- **T016** [live] бенч: scratch-план 4+ честных [P]-слайса, `fleet run --workers 2` vs
  последовательный baseline; wall-clock ≥1.5×, судья 100%, метрики в run-log → чекпоинт.
- **T017** [live] драки: STOP посреди прогона → resume; 429-инъекция → failover; счётчик
  agy-вызовов/limitHit в ledger; CHECKPOINT с вердиктом v1.

## ДАЛЬШЕ (новый чат, при юзере)
1. Юзер логинится в agy → `/elt` → T003 (снять реальные сигнатуры), правки в providers/router.
2. T016 бенч (нужен scratch-проект — открытый вопрос: AWE4 или свежий).
3. T017 драки → вердикт v1 → merge `feature/elt-loop-driver` в main.
4. Открытые вопросы (не блокируют): claude-воркеры skip-permissions vs --permission-mode auto;
   какая Google AI подписка (Pro/Ultra — размер 5ч-окна agy).

## Resume
Ветка `feature/elt-loop-driver` (14 слайсов 002 + драйвер). Оракул `node tools/doctor.test.js &&
node --test tools/fleet/*.test.js` = 56 зелёных. План `specs/002-elt-fleet/tasks.md` (14 [X], 3 [ ] live).
Дизайн: `.planning/ELT-FLEET-DESIGN.md`. Статус: `powershell tools/elt-fleet.ps1 -Action status -Tasks specs/002-elt-fleet/tasks.md`.
