# CHECKPOINT 2026-07-16 — 005 T019+T020 закрыты, resume T021

## Статус: 20/23. Дерево чистое. Ветка `feature/elt-control-plane-convergence`.

`specs/005-elt-control-plane-convergence`. Эта сессия закрыла P1-B код-удаления T019 и T020.
Осталось: **T021** (код, делать в свежем чате) + **T022/T023** (внешние блокеры, автономно нельзя).

## Сделано этой сессией

### T019 — `e80c390` (судья sonnet pass, оракул 41/41)
Удалён old Pipeline v3 / Agent Harness runtime: `harness-runner.js`, `harness-gates.js`,
`pipeline-state.js` + их тесты. Расцеплены потребители (doctor-core.js/git-workflow-audit.js:
инлайн `normalizePath`/`projectKey`). Был заблокирован хроническим env-flake — починен durable:
`tools/sync-agent-surface.test.js:444` timeout 10s→60s (Suite 12 CLI dry-run `spawnSync cmd.exe
ETIMEDOUT` под нагрузкой; ассерт не тронут). Flake-fix вошёл в дерево T019 (git add -A не даёт
отдельный коммит без task-слота), судья это оценил и pass.

### T020 — `78a6745` (судья sonnet pass, оракул 35/35)
Удалено 16 файлов (~1837 LOC): codemap.js/-core/-measure/-benchmark (+3 теста),
project-bootstrap-advisor.js (+тест), install-project-bootstrap-advisor.js (+тест),
install-harness-teeth.js, install-doc-skills.js, memory-provider.js (+тест),
legacy-deprecation.test.js. Расцеплены: doctor-core.js (checkGraphify/checkRag/checkMemoryProvider
+ codemap-provider хвост checkCodeGraph + `.rag` marker + --no-graphify/--memory-provider флаги),
project-bootstrap.js (graphify/rag actions+checks+.rag cleanup), agent-surface-audit.js (codemap-блок),
research-router.js (codemapSource+ragSource). Test surgery в doctor/project-bootstrap/
agent-surface-audit/research-router тестах (удалены ТОЛЬКО ассерты удалённого, часть → guard
«.rag/.graphifyignore больше не создаются»). elt-oracle-runner.js SKIP опустошён.
**Реальный CodeGraph НЕ тронут** (checkCodeGraph/Mcp/Adoption целы) — снят только legacy codemap.
**amos/audit → archive/** (`git mv`, 238 renames, по явному выбору юзера «переместить, не удалять»;
link-scan заранее: 0 активных код-ссылок). Untracked recon-файлы audit/ подхвачены git add -A в archive/.
Осознанно оставлено (не scope): hook-diet.js `graphify-auto-update` regex (generic), strategy-label
`project-docs-codemap-first` (косметика), install-doc-skills в 2 старых .planning-доках.

## Осталось

- **T021 (код, свежий чат):** Fleet ledger truthfulness. Каждый implement/heal/judge spawn несёт
  phase/provider/model/duration/exit; unavailable tokens/cost = `unknown` (НЕ 0); hard budgets
  считают calls ДО spawn. `[files: tools/fleet/router.js (ledgerEntry), fleet.js, providers.js,
  tools/fleet/*.test.js]`. Proof: replayable mocks success/limit/timeout/unknown; totals reconcile
  до кол-ва spawn; budget boundary stop до N+1 call. spec AC16.
- **T022 — ВНЕШНИЙ БЛОКЕР:** Fleet-vs-solo A/B. Нужен paid API + отдельный budget approval +
  снятие Ametryn rate-limit паузы. Автономно закрыть нельзя (guard: rate-limit = inconclusive, не green).
- **T023 — ВНЕШНИЙ БЛОКЕР:** финальный release proof на 1 fresh fixture + 1 real user-approved pilot,
  live judge, 2 повтора. Нужен paid API + явное подтверждение юзера. Закрывает 005 только по ВСЕМ AC.

## Proof (зелёное)
```
T019: node tools/elt-oracle-runner.js → 41/41; судья sonnet pass; commit e80c390; tree clean.
T020: node tools/elt-oracle-runner.js → 35/35; судья sonnet pass; commit 78a6745; tree clean.
rg require(codemap|memory-provider|install-harness-teeth|install-doc-skills|bootstrap-advisor) tools → пусто (AC14).
```

## Resume prompt (T021, свежий чат)
```text
elt
Продолжай specs/005-elt-control-plane-convergence: T019+T020 закрыты (20/23, e80c390/78a6745,
дерево чистое). Дальше T021 — Fleet ledger truthfulness (tools/fleet/router.js:ledgerEntry +
fleet.js/providers.js + *.test.js): каждый implement/heal/judge spawn несёт phase/provider/model/
duration/exit; unavailable tokens/cost = unknown НЕ 0; hard budgets считают calls до spawn; proof =
replayable mocks (success/limit/timeout/unknown) + totals reconcile + budget boundary stop до N+1.
См. .planning/CHECKPOINT-2026-07-16-T019-T020-closed-resume-T021.md.
После T021: T022/T023 — ВНЕШНИЕ блокеры (paid API + Ametryn rate-limit + budget/pilot approval юзера),
автономно не закрыть — доложить юзеру и остановиться.
```
