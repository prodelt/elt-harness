# tasks — ELT Fleet (specs/002-elt-fleet/spec.md, дизайн: .planning/ELT-FLEET-DESIGN.md)

> Оракул репо: `node tools/doctor.test.js && node --test tools/fleet/*.test.js` (bash-shell).
> (glob, не голая директория: Node v24 грузит `tools/fleet/` как модуль — все fleet-тесты плоские в папке.)
> `[live]` = слайс с реальными CLI/квотами — гнать при юзере, оракул = скрипт-проверка.
> Теги для будущего fleet-догфуда: [P] = параллелизуем, [files:] = зона правок.
> Порядок = зависимость: не-[P] слайс ждёт все предыдущие.

## Phase A — фундамент
- [X] **T001** elt init этого репо (`--shell bash --oracle "node tools/doctor.test.js && node --test tools/fleet/*.test.js"`) + `tools/fleet/` со smoke-тестом (node --test проходит на пустом модуле)
- [X] **T002** providers.js: executor-интерфейс run({provider, prompt, cwd, model}) → {exit, logPath, lastMsg} для claude/codex/agy (spawn headless; agy: промпт через STDIN, hard-таймаут на ВСЕ вызовы, пустой stdout при exit 0 = fail; лог в .harness/fleet/logs/); тесты на фейк-CLI-стабах *.cmd [files:tools/fleet/*]
- [ ] **T003** [live] live-fire каждого провайдера: scratch-git, тривиальная правка файла через claude -p / codex exec --sandbox workspace-write / `echo … | agy -p --dangerously-skip-permissions --print-timeout 5m`; PREREQ: юзер залогинен в agy (браузер-OAuth, проверка `agy models` с таймаутом); зафиксировать в providers.js реальные инвокации, exit-коды и сигнатуры лимитов (agy: + пустой stdout, + hang); оракул = скрипт проверяет правки на диске

## Phase B — изоляция
- [X] **T004** [P] worktree.js: create/remove/list `.fleet-wt/<Tid>` + ветка fleet/<Tid> от интеграционной; тесты на темп-репо [files:tools/fleet/worktree*]
- [X] **T005** [P] plan.js: парс тегов [P]/[S|M|L]/[cli:]/[files:] поверх elt slice-формата + выбор параллельного батча (только [P] с disjoint files-глобами, не-[P] = барьер); тесты [files:tools/fleet/plan*]
- [ ] **T006** [P] claims.js: claim/release/stale-детект (pid жив?) в .harness/fleet/claims/; тесты [files:tools/fleet/claims*]

## Phase C — петля
- [ ] **T007** gate.js: в worktree — elt oracle → судья (`claude -p --model sonnet`, промпт+REJECT-default-парсер портировать из elt-loop.ps1) → `elt commit --skip-oracle --verdict pass` БЕЗ [X]-марка; тест с фейк-судьёй [files:tools/fleet/gate*]
- [ ] **T008** merge.js: очередь merge --no-ff fleet/<Tid> → интеграционная + [X]-марк в tasks.md + smoke-оракул после merge; конфликт → пометка requeue-serial; тест с искусственным конфликтом на темп-репо [files:tools/fleet/merge*]
- [ ] **T009** fleet.js run MVP: планер+claims+N воркеров+gate+merge, events.jsonl, STOP-файл (grace 30с → kill), resume по claims; интеграционный тест: стабы, 2 воркера, 3 слайса, 1 конфликт — всё закрыто

## Phase D — роутер
- [ ] **T010** router.js: fleet.json policy (size-тег → цепочка провайдеров), cooldown, ledger-поля в run-log (provider/model/durationSec/failoverFrom/limitHit); тесты [files:tools/fleet/router*]
- [ ] **T011** limit-детект в executor-результате (сигнатуры из T003) → cooldown провайдера + requeue слайса на следующего в цепочке; тест: стаб отдаёт 429 → слайс уезжает дальше
- [ ] **T012** heal-эскалация: красный оракул → 1 heal тем же провайдером → 1 heal claude → слайс failed, fleet продолжает остальные; тест на стабах

## Phase E — обвязка
- [ ] **T013** [P] fleet.js status (таблица: слайс/воркер/провайдер/статус/время из claims+events) + обёртка tools/elt-fleet.ps1 с -Panes (wt split-pane, Get-Content -Wait по логам воркеров); тест status на фикстурах [files:tools/fleet/fleet*,tools/elt-fleet.ps1]
- [ ] **T014** [P] doctor: чеки воркеров (stale claims, брошенные .fleet-wt, `<cli> --version` pre-flight) в ДЕФОЛТНЫЙ прогон doctor текущего проекта — НЕ под существующий `--fleet` (тот = здоровье парка проектов, 549f15a); тест [files:tools/project-docs-core.js,tools/doctor*]
- [ ] **T015** доки: /elt SKILL.md — режим «fleet» (порог ≥3 [P]-слайсов, как запускать/следить/стопить) + PLAYBOOK.md + CLAUDE.md Commands; оракул: doctor docs-чеки зелёные

## Phase F — live-fire
- [ ] **T016** [live] бенч: scratch-план с 4+ честными [P]-слайсами — `fleet run --workers 2` до конца vs последовательный baseline; метрики (wall-clock, провайдеры, судья 100%) в run-log; итог в чекпоинт
- [ ] **T017** [live] драки: STOP посреди прогона → resume добирает; 429-инъекция на живом плане → failover; счётчик agy-вызовов и limitHit видны в ledger; CHECKPOINT с вердиктом v1
