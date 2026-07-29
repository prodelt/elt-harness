# Checkpoint - 2026-07-29 (продолжение сессии, снятие блока T001)

## Build Status
- Compiles: n/a (Node.js, без сборки)
- Lint: not configured
- Type check: not run

## Test Metrics
- Оракул (`node tools/elt-oracle-runner.js`): 59 test files, **59/59 passed** (176.8s)
- Новый тест этой сессии: `tools/d0-smoke-feasibility.test.js` — 4/4 (было 2, добавил 2
  содержательных на живые артефакты)
- Red-proof на T001: **red на baseHead** (`fails-on-base`, ожидаемо — новые тесты падают без
  файлов пруфа), green на новой версии → подтверждает, что тесты реальны, не тавтология

## Code Modifications Since Last Checkpoint
- Files created:
  - `.planning/D0-smoke-feasibility.md` — переписан с рассуждения на живые пруфы
  - `.planning/D0-regression2-live-response.json` — редактированный (PII вырезаны) сырой ответ
    Gemini Interactions API
  - `.planning/D0-regression3-live-response.json` — сырой результат живого вызова Visicom
  - `.planning/d0-proof-scripts/d0-regression2-live.js`, `d0_regression3_live.py` — воспроизводимые
    скрипты живого пруфа
  - `tools/d0-smoke-feasibility.test.js` — усилен (4 теста вместо 2)
- Files modified: `CLAUDE.md` (Gotchas: agy ENAMETOOLONG), `.planning/CHECKPOINT-2026-07-29-auto.md`
- Commits этой сессии: `89eabf0` (docs: гочта agy ENAMETOOLONG), `6217984` (feat: T001 закрыт)

## Git State
- Branch: `feature/judge-bench-parallel-oracle`
- Uncommitted changes: 0 (дерево чистое)
- Last commit: `e4098bb` chore: авточекпоинт сессии (T001-коммит — `6217984`)

## Completed Tasks
- **T001 (спека 010) закрыт.** Судья `claude/sonnet` — pass, verify `codex/gpt-5.6-sol` — pass,
  red-proof — red-на-базе/green-на-версии (корректно). N=2 подтверждён живыми вызовами:
  - Регресс 2 (doc2md-tauri): реальный HTTP-вызов Gemini Interactions API байт-в-байт по
    `build_request()` из `ocr.rs:937` → реальный ответ содержит только плоский `usage`
    (`usageMetadata` нет вообще) → порт pre-fix парсера даёт `total_tokens=0`, post-fix — `4223`.
  - Регресс 3 (Route_API_1C): прямой вызов реальной `search_visicom_candidates` из репо на
    инцидентном адресе (Пустомити, Грушевського 7) — pre-fix (структурный запрос с полным
    Gemini-именем) даёт `candidates: []`, post-fix (raw_text) находит `adr_address` дом 7.
- Найден и записан побочный баг (см. Reference ниже) — не в scope T001, задокументирован, не
  чинился (не относится к спеке 010).

## Blockers
Нет активных блокеров на T001. Системный дефект `gate.js:474-486` (мёртвый ПЕРВИЧНЫЙ судья не
имеет failover, в отличие от мёртвого verify) — не блокер, а известный гэп для будущего слайса
вне 010.

## Reference (найдено, не в scope этой спеки)
**agy-судья падает `spawn ENAMETOOLONG` на больших диффах.** Промпт agy идёт через argv
(`providers.js`), не stdin — Windows режет длину командной строки раньше `DIFF_CAP`. Живой обход:
`elt judge run --task Txxx --provider claude --model sonnet` (verify из `harness.json` остаётся
независимым автоматически — не переопределяется этим флагом). Записано в `CLAUDE.md` → Gotchas
и в память — `reference_agy_judge_enametoolong_bug.md`.

## Next Steps
1. **T002** (`tools/sync-bin.js`) — следующий открытый слайс спеки 010, фаза B (мост доезжает до
   проектов). Копирует замыкание судьи (`judge-invoke.js`, `red-proof.js`, `elt-config.js`,
   `fleet/{gate,providers,exec,plan,router}.js`) в `~/.claude/bin/judge/`.
2. Резервный пункт из прошлого чекпоинта («дописать smoke-слайсы в tasks.md») — снят: разведка
   D0 закрыта доказательно, дальнейшее решение по smoke — отдельный вопрос вне немедленного
   резюме (не блокирует T002).

## Resume Pointer
- Focus: слайс T002 спеки 010 — `tools/sync-bin.js` (мост судьи в `~/.claude/bin/judge/`)
- Resume: `/elt` → продолжить по `specs/010-judge-delivery/tasks.md`, задача T002
