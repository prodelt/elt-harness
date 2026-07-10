# CHECKPOINT 2026-07-10 — ELT Fleet: T003 [live] закрыт (15/17)

## ЧТО СДЕЛАНО (эта сессия)
Продолжение автономного прогона `/elt` по `specs/002-elt-fleet/tasks.md`, ветка
`feature/elt-loop-driver`. Закрыт **T003** — единственный слайс, требовавший реального
живого вызова каждого провайдера (claude/codex/agy) в scratch-git.

### Живые находки (agy, live-fire в scratch-репо)
1. **STDIN не работает как канал промпта у agy** — `echo "..." | agy -p ...` игнорирует ввод,
   agy отвечает шаблонным текстом про собственные CLI-флаги (`--dangerously-skip-permissions`,
   `--print-timeout`), воспроизведено трижды разными промптами. **Фикс**: промпт передаётся
   значением флага `-p` в argv (`agy -p "текст" ...`) — тогда ответ корректный.
2. **agy игнорирует `cwd` процесса** — без явного `--add-dir <path>` пишет файлы в свою
   фиксированную `~/.gemini/antigravity-cli/scratch`, а не туда, откуда его позвали (проверено
   дважды). **Фикс**: обязательный `--add-dir "<cwd>"` в argv.
3. **agy — реальный `.exe` на PATH** (`where agy` → `agy.exe`), НЕ `.cmd`-node-шим как
   claude/codex. Раз промпт теперь в argv, спавн через `shell:true` был бы shell-injection
   на тексте задачи → `needsShell()` явно исключает `'agy'` (подтверждено: прямой
   `spawn('agy', [...], {shell:false})` находит бинарник через PATH и работает).
4. **agy-таймаут** (истечение его собственного `--print-timeout`) = exit 1 + stderr
   `"Error: timeout waiting for response"` — НЕ зависание навечно, НЕ exit 0 с пустым stdout
   (как было в исходном неверном допущении T002).
5. Реальный rate-limit (429) живьём **не** воспроизведён (нельзя спровоцировать намеренно) —
   `LIMIT_SIGNATURES`/`detectLimit` в `router.js` не менялись, только честно уточнён комментарий.
6. claude/codex — regression-проверены тем же методом, STDIN работает штатно без изменений.

### Правки
- `tools/fleet/providers.js`: doc-комментарий переписан под факты; `PROVIDERS.agy` теперь
  `(model, prompt, cwd) => [...]` (было `(model)`), строит argv с `-p <prompt> --add-dir <cwd>`;
  `needsShell()` исключает `'agy'`; stdin-запись пропускается для agy (промпт уже в argv).
- `tools/fleet/router.js`: только комментарий над `LIMIT_SIGNATURES`/`detectLimit` — убрано
  неверное "agy-квирк: пусто при exit 0", заменено честным описанием состояния.
- `specs/002-elt-fleet/tasks.md`: T003 → `[X]` с резюме находок в тексте строки.

### Гейт
Оракул `node tools/doctor.test.js && node --test tools/fleet/*.test.js` — **56/56 зелёных**
(до и после правок). Судья (свежий субагент sonnet, REJECT-default) — **pass**. Commit `4e667df`
(после self-amend — см. «Процессная накладка» ниже).

## Процессная накладка эта сессия (для памяти на будущее)
Я вручную проставил `[X]` в tasks.md ДО вызова `elt commit` и передал несуществующий флаг
`--msg` вместо правильного `--task T003` — CLI не нашёл открытую задачу для `markDone()`,
закоммитил generic `chore: elt slice` с `task:null` в run-log. Исправлено вручную (amend
локального непушенного коммита + правка последней строки `run-log.jsonl`) с подтверждения
юзера. **На будущее: НЕ проставлять `[X]` вручную — вызывать `elt commit --task T0XX
--verdict pass`, CLI сам делает markDone+ветку+сообщение.**

## ОСТАЛОСЬ (всё [live] — ТРЕБУЕТ ЮЗЕРА)
- **T016** [live] бенч: scratch-план 4+ честных `[P]`-слайсов, `fleet run --workers 2` vs
  последовательный baseline; wall-clock ≥1.5×, судья 100%, метрики в run-log → чекпоинт.
  Открытый вопрос: какой scratch-проект (AWE4 или свежий)?
- **T017** [live] драки: STOP посреди прогона → resume; 429-инъекция → failover; счётчик
  agy-вызовов/limitHit в ledger; CHECKPOINT с вердиктом v1.

## ДАЛЬШЕ (новый чат)
1. `/elt` → продолжить по плану, следующий открытый слайс — T016 (нужно решить scratch-проект).
2. T017 → вердикт v1 → merge `feature/elt-loop-driver` в main.
3. Открытые вопросы (не блокируют): claude-воркеры skip-permissions vs `--permission-mode auto`;
   размер Google AI подписки (Pro/Ultra — влияет на 5ч-окно agy).

## Resume
Ветка `feature/elt-loop-driver` (15 слайсов 002-elt-fleet + драйвер). Оракул
`node tools/doctor.test.js && node --test tools/fleet/*.test.js` = 56 зелёных. План
`specs/002-elt-fleet/tasks.md` (15 `[X]`, 2 `[ ]` live). Дизайн: `.planning/ELT-FLEET-DESIGN.md`.
Статус: `powershell tools/elt-fleet.ps1 -Action status -Tasks specs/002-elt-fleet/tasks.md`.
Предыдущий чекпоинт: `.planning/CHECKPOINT-2026-07-10-elt-fleet-impl-A-E-DONE.md`.
