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

- [ ] **T003** Ложный `grounding:phantom-file` на переименовании: `diffFileList` из строки
  статуса `R  old -> new` берёт только цель, поэтому судья, честно назвавший ИСХОДНЫЙ путь
  (`.planning/HARNESS-DEFECTS-REGISTRY-2026-08-21.md` → `docs/DEFECTS.md`), получает
  «выдумал файл» и блокирует слайс. Поймано живьём этим же слайсом. Фикс асимметричный:
  источник переименования законно НАЗВАТЬ (phantom его не считает выдумкой), но требовать его
  нельзя — `unreviewed-file` по-прежнему спрашивает только цели, иначе вместо одного ложного
  отказа появится другой. Регрессия на обе стороны.
  [files: tools/judge-core.js, tools/judge-grounding-rename.test.js]

- [ ] **T004** Массовое удаление файлов делает слайс несудимым — двумя способами сразу.
  (1) Бюджет: секция чистого удаления несёт всё содержимое файла и уменьшает знаменатель
  `left/rest`, поэтому при 711 файлах диффа на каждый приходится ~844 символа и настоящая
  правка обрывается на середине — судья честно отвечает «не могу проверить». (2) Grounding:
  `unreviewed-file` требует назвать КАЖДЫЙ файл диффа, то есть перечислить 544 удалённых пути,
  иначе block. Обе цены платятся за файлы, в которых нечего читать. Свернуть секцию чистого
  удаления в одну строку-уведомление (факт удаления и объём остаются видимы) и не спрашивать
  за такие файлы `filesReviewed`. Регрессия: удаление остаётся ВИДИМЫМ судье, бюджет
  достаётся изменённому коду, а удаление файла с кодом по-прежнему нельзя спрятать.

  По ходу выяснилось, что свёртки мало: сама формула доли (`left/rest` в порядке показа)
  возвращала неизрасходованное только тем, кто идёт ПОЗЖЕ, а `prioritize` ставит первым самое
  важное — то есть нужный файл получал долю по ещё не сжавшемуся знаменателю. Доля считается
  max-min fair, и вторым проходом приоритетные секции дотягиваются до минимума за счёт хвоста:
  без первого важный файл голодает среди сотен мелких секций, без второго — выпадает при
  тесном бюджете (инвариант `judge-grounding.test.js`).
  [files: tools/judge-core.js, tools/judge-deletion-budget.test.js]
