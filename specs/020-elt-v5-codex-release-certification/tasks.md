# Tasks — 020 ELT v5 fail-closed Codex release certification

- [X] **T001** Закрити D25 чотирма регресами: `opus-5` → 1M і small-моделі → 200k;
  ручний хвіст checkpoint переживає повторну ротацію; deployed hook знаходить CLI проєкту;
  gateActive блокує запис під час oracle/judge/commit. Розгорнути source у
  `~/.claude/hooks/checkpoint-writer.js` і довести SHA-256 equality.
  [files: tools/checkpoint-writer.js tools/elt-checkpoint.test.js .planning/HARNESS-DEFECTS-REGISTRY-2026-08-21.md]

- [X] **T007** Background fail-closed: `dead`, malformed, timeout, exception та несподіваний
  verdict не можуть дати `background-verify-pass`; `inconclusive` має окремий terminal-state і
  queue item. Після `ensureWorktree` cleanup завжди у `finally`, terminal error пишеться навіть
  при exception, а конфіг береться з commit/worktree snapshot. Додати дискримінуючі регреси й
  reconcile `5a9bf7a`/`8af6c73` доказом у звіті, не тихим видаленням.
  [files: tools/elt-verify-bg.js tools/elt-verify-bg.test.js tools/harness-watch.js tools/harness-watch.test.js .planning/ELT-V5-BACKGROUND-RECONCILIATION-2026-08-24.md]

- [X] **T002** Закрити background finding T018: language-aware import scan не гасить JS
  private field `#client = require('pkg')` і `${require('pkg')}`, але ігнорує текст у
  звичайній quoted/template string та справжні коментарі. Після green proof закрити
  `elt review close --task T018`.
  [files: tools/elt-gate-l0.js tools/elt-gate-l0.test.js .elt/ledger.jsonl]

- [X] **T003** Замкнути README на versioned KPI snapshot: усі поточні відсотки мають
  фіксований `--as-of`, окремі LOC/defect counts або власну команду, або прибрані; regression
  порівнює README зі snapshot. Після green proof закрити `elt review close --task T016`.
  [files: README.md tools/kpi-commit-share.js tools/kpi-commit-share.test.js tools/kpi-release-snapshot.json]

- [X] **T004** Аудит глобальних `~/.claude/hooks/`: зіставити активні hooks із settings/config,
  знайти посилання на видалені `fleet`, `elt-loop`, `sync-bin` і локальні source-копії.
  Окремо зіставити repo `skills/elt` з активними Codex/Claude/Gemini surfaces. Відомий source
  drift синхронізувати; невідомі/сторонні hooks не видаляти. Зберегти відтворюваний звіт із
  командами, SHA-256 і exact counts.
  [files: .planning/ELT-V5-GLOBAL-HOOKS-AUDIT-2026-08-24.md]

- [ ] **T008** Spec-bound runtime identity: parked/review rows несуть `specPath`; background rows
  додатково мають `commit` і `layer`. `slice next --spec specs/019-...` бачить 019/T020 попри
  legacy parked T020, а `review close` закриває рівно названу identity. Legacy rows мігруються
  fail-closed; регреси мають дві spec з однаковими T005/T020.
  [files: tools/elt.js tools/elt-review.test.js tools/elt-verify-bg.js tools/elt-verify-bg.test.js tools/elt-park.test.js]

- [ ] **T009** Реальний fail-closed git/release gate: bootstrap активує виконуваний pre-commit
  через repo-local `core.hooksPath` (або еквівалент із тим самим доказом), verify перевіряє
  фактичний hook відмовним commit-probe. `treeHash` відхиляє git/ENOBUFS і тримає >1 MiB diff;
  push failure повертає non-zero. Залишити runnable regressions на кожен шлях.
  [files: tools/project-bootstrap.js tools/project-bootstrap.test.js tools/elt.js tools/elt-oracle-proof.test.js tools/elt-commit-proof.test.js .githooks/pre-commit]

- [ ] **T010** Канонічний five-lens review runtime: пʼять `agents/review-*.md` запускаються
  паралельно на одному diff, потім рівно один `confidence-scorer` дає фінальну класифікацію.
  `<80` автоматично пишеться в ledger як `weak-signal`, `>=80` впливає на verdict; той самий
  код викликають sync і background paths. Dead lens/scorer видимий і не зелений; ручний
  `/elt-verify` лише UI над цим runtime. Довести контракт provider fixtures та живим вузьким
  Codex-прогоном без self-attestation.
  [files: tools/review-runtime.js tools/review-runtime.test.js tools/review-lenses.js tools/review-confidence.js tools/judge-core.js tools/judge-core.test.js tools/elt-verify-bg.js commands/elt-verify.md bin/ledger.js]

- [ ] **T011** Hermetic two-OS CI і runtime doctor: повний named oracle зелений на GitHub
  `windows-latest`/`ubuntu-latest` без ambient home skills або встановленого judge; host-only
  інтеграції мають явний fixture/окремий job, не hidden skip. Закріпити third-party Actions
  immutable SHA. `bin/doctor.js` перевіряє реальне `/elt` closure, background terminality schema
  і plugin hooks/surfaces, а не лише наявність façade-файлів.
  [files: .github/workflows/test.yml tools/elt-oracle-runner.js tools/elt-oracle-runner.test.js tools/elt-skill-frontgate-contract.test.js tools/skills-frontgate-contract.test.js tools/agent-surface-audit.test.js tools/doctor.test.js bin/doctor.js bin/doctor.test.js]

- [ ] **T012** Чиста установка і client parity: додати versioned plugin hooks для
  SessionStart/Stop без абсолютних шляхів; довести приватний marketplace у fresh profile.
  Codex-native surface встановлюється з того самого repo й має v5 hash/version parity з Claude
  та Gemini без `~/.claude/bin/elt.js`. Зберегти exact install/doctor commands і не видаляти
  невідомі глобальні hooks.
  [files: hooks/hooks.json .claude-plugin/plugin.json .claude-plugin/marketplace.json skills/elt/SKILL.md bin/doctor.js docs/INSTALL.md .planning/ELT-V5-CLEAN-INSTALL-2026-08-24.md]

> **Additive graph tranche.** Зміст усіх підготовлених задач збережено. Durable IDs початкової
> approved spec відновлено: `T005` = Codex benchmark/certification, `T006` = release; додані
> reliability-слайси мають `T007–T012`. Runtime-порядок:
> bootstrap batch `T001+T007` → `T002–T004 → T008–T012 → T013–T022 → T005 benchmark → T006 release`.

- [ ] **T013** Канонічний graph contract, compiler і pure transition reducer: формалізувати
  `recon/plan/build/landing/mirror/debrief/certified/publish`, typed edges, guards, schemas,
  side effects, trust/platform/failure policy. `advance(state,event,evidence)` детерміновано
  повертає next state або `illegal-transition`; compiler відхиляє duplicate IDs, schema mismatch,
  неявні цикли й зовнішнє володіння approve/certify/commit/publish. Для identity/approve/oracle/
  certify/certificate/git/commit/merge/tag/push/release compiler примусово ставить
  `failure:block`; `skip/degrade` дозволені лише enrichment nodes. Додати окремий regression на
  спробу `skip/degrade` кожної authority capability. Старий CLI не видаляти: compatibility façade
  до green conformance. Весь новий graph release-core `≤1 500` production LOC.
  [files: graphs/schema.json graphs/elt-v5.json tools/graph-core.js tools/graph-core.test.js tools/graph-compiler.js tools/graph-compiler.test.js]

- [ ] **T014** Authoritative append-only journal, legacy cutover і derived state: versioned event несе `runId`,
  graph/lock versions, immutable spec/task identity, batch/generation, node, guard evidence,
  commit і monotonic seq; рівно один terminal event на generation. Atomic append + cross-process
  lock, idempotent replay, crash/restart і migration current parked/review rows. До exact T015
  commit діє `legacy-v1` epoch; T014 готує migration snapshot і звіряє старі
  checkbox/approval/run-log з exact `specPath/task/commit/tree/proof`, а ambiguity блокує
  майбутній cutover і нічого не видаляє. Старий write-path лишається authoritative до T015.
  Реалізувати approval schema
  `elt-approval/v1`: repo-relative POSIX paths, `spec.md→tasks.md`, file-order tasks, UTF-8/LF/NFC,
  checkbox→`[ ]`, length-prefixed records і спільний Windows/Linux golden digest fixture.
  [files: tools/graph-state.js tools/graph-state.test.js tools/graph-journal.js tools/graph-journal.test.js tools/task-identity.js tools/task-identity.test.js]

- [ ] **T015** Одна runtime-двері та feedback loop: `elt run|advance|status --json` відновлює
  journal, обчислює наступний legal edge і не вимагає памʼятати `oracle→judge→commit`.
  SessionStart inject-ить generated state + unresolved ledger; high-confidence debrief повертає
  наступну сесію в `recon`. Низькорівневі команди лишаються diagnostic façade і пишуть ті самі
  events. Після успішного replay T014 ця задача атомарно записує `legacyEpochEnd` на exact T015
  commit, перемикає authority на journal і робить `tasks.md` immutable intent:
  `open→built→landed→certified` живе лише в journal, checkbox/state.md — projections. Регреси:
  resume після compact/restart, duplicate hook, stale projection, failed cutover rollback і
  parity Claude/Codex.
  [files: tools/elt.js tools/elt-run.test.js hooks/hooks.json templates/.elt/state.md skills/elt/SKILL.md commands/elt-doctor.md]

- [ ] **T016** First-class batch landing і repair generations: planner формує ordered
  `taskIdentities[]`, `batchId`, default 3/max 4, одну approved spec, dependency-closed і
  compatible file/risk/platform zones. Focused tests виконуються всередині `build` до події
  `ready`; сам `landing` запускає тільки L0 і створює один local provisional commit без push.
  Red Mirror не відкриває другий batch: repair commit збільшує `generation`, оновлює `batchHead`
  того самого quarantined `batchId`, а всі proofs попередньої generation стають stale. Legacy
  comma arg лише façade. Регреси: split, collision, stale base, repair/replay, L0 red без commit,
  один active generation і `ready_to_local_commit` p95 `<5 s`.
  [files: tools/batch-planner.js tools/batch-planner.test.js tools/elt.js tools/elt-batch.test.js tools/elt-gate-l0.js]

- [ ] **T017** Hash-bound Mirror, certificate algebra і publish quarantine: на одному
  `batchHead/generation` рівно один impact oracle та один review-subgraph. Core-owned таблиця
  детерміновано задає required lenses і входить у evidence; high-risk/release завжди всі пʼять.
  Pass = oracle exit 0 + усі required lenses terminal-success + scorer terminal-success + zero
  findings `≥80` + exact graph/lock/spec/batch/commit/tree hashes. `unknown/error/inconclusive/
  stale` блокують publish; `<80` → weak-signal, `≥80` → debrief/recon. Batch і release
  certificates мають різні schemas; push/merge/tag/release приймають лише відповідний proof.
  [files: tools/certification.js tools/certification.test.js tools/review-runtime.js tools/elt-verify-bg.js tools/elt.js bin/ledger.js]

- [ ] **T018** Мінімальний component registry + frozen lock: namespaced pack/node IDs,
  source/version/commit/license/content hashes, platform/capability/side-effect metadata,
  collision rejection і content-addressed installed generations. Run snapshot-ить lock digest;
  pack не може promote себе або змінити lock усередині run. Старий proof стає stale при зміні
  lock. External executable nodes працюють лише out-of-process з default-empty tools через
  core capability broker; без enforceable boundary мають `unavailable`, а prompt-only nodes
  повертають schema-validated proposal без direct writes. Довести no-op resolve, missing pack,
  duplicate name, modified bytes, denied fs/git/network/secret/process і rollback generation
  receipt без підключення конкретного великого catalog.
  [files: .elt/components.json .elt/components.lock.json tools/component-store.js tools/component-store.test.js tools/component-catalog.js tools/component-catalog.test.js tools/capability-broker.js tools/capability-broker.test.js]

- [ ] **T019** Повний supported `mattpocock/skills` GrailPack поверх T018: pinned
  `5b15a47f2d7150f545fbcacbfe381787fc0230dc`, manifest SHA-256
  `6B5C85512785D36D6DA4561BB309AC11E8BD6C0C028D5777740DC01147A6A025`, рівно 25 promoted
  entries `grail/*`; 11 non-promoted не імпортуються за upstream governance. Усі 25 catalog
  entries доступні через policy, але router/spec/tickets/implement/review мапляться на ELT
  subgraphs, utilities explicit, а secret/git/network/setup nodes потребують declared edge і
  human approval. Прямі commit/issue/instruction writes перехоплюються; немає global symlink/
  copy installer, collisions або mutable `latest`. Windows CRLF smoke блокує shell-backed nodes.
  [files: packs/mattpocock-skills/manifest.json packs/mattpocock-skills/policy.yaml tools/adapters/mattpocock.js tools/adapters/mattpocock.test.js]

- [ ] **T020** Safe component-update graph: discover exact candidate → isolated staging →
  source/hash/license/path/symlink verification → semantic capability diff → SkillSpector
  `--fail-on-incomplete` → Windows/Linux smoke → contract canary → human approval на authority/
  side-effect diff → trusted-core atomic promotion. Candidate ніколи не сканує/підвищує себе;
  previous generation лишається rollback target, а rollback є новим receipt, не стиранням
  історії. Simulation: same commit no-op, docs-only auto path, invocation change block, partial
  install recovery і runtime regression rollback. Для pre-activation scan ця задача напряму
  адаптує наявний `tools/skill-scan.js`; T021 лише оформлює його як зовнішній release adapter і
  не є prerequisite T020.
  [files: tools/component-update.js tools/component-update.test.js tools/component-scan.js tools/component-scan.test.js tools/component-promote.js tools/component-promote.test.js tools/skill-scan.js tools/skill-scan.test.js]

- [ ] **T021** Release adapters для інших upstream: Spec Kit importer з explicit spec dir та
  canonical approval identity; RTK лише presentation поверх збереженого raw stdout/exit;
  SkillSpector як activation gate. OpenShell — optional/unavailable без WSL2/Linux probe,
  pinned image і Landlock `hard_requirement`; ECC — manifest/ownership/dry-run patterns без
  bundle/hooks/`git pull`; DeepSeek — lifecycle/disposer/runner contract без Cordis або gate
  authority. Для кожного adapter є `probe → ready|degraded|unavailable`, license/provenance,
  contract fixture і Windows behaviour.
  [files: tools/adapters/spec-kit.js tools/adapters/spec-kit.test.js tools/adapters/rtk.js tools/adapters/rtk.test.js tools/adapters/skillspector.js tools/adapters/skillspector.test.js tools/adapters/openshell.js tools/adapters/openshell.test.js]

- [ ] **T022** Graph conformance, docs і KPI instrumentation: runnable matrix legal/illegal
  edges, plan skip, stale approval, duplicate/replay, crash after landing, resume, terminal
  failures, repair generation, same T ID у різних spec, ledger threshold, schema upgrade,
  component update/rollback і authority bypass. `doctor` показує graph/packs як
  `ready/degraded/unavailable`; clean install + upgrade доведені на Windows/Linux. Опублікувати
  три editable diagram triplets, exact release-core LOC, ready→commit p95 і certification p50/p90.
  Pre-release safety gates: zero blocking defects, 100% reachable graph-core branches або
  documented unreachable exclusions, release-core `≤3 500` або explicit user-approved
  rebaseline. Adoption `≥80%` за тиждень і S/N `≥1:1` на 20 нових diff — observational
  post-release promotion gates; до них README показує `not yet measured`, а не fake pass.
  [files: tools/graph-conformance.test.js tools/graph-kpi.js tools/graph-kpi.test.js bin/doctor.js docs/ARCHITECTURE.md specs/020-elt-v5-codex-release-certification/diagrams/elt-v5-graph-harness.mmd specs/020-elt-v5-codex-release-certification/diagrams/elt-v5-batch-certification.mmd specs/020-elt-v5-codex-release-certification/diagrams/elt-v5-safe-update.mmd]

- [ ] **T005** Preregistered authoritative benchmark + Codex live certification: зафіксувати
  dataset revision, evaluator/toolchain image digest і щонайменше три задачі Aider Polyglot до
  запуску; для кожної створити arms `plain Codex`/`Codex + ELT` від одного seed SHA з однаковими
  prompt/model/effort/coding budget, grader hashes і worker/coding timeout. Primary endpoint обох
  arms — candidate commit у тому самому independent grader. Preregistration задає randomized
  order, retry/exclusion policy, окремий ELT certification ceiling і не змінюється після першого result. Зібрати
  success, wall-clock, calls, tokens/cost або `missing`, TP/FP/miss/unknown; окремо показати
  coding-agent budget, ELT review/certification overhead і total-arm system cost/time; certification
  timeout не змінює primary pass-rate і класифікується окремо. ELT-arm завершується
  certified batch, publish receipt і run-log. Один кейс = plumbing, три = лише directional evidence.
  [files: benchmarks/README.md benchmarks/preregistration-v5.0.0.json benchmarks/results-v5.0.0.json .planning/ELT-V5-CODEX-LIVE-CERT-2026-08-24.md]

- [ ] **T006** Release engineering і фінальне закриття: додати SemVer/runbook і механічну
  перевірку узгодженості version; README публікує benchmark-таблицю з raw evidence і чесною
  межею claim. Спочатку створити final `prepare-release` commit із version/docs/state/queue;
  потім без жодного запису в certificate-bound tree: full oracle → усі 5 lenses → scorer →
  release certificate з `releaseId`, ordered `specIdentities[]`, ordered batch-certificate digests,
  zero-open-task proof і точними commit/tree/graph/lock hashes → annotated tag `v5.0.0` →
  push/tag/GitHub Release receipts. Нуль release `bg-silent`/orphan/open queue, remote CI зелений;
  закрити 019/T020 через spec-bound identity і створити/перевірити `main`. Будь-яка зміна після
  certificate вимагає нового prepare-release commit і повного протоколу. Branch protection
  і no-force/tag protection увімкнути, якщо API/тариф дозволяє; post-push verifier звіряє remote
  tag SHA. Інакше записати точну відмову та `tagProtection: unavailable` без claim immutability.
  [files: README.md CHANGELOG.md .planning/STATE.md .planning/PROJECT-HISTORY.md docs/RELEASING.md tools/version-check.js tools/version-check.test.js]
