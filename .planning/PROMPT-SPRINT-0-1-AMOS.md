# Промпт для новой сессии — AMOS Sprint 0 + Sprint 1

Скопируй всё, что ниже черты, в новый чат (рабочая папка: `C:\Claude playground\Pipiline setupper`).

---

Ты продолжаешь утверждённую переархитектуру моей агент-системы в **AMOS (Agent Mini-OS)**. Архитектура спроектирована и одобрена в прошлой сессии — НЕ перепроектируй её, твоя задача — реализовать и закрыть Sprint 0 и Sprint 1.

Focus: закрыть Sprint 0 (Baseline & Freeze) и Sprint 1 (AMOS Kernel + State).
Done when: все acceptance-критерии обоих спринтов выполнены с показанным выводом команд, коммиты сделаны, чекпоинт и память записаны.

## Обязательное чтение перед стартом
1. `.planning/ARCHITECTURE-2026-06-10-amos-agent-mini-os.md` — вся архитектура: §3 (целевая схема), §5 (спринты), §8 (живые замеры, traceability, уточнённые KPI).
2. Память `project_amos_architecture_2026-06-10.md` (в `~/.claude/projects/C--Claude-playground-Pipiline-setupper/memory/`).

## Утверждённые решения (не передумывать)
- Имя: AMOS, CLI `amos`.
- Ядро: `C:\Users\espad\.amos` — ОТДЕЛЬНОЕ git-репо (git init).
- State: SQLite через `node:sqlite` (проверь `node --version`, нужен Node 22+; fallback better-sqlite3 только если node:sqlite реально недоступен).
- RAG понижен до опционального провайдера — в ядро не тащить.
- v3-хуки НЕ удалять и НЕ отключать (это Sprint 6). AMOS строится ПАРАЛЛЕЛЬНО, существующая система продолжает работать.
- Tool policy (уже зафиксирована в `~/.claude/rules/rules.md`): Context7 → только `ctx7` CLI; браузер → только `agent-browser`; поиск по репо → CodeGraph/Graphify; GitHub-research → `gh` CLI; поиск скиллов → `skill.cmd` + skillgrab + gstack.

## Sprint 0 — Baseline & Freeze (сделать первым, это быстро)
1. В репо Pipeline Setupper создай ветку `system-upgrade/amos-kernel` от текущего HEAD; поставь тег `v3-legacy` на коммит-точку старта.
2. Закоммить незакоммиченные AMOS-файлы: `.planning/ARCHITECTURE-2026-06-10-amos-agent-mini-os.md`, `.planning/PROMPT-SPRINT-0-1-AMOS.md`, `.tmp/measure-hooks.js`, `.tmp/measure-edit-hooks.js` (если .tmp в gitignore — перенеси замерщики в `tools/amos-baseline/`). Коммит: `docs: AMOS v4 architecture + hook cost probes`. Посторонние изменённые `.planning/*-latest.*` НЕ включай.
3. Baseline-замеры: прогони оба замерщика для `C:/Claude playground/Pipiline setupper` и `D:/Ametrin projects/Law_assistant`; добавь размеры доков (project CLAUDE.md, AGENTS.md, memory_summary.md, MEMORY.md). Всё в `.planning/AMOS-BASELINE.md` таблицами.

**Acceptance S0:** ветка + тег существуют; `AMOS-BASELINE.md` с числами по 2 проектам закоммичен.

## Sprint 1 — Kernel + State
Создать в `~/.amos` (отдельное git-репо):
- `bin/amos.js` — CLI на чистом Node core (НОЛЬ внешних зависимостей): команды `event <name>`, `status`, `report`, `doctor`, `version`.
- Event router: handlers `session-start` и `stop` (минимум). Вход — JSON хука Claude Code из stdin (`session_id`, `cwd`, `hook_event_name`); выход — валидный `{hookSpecificOutput:{additionalContext}}` ИЛИ silent exit 0. Учти в дизайне: у Stop-события другой формат ответа (`{decision, reason}`) — понадобится в Sprint 2.
- SQLite `~/.amos/state.sqlite`: таблицы `sessions`, `events_metrics(event, project, fired_at, duration_ms, output_chars)`, `projects`, `handoffs` (скелет — наполнение в Sprint 2).
- Жёсткий бюджет инъекции session-start ≤2KB (cap в коде, тестируется).
- Профили: `AMOS_PROFILE=minimal|standard|strict` (minimal = только resume-указатель; standard = + focus + bootstrap-совет). `AMOS_DISABLE=1` → немедленный silent exit 0.
- Fail-soft: ЛЮБАЯ ошибка ядра (включая битую БД) → exit 0 без stdout, ошибка в `~/.amos/errors.log`. Клиент никогда не страдает.
- Глобальные обёртки `~/.claude/bin/amos.cmd` (+ `.ps1` опционально) по образцу `doctor.cmd`.
- Перфоманс: `amos event session-start` < 500ms холодный старт — докажи замером (Measure-Command).
- Тесты ≥40 unit (node:test или раннер в стиле `tools/*.test.js`): fail-soft при битой БД, бюджет 2KB, AMOS_DISABLE, запись метрики, неизвестное событие = silent exit, профили.
- Подключение к клиентам (settings.json/hooks.json) в этом спринте НЕ делать — это Sprint 2. Только ручной вызов.

**Acceptance S1 (показать вывод каждого пункта):**
1. `node C:\Users\espad\.amos\bin\amos.js event session-start` со stdin-JSON `cwd=D:/Ametrin projects/Law_assistant` → ответ <500ms, stdout ≤2KB валидного hook-JSON.
2. `amos.cmd status` работает из любой папки.
3. Все тесты зелёные — показать счётчик N/N PASS.
4. Битая `state.sqlite` → exit 0, пустой stdout (тестом).
5. После 3 вызовов `amos report` показывает 3 события с `output_chars`/`duration_ms`.
6. `~/.amos` — git-репо с ≥2 осмысленными коммитами; в Pipeline Setupper закоммичены baseline + чекпоинт.

## Правила работы
- Windows: PowerShell, никаких `&&` (только `;` или отдельные вызовы), пути через `path.join`, порт 3001+.
- Контракт хуков Claude Code: silent exit 0 ИЛИ валидный JSON в stdout — ничего другого. spawnSync timeout 5s → ядро обязано укладываться.
- `~/.claude/settings.json` и существующие хуки НЕ редактировать.
- Ядро без библиотек ⇒ ctx7 не понадобится; если всё же возьмёшь библиотеку — сначала `ctx7 library <name>` → `ctx7 docs <id> <query>`.
- Верификация: ни одного «done» без показанного вывода. Один и тот же тест падает 3 раза — стоп, смени подход.
- Если реальность противоречит архитектуре — не молчи и не изобретай заново: запиши отклонение в `.planning/AMOS-DECISIONS.md` и продолжай с минимальным разумным решением.
- Контекст-дисциплина: после Sprint 0 — мини-чекпоинт (commit). Если к концу Sprint 1 контекст на исходе — `/checkpoint`, память `project_amos_sprint1_<status>.md` с точным handoff (что сделано/что осталось/команда продолжения), и заверши сессию.
- Финал: обнови память + MEMORY.md индекс, `/checkpoint`, коммиты в обоих репо.
