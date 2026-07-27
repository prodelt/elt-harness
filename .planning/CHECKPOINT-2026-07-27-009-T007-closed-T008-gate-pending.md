# CHECKPOINT 2026-07-27 — 009: T007 закрыт, T008 готов и ждёт гейта

## Состояние
- Ветка `feature/judge-bench-parallel-oracle`, HEAD `f16dd4a`. Оракул **57/57**.
- Фазы A и B закрыты. **T007 закрыт** (`8e01cc9`, оба судьи pass, red-proof красный).
- **T008 написан целиком, тесты 17/17, НО не закоммичен** — судья codex дал block.
- Зеркало `~/.claude/bin/elt.js` синхронно с `tools/elt.js` (обе версии с durationSec).

## Закрыто

### T007 watchdog — `8e01cc9`
`tools/harness-watch.js`: 6 детекторов (limit-streak, red-repeat, judge-dead-streak,
oracle-slow, stale-park, circuit-off), `--once` / `--watch`, `.harness/health.jsonl`
идемпотентно по `key` (+ авто-exclude в `.git/info/exclude`). Живой прогон нашёл реальный
инцидент: `limit-streak agy`.

## T008 — в дереве, НЕ закоммичен (ждёт решения гейта)
Незакоммиченные файлы: `tools/harness-watch.js`, `tools/harness-watch.test.js`,
`tools/elt-loop.ps1`, `tools/fleet/fleet.js`, `tools/elt.js` (+ зеркало `~/.claude/bin/elt.js`).

Сделано: авто-фиксы закрытого списка (cooldown / park / judge-fallback), exactly-once через
`ack`, проводка `oracle.durationSec` в run-log (зелёный прогон тоже пишется), fleet применяет
все три решения (`applyWatchdog`, экспортирована ради теста), драйвер — park + judge-cooldown +
`watchdog-cooldown-noop`, сужение батча на припаркованную задачу.

### Дефекты, найденные судьёй codex за 5 раундов (все настоящие, все починены)
1. `status` (elt.js) vs `result` (elt-loop.ps1) — детекторы были слепы на логе драйвера.
2. exit `--once` отражал новизну записи, а не состояние окна.
3. `nextProvider` брал первого из оставшихся вместо следующего по цепочке.
4. Фолбэк судьи менял провайдера БЕЗ модели → fatal config (codex с моделью agy).
5. Fleet применял только cooldown; парковка жила в памяти и не переживала рестарт.
6. at-most-once → exactly-once: действие выдаётся, пока потребитель не подтвердил (`--ack`);
   ack только за фактически применённое (упавший `elt park` не подтверждается).
7. Парковка одной задачи батча выбрасывала весь батч (`continue` на весь `$picked`).

### Почему block (раунд 6) и что решено
Codex требовал, чтобы solo-драйвер применял `cooldown` к провайдеру ИМПЛЕМЕНТАТОРА и уводил
следующий вызов по цепочке. У драйвера цепочки нет — он всегда claude (`claude-invoke.js`);
это работа T010 (failover воркера). Юзер выбрал **вариант 1**: граница уточнена прямо в
`tasks.md` (T008 = cooldown применим к судье + явный noop; перевод имплементатора по цепочке
вынесен в T010), спека переутверждена, коммит `f16dd4a`.

## ДАЛЬШЕ (в свежем чате)
1. `node tools/elt.js oracle` (дерево не трогать после него — treeHash).
2. `node tools/elt.js judge run --task T008 --spec specs/009-elt-v3-thinking-harness`
   — рубрика теперь содержит уточнённую границу, возражение codex про драйвер снято текстом.
3. pass → `node tools/elt.js commit --task T008 --spec specs/009-elt-v3-thinking-harness --skip-oracle`.
4. Дальше по плану — T009 (worker-attestation).

## Гочты сессии
- `elt slice next` / `judge run` / `commit` — ВСЕГДА с `--spec specs/009-elt-v3-thinking-harness`.
- `.planning/*` (авто-чекпоинты, elt-system-audit-latest) судья ловит как scope creep —
  стэшить перед гейтом.
- Ассертить в тестах драйвера по run-log (`.git/elt/run-log.jsonl`), не по `loop-logs/`:
  парковка делает `git stash -u` и уносит untracked-логи. Stdout PowerShell — OEM-кодировка.
- Тест драйвера/fleet можно гонять со стабом провайдера: `FLEET_BIN_CLAUDE=["node","stub.js"]`.
