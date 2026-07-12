# Checkpoint — 2026-07-11 — T028 живой инкремент: 2-слайсовый workers=2, agy-приоритет, чисто

## Итог одной строкой
Первый чистый живой прогон fleet после T028-фикса (`a59a17a`): scratch-репо, 2 [P]-слайса,
`fleet.json` политика agy-first (S/M/L), `workers=2` → **оба слайса merged, 0 failed/abandoned**,
implementer-роль **целиком на agy/Gemini**, claude использован ТОЛЬКО как судья (обязательный
инвариант). Юзер явно попросил остановиться здесь — **baseline `workers=1` НЕ прогонялся**
(экономия бюджета), T028 по спеке (speedup-сравнение) остаётся открытым.

## Setup (scratch-репо, воспроизводимо)
`…/scratchpad/fleet-bench-t028/`: `tasks.md` (T01→out/alpha.txt="ALPHA", T02→out/bravo.txt="BRAVO",
оба `[P][S]` disjoint files), `oracle.js` (сверяет только существующие out-файлы с `manifest.json`),
`.harness/harness.json` (oracle=`node oracle.js`, shell=bash, judge sonnet), `.harness/fleet.json`
(policy S/M/L и default = `["agy","codex","claude"]`, caps `maxCalls:12, maxClaudeCalls:4,
maxMinutes:15, concurrencyPerProvider:2`).

## Результат
| Слайс | Implementer | Judge | Итог |
|---|---|---|---|
| T01 | agy 46s | claude sonnet pass 10s | merged |
| T02 | agy 42s | claude sonnet pass 12s | merged |

- wall-clock ~58s, 0 конфликтов, 0 осиротевших worktree, git-история чистая (`merge(fleet): T01/T02 [X]`).
- **LLM-вызовов всего 4**: 2×agy (implement) + 2×claude (judge only) — claude ни строчки кода не
  писал. Прямое попадание в запрос юзера «больше gemini, без лишних затрат».
- Caps не задеты; ledger (`run-log.jsonl`) содержит все 4 строки с provider/model/duration/verdict.

## Что это доказывает
- T028-фикс (`normalizeWorktree`, `a59a17a`) не сломал happy-path: чистый прогон без
  self-commit-инцидентов проходит как раньше.
- agy-first политика работоспособна: роутер реально уводит implementation на gemini при
  доступности, claude остаётся только для роли, которая инвариантно требует sonnet (судья).

## Что НЕ сделано (осознанно, по решению юзера)
- Baseline `workers=1` на идентичном плане — не прогнан → точного числа speedup для T028 нет.
- Полный парный бенч по критериям spec.md (100% merged ✓ есть, но speedup ≥1.5× и Claude ≤50%
  не измерены/не применимы к этому мини-плану) — НЕ закрывает T028 целиком.
- `tasks.md` T028 остаётся `[ ]` в specs/003 — это была разведка/инкремент, не финальный вердикт.

## Хвосты
- Scratch-бенч остаётся в scratchpad сессии (расходный, можно удалить в любой момент).
- Реальный репо (`Pipiline setupper`) не тронут: только `.planning/CHECKPOINT-*` новый файл.

## Resume pointer
- Ветка `feature/elt-loop-driver`, без изменений в tools/fleet (только новый чекпоинт).
- `/elt` → этот чекпоинт. Если юзер решит продолжать T028 — нужен baseline `workers=1` +
  желательно план покрупнее (4+ слайсов) для содержательного speedup-числа, затем T029/T030.
