# Checkpoint — 2026-07-10 15:15 — T016 live-fire бенч: 4 реальных бага найдены и починены, сам бенч НЕ закрыт

## Build Status
- Compiles: yes (Pipeline Setupper — node, без сборки)
- Lint: not configured (doctor.test.js покрывает)
- Type check: not run (JS без TS)

## Test Metrics (Pipeline Setupper)
- Total: 56 | Passed: 56 | Failed: 0 | Skipped: 0
- Coverage: not measured
- Новых тестов эта сессия: 0 (все 4 фикса — точечные правки промпта/парсинга/экранирования;
  `elt-loop.ps1` по конвенции проекта тестируется live-fire, не юнитами; `gate.js`/`providers.js`
  правки backward-compatible с существующими фейк-стабами — прогонами подтверждено 56/56 после
  каждого из 4 коммитов)

## Код-правки эта сессия (Pipeline Setupper, ветка `feature/elt-loop-driver`)
4 фикса, каждый — оракул зелёный + свежий судья-субагент (sonnet, pass) + `elt commit`:

1. `d2f4751` — `tools/elt-loop.ps1`: `git add -N -- .` (intent-to-add) перед `git diff HEAD`.
   Баг: диф был слеп на новых untracked-файлах (git diff HEAD их не показывает) → судья получал
   пустой промпт. Зеркало уже существовавшего фикса в `gate.js` (fleet-путь).
2. `feba0d5` — `tools/elt-loop.ps1` + `tools/fleet/gate.js`: judge-промпт явно запрещает искать
   ID задачи (T00X) по git-истории/gh. Баг: агентный судья (`claude -p --dangerously-skip-permissions`,
   есть tool-access) сам искал T00X по истории и находил ЧУЖУЮ, не связанную, уже смерженную
   задачу с тем же ID из другой spec-папки того же проекта — рецензировал не то.
3. `6e03142` — `tools/fleet/providers.js` + `tools/fleet/gate.js` + `tools/elt-loop.ps1`: судья
   переведён на `claude -p --json-schema <schema> --output-format json` (structured output)
   вместо regex-парсинга прозы. Баг: судья регулярно пишет легитимный pass другими словами
   («принято», «зачёт») — REJECT-default блокировал нормальные слайсы. Старый regex остался
   фолбэком (не удалён).
4. `dab9782` — `tools/elt-loop.ps1`: JSON-схема записана с backslash-escaped кавычками (`\"`)
   вместо литеральных. Баг: PowerShell 5.1 splatting массива аргументов в нативный `.exe` ломает
   JSON с литеральными `"` → CLI падает `Error: --json-schema is not valid JSON`, судья получал
   пустой вывод. `gate.js` (Node, не PowerShell) фикса #3 этого не требовал — баг чисто PS-специфичный.

**Важно**: фикс #4 диагностирован и подтверждён ЖИВЫМ ПРЯМЫМ вызовом (`claude -p --json-schema
... --output-format json` через PowerShell), но **финальный сквозной retry T104 с ВСЕМИ 4 фиксами
ЕЩЁ НЕ ЗАПУЩЕН** (context-порог сессии — переход в новый чат до этого). Следующая сессия должна
начать именно с этого retry, а не считать баг #4 полностью замкнутым до живого подтверждения.

## Git State
- Pipeline Setupper: ветка `feature/elt-loop-driver`, последний коммит `dab9782`, uncommitted:
  `.harness/run-log.jsonl` (авто-лог, не код)
- AWE4 (`C:\Ametrin projects\Ametrin web ecosystem 4`): ветка `feature/t001-2026-07-10`
  (авто branchPolicy=feature), последний коммит `b7f54bf`. Uncommitted: staged
  `crates/tools-svc/README.md` (T104, реальный контент от имплементатора, ждёт судью — НЕ трогать
  руками, следующий `elt-loop.ps1 -Slices 1` подхватит и прогонит судью с фиксами)

## Контекст: зачем это всё (T016)
`specs/002-elt-fleet/tasks.md` (Pipeline Setupper) — 15/17 закрыто до этой сессии. T016 = живой
бенч `fleet run --workers 2` vs последовательный `elt-loop.ps1` baseline на реальном Rust-монорепо
(AWE4) с тяжёлым оракулом (cargo fmt+clippy+test workspace + pnpm build). Утверждённый план —
`C:\Users\user\.claude\plans\whimsical-petting-platypus.md`. Scratch-спека бенча —
`AWE4/specs/000-fleet-bench-live/` (8 disjoint-file слайсов: README.md+CHANGELOG.md по 4 crates
без документации; T004-T008 переименованы в T104-T108 из-за находки #2 выше).

## Метрики бенча, собранные пока (частичные, baseline)
- T001 (холодная cargo-сборка всего workspace): оракул 273s. Реально закоммичен, `2a0c856`.
- T002/T003 (инкрементально, общий `CARGO_TARGET_DIR`): оракул ~9s каждый. Закоммичены `2ca5f4a`, `8c0a8bd`.
  ⚠ Эти 3 вердикта "pass" получены ДО фикса #2 (ID-collision) — есть шанс, что судья тоже
  рецензировал не совсем то. Контент реальный, низкорисковый (README доки), решено НЕ передокапывать
  задним числом ради экономии бюджета — честная оговорка к метрикам, не скрыто.
- T104 (было T004): 3 попытки, все blocked — но КАЖДАЯ следующая попытка вскрывала НОВЫЙ баг
  (не один и тот же), не легитимный отказ. С фиксом #4 живой прямой вызов подтверждён рабочим,
  но сквозной retry через сам driver ещё не проверен end-to-end.
- `CARGO_TARGET_DIR` shared: `C:\Users\user\AppData\Local\Temp\claude\C--Claude-playground-Pipiline-setupper\a809aba1-0f0d-4fd8-a243-55c0fcc80559\scratchpad\cargo-target-shared`
  — подтверждено рабочим, инкрементальные сборки резко быстрее холодной (273s → ~9s).
- Параллельный прогон (T105-T108, `fleet run --workers 2`) — **ещё не запускался вообще**.

## Remaining Work (в порядке)
1. Ретрай T104 (`elt-loop.ps1 -Project AWE4 -Slices 1`, тот же `CARGO_TARGET_DIR`) — первая живая
   проверка ВСЕХ 4 фиксов вместе, сквозь сам driver (не прямой тестовый вызов).
2. Если T104 наконец закроется — `fleet run --workers 2` на T105-T108
   (`tools/elt-fleet.ps1 -Action run -Project AWE4 -Tasks specs/000-fleet-bench-live/tasks.md -Workers 2`).
3. Собрать метрики (wall-clock baseline vs parallel, провайдеры per-слайс, судья pass-rate) →
   финальный итоговый чекпоинт (не этот, следующий).
4. Закрыть T016 в Pipeline Setupper: `elt commit --task T016 --verdict pass` (свежий судья на
   метрики/чекпоинт).
5. T017 (последний слайс `specs/002-elt-fleet`) → merge `feature/elt-loop-driver` в main.

## Blockers
Нет активных технических блокеров. Единственная неопределённость — сработает ли T104 retry
end-to-end через сам `elt-loop.ps1` (все 4 фикса протестированы по отдельности/напрямую, но не
как единая цепочка внутри реального прогона драйвера).

## Next Steps
1. `$env:CARGO_TARGET_DIR = "...\\scratchpad\\cargo-target-shared"` (путь выше) →
   `powershell -File tools/elt-loop.ps1 -Project "C:\Ametrin projects\Ametrin web ecosystem 4" -Slices 1`
2. Если pass — fleet run на T105-T108.
3. Если снова block — читать `.harness/loop-logs/<ts>-T104-judge.log` в AWE4, диагностировать
   как баги #1-4 выше (методика: воспроизвести ИМЕННО тот вызов, что делает driver, а не
   абстрактный тест).

## Resume Pointer
- Focus: закрыть T016 (fleet-бенч на AWE4) — сначала подтвердить T104 живьём через сам driver
  со всеми 4 фиксами, потом параллельный прогон T105-T108, метрики, закрыть слайс, затем T017 → merge.
- Resume: `/elt` в новом чате восстановит контекст из этого чекпоинта автоматически (свежайший
  `CHECKPOINT-*`). Первая команда — ретрай T104, шаг 1 из Next Steps выше.
