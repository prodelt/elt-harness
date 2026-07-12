# 004 — ELT Self-Drive · tasks

> Формат строки слайса — `- [ ] **T00X** текст` (парсит `elt.js`). Каждый слайс:
> один вертикальный срез, оракул проекта зелёный, свой тест доказывает поведение.
> Оракул: `node tools/doctor.test.js; if ($LASTEXITCODE -eq 0) { node --test tools/fleet/*.test.js }`
> Порядок = приоритет (ценность/риск). T007 и T011 помечены OPTIONAL — не блокируют остальные.

## Фаза A — фундамент (тихие отказы + дубли)

- [X] **T001** Единый источник elt.js: сделать `tools/elt.js` источником, `~/.claude/bin/elt.js` — тонкий re-export/копия с тестом идентичности.
  Сейчас `bin/elt.js` (его зовёт драйвер) и `tools/elt.js` (его тестируют) РАЗЛИЧАЮТСЯ — дрейф.
  Тест: новый `tools/elt-singlesource.test.js` утверждает, что публичное поведение bin==tools
  (байтовая идентичность ИЛИ bin = `require('../tools/elt.js')`). Падает на текущем дрейфе, зеленеет после сведения.

- [X] **T002** Liveness-инвариант судьи/имплементатора: пустой/timeout/spawn-fail вывод → статус `judge-dead`/`impl-dead` (ERROR-STOP), НЕ маскируется под `block`/`pass`.
  Корень бага `3e73423`: пустой лог судьи = REJECT-default block, неотличимо от реального reject.
  **Скан подтверждает:** block 159 vs pass 141 (~53% block) аномально высок — часть «блоков» это
  dead-judge, а не reject. `providers.run()` уже возвращает `reason` (`empty-stdout`/`timeout`/
  `spawn-error`) — драйвер обязан трактовать их отдельно от `verdict:block`. Тест: скормить
  построителю вердикта пустой judgeOut → `judge-dead` в run-log + стоп с явной причиной, НЕ `judge-block`.

## Фаза B — адаптивный эффорт (F2)

- [X] **T003** Проброс `--effort <level>` (+ опц. `MAX_THINKING_TOKENS`) через `providers.run()` → `claude-invoke.js` → `Invoke-Claude`.
  `claude --effort` — подтверждённый headless-флаг; `MAX_THINKING_TOKENS`/`--thinking` — второй рычаг (changelog 2.1.172).
  Добавить `effort` в дескриптор и в `PROVIDERS.claude` argv. Тест: `providers.js` строит argv с
  `--effort max`, когда `effort:'max'` передан; без него — флага нет (обратная совместимость).

- [X] **T004** Политика эскалации в драйвере: импл на `high`, красный оракул → self-heal на `max` (+ opt `--model`/`--fallback-model` из конфига), следующий слайс снова `high`.
  Sonnet-5 «не тянет» долгий багфикс → авто-максимум только на починку, потом вниз (токен-налог).
  Скан: 37× ручной `/effort` + 7 stuck-loop сессий = ровно эта боль. `--fallback-model` (подтв. флаг)
  закрывает и 429-путь. Тест: unit на построителе аргументов — первая инвокация несёт `--effort high`,
  heal-инвокация `--effort max`; политику вынести в чистую функцию (тест без живого спавна claude).

- [X] **T005** [P] Интерактивный stuck-detector: хук считает N подряд красных оракулов/failed-тестов (хвост run-log + транскрипт); на пороге — nudge «застрял N попыток → /effort max + /diagnose».
  Нативной смены эффорта в интерактиве из хука нет → честный потолок = подсказка.
  Тест: синтетический run-log с N `red-stop`/красными → хук эмитит escalation-текст; < порога → тишина (0 токенов).

## Фаза C — авто-ротация сессий (F1) · скан: 29 сессий ≥200k, 43× `/clear` — верх боли

- [X] **T014** Verify-first спайк нативных примитивов ротации: probe-скрипт документирует, что реально есть в 2.1.207 — `--session-id`/`--resume`/`--continue`/`--bg`/`claude agents` (подтв.) и hook-события `Notification`/post-session lifecycle/`SessionEnd` (сверить именами против рантайма).
  Делать ДО T006/T007 — строить на подтверждённом, не на changelog-суммаризации. Тест: probe пишет
  `specs/004-elt-selfdrive/primitives.md` с колонкой confirmed/absent по каждому примитиву (exit 0).

- [X] **T006** Механический чекпоинт-райтер: на ≥200k (`stage2`) гард САМ пишет файл-чекпоинт (git + последний run-log + следующий открытый слайс + resume-указатель) и выдаёт готовый `/elt continue` промпт — не только nudge.
  Сейчас `context-autocompact-guard.js` лишь подсказывает; пользователь пишет чекпоинт руками (43× `/clear` в скане).
  Тест: синтетический транскрипт ≥200k → райтер создаёт файл с секциями git/last-run/next-slice/resume-prompt; < порога — молчит.

- [X] **T007** OPTIONAL Session-rotation драйвер `tools/elt-drive.ps1` на НАТИВНЫХ примитивах (T014): goal-driven петля — `claude --session-id <uuid> -p` bounded → чекпоинт → `claude --resume <id>` (или свежий id), STOP kill-switch. Это «авто new+elt» для автономной цели (не спек-плана), но через нативные `--session-id`/`--resume`/`--bg`, не ручной джагглинг.
  Тест: `-DryRun` показывает N bounded-инвокаций с пробросом session-id + чекпоинт между + уважает `.harness/STOP`; без живого claude.

## Фаза D — codegraph: адопция + liveness (F3) · скан: 24 вызова на 278 сессий — почти мёртв

- [X] **T008** codegraph-liveness + телеметрия адопции в `doctor`: MCP доступен + индекс свежий (парс `codegraph status`) + watcher жив; плюс счётчик реальных вызовов (мандат «codegraph первым» игнорится — 10 `codegraph_context` на 278 сессий).
  Не только надёжность — **адопция ≈0**. Решить честно: чинить надёжность ИЛИ снять мандат, если он мёртв (ponytail).
  Тест: замоканный зелёный статус → PASS; missing `.codegraph/codegraph.db`/stale → WARN с repair-строкой.

- [X] **T009** [P] Pre-slice codegraph-гард (opt-in по конфигу): драйвер громко падает, если проект полагается на codegraph, а индекс мёртв/устарел — вместо тихой деградации на Read.
  Тест: гард срабатывает (nonzero) при отсутствии db, когда флаг включён; при выключенном — no-op.

## Фаза E — самодиагностика и gated self-heal (F4)

- [X] **T010** Watchdog собственного оракула харнесса `tools/harness-selfcheck.js`: гоняет `doctor.test.js` + fleet-тесты; при падении механически пишет слайс в `specs/NNN-selfheal/tasks.md` + маркер в run-log.
  Прецедент реален (`3e73423` — харнесс чинил свой баг). Тест: инжектированный падающий харнесс-тест → watchdog заводит запись-слайс + exit nonzero; зелёный → no-op.

- [ ] **T011** OPTIONAL Gated self-repair: опционально прогнать драйвер по self-heal спеке с судьёй; merge в main по умолчанию человеком (флаг конфига), не авто.
  Тест: `-DryRun` связывает watchdog→драйвер БЕЗ авто-merge в main; авто-merge только при явном флаге.

## Фаза F — гигиена и наблюдаемость

- [X] **T012** [P] Свести Fleet-experimental метку с реальностью: 003 закрыта (verdict 2.66×/3.31×) — снять метку в CLAUDE.md/SKILL.md ИЛИ задокументировать остаточный разрыв явно.
  Тест: grep-проверка, что «experimental — не для реальной работы» не соседствует с закрытой 003 без обоснования (маленький assert-скрипт ИЛИ ручная сверка в diff — судья проверит).

- [ ] **T013** Единый self-drive-обзор в `doctor`: effort-политика активна, judge-liveness-инвариант на месте, codegraph-live, stale fleet-claim подметён, git-workflow-audit свежий — всё в одном `node tools/doctor.js`.
  Тест: `doctor.test.js` расширен проверкой, что новые self-drive-чеки присутствуют в выводе; stale-claim sweep идемпотентен.
