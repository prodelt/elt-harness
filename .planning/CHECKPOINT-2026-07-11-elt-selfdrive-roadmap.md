# CHECKPOINT 2026-07-11 — ELT Self-Drive роадмап готов к авто-запуску

## ЗАДАЧА
Глубокий аудит харнесс-петли + роадмап на 4 фичи: адаптивный эффорт, авто-ротация
сессий на 200k, codegraph-liveness, self-heal харнесса. Уровень «harness, не vibes».

## РЕЗУЛЬТАТ ЭТОГО ЧАТА
- Аудит проведён по РЕАЛЬНОМУ коду (elt.js, elt-loop.ps1, providers.js, 3 контекст-хука,
  codegraph-гейты, run-log 45 записей, doctor). Не по памяти.
- Роадмап: `specs/004-elt-selfdrive/spec.md` + `tasks.md` (13 слайсов, `elt` их видит).
- Ключевой факт-чек: `claude --effort <level>` — реальный headless-флаг → F2 реализуема
  в драйвере per-инвокацию. `--fallback-model`, `--append-system-prompt` тоже есть.

## ДАЛЬШЕ (в НОВОМ чате — авто-запуск elt)
Голый `/elt` в новом чате → Режим 1 (план есть) → возьмёт T001. Или автономно:
```powershell
powershell -File "C:\Claude playground\Pipiline setupper\tools\elt-loop.ps1" -Project "C:\Claude playground\Pipiline setupper" -Slices 4
```
Порядок = приоритет. Must-do первыми: **T001** (дубль elt.js) + **T002** (judge-liveness,
корень бага 3e73423). T007/T011 помечены OPTIONAL. Судья судит по `spec.md` (constitution нет).

## НАЙДЕННЫЕ ДЕФЕКТЫ (для аудита, детали — в spec.md §Проблема)
1. Тихий отказ судьи неотличим от reject (пустой лог → block ВСЕГО; чинено 3e73423, но класс остался).
2. `~/.claude/bin/elt.js` ≠ `tools/elt.js` — дрейф source-of-truth.
3. Плоский эффорт — трудный слайс стопается на том же уровне способностей.
4. Интерактивный контекст-менеджмент только advisory (гард лишь подсказывает).
5. codegraph «не всегда» — не измерено, нет liveness-чека.
6. Нет самодиагностики петли (регрессии ловит только человек на реальной задаче).

## ПОТОЛКИ (осознанные, в spec.md §Вне scope)
- Интерактивная zero-touch ротация НЕ нативна (хук не жмёт /new+/elt). Драйвер = настоящая ротация.
- F-selfheal НЕ автономный самопереписыватель — обнаружил→завёл слайс→судья→merge человеком.

## Resume pointer
`specs/004-elt-selfdrive/tasks.md` (13 open) · этот чекпоинт · аудит-выжимка в ответе чата.
