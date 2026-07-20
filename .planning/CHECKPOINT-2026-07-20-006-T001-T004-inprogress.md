# Checkpoint 2026-07-20 — spec 006 ELT Front Gate: T001-T003 closed, T004 in progress

## Контекст
Юзер попросил "запускай роадмап и луп". `elt-loop.ps1`/`elt slice next` авто-выбирают
**первый** `specs/*/tasks.md` с открытыми `[ ]` (алфавитный порядок) — это специфика
005 (T021 Fleet ledger, T022/T023 внешние блокеры), НЕ 006, хотя вся сессия и ветка
`feature/006-elt-front-gate` про 006. Юзер выбрал явно: работать по 006, слайсы вручную
в интерактиве (implement → oracle → judge sonnet-субагент → `elt commit --task Txxx`),
т.к. сам PS-драйвер не умеет целиться в конкретный tasks.md.

## Закрыто (оракул зелёный, судья sonnet = pass, закоммичено в ОБА репо)
- **T001** `elt spec approve`/`status` — approval.json {approvedAt, specHash, tasksHash}, идемпотентно, stale-детект. Коммит Pipiline setupper `c0928b0`, `~/.claude` `66e75c0`.
- **T002** approval-гейт на `slice next`/`commit` — fail-open без `specApproval:true`, fail-closed с ним; гейт считается по **spec-директории САМОЙ ЗАДАЧИ** (`findTaskBinding`), не по auto-selected первому плану — это критично, иначе 006 никогда бы не гейтился, пока у 005 есть открытые боксы. `--skip-approval` → `approvalSkipped:true` в run-log (только commit). Regression-фикс по пути: `slice next` должен читать harness.json МЯГКО (JSON.parse без строгой схемы), иначе минимальный self-heal-фикстур `{oracle,shell}` в `doctor.test.js` ломается. Коммиты `cf44b7a` / `99939e7`.
- **T003** `elt spec lint` — 6 обязательных H2-секций (prefix-match), `spec approve` гоняет lint первым, self-check: specs/006 проходит свой lint. Коммиты `e941895` / `6f584fc`.

## В работе — T004 (НЕ закоммичено, НЕ прогнан судьёй после последнего фикса)
Pre-run approval-гейт для автономии: `tools/approval-guard.js` (новый, опирается на
`elt.js spec status`, не дублирует логику) + вызов из `elt-loop.ps1` (перед циклом,
однократно) + вызов из `tools/fleet/fleet.js` (`run()`, in-process, explicit specDir
через `path.dirname(tasksPath)` — fleet не проходит через `elt slice next`/`commit`
вообще, поэтому ему нужен свой гейт).

**Файлы (uncommitted, working tree):**
- `tools/approval-guard.js` (новый) — `guard(root, specDir?, eltCli?)`, CLI: `node approval-guard.js <root> [specDir] [eltCliPath]`
- `tools/approval-guard.test.js` (новый) — 7 тестов, все зелёные
- `tools/elt-loop.ps1` (modified) — pre-run вызов гейта перед `for`-циклом + `if (-not $approvalOk) { break }` первой строкой цикла
- `tools/fleet/fleet.js` (modified) — `require('../approval-guard')` + вызов в начале `run()`, early-return `{stopped:true, stoppedReason:'approval-guard'}`
- `tools/fleet/fleet.test.js` (modified) — +1 тест, интеграционный (проходит)

**Статус тестов на момент чекпоинта:**
- `node tools/approval-guard.test.js` — 7/7 pass
- `node tools/fleet/fleet.test.js` — 16/16 pass (включая новый)
- `node tools/elt-oracle-runner.js` — 39/39 pass (ПЕРЕД последним фиксом ниже — надо перепрогнать)

**⚠ Найден и ПОЧИНЕН, но НЕ переverified баг** (обнаружен живым smoke-тестом, не юнит-тестом):
`elt-loop.ps1` изначально вызывал `node approval-guard.js $Project "" $eltCli` (позиционные
аргументы). **PowerShell 5.1 тихо роняет пустую строку `""` при маршалинге argv в нативный
exe** (тот же класс бага, что уже задокументирован в файле про `--json-schema`/claude.exe) —
`$eltCli` сдвигался в слот `specDir`, гейт молча превращался в no-op (exit 0 на заведомо
неутверждённой спеке!). Юнит-тесты этого не поймали, т.к. и `approval-guard.test.js` (Node
`spawnSync`, не PS), и `fleet.test.js` (прямой JS-вызов `guard()`, не через PS) не проходят
через реальный PowerShell native-argv marshalling — только живой `powershell -File elt-loop.ps1`
это вскрыл.

**Фикс применён** (`tools/elt-loop.ps1`): вместо позиционных аргументов — `$env:ELT_CLI = $eltCli`
перед вызовом, `node approval-guard.js $Project` без второго/третьего позиционного (guard()
уже поддерживал `process.env.ELT_CLI` как фоллбэк).

**Ручная проверка фикса ПРЕРВАНА** (PowerShell classifier временно недоступен в сессии — не
ошибка кода, транзиентная недоступность классификатора для PS-команд). Нужно при возврате:
```powershell
$env:ELT_CLI = "$env:USERPROFILE\.claude\bin\elt.js"
& node "C:\Claude playground\Pipiline setupper\tools\approval-guard.js" "C:\Users\user\AppData\Local\Temp\elt-loop-approval-smoke"
Write-Host "EXITCODE=$LASTEXITCODE"   # ожидается 1 (спека unapproved) — до фикса было 0
```
Фикстура для smoke-теста уже создана: `C:\Users\user\AppData\Local\Temp\elt-loop-approval-smoke`
(specApproval:true, specs/001-fixture с полным spec.md, неутверждена). Если temp вычищен —
пересоздать (см. bash-команду в истории сессии, простая: git init + harness.json + spec.md
с 6 секциями + tasks.md).

## Резюме шага (эталонный урок для будущих PS-гейтов в этом проекте)
Юнит-тесты дважды дали ложное чувство полноты для T004: (1) сначала `slice next` строгий
`loadConfig()` сломал self-heal fixture — поймано полным оракулом репо, не юнит-тестом гейта;
(2) потом PS argv-marshalling молча обнулил гейт — поймано ТОЛЬКО живым `powershell -File`
smoke-тестом, юнит-тесты (Node spawnSync / прямой JS-вызов) прошли зелёным мимо бага.
**Вывод: для PS-driver интеграций живой smoke через реальный `powershell -File` — обязательный
шаг перед judge/commit, юнит-тестов JS-уровня недостаточно.**

## Дальше (resume order)
1. Перепроверить smoke-тест фикса (команда выше) — ожидать `EXITCODE=1`.
2. Перепрогнать `node tools/elt-oracle-runner.js` (должен остаться 39/39, фикс не должен ничего сломать — только меняет способ передачи одного аргумента).
3. Спавнить судью (sonnet, REJECT-default) на T004 diff — включить в промпт судье ИМЕННО про найденный+починенный PS-argv баг, попросить его перепроверить фикс живым вызовом, не только читать код.
4. `elt judge-proof write --task T004 ...` → `elt commit --task T004 --skip-oracle` (T004 трогает только tools/, elt.js не менялся — мирроринг в `~/.claude` НЕ нужен для этого слайса).
5. Продолжить T005 → T018 по `specs/006-elt-front-gate/tasks.md` тем же ритмом: implement → полный оракул репо → sonnet-судья (Agent tool, `model: "sonnet"`, foreground) → judge-proof write → `elt commit --task Txxx --skip-oracle` (+ зеркалить `~/.claude/bin/elt.js` и коммитить во ВТОРОМ репо отдельным коммитом, когда слайс трогает elt.js).

## Открытые задачи (TaskList этой сессии, для справки — новая сессия должна пересоздать)
T001-T003 completed, T004 in_progress (см. выше), T005-T018 pending — тексты задач
взяты дословно из `specs/006-elt-front-gate/tasks.md`, дублировать не нужно, просто
читать оттуда по ходу.
