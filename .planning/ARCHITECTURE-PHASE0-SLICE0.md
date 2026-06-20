# ARCHITECTURE — Phase 0 / Slice 0 (AMOS Product v1)

> Источник: `.planning/ROADMAP-AMOS-PRODUCT-V1.md`, решения D1–D11 (закрыты 2026-06-18).
> Эта сессия реализует Slice 0: механический скелет, ноль новой логики, кроме
> минимального installer (которого физически не существовало раньше).

## Цель и место
Новый НЕЗАВИСИМЫЙ репозиторий: `C:\Claude playground\amos-os` (сосед этого репо,
не вложен в него). npm-пакет `amos-os`, CLI-команда остаётся `amos` (через `bin` в
package.json — не зависит от имени на registry). Apache-2.0 (D11). Без GitHub
remote/push в этой сессии — только локально.

## packages/* mapping (источник → назначение)

| package | источник | назначение | примечания |
|---|---|---|---|
| kernel | `~/.amos/{bin,lib,tests,policy.json,.gitignore}` | `packages/kernel/` | исключить `state.sqlite`, `errors.log`, `.cache` — runtime, остаётся в доме юзера |
| hooks | `~/.claude/hooks/*.js`, `hooks/lib/`, `hooks/config.json` | `packages/hooks/` | исключить `hooks/graphify-out` (генерируемый); `settings.json` НЕ копируется — это machine-projection, строится installer'ом позже |
| skills | `~/.claude/skills/*` (72 dirs) | `packages/skills/` | `skill-packs/` (addyosmani, pm-skills — вендоренные, большие) сознательно ВНЕ Slice 0; подтягиваются по требованию через будущий `amos skill add` (D9) |
| agents | `~/.claude/agents/*.md` (16) | `packages/agents/` | как есть |
| tools | `tools/*.js` этого репо (67) | `packages/tools/` | механическая копия; ЧАСТЬ (doctor-core checkDocs/checkRegistry/checkDocsGate/checkHarnessChecklist) — операторские проверки command-center репо, не продуктовая поверхность конечного юзера — помечено для ревью в Phase 1, не разделяется сейчас |
| installer | нет (новое) | `packages/installer/` | минимальный init/uninstall — см. ниже |

## Осознанные отложения (не Slice 0)
- Capability-projection sync-логика (D7) — полный «умный» `amos sync` — Phase 3/4.
- Запись settings.json/hooks.json под конкретного клиента (Claude полный набор событий
  vs Codex без FileChanged/Notification vs Gemini) — installer Slice 0 делает только
  тупое copy с capability-фильтром по имени файла, не умный merge существующих настроек.
- Вендоринг/fetch skill-packs — Phase 4 (`amos skill add`).
- CI реально зелёный на mac/linux — написан, но не запущен из этой Windows-сессии
  (нет remote); верифицируется локально только на Windows.
- Разделение operator-only / product tools/* — аудит Phase 1.
- Создание GitHub-репо / publish на npm — Phase 5.
- **Kernel first-run bootstrap** (сидирование `policy.json` из `packages/kernel/` в
  `$AMOS_HOME` при первом запуске) — нет ни в продуктовом коде, ни в installer'е.
  В исходном colocated `~/.amos` это не требовалось (код и state жили в одном месте).
  CI/sandbox-верификация подкладывает `policy.json` в `$AMOS_HOME` вручную (фикстура,
  не продуктовая логика) — см. `.github/workflows/ci.yml`. Реальный bootstrap — Phase 1.

## Находки при верификации (исправлено в эту же сессию)
- **Баг в 5 тестовых файлах kernel** (`amos.test.js`, `policy.test.js`,
  `preflight.test.js`, `doctor-hooks.test.js`, `browser-doctor.test.js`): резолвили
  путь к CLI под тестом как `path.join(AMOS_HOME, 'bin', 'amos.js')` — валидно только
  для старого colocated layout, где код и state жили в одной директории. После split
  (state ≠ код) тест со свежим/чужим `AMOS_HOME` тихо спавнил СТАРЫЙ `~/.amos/bin/amos.js`
  вместо копии — предыдущая «242/243 совпадает с pristine» проверка (Sprint kernel-extract)
  была честной только для pure-unit тестов, для этих 5 файлов она по факту сравнивала
  pristine с pristine. Исправлено: `AMOS_JS = path.join(__dirname, '..', 'bin', 'amos.js')`
  (тот же приём, что уже стоял на соседней строке для `require('../lib/...')`). Это
  чинит сам тест-харнес, не продуктовый код (`bin/amos.js` и так резолвил `lib/` через
  `__dirname` корректно) — отнесено к «fix root cause», не к «новой логике».
- **Не баг, тестовая фикстура**: assert `additionalContext.includes('.amos')` в
  `amos.test.js` зависит от того, что путь `$AMOS_HOME` буквально содержит подстроку
  `.amos` — верно для дефолтного `~/.amos`, ложно для произвольного tmp-каталога сэндбокса.
  CI/локальная верификация сэндбоксит `$RUNNER_TEMP/amos-home/.amos` (с `.amos` на конце),
  не трогая тест.
- **Подтверждённый pre-existing concurrency-флейк** (параллельные `node:test`-воркеры
  на общем `state.sqlite`) — даёт от 0 до ~5 случайных падений на полном прогоне,
  разный набор тестов каждый раз, исчезает в изоляции одного файла. В CI смягчён
  `--test-concurrency=1` (3/3 чистых прогона локально); реальный fix (per-worker DB
  или сериализация) — Phase 1/2, не Slice 0.

## packages/installer — минимальный объём Slice 0
- `init.js`: копирует `packages/{hooks,skills,agents}` в домашние директории целевых
  клиентов, capability-aware (пропускает регистрацию Notification/FileChanged для Codex;
  пропускает `agents/` для Codex+Gemini — Claude-only фича по CLAUDE.md). Идемпотентно
  (перезапись того же контента, без дублирования). Без логики записи settings.json/
  hooks.json (это явно отложено).
- `uninstall.js`: удаляет только то, что скопировал init (по манифесту путей), не
  трогает runtime state.

## План верификации этого слайса
1. `node packages/hooks/test-all-hooks.js` / `test-hooks-behavior.js` запущены из
   нового расположения — должны остаться зелёными (логика не менялась, пути всё
   ещё через `os.homedir()`). **Результат: 39/39 + 71/71 PASS**, через sandbox
   HOME/USERPROFILE (иначе тест тихо бьёт в реальный `~/.claude`).
2. Sandbox HOME тест: временный HOME/USERPROFILE, `node packages/installer/init.js
   --target claude --home <tmp>`, проверка, что ожидаемые файлы появились.
   **Результат**: все 3 цели (claude/codex/gemini) проверены — capability-фильтр
   (agents claude-only, Notification/FileChanged hooks codex-excluded) подтверждён
   на уровне файлов; идемпотентность (повторный init = тот же счётчик) и uninstall
   (полная очистка по манифесту, чистая ошибка без манифеста) подтверждены.
3. CI workflow файл `.github/workflows/ci.yml` (матрица ubuntu-latest/macos-latest/
   windows-latest) — написан, не выполнен на GitHub (нет remote). Локально на Windows
   весь pipeline эмулирован шаг-в-шаг: kernel **243/243 PASS** (после фикса AMOS_JS
   resolution + seed `policy.json` + `--test-concurrency=1` для известного флейка),
   hooks 39/39 + 71/71. YAML-синтаксис проверен PyYAML.

## Риск
Этот слайс не трогает `~/.amos`, `~/.claude` или живые файлы этого репо — чистое
аддитивное копирование в новую директорию. Ноль риска для работающего пайплайна.
