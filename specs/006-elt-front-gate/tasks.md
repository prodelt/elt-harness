# 006 — ELT Front Gate — tasks

Атомарные вертикальные слайсы. Оракул: `node tools/elt-oracle-runner.js`.
Правки `~/.claude` (elt.js, скиллы) коммитятся во втором репо тем же слайсом;
тесты живут здесь, в `tools/`, и зовут CLI по абсолютному пути.

## Фаза A — Approve-гейт (механическая подпись спеки)
- [X] **T001** `elt spec approve [--spec specs/NNN-slug]` + `elt spec status`: пишет `specs/NNN-slug/approval.json` {approvedAt, specHash, tasksHash} (sha256 содержимого); повторный approve идемпотентен; правка spec.md/tasks.md после подписи → status=stale. Тест `tools/elt-spec-approve.test.js`. [files: ~/.claude/bin/elt.js, tools/elt-spec-approve.test.js]
- [ ] **T002** Гейт входа: при `harness.json.specApproval:true` и наличии `spec.md` рядом с выбранным tasks.md — `elt slice next` и `elt commit` без валидного approval → exit 4 с сообщением «спека не утверждена: elt spec approve»; `--skip-approval` пропускает, но пишет в run-log `{approvalSkipped:true}`. Микро-планы (tasks.md без spec.md) гейт не трогает. Тест. [files: ~/.claude/bin/elt.js, tools/elt-approval-gate.test.js]
- [ ] **T003** `elt spec lint`: обязательные секции спеки (Проблема, Решения, User stories, Критерии приёмки, Риски, Вне scope) → exit≠0 со списком недостающих; `spec approve` сначала гонит lint. Тест (вкл. self-check: specs/006 проходит свой же lint). [files: ~/.claude/bin/elt.js, tools/elt-spec-lint.test.js]
- [ ] **T004** Pre-run approval-чек в автономии: elt-loop.ps1 и fleet (tools/fleet) не стартуют по неутверждённой спеке (паттерн codegraph-guard: громкий стоп + запись в run-log). Логика — в Node (`tools/approval-guard.js`), PS только вызывает. Тест. [files: tools/elt-loop.ps1, tools/approval-guard.js, tools/fleet/*]
- [ ] **T005** project-bootstrap: `apply` включает `specApproval:true` (и `ctx7Gate:"warn"`) в создаваемый harness.json; `verify` репортит контракт approval. Тест bootstrap-CLI. [files: tools/project-bootstrap.js]
- [ ] **T006** Включить у себя + доки: `specApproval:true` в harness.json этого репо; elt SKILL.md — Режим 0: спеку показывать чанками, `elt spec approve` только после явного «утверждаю» от юзера; строки в CLAUDE.md/PLAYBOOK; sync-agent-surface (dry-run → sync, зеркала codex/gemini). [files: .harness/harness.json, ~/.claude/skills/elt/SKILL.md]

## Фаза B — Grill v2 + шаблон спеки
- [ ] **T007** grill-me v2 (SKILL.md): протокол — (1) разведка кода до вопросов; (2) ≥2 раундов AskUserQuestion по категориям «пользователи/сценарии», «данные/интеграции», «риски/edge cases», «не-цели/приоритет MVP», в каждом вопросе рекомендованный ответ; (3) для UI-задач 2–3 варианта концепции на выбор; (4) выход = секция «## Решения (зафиксированы с пользователем <дата>)» для spec.md. Зеркала codex/gemini. Контракт-тест наличия/структуры. [files: ~/.claude/skills/grill-me/SKILL.md, tools/skills-frontgate-contract.test.js]
- [ ] **T008** elt SKILL.md Режим 0 v2: grill обязателен при новом проекте / отсутствии зафиксированных решений / UI-проекте; шаблон спеки = контракт lint (T003) + Mermaid-схема; судейская рубрика += «слайсы по неутверждённой спеке = block». Контракт-тест SKILL.md. [files: ~/.claude/skills/elt/SKILL.md]

## Фаза C — Луп: вход, экономика, наблюдаемость
- [ ] **T009** `elt loop [N] [--model X] [--dry-run]`: подкоманда спавнит драйвер (Node spawn, не PS-заклинание); путь драйвера: env `ELT_DRIVER` → дефолт «C:\Claude playground\Pipiline setupper\tools\elt-loop.ps1»; флаги прокидываются. Тест (dry-run). [files: ~/.claude/bin/elt.js, tools/elt-loop-cmd.test.js]
- [ ] **T010** Экономика моделей драйвера: `harness.json.implModel` (дефолт "sonnet") и `implEffort` (дефолт "medium") читаются elt-config и передаются в Invoke-Claude всегда (heal-эскалация до max остаётся); больше никакого наследования дефолта CLI юзера (opus/xhigh). Тест конфиг-чтения. [files: tools/elt-loop.ps1, ~/.claude/bin/elt-config.js]
- [ ] **T011** Run-log гарантирован: репро кейса Marketing_tg_bot/tg_bot_reclamaties (elt commit прошёл, `.git/elt/` не появился) → фикс (mkdir гарантированно на каждом commit; невозможность писать = громкая ошибка, не тихий скип). Регресс-тест. [files: ~/.claude/bin/elt.js, ~/.claude/bin/run-log.js, tools/elt-runlog-guarantee.test.js]
- [ ] **T012** `elt status` v2 — человекочитаемая сводка: спека+approve статус (T001), последние 3 записи run-log, свежесть последнего loop-прогона (`.harness/loop-logs` mtime) — ответ на «работает ли луп». Тест. [files: ~/.claude/bin/elt.js, tools/elt-status-v2.test.js]

## Фаза D — ctx7-гейт
- [ ] **T013** ctx7-лог: ctx7-обёртка пишет `.harness/ctx7-log.jsonl` {pkg, ts}; парсер `tools/ctx7-log.js` + тест формата. [files: tools/ctx7-log.js]
- [ ] **T014** Deps-чек на commit: дифф манифестов (package.json, Cargo.toml, requirements.txt, go.mod) HEAD↔worktree → новые зависимости без свежей записи в ctx7-логе → поведение по `harness.json.ctx7Gate: "off"|"warn"|"block"` (дефолт warn). Тест. [files: ~/.claude/bin/elt.js, tools/elt-ctx7-gate.test.js]
- [ ] **T015** Драйвер: импл-промпт += строка «новая/внешняя либа → сначала ctx7 <команда>»; судейская рубрика += пункт про недокументированные зависимости. [files: tools/elt-loop.ps1, tools/judge-invoke.js]

## Фаза E — Захват новых проектов + closeout
- [ ] **T016** SessionStart-хук `elt-onramp.js`: cwd содержит код-манифест, но нет `.harness/harness.json` → инжект ровно одной строки-хинта («/elt заведёт план+гейт; /project-bootstrap — эталонный сетап»); иначе silent exit; <4s, без LLM; cwd из input, не process.cwd(). Установка в глобальный settings.json (решение юзера в spec §Решения). Тест JSON-выхода. [files: tools/elt-onramp.js, ~/.claude/settings.json]
- [ ] **T017** doctor.js: контракты 006 (specApproval в конфиге, ctx7Gate, доступность драйвера для `elt loop`, approval-guard подключён); PLAYBOOK/CLAUDE.md — единая инструкция «новый проект: /elt → grill → spec → approve → слайсы (bootstrap до/после)». [files: tools/doctor.js, PLAYBOOK.md, CLAUDE.md]
- [ ] **T018** Live-fire полного нового цикла: scratch-проект → сокращённый grill → spec+lint+approve → `elt loop 2` (implModel sonnet) → 2 слайса закрыты драйвером, run-log/loop-logs как proof; результат в `.planning/CHECKPOINT-*-006-livefire.md`. Красный опыт = баг-слайсы в этот план. [files: .planning/]
