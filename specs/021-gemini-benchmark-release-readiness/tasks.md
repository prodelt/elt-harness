# Tasks — 021 Gemini benchmark і GitHub release readiness

- [ ] **T001** Закрити D27: довести шість Windows-green/Linux-red випадків до
  platform-hermetic контрактів, залишити найменші discriminating regressions і відтворити
  точні попередні CI failures локально або в Linux-контейнері.
  [files: tools/adapters/openshell.js tools/adapters/openshell.test.js tools/agent-surface-audit.js tools/agent-surface-audit.test.js tools/doctor.test.js tools/elt-config.test.js tools/git-workflow-audit.js tools/judge-core.js tools/judge-core.test.js tools/project-bootstrap.js tools/project-bootstrap.test.js .planning/HARNESS-DEFECTS-REGISTRY-2026-08-21.md]

- [ ] **T002** Перенести benchmark із session scratchpad у versioned, resume-safe контур:
  Gemini-only runner, append-only raw logs, deterministic dataset builder, integrity/anti-leak
  checks, transport-only retry та machine-generated summary. Зафіксувати preregistration і hash
  runner'а до першого нового result row; старі змішані результати зареєструвати як
  `invalid-for-claim` без включення в headline.
  [files: benchmarks/gemini-3.7-flash-high/preregistration.json benchmarks/gemini-3.7-flash-high/runner.js benchmarks/gemini-3.7-flash-high/build-gate-dataset.js benchmarks/gemini-3.7-flash-high/summarize.js benchmarks/gemini-3.7-flash-high/README.md benchmarks/README.md]

- [ ] **T003** Виконати повний Gemini-only benchmark: paired writer A/B 30+30 на
  `Aider-AI/polyglot-benchmark@7e0611e` і bare-vs-`judgeDiff` gate A/B на preregistered
  збалансованій SWE-bench вибірці. Дозапустити лише transport failures, згенерувати raw results,
  checksums, summary та 95% CI; заборонити claim, якщо будь-яка рука неповна.
  [files: benchmarks/gemini-3.7-flash-high/writer-results.jsonl benchmarks/gemini-3.7-flash-high/gate-results.jsonl benchmarks/gemini-3.7-flash-high/transport-failures.jsonl benchmarks/gemini-3.7-flash-high/results.json benchmarks/gemini-3.7-flash-high/checksums.sha256 benchmarks/gemini-3.7-flash-high/README.md]

- [ ] **T004** Зробити GitHub front page release-grade: короткий перший екран, чесні badges,
  5-хвилинний quick start, один наскрізний приклад слайса, схема гейта, результати benchmark із
  межами claim, install/update/rollback/troubleshooting. Прибрати або позначити застарілі KPI;
  CLI help має називати поточний runtime ELT v5, а не історичний v3, із regression-тестом.
  [files: README.md docs/INSTALL.md docs/USAGE.md benchmarks/README.md tools/elt.js tools/elt-cli.test.js specs/021-gemini-benchmark-release-readiness/diagrams/elt-release-flow.mmd specs/021-gemini-benchmark-release-readiness/diagrams/elt-release-flow.svg]

- [ ] **T005** Довести реальну працездатність із чистого середовища: fresh project/plugin
  install, `bin/doctor`, first `/elt` bootstrap, Codex/Gemini surface parity та headless `agy`
  smoke на `gemini-3.7-flash-high`. Зберегти exact commands, exits і hashes у release evidence.
  [files: tools/smoke-elt-deploy.js tools/smoke-elt-deploy.test.js docs/INSTALL.md .planning/ELT-V5-RELEASE-CANDIDATE-2026-08-25.md]

- [ ] **T006** Закрити release gate: повний oracle + smoke + doctor, рівно один Codex-judge,
  ELT commits, push feature branch, зелена GitHub Actions matrix на Windows/Linux, `main` як
  default branch, release-ready description/topics і нуль blocking review rows. Public visibility,
  tag та GitHub Release не створювати до фінального підтвердження користувача.
  [files: .github/workflows/test.yml .claude-plugin/plugin.json .claude-plugin/marketplace.json README.md .planning/ELT-V5-RELEASE-CANDIDATE-2026-08-25.md]
