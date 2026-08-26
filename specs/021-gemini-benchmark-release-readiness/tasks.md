# Tasks — 021 Gemini benchmark і GitHub release readiness

- [X] **T001** Закрити D27: довести шість Windows-green/Linux-red випадків до
  platform-hermetic контрактів, залишити найменші discriminating regressions і відтворити
  точні попередні CI failures локально або в Linux-контейнері.
  [files: tools/adapters/openshell.js tools/adapters/openshell.test.js tools/agent-surface-audit.js tools/agent-surface-audit.test.js tools/doctor.test.js tools/elt-config.test.js tools/git-workflow-audit.js tools/judge-core.js tools/judge-core.test.js tools/project-bootstrap.js tools/project-bootstrap.test.js .planning/HARNESS-DEFECTS-REGISTRY-2026-08-21.md]

- [X] **T007** Закрити два post-commit дефекти, знайдені фоновим суддею T001: зберегти
  розпізнавання UNC share root незалежно від платформи та fail-closed контракт `fileCount`,
  якщо корінь або вкладений каталог неможливо прочитати. Додати мінімальні runnable regressions
  і повторити targeted перевірки на Windows та Linux.
  [files: tools/git-workflow-audit.js tools/git-workflow-audit.test.js tools/project-bootstrap.js tools/project-bootstrap.test.js]

- [X] **T002** Перенести benchmark із session scratchpad у versioned, resume-safe контур:
  Gemini-only runner, append-only raw logs, deterministic dataset builder, integrity/anti-leak
  checks, transport-only retry та machine-generated summary. Зафіксувати preregistration і hash
  runner'а до першого нового result row; старі змішані результати зареєструвати як
  `invalid-for-claim` без включення в headline.
  [files: benchmarks/gemini-3.7-flash-high/preregistration.json benchmarks/gemini-3.7-flash-high/runner.js benchmarks/gemini-3.7-flash-high/runner.test.js benchmarks/gemini-3.7-flash-high/build-gate-dataset.js benchmarks/gemini-3.7-flash-high/summarize.js benchmarks/gemini-3.7-flash-high/README.md benchmarks/README.md]

- [X] **T003** Виконати повний Gemini-only benchmark: paired writer A/B 30+30 на
  `Aider-AI/polyglot-benchmark@7e0611e` і bare-vs-`judgeDiff` gate A/B на preregistered
  збалансованій SWE-bench вибірці. Дозапустити лише transport failures, згенерувати raw results,
  checksums, summary та 95% CI; заборонити claim, якщо будь-яка рука неповна. Рука `bare`
  рахується аналітично (конвеєр без гейта пропускає все за визначенням), бо per-instance
  SWE-bench test harness у цьому репозиторії відсутній — відхилення і його ціна для claim
  зафіксовані в `preregistration-gate.json` ДО першого рядка результату.
  [files: benchmarks/gemini-3.7-flash-high/writer-results.jsonl benchmarks/gemini-3.7-flash-high/gate-results.jsonl benchmarks/gemini-3.7-flash-high/transport-failures.jsonl benchmarks/gemini-3.7-flash-high/results.json benchmarks/gemini-3.7-flash-high/checksums.sha256 benchmarks/gemini-3.7-flash-high/README.md benchmarks/gemini-3.7-flash-high/preregistration-gate.json benchmarks/gemini-3.7-flash-high/gate-runner.js benchmarks/gemini-3.7-flash-high/gate-runner.test.js benchmarks/gemini-3.7-flash-high/gate-summarize.js benchmarks/gemini-3.7-flash-high/build-gate-dataset.js benchmarks/gemini-3.7-flash-high/runner.test.js benchmarks/gemini-3.7-flash-high/export-swebench.py tools/judge-core.js tools/elt-oracle-runner.js tools/elt-oracle-runner.test.js CLAUDE.md AGENTS.md .gemini/GEMINI.md]

- [X] **T004** Зробити GitHub front page release-grade: короткий перший екран, чесні badges,
  5-хвилинний quick start, один наскрізний приклад слайса, схема гейта, результати benchmark із
  межами claim, install/update/rollback/troubleshooting. Прибрати або позначити застарілі KPI;
  CLI help має називати поточний runtime ELT v5, а не історичний v3, із regression-тестом.
  Сторінка англомовна: README, обидва docs і benchmark-звіт — англійською, з діаграмами.
  [files: README.md docs/INSTALL.md docs/USAGE.md benchmarks/README.md benchmarks/gemini-3.7-flash-high/README.md benchmarks/gemini-3.7-flash-high/checksums.sha256 tools/elt.js tools/elt-cli.test.js tools/kpi-release-snapshot.json tools/kpi-commit-share.test.js bin/doctor.test.js specs/021-gemini-benchmark-release-readiness/diagrams/elt-release-flow.mmd specs/021-gemini-benchmark-release-readiness/diagrams/elt-release-flow.svg]

- [X] **T005** Довести реальну працездатність із чистого середовища: fresh project/plugin
  install, `bin/doctor`, first `/elt` bootstrap, Codex/Gemini surface parity та headless `agy`
  smoke на `gemini-3.7-flash-high`. Зберегти exact commands, exits і hashes у release evidence.
  [files: tools/smoke-elt-deploy.js tools/smoke-elt-deploy.test.js docs/INSTALL.md .planning/ELT-V5-RELEASE-CANDIDATE-2026-08-25.md]

- [X] **T006** Закрити release gate: повний oracle + smoke + doctor, рівно один Codex-judge,
  ELT commits, push feature branch, зелена GitHub Actions matrix на Windows/Linux, `main` як
  default branch, release-ready description/topics і нуль blocking review rows. Public visibility,
  tag та GitHub Release не створювати до фінального підтвердження користувача.
  [files: .github/workflows/test.yml .claude-plugin/plugin.json .claude-plugin/marketplace.json README.md .planning/ELT-V5-RELEASE-CANDIDATE-2026-08-25.md tools/elt-brief.test.js]

- [X] **T008** Довести матрицю GitHub Actions до зеленого на обох платформах: після 021/T003
  корінь `benchmarks/` уперше потрапив під оракул і оголив тест, який не гонявся жодного разу
  (`gradePolyglotWriter` кличе справжній pytest, якого на раннері немає) — поставити Python і
  pytest у workflow, НЕ послаблюючи тест. Решта — залишок D27, який T001 оголосила закритим, а
  матриця спростувала: `isDiskRoot: C: returns true` і `D:` червоні на Linux,
  `openshell` вимагає Landlock, `doctor`/`project-bootstrap` роблять strict-equal на
  платформозалежних значеннях, `judge-core` падає на Windows через 8.3-імена
  (`git diff HEAD -- ../../../../RUNNER~1/...`), а `runGitWorkflowAudit` — на generated
  planning state. Доказ — run 32953338668 (ubuntu 104/109, windows 105/109). Кожен випадок
  довести до platform-hermetic контракту з найменшим discriminating regression; тести не
  видаляти і не послаблювати. Критерій закриття — свіжий push дає зелену матрицю на
  `windows-latest` і `ubuntu-latest`.
  [files: .github/workflows/test.yml tools/adapters/openshell.js tools/adapters/openshell.test.js tools/doctor.test.js tools/doctor-core.js tools/project-docs-core.js tools/git-workflow-audit.js tools/git-workflow-audit.test.js tools/judge-core.js tools/judge-core.test.js tools/project-bootstrap.js tools/project-bootstrap.test.js benchmarks/gemini-3.7-flash-high/runner.test.js]

- [ ] **T009** T008 закрита передчасно: коміт `8d92d9b` пройшов локальний гейт, але свіжий push
  (run 32959223063) лишився червоним на ОБОХ платформах — той самий клас дефекту, що й D27/T001
  ("закрита невірно, це записано тут, а не заглажено"). Ubuntu: `gradePolyglotWriter` тепер реально
  кличе pytest, але `sol.py` переписується і перегрейдиться в межах однієї секунди — CPython кешує
  `.pyc` по mtime, і другий прогін виконує СТАРИЙ байткод (`true == false` замість очікуваного fail
  на свідомо зламаному рішенні). Windows: `runGitWorkflowAudit: generated planning state does not
  dirty-block closeout` падає на `audit.summary.status` — тестовий репозиторій створюється під
  `os.tmpdir()` (на windows-latest це `D:\a\_temp`, Dev Drive/ReFS), і git позначає щойно
  ініціалізований СВОЇМ ЖЕ процесом репозиторій "dubious ownership"; `actions/checkout` реєструє
  `safe.directory` лише для шляху чекауту, не для всього `D:\`. Критерій закриття — той самий, що
  й у T008: свіжий push дає зелену матрицю на `windows-latest` і `ubuntu-latest`.
  [files: benchmarks/gemini-3.7-flash-high/runner.js .github/workflows/test.yml]
