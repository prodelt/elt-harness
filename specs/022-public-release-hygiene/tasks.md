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

- [ ] **T002** Три дефекта судьи, найденные прогоном ЭТОЙ ЖЕ волны через собственный гейт.
  Одна задача, потому что все три живут в `tools/judge-core.js` и вместе решают одно: слайс с
  массовым удалением файлов не был судим в принципе.

  (1) **Бюджет недостижим ровно на большом диффе.** Читающие `execFileSync('git', …)` идут с
  дефолтным `maxBuffer` 1 МиБ, поэтому `git diff HEAD` на 6 МБ бросает `ENOBUFS` ДО
  `budgetDiff`, и цепочка падает с «судья не вернул JSON». Класс уже чинили в `tools/elt.js`
  (020/T009) и в оракуле — чинили вызовы, а не корень. Дать всем читающим git-вызовам судьи
  один явный лимит.

  (2) **Ложный `phantom-file` на любом `git mv`.** `diffFileList` из строки `R  old -> new`
  берёт только цель, поэтому судья, честно назвавший ИСХОДНЫЙ путь
  (`.planning/HARNESS-DEFECTS-REGISTRY-2026-08-21.md` → `docs/DEFECTS.md`), объявляется
  выдумщиком. Фикс асимметричный: источник законно НАЗВАТЬ, но требовать его нельзя —
  `unreviewed-file` по-прежнему спрашивает только цели, иначе вместо одного ложного отказа
  появится другой.

  (3) **Массовое удаление делает слайс несудимым — двумя способами сразу.** Секция чистого
  удаления несёт всё содержимое файла и уменьшает знаменатель доли, а `unreviewed-file`
  требует назвать каждый из 544 удалённых путей. Обе цены платятся за файлы, в которых нечего
  читать: при 711 файлах диффа на каждый приходится ~844 символа, и настоящая правка
  обрывается на середине. Свернуть чистое удаление в строку-уведомление (факт и объём видны,
  спрятать нельзя) и не спрашивать за такие файлы `filesReviewed`. Отдельно — сама формула
  доли: `left/rest` в порядке показа возвращала неизрасходованное только тем, кто идёт ПОЗЖЕ,
  а `prioritize` ставит первым самое важное. Доля считается max-min fair, вторым проходом
  приоритетные секции дотягиваются до минимума за счёт хвоста: без первого важный файл
  голодает среди сотен мелких секций, без второго — выпадает при тесном бюджете (инвариант
  `judge-grounding.test.js`).

  (4) **Grounding наказывал судью за послушание.** Промпт перечисляет владения харнеса и
  сгенерированное отдельной секцией с прямым «не выноси по ним вердикт», а `unreviewed-file`
  тут же требовал назвать их в `filesReviewed`. Живой блок на `.elt/ledger.jsonl` и фикстуре
  `judge-bench`. Граница берётся из того же единственного списка `harness-files.js`, что и сам
  запрет; `.harness/harness.json` из послабления исключён намеренно — слайс, ослабляющий
  собственный гейт, обязан быть замечен.

  Регрессия у каждого своя и каждая краснеет без своего фикса.
  [files: tools/judge-core.js, tools/judge-diff-budget.test.js, tools/judge-grounding-rename.test.js, tools/judge-deletion-budget.test.js]
