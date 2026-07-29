# Checkpoint - 2026-07-29 (T002 + T003 закрыты, resume T004)

## Build Status
- Compiles: n/a (Node.js, без сборки)
- Lint: not configured
- Type check: not run

## Test Metrics
- Оракул (`node tools/elt-oracle-runner.js`): 60 test files, **60/60 passed** (~220-250s,
  разброс от машинной нагрузки)
- Новые тесты: `tools/sync-bin.test.js` (13 assert, копирование замыкания + require без
  MODULE_NOT_FOUND во временном HOME), 4 новых теста в `tools/elt-judge-contract.test.js`
  (резолв судьи-моста: explicit > local > global > exit 4)
- Оба судьи (agy pass + codex pass) на T002 и на T003 (после доработки)
- Red-proof: red-на-базе на обоих слайсах (новые тесты реальны, не тавтология)
- Известный флейк подтверждён и не связан с изменениями: `context7-cli.test.js` (сетевой) —
  один красный прогон, зелёный при изоляции и при повторе полного оракула

## Code Modifications Since Last Checkpoint
- Files created: `tools/sync-bin.js`, `tools/sync-bin.test.js`
- Files modified:
  - `tools/elt.js` — добавлен `require('os')`, функция `resolveJudgeInvoke()` (T003):
    явный `--invoke` > `<cwd>/tools/judge-invoke.js` > `~/.claude/bin/judge/judge-invoke.js`
    > exit 4 с инструкцией `node tools/sync-bin.js`. Синхронизирован в
    `~/.claude/bin/elt.js` (identical, проверено diff).
  - `tools/elt-judge-contract.test.js` — добавлены 4 теста на три ветки резолва +
    explicit-приоритет, с РАЗЛИЧИМЫМИ маркерами в стаб-мостах (`stub:local`/`stub:global`/
    `stub:explicit`) — важная правка после round 1 судьи (codex забраковал версию с
    одинаковым результатом у всех трёх мостов как недоказательную)
- Commits этой сессии: `bf9b148` (T002), `bd10662` (T003)

## Git State
- Branch: `feature/judge-bench-parallel-oracle`
- Uncommitted changes: 0 (дерево чистое)
- Last commit: `bd10662` feat: T003 Fallback-резолв в tools/elt.js:606

## Completed Tasks
- **T002 закрыт** (`bf9b148`). `tools/sync-bin.js` копирует замыкание моста судьи
  (`judge-invoke.js`, `red-proof.js`, `elt-config.js`, `fleet/{gate,providers,exec,plan,router}.js`)
  в `~/.claude/bin/judge/` с сохранением относительной структуры (`fleet/` подпапка) — это
  и обеспечивает корректный резолв `require()` внутри копии без правки путей.
- **T003 закрыт** (`bd10662`). Fallback-резолв в `elt.js`: явный `--invoke` сохраняется как
  есть (даже если файла нет — отдельное сообщение об ошибке для явно указанного, но
  отсутствующего моста, не спутано с «резолв исчерпан»), иначе local → global → exit 4.
  Судья round 1 (codex) заблокировал версию теста с одинаковым результатом у всех трёх
  мостов как недоказательную — исправлено: стаб-мосты различаются по `reasons` (маркер),
  тест реально проверяет, ЧТО было выбрано, не только что что-то было выбрано.

## Blockers
Нет активных блокеров.

## Gotcha (подтверждено живьём в этой сессии)
`elt spec approve` пишет `approval.json` в дерево — если делать это МЕЖДУ судьёй и
`commit`, ловишь `stale-tree` (пруф судьи привязан к дереву на момент его прогона).
Правило CLAUDE.md подтверждено практикой: approve (если approval стал stale из-за
`[X]`-флипа предыдущего коммита) — ДЕЛАТЬ ДО судьи, не между судьёй и коммитом.
Последовательность на будущее: `elt spec approve` (если stale и diff мех.) → `elt oracle`
→ `elt judge run` → `elt commit --skip-oracle`, без разрывов.

## Next Steps
1. **T004** (спека 010, фаза B) — `doctor`: WARN, если глобальная копия моста расходится с
   репо или отсутствует при `judge.enabled`. Файлы: `tools/doctor-core.js`,
   `tools/doctor.test.js`.
2. Далее T005 (Фаза C, удаление `--skip-attest`), T006-T008 (Фаза D, bootstrap),
   T009-T010 (Фаза E, периметр), T011 (Фаза F, живой блок в чужом проекте).

## Resume Pointer
- Focus: слайс T004 спеки 010 — doctor WARN на drift/отсутствие глобальной копии моста
- Resume: `/elt` → продолжить по `specs/010-judge-delivery/tasks.md`, задача T004
