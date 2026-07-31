# CHECKPOINT 2026-07-31 (4) — 010 Фаза D закрыта, 011/T002 (L0) закрыт

Предыдущий: `.planning/CHECKPOINT-2026-07-31-010-T006-approval-drift.md`.

## ЗАКРЫТО В ЭТОЙ СЕССИИ

- `122638d` **010/T008** «шум вон из красного». Оракул exit 0 (162 c), судья `pass` (agy,
  13.7 c), red-proof `red: fails-on-base`.
  - `project-docs-core.js`: `unknownSections` больше не рубят `verifyProjectDocs.ok` (было
    fail-closed, 005 AC10) — своя секция в AGENTS.md проекта это жизнь, а не поломка.
  - `project-bootstrap.js`: `unknownSections` пробрасываются через `inspectProject` →
    `checkDocsContract` возвращает их + `warnings` (причина видна, раньше не доезжала вовсе);
    `DEPRECATED_SKILLS = {pipeline}` исключены из `driftedInstalls`, но НЕ из `missingInstalls`
    (исключение узкое: только дрейф копии, отсутствие установки остаётся красным).
  - `project-docs.test.js` не был в `[files:]`, но переехал обязательно: снятие fail-closed
    механически ломает `testVerifyFailsOnUnknownNonCoreSection` → он стал
    `testVerifyWarnsButPassesOnUnknownNonCoreSection`. Судья принял, scope creep не назвал.
  - Из заготовки НЕ переносил переезд `checkApprovalContract` — косметическая перестановка
    006/T005, к T008 отношения не имеет.
- `2c464d0` заготовки удалены: `.planning/pb-all3*`, `.planning/pd*-all3*`,
  `.planning/010-T006-T007-T008-full.patch`. Отдельным коммитом ПОСЛЕ гейта — `.planning/*` в
  диффе слайса судья ловит как scope creep.
- `19360bd` **011/T002** — `tools/elt-gate-l0.js`. Судья `pass` (17.1 c), red-proof
  `red: fails-on-base`, оракул зелёный.

## 011/T002 — что построено

`evaluate({diff, status, config, cwd})` → `{triggers: [{name, files, reason}], judgeNeeded}`.
Чистая: ни fs, ни spawn, ни сети — тест не требует репозитория и не может подвиснуть в гейте.

Четыре триггера: `existing-test-modified` (тест-файл без `new file mode`), `new-code-no-check`
(новый прод-код при нуле тестов в наборе), `hot-path` (`config.hotPaths`, дефолт —
гейт/auth/секреты), `diff-size` (`config.diffSizeThreshold`, дефолт 400).

`status` (git porcelain) не декоративен: untracked-файлы в `git diff` не видны вовсе, без них
`new-code-no-check` слеп ровно на своём главном случае. Зафиксировано отдельным ассертом.

Два `ponytail:`-потолка с путём апгрейда: минимальный glob (`**`/`*`/`?`, ~5 строк вместо
зависимости) и заведомо широкий дефолтный список горячих путей (`author.js` попадёт под
`*auth*` — ложный триггер стоит одного вызова судьи, пропуск стоит дыры).

## ОТКРЫТО

- **010 НЕ закрыта целиком** (вопреки постановке сессии — закрыта только Фаза D). Открыты
  `T005` (удалить `--skip-attest`), `T009` (авто-чекпоинт молчит в гейте), `T010` (скиллы),
  `T011` (живой блок в чужом проекте). По решению 8 спеки 011 они переезжают в 011 как слайсы;
  `stash@{0}` = `batch2-T005-T009-T010-T011` не потерян.
- **011/T003 — следующий**: проводка L0 в гейт (`tools/elt.js`, `tools/fleet/gate.js`,
  `tools/elt-gate-l0.test.js`). Нет триггеров → судья НЕ зовётся, `l0-clean` в run-log; есть →
  список триггеров едет в run-log и в промпт судьи. Тест: судья-стаб не вызван ни разу на
  чистом слайсе, вызван ровно один раз на рисковом. [AC3]
- **Порядок фаз по деньгам перевёрнут.** Замер этой сессии, два слайса подряд: оракул 162 c из
  ~200 c гейта, судья 13.7 и 17.1 c. L0 (фаза B) экономит ~17 c; `oracleSelect: impact`
  (T006, фаза D) — сотни. Менять порядок без решения юзера не стал, замер уже вписан в tasks.md.
- **approval-дрейф не починен** (см. предыдущий чекпоинт): отметка `[X]` меняет `tasksHash` →
  спека `stale` → re-approve пишет в дерево → `treeHash` уехал → `--skip-oracle` отказывает.
  Обход — жёсткий порядок в одной цепочке: `approve → oracle → judge → commit --skip-oracle`.
  Кандидат на фикс: не включать чекбоксы в `tasksHash`. Задачи под это до сих пор нет.
- `tools/elt-loop.ps1:397` — автономный драйвер сломан, `checkLoopJudgePath` не написан.

## Resume Prompt

> Продолжаю Pipeline Setupper, ветка `feature/judge-bench-parallel-oracle`. Читай
> `.planning/CHECKPOINT-2026-07-31-010-closed-D-011-T002.md`. Делай **011/T003** — проводка L0
> (`tools/elt-gate-l0.js`, уже закрыт в `19360bd`) в гейт: нет триггеров → судья не зовётся,
> вердикт `pass`, запись `l0-clean` в run-log с пустым списком; есть триггеры → путь к судье как
> раньше, список триггеров в run-log и в промпт судьи. Тест на судью-стаб: 0 вызовов на чистом
> слайсе, ровно 1 на рисковом. Зона — `tools/elt.js`, `tools/fleet/gate.js`,
> `tools/elt-gate-l0.test.js`. Гейт строго одной фоновой цепочкой:
> `spec approve --spec specs/011-elt-v3-gate && oracle && judge run --task T003 --spec … &&
> commit --task T003 --spec … --skip-oracle`; в дерево между шагами не писать.
