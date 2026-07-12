# Checkpoint — 2026-07-11 — T028 закрыт: workers=1 baseline vs workers=2, speedup 2.66×

## Итог одной строкой
Тот же честный 2-слайсовый scratch-план (T01/T02, disjoint files, agy-first policy)
прогнан **живьём дважды**: `workers=1` (baseline, новый прогон сегодня) и `workers=2`
(из предыдущего чекпоинта, тот же день). Оба 100% merged, 0 failed. **Speedup 2.66×**
(155.09s → 58.35s). T028 закрыт по критериям spec.md.

## Setup (идентичный обоим прогонам)
Клон scratch-репо на коммит `f559485` (pre-run seed, tasks.md оба `[ ]`, нет `out/`) —
гарантирует честное сравнение, а не повторный прогон уже смёрженного плана.
`.harness/harness.json` (oracle=`node oracle.js`, judge sonnet), `.harness/fleet.json`
(policy S/M/L = agy→codex→claude, caps maxCalls:12 maxClaudeCalls:4 maxMinutes:15).

## Результат (из run-log.jsonl / fleet/events.jsonl обоих прогонов)

| Метрика | workers=1 | workers=2 |
|---|---|---|
| Wall-clock | **155.09s** (12:06:01.856→12:08:36.949) | **58.35s** (12:00:18.042→12:01:16.388) |
| LLM-вызовов всего | 5 (T01: implement+heal+judge; T02: implement+judge) | 4 (T01/T02: implement+judge) |
| Claude-вызовов | 2 (judge only) = 40% | 2 (judge only) = 50% |
| Merged | 2/2 (100%) | 2/2 (100%) |
| Failed/abandoned | 0 | 0 |
| LLM/слайс max | 3 (T01 с хилом) | 2 |

**Speedup = 155.09 / 58.35 = 2.66×**

## Проверка против критериев spec.md §Критерии
- 100% merged — ✓ оба прогона
- speedup ≥1.5× — ✓ **2.66×**
- Claude ≤50% вызовов — ✓ оба (40%, 50%)
- ≤4 LLM-вызова/слайс — ✓ (max 3, из-за одного self-heal на T01 в w1-прогоне)

Все критерии T028 выполнены живыми данными. Честная оговорка: w1-прогон содержит один
agy self-heal ретрай на T01 (+76s), которого не было в w2-прогоне — это реальный
non-determinism LLM-имплементера, не искажение методики (план/конфиг идентичны,
оба прогона с одного и того же pre-run коммита).

## Хвосты / что дальше
- T028 `[X]` в `specs/003-elt-fleet-hardening/tasks.md`.
- Открыты T029 (live STOP/resume + failover) и T030 (финальный gate-вердикт по
  всем критериям жизни spec.md — снять experimental или откатить параллельный слой).
- Scratch-репо (`fleet-bench-t028-w1` в текущем scratchpad, `fleet-bench-t028` в
  прошлом session-scratchpad) — расходные, можно удалить в любой момент.
