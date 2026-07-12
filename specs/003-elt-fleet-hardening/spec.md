# spec — ELT Fleet Hardening: сделать параллельный прогон безопасным и честным

> Источник: аудит-вердикт от 2026-07-10 (trace AWE4, 64 мин, ≥94 запуска Claude CLI).
> Рубрика судьи: этот файл + `constitution.md` (если есть) + `.planning/ELT-FLEET-DESIGN.md`.
> Предшественник: `specs/002-elt-fleet/` (MVP-слайсы T001–T017). 002 помечен experimental;
> T008, T009, T012, T016, T017 переоткрыты как ложно/частично закрытые — их доказывает эта спека.

## Проблема

Fleet как идея (ускорять независимые слайсы, переносить нагрузку на codex/agy при
Claude-лимитах) осмыслен, но текущая реализация небезопасна: за один живой прогоне
сожжено ≥94 Claude-вызова, из них ≥86 без явной модели (глобальный opus/high), при
том что план обещал ≤4 LLM-вызова на слайс. Прогон отдаёт exit 0 даже при
failed/abandoned слайсах, STOP не убивает активные процессы (живут до 5-мин timeout),
merge может отключить smoke-оракул и захватить чужие правки, ledger не отражает реальный
расход. Прежде чем Fleet можно доверить работу, нужно закрыть дефекты и заново доказать
критерии жизни на повторяемом бенче.

## Решение (объём)

Правки только в `tools/fleet/*` (+ `tools/elt-fleet.ps1`, доки). Инварианты `elt.js`
(оракул/судья/commit-гейт) не трогаем. По фазам:

- **Caps & routing:** явная модель на КАЖДОМ spawn + lean CLI-профиль (без глобальной
  массы skills/MCP/hooks); hard caps до spawn (`maxCalls`, `maxClaudeCalls`, `maxMinutes`,
  concurrency-per-provider); все провайдеры cooling/down = stop прогона (не fallback на
  остывающего); распознавать `session limit` наравне с 429.
- **State machine:** персистентная машина слайса `implementing → oracle → judge_pending
  → merge_pending → merged`; judge недоступен = припарковать worktree на `judge_pending`,
  НЕ переделывать реализацию; crash-resume читает состояние. Heal ограничен планом
  (≤2 heal, без ×3-размножения по батчам), причина `block` уходит в следующий prompt.
- **Merge honesty:** scoped `git add <файлы слайса>` вместо `-A`; убрать `git reset --hard`
  из error-path; non-conflict `m.ok=false` = terminal (не "merged"); обязательный
  integration-оракул после КАЖДОГО merge (включая production, без skip); любой
  failed/abandoned слайс → прогон nonzero exit.
- **Observability:** судья получает `spec.md`+`constitution.md` как рубрику, `block`-причина
  переживает retry; полный per-phase call-ledger (строка на каждый spawn:
  phase/provider/model/tokens/cost/durationSec; heal и judge посчитаны).
- **Process ownership:** трекинг child PID, STOP → tree-kill (`taskkill /T`), STOP→мертво
  ≤10с, ноль orphan-worktrees после crash-resume.
- **Re-validation [live]:** идентичный бенч workers=1 vs workers=2, живой STOP/resume и
  реальный limit-failover, финальный gate против критериев жизни.

## Критерии приёмки (Fleet живёт ⇔ два повторяемых прогона показывают всё)

1. **100% merged** — все [P]-слайсы плана закрыты через `elt commit`; ноль слайсов, молча
   объявленных merged при `m.ok=false`.
2. **Speedup ≥1.5×** — wall-clock `workers=2` против измеренного `workers=1` baseline
   (baseline реально запущен, не реконструирован).
3. **Claude-токены ≤50%** Claude-only baseline (из per-phase ledger, не оценка).
4. **≤4 LLM-вызова на слайс** — worker + heal + judge суммарно; hard cap не превышен ни разу.
5. **STOP ≤10с** — от записи `.harness/STOP` до смерти всех child-процессов; ноль orphan.
6. **Exit-честность** — прогон с любым failed/abandoned слайсом возвращает nonzero.

Порог удаления: speedup <1.3× ИЛИ экономия Claude <30% → параллельный слой снять, полезное
оставить как последовательный multi-provider failover в `elt-loop`.

## Вне scope

- Переписывание оркестратора на Rust (профилирование показало: нагрузку создают CLI и
  build/test, не Node; Rust — только если после фиксов оркестратор >10% CPU/RSS или нужны
  Windows Job Objects).
- Изменение инвариантов `elt.js` / `elt-loop.ps1`, spec-kit, UI-дашборд, автотюнинг воркеров.
- Экономия суммарных токенов как цель (цель — время + разгрузка Claude-бюджета).
