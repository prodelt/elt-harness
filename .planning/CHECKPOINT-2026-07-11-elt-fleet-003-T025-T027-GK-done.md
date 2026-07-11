## Checkpoint - 2026-07-11 (сессия T025-T027)

### Build Status
- Compiles: n/a (Node.js, без сборки)
- Lint: not configured
- Type check: not run

### Test Metrics
- Total: 90 | Passed: 90 | Failed: 0 | Skipped: 0
- Oracle: `node tools/doctor.test.js; if ($LASTEXITCODE -eq 0) { node --test tools/fleet/*.test.js }` — exit 0
- Новых тестов за сессию: ~10 (gate.test.js: рубрика+persist ×3, router.test.js: ledgerEntry-форма ×1 обновлён, fleet.test.js: T026 ledger ×1 + T027 orphan-worktree ×1, providers.test.js: T027 STOP-kill ×1)

### Code Modifications Since Last Checkpoint
- Files modified: `tools/fleet/gate.js`, `tools/fleet/gate.test.js`, `tools/fleet/router.js`, `tools/fleet/router.test.js`, `tools/fleet/fleet.js`, `tools/fleet/fleet.test.js`, `tools/fleet/providers.js`, `tools/fleet/providers.test.js`, `specs/003-elt-fleet-hardening/tasks.md`
- Files created: нет
- Files deleted: нет

### Git State
- Branch: `feature/elt-loop-driver`
- Uncommitted changes: 1 файл (`.harness/run-log.jsonl` — самопишущийся ledger-хвост, безвреден, подберётся следующим слайсом)
- Last commit: `67b6af5` feat: T027 владение child-процессами (STOP убивает in-flight spawn ≤10с) + orphan-worktree cleanup на resume

### Completed Tasks (Phase J + K — весь оставшийся non-live hardening)
- **T025** (`88edbaa`) — Судья получает рубрику: `gate.js` автоматически находит `spec.md`/`constitution.md` рядом с `tasks.md` (поиск по `**Tid**`-маркеру в дереве `specs/`, т.к. ID не глобально уникален) и вшивает их в промпт судьи. Block-причина по-прежнему переживает retry (T022) — подтверждено интеграционным тестом через РЕАЛЬНЫЙ stdin-промпт (capture-стаб), не только unit на `judgePrompt`.
- **T026** (`6ad412c`) — Per-phase call-ledger: одна строка run-log на КАЖДЫЙ spawn (`implement`/`heal`/`judge` раздельно, было — одна агрегированная строка на весь батч-проход слайса, heal/judge вообще не попадали в ledger отдельно). `router.ledgerEntry()` стал РЕАЛЬНЫМ консьюмером (`fleet.js` строит через него, раньше был мёртвый код, протестированный только в изоляции) — расширен полями `phase`/`exit`/`tokens`(null-плейсхолдер)/`costUsd`(null-плейсхолдер). Побочный баг найден и починен по пути: `res.exit`/`res.ok` разыменовывались без guard на `undefined` (инжектируемые тестовые/legacy-воркеры без `return`) — падало исключение внутри per-slice try/catch, слайс тихо проваливался.
- **T027** (`67b6af5`) — Настоящее владение child-процессами: `providers.js` теперь поллит `stopFile` (дефолт раз в 1с) во время исполнения child и убивает его через уже существующий `hardKill` (taskkill /T /F на Windows — tree-kill уже был, не хватало быстрого триггера) — раньше STOP проверялся ТОЛЬКО между батчами `fleet.js`, in-flight spawn переживал STOP до своего 5-минутного timeout. `fleet.js` прокидывает `stopFile` в `defaultWorker`/`redoSerial`; при `res.reason==='stopped'` слайс НЕ идёт в heal/judge (короткое замыкание), worktree/claim освобождаются сразу. Отдельно: `claims.sweep()` снимал только claim-файл упавшего процесса, worktree упавшего implementing/oracle/heal-claim (до judge_pending) оставался на диске орфаном → следующий `worktree.create()` падал "already exists"; добавлена чистка таких worktree на старте `run()`, ДО sweep (resumable judge_pending/merge_pending не трогаем — там живая незакоммиченная реализация).

### Remaining Work — Phase L, [live], требует юзера за столом
- **T028** `[live]` — идентичный бенч (переоткрытие T016): `workers=1` baseline РЕАЛЬНО запущен vs `workers=2`, метрики wall-clock + Claude-токены из T026-ledger.
- **T029** `[live]` — живой STOP/resume + реальный limit-failover (переоткрытие T017): запись STOP посреди прогона → child мёртв ≤10с (T027 уже даёт механику, но нужна ЖИВАЯ проверка на реальном CLI), повторный run добирает остаток.
- **T030** `[live]` — gate-вердикт: два повторяемых прогона против критериев жизни спеки (100% merged, speedup ≥1.5×, Claude ≤50%, ≤4 LLM/слайс, STOP ≤10с, exit-честность). Решение: снять experimental ИЛИ откатить параллельный слой.

### Blockers
Юзер явно отложил live-фазу (спрошено через AskUserQuestion) — не блокер, осознанная пауза. Fleet остаётся ⚠ experimental до закрытия T028-T030.

### Next Steps
1. Когда юзер готов к live-прогону: `/elt` или `/elt t28` → взять T028 (нужны реальные claude/codex/agy CLI под рукой, agy — с логином).
2. Порядок строго: T028 → T029 → T030 (последний решает судьбу experimental-флага).
3. **Урок сессии**: `router.ledgerEntry()` был мёртвым кодом 4 T-слайса подряд (только протестирован в изоляции, ни разу не вызван из `fleet.js`) — при добавлении "формы записи" в одном файле всегда проверять, что её реально ПОДКЛЮЧАЮТ там, где предполагается использование, иначе рубрика/схема живёт только в тестах.

### Resume Pointer
- Focus: T028 (live-бенч workers=1 vs workers=2) — первый живой слайс `specs/003-elt-fleet-hardening/tasks.md`
- Resume: `/elt t28` в `C:\Claude playground\Pipiline setupper` на ветке `feature/elt-loop-driver`, юзер должен быть за столом (реальные CLI-вызовы/квоты)
