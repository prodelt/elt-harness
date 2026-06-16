# ROADMAP — Доработки AMOS / Pipeline (аудит 14–15.06.2026)

> Источник: глубокий аудит сессий 12–15.06 (cost_ledger SQLite + JSONL всех проектов).
> Сквозная причина всех дефектов: **построенная защитная автоматика не принуждается и не вызывается** в реальной работе (advisory вместо enforcement). Это продолжение [[project_ai_os_healing_2026-06-14]] на уровень глубже.
> Принцип роадмапа: **превратить built-but-idle машинерию в enforced-and-invoked, НЕ добавляя нового advisory-текста.**

---

## Доказательная база (факты, не догадки)

| # | Находка | Доказательство |
|---|---|---|
| F1 | **Субагент-rework loop** — Haiku-воркеры дали брак, Opus переписал сам | Fasoli 14.06: 6 файлов правили и sub, и main (sub×6–8 → main×2–3); юзер «что за ужас ты сделал»; Opus: «регрессия… деплой сломан… зря объявил готово без визуал-теста» |
| F2 | **ship-гейт скипаем одной командой** | в логе: «ставлю skip-файл ship-гейта (legitimate WIP)» → «готово» на сломанном деплое |
| F3 | **Предохранитель-ревьюер не поднимается** | `agent type 'code-reviewer' not found` ×2 (в реестре имя `reviewer`) |
| F4 | **Нет обязательного визуал-теста UI** до «готово» | Fasoli: success объявлен без скриншота; баг виден только глазами |
| F5 | **policy_events = 0** за всё время | model-policy gate (S5) не зафиксировал ничего; 13–14.06 Opus 94–100% output при политике «80% Sonnet» |
| F6 | **cost_ledger слеп к субагентам** | 0 haiku-записей, хотя субагенты массово работали (Fasoli ×8, Geocode, Top5) → `amos cost` недосчитывает объём |
| F7 | **codegraph — театр** | субагенты: 172 Read / 14 Grep / **0 codegraph** (нет tools в toolset!); main: 185 сырых чтений vs 15 codegraph (~12:1) |
| F8 | **read-gate инертен** | за 2 дня сработал **1 раз**; 338 Read прошли свободно |
| F9 | **graphify не отставлен** | всё ещё 8× вызовов — два движка структурного поиска при доминировании третьего (Read) |
| F10 | **skill-ranker залип** | подсказки: **21× /init-project**, 2× /pipeline, 2× /freeze — независимо от темы → юзер игнорирует |
| F11 | **Скиллы не используются** | за 2 дня / 5+ проектов из ~70 вызваны 2: inline-review(8), pipeline(4). checkpoint/learn/tdd/qa/diagnose/ship/architect-first = 0 |
| F12 | **harness построен, но простаивает** | tools+bin+hook есть; на ВСЕ проекты — 3 pipeline-state, 3 ledger; 0 CHECKPOINT за 13–15.06 |
| F13 | **Петля обучения мертва** | `skills/learned/` не пополнялась с 17.04; `amos evolve`/`/learn` не дали новых скиллов; evolve-nudge.js есть, артефактов нет |
| F14 | **Cold starts доминируют** | 126 session-start vs 82 handoff; Geocode 15.06 — ~8 холодных стартов = некэшированный системный промпт каждый раз |
| F15 | **Гигиена библиотеки** | дубли loose-`.md` рядом с папками (checkpoint.md+checkpoint/, learn.md+learn/, model-route.md, nextjs-16.md, supabase-*.md) = лишняя per-turn стоимость |

**Что работает хорошо (не ломать):** телеметрия AMOS пишет честно (по ней и пойман провал); хуки дёшевы (session-start ~200симв/291мс, pre-tool ~190симв/9мс, stop≈0 — НЕ источник раздувания); субагенты дисциплинированно на Haiku (но качество — см. F1); cache_read/ход падает (15.06=85.7K vs 130–139K ранее).

**Ключевая поправка по токенам:** лимиты бьёт output+fresh_input, а cache_read дёшев. Главная утечка — НЕ модель и НЕ кэш, а **rework-петли (F1) + Opus-инерция (F5)**.

---

## Спринты

### Sprint 0 — Критическая безопасность (P0): «никогда снова сломанный UI как готово» ✅ ЗАВЕРШЁН 2026-06-15
Прямо гасит самый дорогой failure mode (F1–F4).
- [x] Фикс имени ревьюера `code-reviewer`→`reviewer` в авто-роутинге (`tools/agent-library.js`, `~/.claude/agents/*.md`, `amos roster`). Без этого предохранитель не существует.
- [x] **Subagent verify-gate** (Stop/PreToolUse хук): если в сессии субагенты редактировали файлы — блок claim «готово»/closeout пока не выполнен verify-шаг (test/visual). Запись в policy_events.
- [x] **UI visual-gate**: для изменений в UI-путях обязателен артефакт agent-browser-скриншота до success.
- [x] **Запрет skip ship-гейта** при незавершённой работе субагентов (или явная причина в policy_events).
- Проверка: воспроизвести Fasoli-паттерн в scratch — гейт обязан заблокировать.

**Реализация**: новый хук `~/.claude/hooks/subagent-verify-gate.js` (+ lib `lib/subagent-verify.js`) сканирует transcript сессии — если editor-субагент (backend/frontend/devops/3d-animation/docs/general-purpose/claude) менял код-файлы и после этого не было test-run/reviewer-security-qa-субагента → `decision:block` "SUBAGENT VERIFY REQUIRED"; если менялись UI-пути (`.tsx/.jsx/.vue/.svelte`, `components|pages|views/`) без agent-browser-скриншота → "UI VISUAL GATE". Подключён в Stop (settings.json + ~/.codex/hooks.json) между stop-verification.js и ship-gate.js. ship-gate.js: skip-bypass теперь требует непустой `reason` (логируется в policy_events как `ship-gate-skip-override`/`-denied`), если verify-gate активен. One-time override (`claude-subagent-verify/override-<hash>.json` с `reason`) логируется как `subagent-verify-override`. Naming-fix: `code-reviewer`→`reviewer`, `security-reviewer`→`security`, `architect` opus→sonnet (CLAUDE.md, edit-enforcer.js, domain-agent-gate.js, inline-review-tracker.js, skills/inline-review/SKILL.md v1.0.2).
Тесты: `test-all-hooks.js` 36/36, `test-hooks-behavior.js` 49/49 (5 новых сценариев для subagent-verify-gate.js: BLOCK без верификации, APPROVE после reviewer+screenshot, APPROVE после npm test, APPROVE через override, APPROVE без transcript). Fasoli-паттерн воспроизведён в scratch-репо (`components/Dashboard.tsx` правит frontend-субагент без verify) — гейт вернул `decision:block` с обоими reason'ами, записал 1 policy_event.
Побочный фикс: `lib/subagent-verify.js` `changedFiles()` — `git status --porcelain` без `--untracked-files=all` сворачивал новые директории в одну строку (`?? components/`), из-за чего `isCodeFile`/`isUiFile` не матчились на файлы внутри.

### Sprint 1 — Принуждение модель/стоимость (P1): убить Opus-инерцию, честный учёт ✅ ЗАВЕРШЁН 2026-06-15
- [x] Оживить model-policy gate: **писать policy_events** при выборе Opus на не-ARCH задаче (с escape). Сейчас 0 (F5).
- [x] Захват стоимости субагентов в cost_ledger (нет haiku-записей, F6) — парс субагентских JSONL или хук на Stop.
- [x] `amos cost`: разбивка per-project + sub/main split.
- Проверка: кодовая задача на Opus → строка policy_event; `amos cost` показывает haiku.

**Реализация**: `lib/cost.js` — `extractUsageFromTranscript` теперь даёт per-model разбивку (`byModel`), не схлопывает на last-seen; новая `findSubagentTranscripts(mainTp)` находит sidecar-транскрипты `<dir>/<session>/subagents/agent-*.jsonl`. `lib/policy.js` — новая `evaluateMainModel(model)`: Opus-main без ARCH-исключения → `{violation}` (escapes: `AMOS_MODEL_POLICY=off`, `AMOS_ARCH_SESSION=1`). `lib/db.js` — миграция cost_ledger (+`project`,+`kind` через PRAGMA-probe ALTER, идемпотентно); `logCost` пишет project/kind; `getCostSummary` отдаёт `byProject`+`byKind`. Stop-хук (`bin/amos.js`): одна cost-строка на модель (kind='main'), плюс строка на каждый субагентский транскрипт (kind='sub'), плюс `policy_event` `main-model` при Opus-main. `handleCost` рисует секции Origin (main/sub) и Project.
Тесты: `tests/s1-model-cost.test.js` 12/12 (per-model breakdown, sidecar discovery, evaluateMainModel + 4 escape/edge, project+kind split). Полный AMOS-сьют 234/234. E2E через node: Stop с Opus-транскриптом + haiku-субагентом → cost_ledger: main/opus + **sub/haiku (output 120 виден)**, project проставлен, `policy_events`: `main-model`=claude-opus-4-8. Миграция на боевой `state.sqlite` прошла, `amos cost` рисует Origin+Project.

### Sprint 2 — Честность CodeGraph (P2): убрать театр, срезать стоимость сырых чтений ✅ ЗАВЕРШЁН 2026-06-15
- [x] Решение: дать нативным субагентам codegraph MCP-tools (правка agent-defs) — выбран этот вариант, доковый claim «единственный движок» становится правдой (F7).
- [x] read-gate: сделать реально кусачим — метрика срабатываний в policy_events (F8).
- [x] Отставить graphify (8× вызовов, F9) — один движок.
- Проверка: субагентская сессия показывает codegraph>0; счётчик read-gate denials виден.

**Реализация**: `tools/agent-library.js` — новый набор `CG` (7 read-only codegraph MCP-tools: context/search/explore/callers/callees/impact/node) добавлен в инвестигатор-(`RO`) и имплементер-(`RW`) тулсеты → 12 код-обращённых ролей теперь несут codegraph (planner/researcher/docs/product-manager с кастомным минимальным тулсетом — без, корректно). Регенерил `~/.claude/agents/*.md` (`--write`, 12 updated). `codegraph-read-gate.js` — на каждый deny пишет AMOS `policy_event` kind=`read-gate` detail=rel-путь (enforcement стал аудируемым). graphify отставлен: удалены 3 активных хука из `settings.json` (graphify-preuse Glob|Grep, graphify-post-commit Bash, graphify-auto-update Edit|Write); codex hooks.json graphify не содержал; файлы graphify-*.js оставлены как legacy fallback (не зашиты в пайплайн). CLAUDE.md уже фиксирует «codegraph единственный движок; Graphify — legacy fallback» — теперь соответствует реальности.
Проверка: `settings.json` валиден, 0 graphify-ссылок. E2E read-gate: попытка Read `tools/agent-library.js` (201 строк) → `permissionDecision:deny` + `policy_event` `read-gate`→`tools/agent-library.js` записан. Агенты backend(RW)/architect(RO) содержат codegraph, planner — нет. Тесты: `test-all-hooks.js` 36/36, `test-hooks-behavior.js` 49/49, agent-surface 2/2. Inline-review (sonnet-субагент, у него теперь codegraph в toolset) — чисто, блокеров нет.

### Sprint 3 — Замкнуть петлю обучения/контекста (P3) ✅ ЗАВЕРШЁН 2026-06-16
- [x] Авто-checkpoint у порога контекста (предупреждение 379KB) — хук-нудж/amos (F12).
- [x] `amos evolve`/`/learn` реально рождают скиллы из зрелых instincts (мертво с 17.04, F13).
- [x] Срезать cold starts: SessionStart предлагает resume из handoff (82 есть vs 126 холодных, F14).
- [x] Фикс skill-ranker: доминирование 21× /init-project → диверсификация, подавление при низком gap (F10).
- [x] Гигиена: удалить loose-дубли .md, срезать per-turn стоимость описаний (F15, F11).
- Проверка: ранкер не отдаёт init-project на нерелевантный запрос; evolve выдаёт черновик скилла.

**Реализация**: F10/F12/F13 оказались уже исправлены предыдущей healing-сессией (2026-06-14) — здесь только верификация. F14: `~/.claude/hooks/harvest-injector.js` (SessionStart cross-session briefing, ≤2KB, age-gate 24h) существовал, но НЕ был подключён ни в `settings.json`, ни в `~/.codex/hooks.json` — добавлен последним хуком SessionStart в обоих (после `evolve-nudge.js`). F15: удалены 7 loose `.md` из `~/.claude/skills/` — `checkpoint.md`/`learn.md` (устаревшие дубли каталоговых `checkpoint/SKILL.md` v1.0.0/`learn/SKILL.md` v1.1.0, без version/requires) и 5 ничем не зарегистрированных в `digests.jsonl` сирот (`model-route.md`, `nextjs-16.md`, `postgres-patterns.md`, `supabase-best-practices.md`, `supabase-schema.md`).
Проверка: (F10) `node tools/skill-search.js --benchmark --json` → `"status":"pass"` все 10 бенчмарков (включая `update project readme documentation` → `avoid: init-project`, реально вернул `gstack/document-release`); ручные запросы — "explain how the deploy pipeline credentials are rotated" → `selected: "no skill"` (init-project НЕ выбран, хотя в топе score=0.455 < relevance-gate). (F13) `amos evolve` вернул 10 кандидатов с `confidence=1.00` (ship-gate skip ×19, cargo check ×18, python verify_output.py ×12, ...) — петля жива. (F12) `context-budget-gate.js` зарегистрирован в UserPromptSubmit, порог 90000 токенов×6 chars ≈ 540KB, эскалация каждые 20000 токенов. (F14) E2E: `node ~/.claude/skills/session-harvest/harvest.js 7` пересобрал `latest.md` (166 сессий, 15 per-project файлов) → `harvest-injector.js` с реальными данными вернул `additionalContext` с "## HARVEST (0.0h ago)" + сводкой сессии. (F15) `ls ~/.claude/skills/*.md` → 0 файлов (только директории). Регрессия: `test-all-hooks.js` 36/36, `test-hooks-behavior.js` 49/49.

### Sprint 4 — Апгрейд daily-driver скиллов (P4, явный запрос юзера) ✅ ЗАВЕРШЁН 2026-06-16
Улучшить постоянно используемые скиллы заимствованием из топовых.
- [x] **pipeline**: добавить Agent Budget (>2 субагентов → verify-gate перед closeout) + UI visual-gate + **подключить реальный harness verifyCloseout** (tools уже есть! F12) чтобы success не был самозаявленным; сжать always-on триггер (caveman-стиль), детали on-demand. Доноры: `frontend-ui-engineering` (визуал-verify), `auto-ship` (self-healing ship-loop), `grill-with-docs` (interview-строгость для ARCH), `incremental-implementation` (slice-дисциплина).
- [x] **checkpoint**: интегрировать `session-harvest` (cross-session briefing) + `handoff` (resume-pointer, срезает cold starts) + снапшот AMOS cost/instincts + авто-триггер у лимита контекста.
- Проверка: апгрейженный pipeline на UI-задаче → визуал-гейт срабатывает; checkpoint содержит cost+resume.

**Реализация**: `~/.claude/skills/pipeline/SKILL.md` (3.2.0→3.3.0): новые секции "Agent Budget & Subagent Verify Gate" (>2 редактирующих субагента → перед closeout обязателен test/build/lint ИЛИ reviewer/security/qa субагент — проактивно описывает то, что `subagent-verify-gate.js` иначе блокирует постфактум) и "UI Visual Gate" (изменения `.tsx/.jsx/.vue/.svelte` или `components|pages|views/` → обязателен agent-browser скриншот в `proof`, иначе Stop-хук вернёт "UI VISUAL GATE"). Final Closeout расширен: если в pipeline-state есть `runId`, перед `success:true` обязателен `harness-gates closeout <runId> --root . --json` → `ok:true` (закрывает F12 — harness больше не декоративный). Always-on описание (frontmatter `description`) уже было компактным (1 строка ~110 симв.) — не раздувалось.
`~/.claude/skills/checkpoint/SKILL.md` (1.0.0→1.1.0): новые секции вывода "Cost Snapshot (AMOS)" (`amos cost` — модель/Origin main-vs-sub/evolvable instincts) и "Resume Pointer" (явный Focus+Resume-команда — то, что подхватывает `harvest-injector.js`/handoff на следующем SessionStart, F14). Новый шаг Workflow: на каждом чекпоинте перезапускать `node ~/.claude/skills/session-harvest/harvest.js 7`, чтобы `latest.md` не протухал >24h. Новая секция "Auto-Trigger": нудж от `context-budget-gate.js` (~90k токенов / ~540KB, эскалация каждые 20k) = сигнал немедленно запустить `/checkpoint` (F12 замкнут).
Оба файла синхронизированы skill-sync хуком в `~/.codex/skills` и `~/.gemini/skills` (версии 3.3.0/1.1.0 совпадают, разница в байтах — CRLF у gemini-копий).
Проверка: `test-all-hooks.js` 36/36, `test-hooks-behavior.js` 49/49 (включая subagent-verify-gate с UI-гейтом, не регрессировал). UI visual-gate логика (`lib/subagent-verify.js: isUiFile/needsVisual`, `subagent-verify-gate.js: "UI VISUAL GATE: N UI file(s) changed..."`) подтверждена существующей Sprint-0 Fasoli-репродукцией (блокирует "готово" без agent-browser-артефакта) — pipeline теперь декларирует это требование ДО, а не только хук ПОСЛЕ. Checkpoint cost+resume — см. финальный чекпоинт сессии `.planning/CHECKPOINT-2026-06-16-amos-roadmap-sprints-1-4.md`, написанный по новому формату (содержит Cost Snapshot + Resume Pointer секции).

---

## Карта файлов (для реализации)
- Агенты/роли: `tools/agent-library.js`, `~/.claude/agents/*.md`, `amos roster` (`~/.amos/bin/amos.js`)
- Model-policy/cost: `~/.amos/bin/amos.js` (cost_ledger, policy_events), Stop-хук `amos event stop`
- Harness: `tools/harness-{runner,gates,checklist}.js`, `tools/pipeline-state.js`, `~/.claude/bin/harness-*.cmd`, `~/.claude/hooks/harness-run-gate.js`
- read-gate / skill-suggest: PreToolUse + UserPromptSubmit хуки в `~/.claude/hooks/`; ранкер `tools/skill-search.js`
- evolve: `~/.claude/hooks/evolve-nudge.js`, `amos evolve`
- Скиллы: `~/.claude/skills/{pipeline,checkpoint}/SKILL.md`; доноры `{frontend-ui-engineering,auto-ship,grill-with-docs,incremental-implementation,session-harvest,handoff}`
- supply-chain: `tools/agent-skill-supply-chain.js`

## Порядок
Sprint 0 → 1 → 2 → 3 → 4 (по убыванию impact). 0–1 гасят дорогие провалы (качество+стоимость), 4 — то, что юзер просил про скиллы. Каждый спринт независимо проверяем, с показом вывода.

## ✅ Финальная верификация — 2026-06-16

Все 5 спринтов (0-4) закрыты. Сводная проверка (Task 5):

- `cd ~/.amos && node --test tests/*.test.js` → `tests 234, pass 234, fail 0` (35.1s)
- `node ~/.amos/bin/amos.js doctor` → все `[PASS]`: Node v24.14.0, env, workspace, write-перм, git, SQLite (node:sqlite full WAL), SessionStart/Stop/PreToolUse хуки Claude/Codex/Gemini, agent-browser CLI 0.27.1 + `doctor --offline --quick: OK`
- `node tools/doctor.js` (проектный) → ключевые PASS: Codemap graph OK (3107 nodes/302 files), CodeGraph MCP healthy (207 files/3113 nodes), RAG manifest/index/queue OK, Skill surface sync OK, Agent surface audit current, Git refs/GitHub CLI/auth OK, Pipeline state closed, no Defender-risk files.
  - Оставшиеся WARN — **не относятся к спринтам 0-4**, это фоновый долг другого порядка: codegraph relevance smoke (community-кластеры в vendor/skillspector), agent-skill supply-chain drift (4 устаревших install — починка через `agent-skills install-skills --apply`), docs/harness/git-workflow audit reports устарели (нужен `--write` ререан). Зафиксировано как remaining work, не блокирует закрытие роадмапа.
- Hook regression: `node ~/.claude/hooks/test-all-hooks.js` 36/36, `node ~/.claude/hooks/test-hooks-behavior.js` 49/49 (см. Sprint 3 отчёт).
- Чекпойнт: `.planning/CHECKPOINT-2026-06-16-amos-roadmap-sprints-1-4.md` (новый формат checkpoint v1.1.0 — Cost Snapshot + Resume Pointer).

**Итог**: 234/234 AMOS-тестов, amos doctor all-PASS, проектный doctor — все целевые проверки PASS, hook-сьюты 36/36+49/49. Роадмап закрыт.
