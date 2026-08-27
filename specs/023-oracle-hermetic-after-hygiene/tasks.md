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
