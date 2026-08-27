# 023 — задачи

- [X] **T001** Сьют перестаёт зависеть от `.gitignore`-нутого дерева, и класс закрывается
  замком. Одна задача, потому что все пять файлов краснеют по одной причине и порознь
  проверить фикс нельзя: зелёный оракул в чистом клоне — это одно утверждение, а не пять.

  (1) **Замороженные baseline judge-bench переезжают в поставку.**
  `.planning/JUDGE-BENCH-011-T001.json` → `tools/judge-bench/baselines/011-T001.json`,
  `.planning/JUDGE-BENCH-011-T023.json` → `tools/judge-bench/baselines/011-T023.json`.
  Читатели (`tools/elt-gate-l0.test.js`, `tools/judge-bench.test.js`) идут по новым путям;
  ни один ассерт не ослабевает, включая сверку `results` с `[...handwritten,
  ...RETIRED_SINCE_REPORT]` — она и есть защита от молчаливого дрейфа набора.

  (2) **`harness-checklist.test.js` перестаёт утверждать неправду о собственном репозитории.**
  Тест `gatherFacts: this repo has core docs + planning` разбирается надвое: `docsAgents` для
  этого репозитория остаётся живой проверкой (AGENTS.md в поставке есть), а `planningNonEmpty`
  переезжает на временную фикстуру с обеими сторонами — непустой `.planning` даёт `true`,
  отсутствующий даёт `false`. Способность `gatherFacts` различать эти два случая — и есть то,
  что тест обязан стеречь; после 022 «в этом репозитории `.planning` непуст» просто ложь.

  (3) **Приёмка закрытых спек снимается, числа сохраняются.** `tools/d0-smoke-feasibility.test.js`
  (010/T001, разведка D0, N=3) и `tools/gate-verdict.test.js` (011/T015, AC13) удаляются:
  они проверяют форму одноразовых отчётов, а не код. Числа обоих замеров — block-rate 77%→,
  доля-до-L3 100%→, оракул p50 185c→, recall/FPR judge-bench, N=3 по трём регрессам —
  переносятся в `docs/EVIDENCE.md` с датой и номером спеки. Снятие объявляется в `CHANGELOG.md`:
  охват падает со 112 файлов до 110, и это записано, а не замолчано.

  (4) **Замок на класс — `tools/oracle-hermetic.test.js`.** Проходит по всем `*.test.js` под
  корнями оракула (`tools/`, `bin/`, `benchmarks/`), достаёт литеральные сегменты путей,
  собираемых от корня репозитория, и красит любой, который `git check-ignore` признаёт
  игнорируемым. Виновный файл и путь названы в сообщении. Проверяется отдельно, что замок
  ловит: временный тест-образец с чтением из `.planning/` обязан быть пойман.

  Регрессия у каждого пункта своя: (1) и (2) краснеют в дереве без `.planning/`, (3) снимает
  красноту вместе с файлами, (4) краснеет на любом из пяти исходных файлов до фикса.
  [files: tools/judge-bench/baselines/011-T001.json, tools/judge-bench/baselines/011-T023.json,
  tools/elt-gate-l0.test.js, tools/judge-bench.test.js, tools/harness-checklist.test.js,
  tools/oracle-hermetic.test.js, tools/d0-smoke-feasibility.test.js, tools/gate-verdict.test.js,
  docs/EVIDENCE.md, CHANGELOG.md, .gitignore]

- [ ] **T002** Релизная подготовка 5.0.1 и дефект, который она вскрыла. Задача существует
  потому, что `prepare-release` по `docs/RELEASING.md` — это правка манифестов и снимка KPI,
  то есть НЕ документный коммит, и дверь `elt commit` законно требует за него задачу. Релиз
  v5.0.0 такой задачи не имел: его тег висит на коммите «chore: авточекпоинт сессии».

  (1) **Версия 5.0.1** — patch: ни контракт, ни поведение харнеса не менялись, слайс T001
  чинил только герметичность сьюта. Поднята в `.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json` (дважды) и `CHANGELOG.md`, раздел `[Unreleased]` закрыт
  датой.

  (2) **D28 — версия объявлена в шести местах, `version-check` сверяет четыре.** Найден не
  анализом, а попыткой пройти протокол: поднял версию ровно по инструкции («в четырёх
  местах»), `version-check` сказал `ok`, полный оракул дал 107/111 — четыре красных файла с
  одной причиной. Пятое место — `version:` во frontmatter `skills/elt/SKILL.md`: его сверяет
  доктор, но не `version-check`, а инструкция релиза писалась по охвату `version-check`.
  Шестое — `.elt/components.json`/`.lock.json`, где у `elt/core` своя версия, пришпиленная к
  коммиту. Расхождение устранено (скил + примеры вывода доктора в `docs/INSTALL.md`), корень
  оставлен открытым и записан: чинить его надо одним источником списка мест, как уже сделано
  для владений харнеса в `tools/harness-files.js`, а не ещё одной проверкой рядом.

  (3) **Счёт открытых дефектов приведён в соответствие с реестром.** `defects.command` в
  снимке KPI считает только строки главной таблицы, а D26–D28 записаны разделами, поэтому
  добавление D28 не сдвинуло бы число. Подгонять снимок под команду — то же враньё, что и
  зелёный тест на красном коде: D28 внесён и строкой таблицы, снимок и `docs/EVIDENCE.md`
  обновлены до 3 открытых из 28 (было 2 из 24). Блокирующих открытых по-прежнему ноль.

  Регрессия: `node tools/version-check.js` → 5.0.1, `node bin/doctor.js` → FAIL=0,
  `node tools/kpi-commit-share.test.js` → 16/16 на новых числах.
  [files: .claude-plugin/plugin.json, .claude-plugin/marketplace.json, CHANGELOG.md,
  skills/elt/SKILL.md, docs/INSTALL.md, docs/DEFECTS.md, docs/EVIDENCE.md,
  tools/kpi-release-snapshot.json, specs/023-oracle-hermetic-after-hygiene/tasks.md]
