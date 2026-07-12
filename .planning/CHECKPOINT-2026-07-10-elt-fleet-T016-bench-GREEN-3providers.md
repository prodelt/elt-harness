# Checkpoint — 2026-07-10 ~19:05 — T016 fleet-бенч ЗЕЛЁНЫЙ: codex+agy доказаны end-to-end, все 3 бага починены

## Build Status
- Оракул зелёный: `node tools/doctor.test.js && node --test tools/fleet/*.test.js` → doctor PASS + **59 тестов**, EXIT=0.
- Ветка `feature/elt-loop-driver`. Коммиты сессии: `4a18997`(#8), `8a42d25`(#9), `8036791`(#10).

## Результат бенча (bench v3, live, реальные LLM-вызовы)
Scratch git-репо, 4 честных [P]-слайса (disjoint `[files:]`), `fleet run --workers 3`, тегирование
по провайдерам. Каждый слайс: воркер → оракул (`node oracle.js`) → **реальный судья-sonnet** → merge.

| Слайс | Провайдер | Итог |
|---|---|---|
| T02 | **codex** | ✅ gate-pass → **merged** (out/bravo.txt=BRAVO на main) |
| T04 | **codex** | ✅ gate-pass → **merged** (out/delta.txt=DELTA) |
| T03 | **agy/Gemini** | ✅ gate-pass → **merged** (out/charlie.txt=CHARLIE; 1 reject-retry, 2-й заход чистый) |
| T01 | claude | ⛔ block ×3 → **abandoned** (cap #8; полный Claude Code воркер на задачу-заглушку делает лишнее вне зоны [files:], судья справедливо блокирует) |

- **summary**: `merged:[T02,T03,T04], abandoned:[T01], stopped:false` (завершился САМ по `done`, не по STOP).
- **wall-clock**: 229s (включая 3 медленных claude-abandon попытки T01 — они и есть узкое место).
- Всё прибрано автоматически: 0 остаточных worktrees, 0 fleet-веток даже после abandon.

## Что доказано живьём (цель T016)
1. **Провайдеры codex и agy/Gemini работают в fleet-пайплайне end-to-end** — воркер→оракул→судья→merge,
   реальные файлы влиты на main. (+ smoke ранее: codex PONG 84s, agy PONG 42s.)
2. **Судья sonnet РАЗБОРЧИВ, не резиновый**: pass для чистых codex/agy, block ×3 для claude-воркера
   с лишним. Гейт реально фильтрует scope creep.
3. **Все 3 бага, найденные в этой серии, подтверждены починенными одним прогоном**:
   - #10 (судья `--json-schema` рвётся cmd.exe) — иначе НИ ОДИН слайс не прошёл бы gate; теперь gate-pass есть. `8036791`.
   - #9 (лог воркера засорял дифф) — иначе codex/agy тоже блокировались бы; теперь чисто. `8a42d25`.
   - #8 (unbounded retry) — T01 остановлен на 3-й попытке (`batch-abandoned, attempts:3`), не бесконечно; прогон завершился сам. `4a18997`.

## Фиксы (детали) — см. предыдущий чекпоинт `...bench-bug8-9-fixed-bug10-judge-schema.md`
- #8: `fleet.js` maxAttempts=3 + attempts Map + recordFail + batch фильтр !isAbandoned.
- #9: `fleet.js ensureFleetIgnore` → `.git/info/exclude` (logs/events/claims; не трекаемый .gitignore).
- #10: `providers.js claudeExe()` резолвит claude.cmd-шим → реальный `claude.exe` (spawn без shell,
  node сам квотит inline JSON-схему). `where claude` → node_modules/@anthropic-ai/claude-code/bin/claude.exe.

## НЕ сделано в рамках T016 (осознанно)
- **Последовательный baseline (`--workers 1`)** для точного «vs» ускорения — НЕ прогнан. Параллель = 229s.
  Аналитически последовательно было бы ~365s+ (T01 claude-abandon ~165s + codex/agy слайсы), т.е. ~1.5-1.6x,
  ограничено самым медленным воркером (claude-abandon). Точный baseline — необязательный добор.
- **T017** (драки: STOP-resume дожимает; 429-инъекция → failover; agy-счётчик/limitHit в ledger) — отдельный live-слайс, не начат.

## Next Steps
1. (опц.) Baseline `--workers 1` на идентичном bench-репо → точное число ускорения в чекпоинт.
2. T017 live-драки (STOP/resume + 429-failover).
3. После T016(+T017) → вердикт v1 fleet → merge `feature/elt-loop-driver` в main.

## Resume Pointer
- Focus: T016 fleet-бенч ЗАКРЫТ по сути (провайдеры codex+agy доказаны end-to-end, судья разборчив,
  3 бага починены и подтверждены живьём). Осталось опц. baseline-число + T017-драки → merge в main.
- Resume: `/elt` → этот чекпоинт (свежайший).
