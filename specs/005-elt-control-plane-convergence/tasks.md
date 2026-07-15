# 005 — ELT Control Plane Convergence · tasks

> Затверджено 2026-07-15. Реалізацію починати в новому чаті з T001.  
> Формат парсера: `- [ ] **Txxx**`. Порядок є dependency order; Fleet не запускати до T021.  
> Загальний oracle до його заміни: `node tools/doctor.test.js; if ($LASTEXITCODE -eq 0) { node --test tools/fleet/*.test.js }`.

## P0-A — механічна чесність ELT

- [X] **T001** Додати єдиний fail-closed validator `.harness/harness.json`: явний `kind`, непорожній oracle/artifact verifier, валідний judge config; підключити його до `elt`, bootstrap і doctor без трьох копій правил.  
  **Docs/API:** `spec.md` §5.1, §4; `tools/elt.js:loadConfig`, `tools/doctor-core.js`.  
  **Proof:** fixture-тести missing/empty/malformed → nonzero; чинний config → pass.  
  **Guard:** не вводити schema dependency; Node stdlib, короткий модуль лише тому, що є 3 consumers. `[files:tools/elt-config.js,tools/elt-config.test.js,tools/elt.js,tools/doctor-core.js,tools/project-bootstrap.js]`

- [X] **T002** Реалізувати judge-proof schema/read/write/validate у git-dir з binding `taskId + specPath + baseHead + treeHash + oracleProofHash`; missing/stale/block/dead мають різні machine-readable причини.  
  **Docs/API:** `spec.md` §5.2; перевикористати `treeHash()`/oracle-proof path; structured verdict із `tools/fleet/gate.js`.  
  **Proof:** unit fixtures для valid, malformed, stale tree, wrong task, block, judge-dead.  
  **Guard:** proof — процесний інваріант, не криптографічна security boundary; не додавати PKI/signing. `[files:tools/elt.js,tools/elt-judge-proof.test.js]`

- [X] **T003** Додати `elt checkpoint` як єдиний no-judge шлях, жорстко обмежений `.planning/**` і `specs/**`; code/config зміни блокувати до staging/commit.  
  **Docs/API:** `spec.md` AC05; існуючі `findTasks()`, git helpers у `tools/elt.js`.  
  **Proof:** temp repo: planning-only commit pass; `tools/x.js`, `.harness/harness.json`, mixed diff → nonzero і без commit.  
  **Guard:** не робити загальний `--no-judge`/`--force`; allowlist вузький і тестований. `[files:tools/elt.js,tools/elt-checkpoint.test.js]`

- [X] **T004** Зробити `elt commit` fail-closed: прибрати authority вільного `--verdict`, вимагати актуальний judge proof після зеленого oracle, валідувати task/spec/tree перед `git commit`.  
  **Docs/API:** `spec.md` AC03–AC04; `tools/elt.js` commit flow; результат T002.  
  **Proof:** integration temp repo: missing/stale/block/dead → commit count незмінний; valid pass → один commit.  
  **Guard:** oracle залишається механічним і не може бути «прощений» суддею. `[files:tools/elt.js,tools/elt-commit-proof.test.js]`

- [X] **T005** Підключити proof producer до `elt-loop.ps1` і Fleet gate: суддя пише schema-valid proof для поточного worktree; прибрати mutating `git add -N` із solo snapshot; пустий output/timeout/spawn fail не маскується під content block; retry не переносить proof на new tree.
  **Docs/API:** `spec.md` §5.2; `tools/fleet/gate.js:runJudge/gate`; liveness контракт spec 004.  
  **Proof:** stub judge pass/block/empty/timeout; один end-to-end slice без live LLM; після кожного exit path `git diff --cached --name-only` і `git status --porcelain` не містять створеного драйвером intent-to-add сміття.  
  **Guard:** один формат proof для solo і Fleet; не створювати окремий Fleet judge protocol. `[files:tools/elt-loop.ps1,tools/fleet/gate.js,tools/fleet/gate.test.js,tools/fleet/judge-invoke.js]`

- [X] **T006** Прибрати self-dirty: перенести runtime run-log у `.git/elt/run-log.jsonl`, мігрувати tracked `.harness/run-log.jsonl` без втрати, оновити всіх producers/readers і завершувати успішний commit чистим деревом.  
  **Docs/API:** `spec.md` §5.3, AC06; `appendRunLog()` у `tools/elt.js` і `tools/fleet/fleet.js`.  
  **Proof:** temp repo з legacy log → migration count збережений; два commits → `git status --porcelain` порожній; telemetry читається.  
  **Guard:** не видаляти поточний user log до backup/count verification; не змішувати runtime state з config у `.harness`. `[files:tools/elt.js,tools/fleet/fleet.js,tools/fleet/router.js,tools/doctor-core.js,.gitignore]`

- [X] **T007** Додати repo-native `elt gate`, повний control-plane test oracle і managed git pre-commit/CI entrypoint: direct code commit без актуальних proofs блокується; `elt checkpoint` пропускає лише allowlist; client hooks лишаються optional UX. Поточний oracle, який запускає лише doctor + Fleet, замінити discovery/manifest-підходом, що включає всі `tools/**/*.test.js`, зокрема ELT/bootstrap/project-docs.  
  **Docs/API:** `spec.md` §5.3; існуючий Git workflow; не перевикористовувати obsolete `install-harness-teeth.js`.  
  **Proof:** temp repo direct `git commit` red; `elt commit` green; hook bypass окремо виявляється CI verify; навмисно failing новий `tools/*.test.js` робить загальний oracle red; PowerShell/Windows smoke.  
  **Guard:** gate не викликає LLM і не додає per-turn token tax; один executable contract для hook і CI. `[files:tools/elt.js,tools/elt-gate.test.js,.githooks/pre-commit]`

## P0-B — canonical project bootstrap

- [X] **T008** Перебудувати `project-bootstrap inspect` і `plan` як read-only модель target state для `code|docs|unknown`, з JSON output і явними decisions для oracle, CodeGraph та git gate.  
  **Docs/API:** `spec.md` §5.4; зберегти корисні fixtures/detectStack із `tools/project-bootstrap.js`.  
  **Proof:** before/after hash target directory однаковий; plan deterministic; unknown не отримує вигаданий oracle.  
  **Guard:** не сканувати весь ПК; лише вказаний root і registry metadata. `[files:tools/project-bootstrap.js,tools/project-bootstrap.test.js]`

- [X] **T009** Реалізувати ідемпотентний `project-bootstrap apply`: project docs, `.planning/STATE.md`, harness config, git hygiene, managed gate, optional CodeGraph і registry — тільки з plan; прибрати створення `.rag`, `.graphifyignore`, pipeline-state та obsolete hooks.  
  **Docs/API:** `spec.md` §5.4; `tools/project-docs-core.js`, `elt init`, результат T007–T008.  
  **Proof:** перший apply створює точний manifest; другий `changed=[]`; protected blocks і user files байт-ідентичні.  
  **Guard:** destructive cleanup legacy артефактів не робити тут — лише report; видалення в T020. `[files:tools/project-bootstrap.js,tools/project-bootstrap.test.js]`

- [ ] **T010** Реалізувати `project-bootstrap verify` як fail-closed semantic check: docs, harness config, oracle/verifier, gate, skill availability, spec readiness і clean-tree signal; verify ніколи не repair.  
  **Docs/API:** `spec.md` AC07–AC11; validators T001, project-docs T014.  
  **Proof:** по одному negative fixture на кожний контракт; JSON і text exit semantics збігаються.  
  **Guard:** відсутність active spec у щойно створеному idle-проєкті = explicit idle, не fake PASS і не hard fail. `[files:tools/project-bootstrap.js,tools/project-bootstrap.test.js]`

- [ ] **T011** Додати deterministic `project-bootstrap live-fire` на disposable temp repo: apply×2 → red oracle → green implementation fixture → stub judge proof → guarded commit → clean tree.  
  **Docs/API:** `spec.md` AC07; ELT CLI T001–T007.  
  **Proof:** одна команда/тест перевіряє всі переходи й negative judge path без платного API/LLM.  
  **Guard:** target project не використовується як scratch; temp repo гарантовано прибирається після тесту. `[files:tools/project-bootstrap.js,tools/project-bootstrap.e2e.test.js]`

- [ ] **T012** Виправити strict YAML frontmatter і скоротити `project-bootstrap` skill до thin orchestrator одного CLI; синхронізувати Claude/Codex/Gemini mirrors через штатний supply-chain workflow.  
  **Docs/API:** `spec.md` AC08; офіційний принцип focused skill/progressive disclosure.  
  **Proof:** strict parser pass для трьох mirrors; skill smoke викликає `inspect→plan`, не дублює policy; diff mirrors нульовий.  
  **Guard:** не редагувати три копії вручну; source → sync → audit. `[files:skills/project-bootstrap/SKILL.md,agent-skills.lock.json]`

- [ ] **T013** Розширити supply-chain manifest/audit так, щоб `elt`, його aliases і `project-bootstrap` були обов'язковими critical targets; invalid YAML, missing mirror або content drift → fail.  
  **Docs/API:** `spec.md` AC09; `tools/doctor-core.js:checkAgentSkillSupplyChain`.  
  **Proof:** fixture delete/drift/YAML error для кожного critical skill; `agent-skills.cmd audit` nonzero, після sync — pass.  
  **Guard:** не додавати весь каталог skills у mandatory surface; тільки control-plane critical set. `[files:agent-skills.lock.json,tools/doctor-core.js,tools/doctor.test.js]`

## P1-A — docs, health і безпечний rollout

- [ ] **T014** Зробити project-docs semantic verifier чесним: 9 секцій (`Overview`, `Stack`, `Structure`, `Commands`, `Code style`, `Testing`, `Commit & PR`, `Gotchas`, `Memory`), `coreIdentical=true` входить в success, unknown sections лише explicit protected/local; припинити створення `.rag`.  
  **Docs/API:** `spec.md` AC10; parser/protected blocks у `tools/project-docs-core.js`.  
  **Proof:** missing section, drift, garbage non-core, protected local, idempotent sync; `verify` nonzero на перших трьох.  
  **Guard:** невідомий user content не видаляти мовчки — report + explicit migration. `[files:tools/project-docs-core.js,tools/project-docs.js,tools/project-docs.test.js]`

- [ ] **T015** Перебудувати `doctor --fleet` на domain-aware readiness: missing/non-git/code/docs/unknown, config schema, real oracle/verifier, tasks/state, gate, CodeGraph policy; PASS лише для повного контракту типу проєкту.  
  **Docs/API:** `spec.md` AC11; `checkFleetProject()`/registry helpers у `tools/doctor-core.js`.  
  **Proof:** table-driven fixtures для всіх класів; text/JSON counts узгоджені; false-green fixture red.  
  **Guard:** docs/office проєкти не змушувати мати code tests; classification має бути явною. `[files:tools/doctor-core.js,tools/doctor.test.js]`

- [ ] **T016** Додати fleet-wide bootstrap migration planner: read-only аналіз усього current registry, machine-readable per-project actions/risk/domain; жодних writes без окремого `apply --project` і user confirmation.  
  **Docs/API:** `spec.md` AC12; registry з project-docs/doctor; canonical plan T008.  
  **Proof:** hash/mtime registry projects до/після dry-run незмінні; report totals reconcile до registry; missing paths не crash.  
  **Guard:** ніякого `apply-all` у цій спеці; rollout по одному pilot/domain batch у майбутньому. `[files:tools/project-bootstrap.js,tools/project-bootstrap.test.js,.planning]`

- [ ] **T017** Додати repo-документацію та doctor signal для Codex profiles: safe default і explicit privileged profile; небезпечне `danger-full-access + approval=never` позначати high-risk, але global config не змінювати автоматично.  
  **Docs/API:** `spec.md` §5.5, AC13; OpenAI sandboxing guidance; `checkCodexDefaults()`.  
  **Proof:** fixtures safe/risky/missing; doctor severity правильна; окремий manual smoke для Claude/Codex surface parity.  
  **Guard:** будь-яка реальна зміна `%USERPROFILE%/.codex/config.toml` — лише після нового явного підтвердження користувача. `[files:docs/CODEX-PROFILES.md,tools/doctor-core.js,tools/doctor.test.js]`

## P1-B — convergence і видалення legacy

- [ ] **T018** Оголосити ELT єдиною active code route у PLAYBOOK/AGENTS/CLAUDE/GEMINI/skills; Pipeline v3, old harness і install-harness-teeth перевести у deprecated error з посиланням на migration plan; прибрати stale health noise.  
  **Docs/API:** `spec.md` AC01; поточні route docs і usage scan.  
  **Proof:** `rg` active-route allowlist; docs sync audit; legacy CLI invocation nonzero з actionable message; 7-day usage baseline збережений у checkpoint.  
  **Guard:** compatibility shim тільки якщо є підтверджений caller; без caller — видалення в T019/T020. `[files:PLAYBOOK.md,AGENTS.md,CLAUDE.md,.gemini/GEMINI.md,tools/doctor-core.js]`

- [ ] **T019** Видалити old Pipeline v3 / Agent Harness runtime (`harness-runner`, `harness-gates`, `pipeline-state`) і тести після zero-caller proof; перенести лише ще потрібні негативні сценарії в ELT tests.  
  **Docs/API:** `spec.md` §9, AC14–AC15; call/import scan перед delete.  
  **Proof:** `rg` zero active callers; загальний oracle green; skipped/absent test closeout negative test живе у новому gate; LOC delta зафіксований.  
  **Guard:** не зберігати мертву abstraction «про всяк випадок»; git history є rollback. `[files:tools/harness-runner.js,tools/harness-gates.js,tools/pipeline-state.js,tools/*harness*.test.js]`

- [ ] **T020** Видалити old bootstrap advisor/installer, RAG/Graphify/codemap paths і відповідні doctor checks після canonical bootstrap migration; архівувати AMOS/audit history поза active runtime лише після link scan.  
  **Docs/API:** `spec.md` §9, AC14; результати T009, T014, T016, T018.  
  **Proof:** `rg` zero active callers/links; bootstrap + doctor tests green; fresh repo не створює legacy files; LOC/artifact delta у checkpoint.  
  **Guard:** не видаляти user project data масово; тут чиститься control-plane repo, а registry projects отримують лише future explicit plans. `[files:tools/install-harness-teeth.js,tools/codemap.js,tools/doctor-core.js,amos,audit]`

## P2 — Fleet economics і release proof

- [ ] **T021** Зробити Fleet ledger правдивим: кожен implement/heal/judge spawn має phase/provider/model/duration/exit; unavailable tokens/cost = `unknown`, aggregation не перетворює unknown на 0; hard budgets рахують calls до spawn.  
  **Docs/API:** `spec.md` AC16; `tools/fleet/router.js:ledgerEntry`, providers/fleet call tracker; spec 003 caps.  
  **Proof:** replayable mocks для success/limit/timeout/unknown usage; totals reconcile до кількості spawn; budget boundary stop до N+1 call.  
  **Guard:** не заявляти token savings за proxy wall-time або CLI runtime. `[files:tools/fleet/router.js,tools/fleet/fleet.js,tools/fleet/providers.js,tools/fleet/*.test.js]`

- [ ] **T022** Провести контрольований Fleet-vs-solo A/B на однаковому start commit, task corpus, oracle і judge rubric; два повтори; зафіксувати quality, wall time, calls, tokens/cost, failures і uncertainty; винести keep/experimental/simplify verdict.  
  **Docs/API:** `spec.md` AC17; spec 003 acceptance; попередній A/B checkpoint не вважати автоматично прийнятим.  
  **Proof:** replay script + raw ledgers + summary checkpoint; всі slices мають однаковий acceptance result.  
  **Guard:** rate-limit/unknown usage позначає run inconclusive, а не green; не витрачати paid API без окремого budget approval. `[files:tools/fleet,.planning]`

- [ ] **T023** Фінальний release proof: fresh disposable repo та один user-approved real pilot проходять bootstrap×2, red→green, oracle, live judge, guarded commit, clean tree і doctor; два повтори; оновити STATE/checkpoint та закрити 005 тільки за всіма AC.  
  **Docs/API:** `spec.md` AC01–AC18; результати T001–T022.  
  **Proof:** exact commands, exit codes, commit SHA, clean-tree output, doctor JSON і negative-path suite у фінальному checkpoint.  
  **Guard:** жодного mass rollout; якщо хоча б один AC не доведений, task/spec лишаються відкритими з конкретним blocker. `[files:.planning/STATE.md,.planning/CHECKPOINT-*,specs/005-elt-control-plane-convergence/tasks.md]`
