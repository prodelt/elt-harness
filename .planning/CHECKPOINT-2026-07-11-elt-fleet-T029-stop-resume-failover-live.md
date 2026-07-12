# Checkpoint — 2026-07-11 — T029 закрыт: живой STOP/resume + инжектированный лимит-failover

## Итог одной строкой
Два независимых живых прогона на scratch-репо: (A) STOP посреди работы → child мёртв
≤10с, 0 orphan, resume добирает остаток; (B) инжектированный 429-лимит (`FLEET_BIN_CODEX`
→ stub) → живой failover на следующего провайдера в цепочке, `failoverFrom`/`limitHit`
видны в `run-log.jsonl`. T029 закрыт по обоим критериям задачи.

## Часть A — STOP посреди прогона + resume
`…/scratchpad/fleet-bench-t029-stop/`: 3 disjoint `[P][S]`-слайса (T01/T02/T03),
`workers=2`, agy-first policy (та же схема, что T028).

**Прогон 1 (interrupt):** батч [T01,T02] стартовал (`slice-work` ×2, agy). Через 6с после
старта implement-фазы записан `.harness/STOP` (12:17:18.451Z). Живой agy-процесс умер
**8.3с** спустя (12:17:26.756Z, `Get-Process agy` перестал находить процесс) — внутри
критерия ≤10с. T02 успел закрыться штатно (gate-pass+merged ДО STOP), T01 получил
`stopped-mid-slice` (worktree/claim освобождены СРАЗУ — `.fleet-wt` и
`.harness/fleet/claims` пусты сразу после прогона, `git worktree list` чист), T03 не
стартовал (батч не набрался). Прогон вернул **exit 1** (`stopped:true`,
`stoppedReason:"STOP-файл"`) — честный nonzero при незакрытом плане (совпадает с
критерием 6 spec.md, хотя это T030).

**Прогон 2 (resume):** `.harness/STOP` удалён, тот же `run` без изменений в tasks.md/коде.
`summary: {"merged":["T01","T03"],...,"stopped":false}` за 45.4с — claims-based resume
дожал оставшиеся 2 слайса (T01 переделан заново, не «доделан» — implementer стартовал
с нуля в свежем worktree, это ожидаемо: mid-flight работа не сохраняется, только claim
освобождён для повторного захвата). Итог: **3/3 merged**, `tasks.md` все `[X]`,
`git worktree list`/`.fleet-wt`/claims чисты — **0 orphan** после обоих прогонов.

## Часть B — инжектированный лимит → живой failover
`…/scratchpad/fleet-bench-t029-failover/`: 1 слайс `[S]`, `workers=1`, policy
`S: ["codex","agy","claude"]`. `FLEET_BIN_CODEX` (документированный override в
`providers.js:resolveBin`) указан на node-стаб, печатающий `"Error: 429 rate limit
exceeded..."` и падающий exit 1 — реальный live-путь `fleet.js` → `providers.run` →
`router.detectLimit` → `router.failover`, не юнит-тестовый мок.

`run-log.jsonl` (живые строки, не сконструированные):
```
{"tid":"T01","phase":"implement","provider":"codex","exit":1,"failoverFrom":"codex","limitHit":true,"verdict":"limit"}
{"tid":"T01","phase":"implement","provider":"agy","exit":0,"failoverFrom":null,"limitHit":false,"verdict":"ok"}
{"tid":"T01","phase":"judge","provider":"claude","model":"sonnet","verdict":"pass"}
```
`events.jsonl`: `limit-hit tid=T01 provider=codex next=agy` → новый батч на agy → gate-pass
→ merged. `summary.requeued:["T01"]` фиксирует, что слайс был переигран другим
провайдером. Слайс закрыт (`[X]`, `out/delta.txt`="DELTA", oracle зелёный).

## Проверка против T029 (tasks.md L30)
- «запись STOP посреди прогона → child мёртв ≤10с» — ✓ 8.3с
- «повторный run добирает остаток (resume по state)» — ✓ 45.4с, 3/3 merged
- «реальный/инъецированный лимит → failover виден в ledger (failoverFrom, limitHit)» —
  ✓ обе строки в run-log.jsonl несут явные значения, не null/false-заглушки

## Хвосты / что дальше
- T029 `[X]` в `specs/003-elt-fleet-hardening/tasks.md`.
- Осталось T030 — финальный gate-вердикт по ВСЕМ 6 критериям spec.md (T028 закрыл 1-4,
  T029 закрыл 5 живьём; критерий 6 exit-честность уже косвенно подтверждён прогоном 1
  части A выше, но T030 должен зафиксировать это формально по двум ПОЛНЫМ повторяемым
  прогонам плана, не по разрозненным бенчам).
- Scratch-репо (`fleet-bench-t029-stop`, `fleet-bench-t029-failover`, `stub-limit.js` в
  текущем scratchpad) — расходные.
