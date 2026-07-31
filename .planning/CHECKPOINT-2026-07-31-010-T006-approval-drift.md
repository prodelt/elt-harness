# CHECKPOINT 2026-07-31 (3) — 010/T006 в гейте, найден approval-дрейф после каждого слайса

Предыдущий: `.planning/CHECKPOINT-2026-07-31-011-T016-010-T004-closed.md`.

## СДЕЛАНО РАНЬШЕ В ЭТОЙ СЕССИИ
`cf419ea` 011/T016 (red-proof: потолок на файл + прогон по одному файлу), `0377f07` 010/T004
(`checkJudgeBridge` в докторе), `9af8e97` чекпоинт + замер, `ed60505` переутверждение 011
(`tasksHash ca83fecf`).

## 010/T006 — разрезан и в гейте

Стэш `010-T006-T007-T008` распущен, T006 изолирован:
- `project-docs-core.js` + `project-docs.test.js` откачены целиком (чистый T008).
- `project-bootstrap.js` возвращён к HEAD, накачены ТОЛЬКО три куска T006:
  `checkJudgeBridgeContract`, её проводка в `verifyProject`, экспорт.
- Из `project-bootstrap.test.js` вырезаны два теста T007
  (`testOracleVerifierContractResolvesAndRunsDeep`, `testOracleVerifierDeepActuallySpawnsShell`),
  один T008 (`testVerifyDowngradesUnknownSectionsAndIgnoresDeprecatedSkill`), импорт
  `checkOracleVerifierContract` и их регистрация в `main()`.
- Осталось в зоне: `homeWithBridge()` + проброс `home` в 5 существующих тестов — это ЧАСТЬ T006,
  не косметика: новый контракт рубит `verify` при `judge.enabled` без моста, поэтому фикстуры,
  ждущие зелёный verify, обязаны класть мост в свой временный HOME.

Зона = 2 файла, 75 строк, ровно по `[files:]` задачи. Оракул 61/61 (193.7 c), судья `pass`,
red-proof **`red: fails-on-base`**.

**Работа T007/T008 НЕ потеряна** — полная версия всех 4 файлов и патч сохранены В РЕПО (стэша
больше нет, он распущен): `.planning/010-T006-T007-T008-full.patch`, `.planning/pb-all3.js`,
`.planning/pb-all3.test.js`, `.planning/pdc-all3.js`, `.planning/pd-all3.test.js`.
Удалить их после закрытия T008.

## НАЙДЕНО: approval-дрейф глушит КАЖДЫЙ следующий слайс

`elt commit` T006 отказал: `спека не утверждена (status: stale, specs/010-judge-delivery)` —
потому что предыдущий слайс (T004) отметил `[X]` в том же `tasks.md`, `tasksHash` уехал,
approval устарел. Т.е. **после каждого закрытого слайса спека сама становится stale**, и
следующий слайс требует re-approve. Это механический дрейф, не смысловая правка.

Дороже, чем кажется: `spec approve` пишет `approval.json` в дерево → `treeHash` меняется →
`--skip-oracle` отказывает (trust-hole закрыт сверкой treeHash) → **оракул приходится гнать
заново, +194 c на каждый слайс**. Порядок обязателен: `approve` → `oracle` → `judge` → `commit`.

Это уже отмечалось как «approval-гейт глушит драйвер после КАЖДОГО слайса (`stale` → exit 4)»
в контексте 008/T004, но задачи под фикс до сих пор нет. Кандидат: не включать отметки `[X]`
в `tasksHash` (хэшировать текст задач без чекбоксов) — тогда закрытие слайса не расподписывает
спеку, а реальная правка формулировок по-прежнему расподписывает.

## ДАЛЬШЕ

1. Дождаться фоновой цепочки `bbo600cik` (approve 010 → oracle → judge T006 → commit).
2. **T007** — из scratchpad `pb-all3.js`/`pb-all3.test.js` взять куски T007 (`commandBinary`,
   переписанный `checkOracleVerifierContract`, `--deep` в `parseArgs`, экспорт + 2 теста).
3. **T008** — остаток: `DEPRECATED_SKILLS`, `unknownSections` наружу в `inspectProject`/
   `checkDocsContract`, фильтр `live` в `summarizeSupplyChain`, `project-docs-core.js`,
   `project-docs.test.js` + тест.
4. Отдельно: `checkLoopJudgePath` + фикс `tools/elt-loop.ps1:397` (автономный драйвер сломан).
5. 011/T002+ (спека утверждена, `tasksHash ca83fecf`).
