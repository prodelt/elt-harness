# Checkpoint (auto) — 2026-08-22

Автозаписан `checkpoint-writer.js` на пороге ~196k/200k токенов (stage2) — ротация сессии, не ручной /checkpoint.

## Git
- branch: `feature/judge-bench-parallel-oracle`
- dirty files: 16

## Last Run
- commit: `(none)`
- verdict: block
- oracle exit: ?
- msg: 

## Next Slice
- plan file: `specs\018-spec-approval-to-git-trailer\tasks.md`
- open: 4 / done: 4
- next: T004 Гейт `specApprovalGateFor()` читає ЛИШЕ трейлер. Міграційної пільги немає: заміряно по реєстру з 353 проєктів — `approval.json` 39 штук у 8 проєктах, із них 32 вже `stale` СЬОГОДНІ, а 7 живих валідні тільки за старою хеш-функцією, яку T001 змінює. Пільга коштувала б дуального шляху хешування заради 7 директорій. Замість неї — гучна відмова з точною командою: `спека не підписана: elt spec approve --spec <specDir>`. Обидва місця виклику (`slice next`, `commit`) не змінюють сигнатуру. Перевірка: `node --test tools/elt-approval-gate.test.js` — трейлер пускає, відсутність підпису блокує з текстом команди в stderr, самотній `approval.json` більше НЕ пускає.

## Resume Prompt
/elt continue — план `specs\018-spec-approval-to-git-trailer\tasks.md`, следующий слайс: T004 Гейт `specApprovalGateFor()` читає ЛИШЕ трейлер. Міграційної пільги немає: заміряно по реєстру з 353 проєктів — `approval.json` 39 штук у 8 проєктах, із них 32 вже `stale` СЬОГОДНІ, а 7 живих валідні тільки за старою хеш-функцією, яку T001 змінює. Пільга коштувала б дуального шляху хешування заради 7 директорій. Замість неї — гучна відмова з точною командою: `спека не підписана: elt spec approve --spec <specDir>`. Обидва місця виклику (`slice next`, `commit`) не змінюють сигнатуру. Перевірка: `node --test tools/elt-approval-gate.test.js` — трейлер пускає, відсутність підпису блокує з текстом команди в stderr, самотній `approval.json` більше НЕ пускає.
