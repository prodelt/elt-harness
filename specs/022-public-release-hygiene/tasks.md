# 022 — задачи

- [ ] **T001** Публичная гигиена репозитория одной волной: свести дерево к поставке
  (`.planning/`, `archive/`, `presentation/`, `sa-workspace/`, `demo/`, `memory/`, `.rag/`,
  `.cursor/`, `docs/hermes-agent/` и корневой мусор — в `.gitignore`, реестр дефектов переезжает
  в `docs/DEFECTS.md`); вычистить абсолютные пути автора и имена сторонних проектов; убрать
  захардкоженный путь автора из обёрток `tools/{doctor,skill}.{cmd,ps1}`; переписать README как
  обложку продукта и вынести измерения в `docs/EVIDENCE.md`; снять `PLAYBOOK.md` (описывал ELT
  v3) и задокументировать фоновый режим в `docs/USAGE.md` как спекулятивный, а не гейт;
  добавить `CONTRIBUTING.md`, `SECURITY.md`, шаблоны issue/PR и метаданные манифестов; усилить
  замок KPI сверкой снимка с деревом.
  [files: README.md, CHANGELOG.md, CLAUDE.md, AGENTS.md, .gemini/GEMINI.md, .gitignore,
  CONTRIBUTING.md, SECURITY.md, PLAYBOOK.md, .github/pull_request_template.md,
  .github/ISSUE_TEMPLATE/bug_report.yml, .github/ISSUE_TEMPLATE/false_verdict.yml,
  .claude-plugin/plugin.json, .claude-plugin/marketplace.json, .elt/components.json,
  docs/EVIDENCE.md, docs/DEFECTS.md, docs/INSTALL.md, docs/USAGE.md, docs/RELEASING.md,
  tools/kpi-release-snapshot.json, tools/kpi-commit-share.test.js, tools/doctor.test.js,
  tools/doctor.cmd, tools/doctor.ps1, tools/skill.cmd, tools/skill.ps1, tools/project-docs-core.js,
  bin/doctor.test.js, skills/elt/SKILL.md, skills/harness-method/SKILL.md,
  skills/harness-method/REFERENCE.md, skills/project-bootstrap/SKILL.md,
  config/antigravity-elt-workflow.md, specs/**]

- [ ] **T002** Судья слепнет на большом диффе раньше собственного бюджета: три читающих
  `execFileSync('git', …)` в `judge-core.js` идут с дефолтным `maxBuffer` 1 МиБ, поэтому
  `git diff HEAD` на 6 МБ бросает исключение ДО `budgetDiff`, и цепочка гейта падает с «судья
  не вернул JSON». Класс дефекта уже закрыт в `tools/elt.js` (020/T009) и в оракуле — но
  починили тогда вызовы, а не корень. Дать всем читающим git-вызовам судьи один явный лимит и
  оставить регрессию: дифф больше 1 МиБ обязан вернуться урезанным по бюджету, а не исключением.
  [files: tools/judge-core.js, tools/judge-diff-budget.test.js]
