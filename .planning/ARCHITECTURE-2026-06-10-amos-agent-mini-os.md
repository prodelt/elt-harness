# ARCHITECTURE 2026-06-10 — AMOS: Agent Mini-OS (v4 системы)

Статус: **ДРАФТ — ждёт утверждения пользователем** (Architecture-First).
Ветка реализации после аппрува: `system-upgrade/amos-kernel`.

---

## 0. TL;DR

Текущая система (v3) — это 109 hook-регистраций, 3 копии документации, 3 системы памяти,
2 codemap-провайдера без ролей и «мозг» в одном репозитории. Она исправно работает ТОЛЬКО
как советчик: 81 из 109 хуков — advisory, и слабые модели (Codex medium, Gemini) их игнорируют.
Токены уходят на SessionStart-инъекции (~18KB/сессию), дубли хуков и недоиспользуемые подсистемы.

**Решение v4 — AMOS (Agent Mini-OS):** одно ядро-CLI (`amos`) + SQLite-state + единый event-роутер.
Каждый клиент (Claude Code / Codex / Gemini-Antigravity) держит ≤12 тонких hook-строк, каждая —
вызов `amos event <name>`. Вся логика, бюджеты, политика инструментов, континуальность сессий
(handoff/resume между клиентами), bootstrap проектов и метрики — внутри ядра, один раз, для всех.

Главная фича: **прогресс не теряется никогда** — кончились лимиты в Claude → открыл Codex →
`amos resume` поднимает тот же handoff, ту же state, ту же задачу.

---

## 1. Диагноз текущей системы (доказательства собраны 2026-06-10)

### 1.1 Куда уходят токены

| Факт | Число | Источник |
|---|---|---|
| Hook-регистраций всего | **109** (81 advisory / 14 hard-block / 10 telemetry / 4 background) | `hook-diet --summary` |
| Регистраций на SessionStart | **21** (11 хуков × дубль-группы + claude-hook обёртка) | `hook-diet` |
| Дублирующихся matcher-групп | **16** | `hook-diet` |
| SessionStart-инъекция | **~18KB/сессию** (skill listing 6KB + deferred tools 6.9KB + advisories) | аудит 2026-05-22 |
| Token burn | **~90K/сессию** | CLAUDE.md |
| Хуки с runtime-метриками | **16/107 (15%)** | hook-diet evidence join |
| Хуков удалено по hook-diet | **0 из 107** — все «заблокированы отсутствием метрик» | HOOK-DIET-CANDIDATES |
| Graphify в реальных сессиях | **0/16 сессий** использовали `graphify query` | аудит 2026-05-22 |

**Вывод:** hook-diet попал в собственный тупик — «нельзя удалять без метрик, метрик нет,
потому что их никто не пишет». Параллельно 21 node-процесс стартует на каждую сессию
в каждом проекте и инжектит советы, которые модель не обязана выполнять.

### 1.2 Почему «работает только тут» (главная боль)

Проверено: **все 62 hook-команды в settings.json глобальные** (0 ссылок на этот репозиторий) —
хуки физически срабатывают во всех папках. Реальные причины деградации в других проектах:

1. **Advisory-модель.** Hard-block только у freeze/secrets/destructive. Всё остальное — «совет
   в additionalContext», который Claude чаще выполняет, а Codex/Gemini чаще пропускают.
2. **Мозг живёт в одном репо.** `doctor`, `skill-search`, `research-router`, `docs-gate`,
   `codemap`, `rag-ingest` — в `C:\Claude playground\Pipiline setupper\tools\`. Глобальные
   обёртки есть лишь у части (doctor.cmd, skill.cmd, agent-skills.cmd, harness-*).
3. **Инфраструктура проектов неравномерна:** 17 проектов в registry, 2 пути мертвы,
   codemap есть у ~9/17, RAG-индексы устаревают. Хук видит «нет графа» → молчит или шумит.
4. **Gemini-хуки не верифицированы:** в `~/.gemini/settings.json` сконфигурировано 137 команд,
   но факт их исполнения Antigravity никогда не проверялся (Codex проверен: `hooks = true`).
5. **Континуальность размазана:** чекпоинты в `.planning/`, память в `projects/C--/memory/`,
   Codex — свои sqlite. Нет одной команды «продолжи с того места».

### 1.3 Костыли (что мешает системе)

| Костыль | Цена |
|---|---|
| 3 копии доков (AGENTS/CLAUDE/GEMINI.md) + sync-инструмент | drift, ручная синхронизация, конфликты |
| 3 копии скиллов (99/106/109 у клиентов) + hash-sync | drift, «известный конфликт pipeline» |
| 3 системы памяти (memory-файлы, RAG+ollama, Codex sqlite) | дублирование, ни одна не канонична |
| 21 SessionStart-процесс | латентность старта + токен-шум |
| Graphify И CodeGraph без разделения ролей | двойное обслуживание; Graphify фактически не используется |
| browser-harness наследие в политиках | путаница: стандарт уже agent-browser (S59) |
| hook-метрики через патч process.stdout.write | хрупко, покрытие 15% |

### 1.4 Что убрать / что оставить

**УБРАТЬ / СЛИТЬ В ЯДРО (после миграции, не раньше):**
- Все 11 SessionStart-хуков (project-docs-gate, session-focus-gate, autoskills-check,
  graphify-session-init, memory-discipline, session-branch-advisor, harvest-injector,
  projects-dashboard, rag-context-injector, project-bootstrap-advisor, claude-hook) →
  **одна** команда `amos event session-start` с бюджетом инъекции ≤2KB.
- Дубль-обёртку `claude-hook`, дубли matcher-групп.
- Трёхстороннюю синхронизацию доков → генерация из канонического AGENTS.md.
- browser-harness из дефолтных политик (остаётся как явно вызываемый legacy).
- RAG как обязательный слой → понижается до опционального провайдера памяти.

**ОСТАВИТЬ (доказали ценность):**
- Hard-block хуки: secret-scanner, config-protection, settings-schema-guard, freeze.
- loop-guardian, auto-branch, pre-commit/conventional-commit гейты.
- harness-runner + harness-gates (82/82 + 32/32 тестов) — становится execution-слоем AMOS.
- pipeline-state (project key/state/ledger) — мигрирует в SQLite ядра, API сохраняется.
- doctor — расширяется до `amos doctor` (работает в любом проекте).
- skill-search router (10/10 benchmark) — становится `amos preflight`.
- Память файловая (human-readable) — остаётся слоем поверх SQLite-индекса.
- Graphify + CodeGraph — оба, но с ролями (см. 3.3).

---

## 2. Исследование GitHub (gh CLI, 2026-06-10)

| Система | ★ | Что это | Что берём |
|---|---:|---|---|
| obra/superpowers | 222K | skills-framework + методология | паттерн «скилл = методология, не текст» |
| **affaan-m/ECC** | 212K | cross-harness operator system | **hook-профили** (`ECC_HOOK_PROFILE=minimal/standard/strict`), **SQLite state store**, **status snapshot = portable handoff**, selective-install манифесты, control-plane daemon (ecc2: start/sessions/status/resume) |
| github/spec-kit | 110K | spec-driven development | контракт spec→plan→tasks для COMPLEX-маршрута |
| garrytan/gstack | 108K | 23 opinionated tools (CEO/QA/Design...) | уже у нас; включаем в preflight-роутер как доменные скиллы |
| ruvnet/ruflo | 58K | meta-harness, swarms | ничего критичного; оркестрация у нас своя (harness-runner) |
| **HKUDS/CLI-Anything** | 42K | «agent-native CLI для любого софта», CLI-Hub (`pip install cli-anything-hub`) | **фабрика CLI**: `cli-hub install <name>`, генератор CLI+SKILL.md, 2461 тест |
| **PrefectHQ/fastmcp** | 25K | Pythonic MCP-серверы | **фабрика MCP**: шаблон генерации серверов |
| SuperClaude_Framework | 23K | конфиг-фреймворк, персоны | ничего нового для нас |
| automazeio/ccpm | 8K | PM через GitHub Issues + worktrees | паттерн issue-driven параллельности (поздний спринт) |
| buildermethods/agent-os | 4.8K | инъекция стандартов кодовой базы | паттерн standards-файлов на проект |
| parcadei/Continuous-Claude-v3 | 3.8K | ledgers + YAML handoffs + memory daemon | **«Compound, don't compact»**: handoff-формат, skill-activation инъекция на prompt, анти-сложность |

**Чем AMOS будет уникален (ниша, которую никто не закрыл):**
1. ECC — это «пакет для всех», без жёсткой политики инструментов; Continuous-Claude — только Claude.
   **AMOS = ядро с обязательной (deny+redirect) политикой инструментов + кросс-клиентный resume
   между Claude/Codex/Antigravity на одной машине** — ровно сценарий «кончились лимиты».
2. Ни одна из систем не объединяет: codemap-провайдеры (Graphify+CodeGraph), skill-router с
   локальным registry + skillgrab + gstack, и фабрику CLI/MCP (CLI-Anything+FastMCP) под одним ядром.
3. Доказуемость: каждый спринт закрывается измеримым KPI, метрики пишет само ядро (не патчи stdout).

---

## 3. Целевая архитектура AMOS

### 3.1 Принципы

1. **Kernel, not hooks.** Хуки — транспорт событий, не место для логики. ≤12 регистраций на клиента.
2. **One state.** SQLite (`~/.amos/state.sqlite`): sessions, handoffs, ledger, project registry,
   metrics, router-события. Файловая память остаётся человекочитаемым слоем; БД её индексирует.
3. **Budget-first.** Любая инъекция в контекст проходит бюджет ядра (SessionStart ≤2KB,
   advisory ≤300 байт, повтор одного совета — максимум 1 раз/сессию).
4. **Deny+redirect вместо советов.** Политика инструментов — это PreToolUse-deny с текстом
   «используй X», а не пожелание.
5. **Zero-config проекты.** Любая папка с кодом получает bootstrap автоматически при первом событии.
6. **Метрики by construction.** Ядро логирует каждое событие (fired/blocked/outputChars/duration)
   в SQLite — отчёт `amos report` всегда честный.
7. **Fail-soft.** Ядро упало/не найдено → клиент работает как ванильный, ничего не блокируется
   (кроме secrets/destructive, которые остаются автономными хуками).

### 3.2 Схема

```
┌─ Клиенты ──────────────────────────────────────────────────┐
│ Claude Code        Codex CLI        Antigravity/Gemini     │
│ settings.json      hooks.json       settings.json          │
│ ≤12 hook-строк     ≤12 hook-строк   ≤12 hook-строк         │
│   └──────────────── amos event <name> ────────────────┐    │
└────────────────────────────────────────────────────────┼───┘
                                                         ▼
┌─ AMOS Kernel (~/.amos, своё git-репо; CLI на Node) ────────┐
│ event router → handlers:                                   │
│  session-start: resume+handoff inject, bootstrap, focus    │
│  pre-tool:      tool-policy gate (deny+redirect)           │
│  post-edit:     quality advisory (бюджет), codemap touch   │
│  pre-commit:    secrets, conventional commit, quality      │
│  stop:          handoff write, checkpoint, ship-gate       │
│ state: SQLite (sessions/handoffs/ledger/metrics/registry)  │
│ policy.json: context7=cli, browser=agent-browser,          │
│   skills=skillgrab+registry, codemap=graphify+codegraph    │
│ profiles: AMOS_PROFILE=minimal|standard|strict             │
└──────────────┬─────────────────────────────────────────────┘
               ▼
┌─ Сервисы ──────────────────────────────────────────────────┐
│ preflight: skill-router(registry+skillgrab+gstack)+ctx7    │
│ codemap:   CodeGraph (символы) + Graphify (fallback/graph) │
│ memory:    files (canon) + SQLite index (+RAG опционально) │
│ harness:   harness-runner/gates (фазы+гейты, как есть)     │
│ factory:   amos make cli|mcp (CLI-Anything + FastMCP)      │
│ docs:      AGENTS.md → генерация CLAUDE.md/GEMINI.md       │
└────────────────────────────────────────────────────────────┘
```

### 3.3 Контракты инструментов (фиксируются в policy.json, исполняются deny+redirect)

| Назначение | Инструмент | Контракт |
|---|---|---|
| Доки библиотек | **Context7 CLI only** (`ctx7`) | MCP context7 → deny+redirect на CLI; перед кодом с библиотекой — обязательный вызов |
| Браузер | **agent-browser only** | MCP chrome/browser-harness → deny+redirect; `amos doctor` чинит agent-browser (reinstall/chrome download) автоматически |
| Поиск скиллов | **skillgrab + локальный registry + gstack** | preflight обязан опросить все три источника до COMPLEX-кода |
| Поиск по репо | **CodeGraph (символы/структура) + Graphify (fallback, project-graph)** | grep/Read full-file >120 строк → advisory с конкретной командой |
| Веб-поиск | agent-browser; WebFetch только для JSON API | как сейчас, но через единый гейт |
| Генерация CLI/MCP | **CLI-Anything + FastMCP** | `amos make cli <target>` / `amos make mcp <target>` |

### 3.4 Континуальность (ядро фичи «мини-ОС»)

- **Stop:** ядро пишет handoff (YAML): задача, состояние, изменённые файлы, незакрытые шаги,
  команда продолжения. Хранится в SQLite + зеркало в `.planning/handoffs/` проекта.
- **SessionStart (любой клиент):** ядро находит последний handoff этого проекта и инжектит
  компакт (≤1.5KB) + строку «продолжить: amos resume <id>».
- **`amos status --markdown`** — портативный снапшот (паттерн ECC) для ручной передачи куда угодно.
- Лимиты кончились в Claude → открыл Codex в той же папке → SessionStart сам поднял handoff.

### 3.5 Документация и порядок в репозиториях

- Канон — **AGENTS.md** (уже решено в S41). CLAUDE.md и .gemini/GEMINI.md **генерируются**
  с шапкой «GENERATED from AGENTS.md — не редактировать» (правка руками → doctor FAIL).
- `amos bootstrap` (авто на первом событии в новой папке): registry + AGENTS.md скелет +
  .graphifyignore + codemap init + handoff-папка. Стандарты структуры — паттерн agent-os
  (standards-файл на проект).
- Чистка: 2 мёртвых пути registry архивируются; `.planning/` получает индекс.

---

## 4. KPI (доказательства, не слова)

| KPI | Сейчас | Цель v4 | Как меряем |
|---|---|---|---|
| SessionStart-инъекция | ~18KB | **≤2KB** | `amos report session-cost` (из SQLite) |
| Hook-регистраций на клиента | 62 (Claude) / 108+ | **≤12** | подсчёт в settings/hooks.json |
| Node-процессов на SessionStart | 21 | **1** | счётчик ядра |
| Cross-client resume | нет | **<30 сек, 0 ручных шагов** | E2E: Claude stop → Codex start в 3 проектах |
| Проектов с полным bootstrap | ~9/17 | **17/17 (живых)** | `amos doctor --all-projects` |
| Хуков с метриками | 15% | **100% событий ядра** | SQLite metrics |
| Политика инструментов | советы | **deny+redirect, 0 обходов** | tool-policy тесты |
| Тестовое покрытие ядра | — | **unit + E2E на каждый спринт** | CI-набор `amos test` |

---

## 5. Спринты

### Sprint 0 — Baseline & Freeze (0.5 дня)
Зафиксировать v3: тег `v3-legacy`, точный замер SessionStart-цены в 3 проектах и 2 клиентах
(`token-impact`), снапшот настроек всех клиентов.
**Done when:** baseline-отчёт в `.planning/AMOS-BASELINE.md` с числами по каждому клиенту.

### Sprint 1 — Kernel + State (2-3 дня)
`~/.amos` (своё git-репо): CLI `amos` (Node, без зависимостей), event-роутер, SQLite-state
(node:sqlite, как у CodeGraph), `amos event session-start|stop` , профили, fail-soft, метрики.
Глобальные обёртки amos.cmd/ps1. Юнит-тесты ≥40.
**Done when:** `amos event session-start` в чужом проекте отвечает <500ms, пишет метрику,
инжектит ≤2KB; падение ядра не ломает клиент (тест).

### Sprint 2 — Континуальность (2 дня)
handoff write/read, `amos resume`, `amos status --markdown`, миграция pipeline-state в SQLite
(старый API через shim). Подключение Stop/SessionStart хуков всех 3 клиентов на ядро.
**Done when:** E2E-доказательство: задача начата в Claude (law-assistant), продолжена в Codex
без ручного контекста; то же Codex→Claude. Верификация исполнения хуков Gemini —
отдельный протокол (если Antigravity не исполняет — задокументированный fallback: AGENTS.md
инструкция + `amos resume` вручную одной командой).

### Sprint 3 — Tool Policy Gate (1-2 дня)
Единый PreToolUse-гейт: deny+redirect по policy.json (Context7→CLI, browser→agent-browser,
chrome MCP→deny). `amos doctor browser` с авто-починкой agent-browser (`agent-browser install`,
проверка Chrome, smoke `doctor --offline --quick`).
**Done when:** тест-матрица: каждый запрещённый инструмент отклонён с правильным redirect;
agent-browser сломан искусственно → doctor чинит → smoke PASS.

### Sprint 4 — Preflight (skill-router v2) (2 дня)
`amos preflight "<task>"`: локальный registry + **skillgrab** + **gstack** доменные скиллы +
Context7-подсказка + codemap-контекст → один блок ≤1.5KB. Перед COMPLEX-кодом preflight
обязателен (гейт в pipeline-фазе plan_design через harness-gates).
**Done when:** benchmark 10/10 сохранён + 5 новых кейсов (маркетинг/планирование → gstack,
кодинг → skillgrab) PASS; время <5s.

### Sprint 5 — Project Autopilot (2 дня)
`amos bootstrap` авто при первом событии: registry, AGENTS.md-скелет, docs-генерация
CLAUDE/GEMINI из AGENTS, codemap init (CodeGraph index + .graphifyignore), handoffs-папка.
Прогон по всем 17 проектам registry, архив мёртвых путей.
**Done when:** `amos doctor --all-projects` = 0 FAIL; в 3 ранее «голых» проектах SessionStart
даёт полноценный контекст (доказательство — транскрипты).

### Sprint 6 — Hook Diet Execution (1-2 дня)
Перевод всех клиентов на ≤12 hook-строк; удаление слитых хуков из settings/hooks.json
(файлы хуков остаются в архиве ветки v3-legacy). Перезапуск тестов хуков (новые наборы).
**Done when:** регистраций: Claude ≤12, Codex ≤12, Gemini ≤12; все тест-сьюты зелёные;
SessionStart-инъекция ≤2KB измерена повторно.

### Sprint 7 — Factory: CLI/MCP генерация (2 дня)
`amos make cli <target>` (CLI-Anything: cli-hub install или генерация новой обвязки + SKILL.md)
и `amos make mcp <target>` (FastMCP-шаблон). Пилоты: 1 CLI для реального сервиса пользователя +
1 MCP (кандидат: внутренний инструмент из D:\Ametrin projects).
**Done when:** оба пилота установлены, агент использует их в реальной задаче (транскрипт).

### Sprint 8 — Hardening & Portfolio (2 дня)
README (EN+RU), installer (`npx amos-kernel init` или setup.ps1), демо-GIF (agent-browser),
лицензия MIT, чистка секретов/путей, публикация на GitHub как портфолио.
**Done when:** установка на чистую машину по README < 10 минут; secret-scan чистый; repo публичен.

Суммарно: ~12-14 рабочих дней. После каждого спринта — `/checkpoint` + commit + handoff.

---

## 6. Риски и откаты

| Риск | Митигация |
|---|---|
| Antigravity/Gemini не исполняет хуки | Sprint 2 верифицирует факт; fallback — AGENTS.md-протокол + ручной `amos resume` (1 команда) |
| Ядро тормозит SessionStart | бюджет 500ms, кэш state, fail-soft таймаут 2s → клиент стартует без ядра |
| node:sqlite недоступен в старом Node | минимум Node 22 (есть, CodeGraph уже использует) или better-sqlite3 fallback |
| Слом текущего workflow при миграции | v3 не удаляется до Sprint 6; флаг `AMOS_DISABLE=1` мгновенно возвращает старое поведение |
| Codex sandbox: spawn EPERM | как сейчас — верификация вне sandbox; ядро не спавнит детей на горячем пути |
| CLI-Anything (Python) конфликт окружений | изолированный venv `~/.amos/venv`, доступ только через `amos make` |

## 7. Non-goals v4

- Не переписываем harness-runner/gates (работают, 114 тестов) — только встраиваем.
- Не строим свой векторный RAG — он опциональный провайдер, не ядро.
- Не делаем мульти-машинную синхронизацию (только локальная мини-ОС; облако — v5).
- Не трогаем red-team корпус.

---

## Решения, требующие подтверждения пользователя

1. **Имя**: AMOS (Agent Mini-OS), CLI `amos`. Альтернативы приветствуются.
2. **Расположение ядра**: `~/.amos` как отдельное git-репо (по образцу выноса `~/.claude`).
3. **Судьба RAG**: понижение до опционального провайдера (ollama-ingest перестаёт быть обязательным).
4. **Порядок спринтов**: можно поменять (например, Factory раньше Hook Diet).

---

## 8. Дополнение v1.1 — углублённый аудит с живыми замерами (2026-06-10)

### 8.1 Коррекция модели token waste (главное открытие)

Прямой замер всех хуков (`.tmp/measure-hooks.js`, `.tmp/measure-edit-hooks.js`) в двух проектах:

| Источник расхода | Этот проект | Law_assistant | Вердикт |
|---|---|---|---|
| SessionStart stdout (11 хуков) | 1 111 ch ≈ 278 tok | 1 270 ch ≈ 318 tok | НЕ главный пожиратель |
| UserPromptSubmit (каждый промпт) | 0 ch | 0 ch | ок |
| Per-Edit advisory (edit-enforcer и др.) | 0.5–1.2KB/эдит → 15–60KB/сессию | то же | **главный повторяющийся расход** |
| Доки, инжектируемые на старте | project CLAUDE.md **36KB** + AGENTS.md дубль 36KB + global 4.2KB + rules 6.2KB + MEMORY.md 5.9KB ≈ **13K tok/сессию** | зависит от проекта | **главный разовый расход** |
| Латентность хуков | Bash ≈ **4.2s/вызов** (pre 3.1s: context7-tracker 1011ms, quality-gate 598ms; post 1.2s); Edit ≈ 1.8s | хуже (диск D:) | скрытый костыль: минуты простоя/сессию |

Следствия для ядра: (1) hard-cap project-доков 150 строк — «Current State» уходит в SQLite-ledger,
не в CLAUDE.md (сейчас там вся история S12–S59); (2) per-edit advisory: бюджет ≤300 байт,
повтор ≤1/сессию; (3) hot-path событий ядра — in-process <50ms, не node-spawn на каждый Bash;
(4) KPI уточнён: стартовый payload проекта (доки+хуки) ≤8KB.

**Живое противоречие, пойманное в этой сессии:** edit-enforcer на запись measure-скрипта без
единой библиотеки потребовал «mcp__context7__resolve-library-id» (запрещённый теперь MCP-путь)
и написал «This edit is BLOCKED», будучи advisory. Один хук — три лжи: не тот инструмент,
не тот повод, не тот статус.

### 8.2 Верификация инструментального стека (живьём, 2026-06-10)

| Инструмент | Статус | Действие |
|---|---|---|
| agent-browser | **PASS**: v0.27.1, doctor 5 pass / 0 warn / 0 fail, Chrome 149 | починка не нужна; авто-repair остаётся в `amos doctor browser` (S3) |
| ctx7 CLI | присутствует (npm) | MCP context7 из ~/.claude.json → deny/удаление в S3 |
| skillgrab / skills-sh CLI | присутствуют (npm) | источник №2 preflight |
| codegraph CLI + MCP | PASS (doctor) | роль: символы/структура |
| graphify CLI | PASS (doctor) | роль: project-graph + fallback |
| gstack | bun 1.3.13; **43 скилла** в registry (qa, browse, design-review, cso, benchmark, context-save/restore, land-and-deploy, investigate, health...) | источник №3 preflight, поимённые домены |
| fastmcp | **3.2.3 установлен** | фабрика MCP готова |
| cli-anything-hub | **НЕ установлен** | пререквизит S7: `pip install cli-anything-hub` в `~/.amos/venv` |
| MCP в ~/.claude.json | context7, ukraine-laws, chrome-devtools, skillgrab, codegraph | deny в S3: context7 (CLI only), chrome-devtools (agent-browser only); остаются codegraph, skillgrab, ukraine-laws |

### 8.3 Antigravity/Gemini — фактаж

`~/.gemini/` содержит antigravity / antigravity-ide / antigravity-cli, settings.json с hooks-блоком
на ВСЕ события (вкл. FileChanged/Notification) и **локальную копию 67 hook-файлов** в `~/.gemini/hooks/`.
Конфигурация полная; runtime-исполнение хуков Antigravity по-прежнему не доказано логами →
протокол верификации в S2: маркер-хук, запуск сессии, проверка следа в metrics/файле.

### 8.4 Память — текущий ландшафт (3 системы)

1. Файловая (канон): `~/.claude/projects/C--/memory/` ↔ junction `~/.codex/memories` (проверен: Junction, target корректный); memory_summary.md 14KB.
2. RAG (ollama/Google embeddings) — используется редко → понижается до опционального провайдера.
3. Codex встроенная: memories_1.sqlite 0.8MB; **logs_2.sqlite 335MB(!)** — ротация в S5 (гигиена).
Antigravity свою память в общий контур не пишет — подключается через AMOS handoffs (S2).

### 8.5 Traceability: каждое требование ТЗ → решение → спринт

| Требование пользователя | Решение | Когда |
|---|---|---|
| Найти token waste | §1.1 + §8.1 (живые замеры) | done |
| Найти костыли; что убрать/оставить | §1.3–1.4 | done |
| Лучшие решения GitHub через CLI | §2: gh CLI, 11 систем (ECC 212K★...) | done |
| Пайплайн реальной разработки во всех клиентах | kernel events + harness-runner фазы | S1–S2 |
| Автоведение доков по ИТ-стандартам | AGENTS.md канон → генерация CLAUDE/GEMINI + docs-gate + cap 150 строк | S5 |
| Общая память + самоулучшение | SQLite state + файловый канон; `amos learn` (harvest + weekly → предложения) | S2, S5 |
| Поиск скиллов перед работой (кодинг/маркетинг/планирование) | `amos preflight`: registry + **skillgrab** + **gstack(43)** | S4 |
| Сохранения | handoff на Stop + `amos status --markdown` | S2 |
| Грамотный git | auto-branch + git-workflow-audit + commit-гейты в ядре | S1, S6 |
| Тестирование как следует | harness-gates фазы linter/tests + TDD-скилл в preflight | встроено |
| АВТОМАТИЧЕСКИ ВО ВСЕХ ПРОЕКТАХ | zero-config bootstrap при первом событии | S5 |
| Не терять прогресс при лимитах/смене клиента | cross-client resume <30s | S2 |
| Context7 — только CLI, не fallback | **зафиксировано 2026-06-10** в rules.md + CLAUDE.md; deny MCP | done + S3 |
| agent-browser строго; чинить если сломан | **проверен: PASS** (чинить нечего); авто-repair в ядре | done + S3 |
| Skillgrab для поиска скиллов | **зафиксировано** в rules.md (Skill Discovery) | done + S4 |
| Graphify+CodeGraph строго для поиска по репо | **зафиксировано**: «Repo Search» заменил «RAG-first» в rules.md | done + S3 |
| ИИ наводит порядок в репозиториях | `amos tidy`: docs cap, ledger вместо истории в доках, ротация мусора (Codex logs 335MB), структурные стандарты | S5 |
| gstack задействованы | 43 скилла поимённо в preflight-доменах | S4 |
| Доказать работу реально | KPI §4 + замеры §8.1 + E2E-критерий каждого спринта | все |
| Портфолио на GitHub | Sprint 8 | S8 |
| CLI-Anything + FastMCP фабрика | `amos make cli\|mcp`; fastmcp 3.2.3 есть, cli-hub доустановить | S7 |

### 8.6 Зафиксировано немедленно (политика, не код — аппрува не требует)

- `~/.claude/rules/rules.md`: «Web Search & Scraping» → **agent-browser ONLY**; «Context Reading (RAG-first)» → **«Repo Search — CodeGraph + Graphify строго»** (RAG опционален); Context7 → **CLI ONLY, MCP forbidden**; новая секция **Skill Discovery** (registry + skillgrab + gstack); gh CLI разрешён для GitHub-исследований.
- `~/.claude/CLAUDE.md`: секция Browser Automation переписана на agent-browser (+ процедура самопочинки); browser-harness помечен LEGACY; Context7 усилен до «CLI — единственный путь».
- Память: `feedback_browser_tool`, `feedback_websearch_forbidden` переписаны; MEMORY.md индекс синхронизирован (3 устаревшие строки исправлены).

### 8.7 Правки KPI после замеров

| KPI (было в §4) | Стало |
|---|---|
| SessionStart-инъекция ≤2KB | Стартовый payload проекта (доки + хуки + memory-индекс) **≤8KB**; stdout хуков ≤2KB |
| — (не было) | Per-edit advisory ≤300 байт, повтор ≤1/сессию |
| — (не было) | Hook-латентность: Bash-цикл ≤300ms (сейчас 4 200ms), Edit-цикл ≤200ms (сейчас 1 800ms) |
| — (не было) | Project CLAUDE.md ≤150 строк во всех 17 проектах (сейчас флагман сам 330+) |
