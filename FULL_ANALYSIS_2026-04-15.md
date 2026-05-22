# Полный анализ пайплайна: архитектура, ошибки, сравнение

> Дата: 2026-04-15 | Версия системы: v8 | Основа: независимый аудит + исследование топ-решений

---

## 1. Что это за система

Кастомный dev-automation pipeline поверх Claude Code / Codex CLI / Antigravity:
- **24 хука** (Node.js), охватывающие весь lifecycle агента
- **Shared memory** между 3 инструментами через Windows Junction
- **Graphify** knowledge graph — semantic code navigation
- **Skill ecosystem**: pipeline, ship, sprint, company, architect-first + GSD suite

Цель: автоматизировать quality enforcement без участия разработчика.

---

## 2. Сравнение с топовыми решениями (2026)

### Референсы

| Решение | Stars | Хуки | Агенты | Multi-tool | Graphify | Score |
|---|---|---|---|---|---|---|
| **awesome-claude-code-toolkit** | ~2k | 20 | 135 | нет | нет | — |
| **claude-code-hooks** | ~500 | 15 | нет | нет | нет | — |
| **awesome-claude-skills** | ~800 | нет | нет | частично | нет | — |
| **antigravity-awesome-skills** | ~300 | нет | 1400+ | нет | нет | — |
| **Aider** | 24k | git hooks | нет | нет | нет | — |
| **Continue.dev** | 21k | нет | нет | IDE only | нет | — |
| **ЭТА СИСТЕМА** | — | **24** | 10+ agents | **Claude+Codex+AG** | **ДА** | 66/100 |

### Уникальные преимущества этой системы (чего НЕТ у конкурентов)

1. **Lifecycle coverage** — 24 хука vs 15-20 у лучших. Покрыты: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, Notification.

2. **Graphify deep integration** — semantic knowledge graph для code navigation. Уникально. Ни один конкурент не имеет аналога.

3. **Multi-tool sync** — одни хуки, одна память для Claude Code + Codex + Antigravity. awesome-claude-code-toolkit работает только с Claude Code.

4. **Domain-aware injection** — автоматические правила per-domain при первом Edit. awesome-claude-code-toolkit не имеет этого.

5. **Context7 enforcement** — мандаторная проверка docs через MCP. Уникально для safety от hallucinated API.

6. **Session focus gate** — "1 цель = 1 сессия" с scope guard. Данные по сессиям показывают: focused sessions = fully_achieved.

### Отставание

1. **Размер экосистемы** — 10 агентов vs 135 у awesome-claude-code-toolkit.
2. **Нет CI/CD интеграции** — GitHub Actions hooks pattern. Claude Code HTTP hooks + GitHub Actions = тренд 2026.
3. **Нет инсталлятора** — топ-решения: `npm install -g` или curl скрипт за 30 сек.
4. **Документация** — нет README с диаграммами. Конкуренты имеют architecture docs.
5. **Нет конфигурируемости** — threshold'ы хардкодированы. Continue.dev: полная кастомизация через config.json.

---

## 3. Критические архитектурные ошибки

### A-ERR-1: Stop hook format — неправильный `reason` тип
**Файл:** `ship-gate.js`, `stop-verification.js`  
**Severity:** HIGH

```js
// Было (ОШИБКА): reason — массив, не строка
process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: ['line1', 'line2', 'line3'].join('\n')  // .join спасает, но это хак
}));

// Правильно по API:
process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: 'Single string message'
}));
```

Официальный API Claude Code Stop hooks ожидает `reason: string`. Текущий код использует массив с `.join('\n')` — работает случайно. При изменении формата сломается.

---

### A-ERR-2: Async stdin + ReadFileSync несовместимость в hook suite
**Файлы:** Часть хуков использует `fs.readFileSync(0, 'utf8')` (sync), часть — `process.stdin.on('data', ...)` (async).

```
Sync: edit-enforcer.js, domain-agent-gate.js, config-protection.js, graphify-preuse.js
Async: scope-guard.js, context-budget-gate.js, loop-guardian.js, post-edit-combined.js
```

**Проблема:** Async hooks имеют `setTimeout(() => process.exit(0), 5000)`. На Windows с медленными дисками или при высокой нагрузке — возможны timeouts. Sync паттерн надёжнее.

**Рекомендация:** Унифицировать все hooks на `fs.readFileSync(0, 'utf8')`.

---

### A-ERR-3: context-budget-gate — неправильный путь транскрипта
**Файл:** `context-budget-gate.js`  
**Severity:** HIGH (хук частично не работает)

```js
// Fallback ищет: ~/.claude/projects/{dir}/{session-id}.jsonl
const candidate = path.join(projectsDir, dir, sessionId + '.jsonl');

// Реальная структура Claude Code:
// ~/.claude/projects/{encoded-cwd}/{session-id}.jsonl
// Где encoded-cwd = путь с заменой / на -- и пробелов на -
```

Fallback discovery никогда не найдёт transcript. Хук работает ТОЛЬКО если `transcript_path` передаётся в payload (Claude Code передаёт его начиная с некоторой версии).

---

### A-ERR-4: scope-guard.js — exit(2) в PostToolUse
**Файл:** `scope-guard.js`  
**Severity:** MEDIUM

```js
// PostToolUse hook:
process.stderr.write('MEGA-SPRINT BLOCKED: ...');
process.exit(2); // ❌ exit(2) работает ТОЛЬКО в PreToolUse

// PostToolUse при exit(2) → ошибка выполнения hook, Claude видит
// "hook failed" а не сообщение → контрпродуктивно
```

По документации Claude Code:
- `exit(2)` → blocking error (только для PreToolUse и Stop)
- PostToolUse: только `additionalContext` через stdout

---

### A-ERR-5: quality-gate-runner.js — читает cwd неправильно
**Файл:** `quality-gate-runner.js`

```js
const cwd = (input.tool_input && input.tool_input.cwd) || input.cwd || process.cwd();
```

PreToolUse hooks получают в stdin: `{ tool_name, tool_input: { command, ... } }`. Поле `cwd` находится на верхнем уровне (`input.cwd`), НЕ в `tool_input.cwd`. Порядок приоритетов обратный — нужно `input.cwd || (input.tool_input && input.tool_input.cwd) || process.cwd()`.

---

### A-ERR-6: SLASH_COMMAND_TOOL_CHAR_BUDGET слишком мало
**Файл:** `~/.claude/settings.json`

```json
"SLASH_COMMAND_TOOL_CHAR_BUDGET": "8000"
```

8000 символов недостаточно для многих скиллов (pipeline.md = ~2500 chars OK, но cto-playbook, company — могут быть обрезаны). Топ-решения рекомендуют 20000-50000.

**Рекомендация:** Увеличить до 25000.

---

### A-ERR-7: MAX_THINKING_TOKENS слишком ограничен
**Файл:** `~/.claude/settings.json`

```json
"MAX_THINKING_TOKENS": "10000"
```

10k токенов для extended thinking — очень мало для архитектурных решений. Для Opus на сложных задачах нужно 20k-60k. Ограничение снижает качество reasoning в /architect-first и /company.

---

### A-ERR-8: CLAUDE_AUTOCOMPACT_PCT_OVERRIDE слишком высок
**Файл:** `~/.claude/settings.json`

```json
"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "90"
```

90% от 1M = компакция только при 900k токенов. Это:
- Слишком поздно — качество деградирует при 600k+
- Заставляет хранить весь session history в памяти
- При compaction теряется слишком много контекста разом

**Рекомендация:** 65% (650k tokens) — компакция с запасом, но не слишком рано.

---

## 4. Graphify — полный анализ состояния

### Что работает

- Бинарник установлен: `C:/Users/user/.../graphify.exe` ✅
- Хуки существуют: `graphify-preuse.js`, `graphify-session-init.js` ✅
- Graphs существуют на D:\ (5 проектов): `D:/Ametrin projects/*/graphify-out/graph.json` ✅
- `cmd /c graphify query` работает из bash ✅

### Что сломано / не работает

#### Проблема 1: Нет graph.json в C:\ playground проектах
```
D:/Ametrin projects/Ametrin 1C разраб/graphify-out/graph.json  ✅
D:/Ametrin projects/Law_assistant/graphify-out/graph.json       ✅
C:/Claude playground/Pipiline setupper/                         ❌ нет graph.json
```

Хуки `graphify-preuse.js` и `graphify-session-init.js` делают `process.exit(0)` когда нет graph.json. Агенты в C:\ проектах НИКОГДА не используют graphify.

**Фикс:** `cmd /c graphify update . && cmd /c graphify hook install` в каждом проекте на D:\.

#### Проблема 2: Нет авто-обновления при изменениях
Хуки ЧИТАЮТ graph но НИКОГДА не обновляют его. `graphify watch <path>` запускает watcher, но он нигде не настроен.

```bash
# Что должно быть:
# Git post-commit hook → graphify update .
# SessionStart hook → проверить age graph.json → если >24h → graphify update . (async)
```

Сейчас graph обновляется только вручную через `cmd /c graphify update .`.

#### Проблема 3: graphify-session-init.js не запускает scan
```js
// В graphify-session-init.js:
// Does NOT run graphify scan (too slow for SessionStart).
```

Комментарий правильный — `graphify update .` занимает 30-60 сек. Но без автообновления graph устаревает.

**Архитектурное решение:** Запускать `graphify update .` в фоне (после SessionStart) через `execSync({detached: true})`, не блокируя сессию.

#### Проблема 4: graphify claude install устанавливает сломанный PS хук
```
# graphify claude install → PowerShell post-commit hook → BROKEN в bash
```

Зафиксировано в memory. Обходной путь: `graphify-preuse.js` уже установлен как глобальный hook.

#### Проблема 5: Агенты не обучены использовать graphify
В domain-agent-gate.js правила говорят "используй Context7", но НЕ говорят "используй `cmd /c graphify query` вместо Glob/Grep если graph.json есть". Graphify-preuse.js инжектирует это только когда есть graph.json — т.е. только для D:\ проектов.

### Roadmap для полной Graphify интеграции

```
Sprint A: Инициализация
  - cmd /c graphify update . во всех C:\ playground проектах
  - cmd /c graphify hook install в каждом проекте

Sprint B: Авто-обновление
  - Обновить graphify-session-init.js: запускать update . async если graph старше 6h
  - Добавить в domain-agent-gate.js правило: "если graph.json есть → graphify query первым"

Sprint C: Глубокая интеграция
  - graphify-preuse.js: если нет graph → suggest creating (не молча пропускать)
  - Добавить graphify query в pipeline skill (Step 0: query graph вместо чтения файлов)
  - Метрики: сколько раз graphify использован vs Glob/Grep
```

---

## 5. Анализ Claude Code / Codex / Antigravity документации vs реализация

### Claude Code Hooks API — расхождения

| Feature | По документации | Реализовано |
|---|---|---|
| Stop hook output | `{ decision: 'block', reason: string }` | ✅ (reason через .join — работает) |
| PreToolUse block | `hookSpecificOutput.permissionDecision: 'deny'` | ✅ |
| PreToolUse allow | `hookSpecificOutput.permissionDecision: 'allow' + additionalContext` | ✅ |
| PostToolUse advice | `hookSpecificOutput.additionalContext` | ✅ |
| SessionStart advice | `hookSpecificOutput.additionalContext` | ✅ |
| PostToolUse block | **НЕ ПОДДЕРЖИВАЕТСЯ** | ❌ scope-guard.js использует exit(2) |
| Hook timeout | 60 секунд по умолчанию | ✅ (async hooks: 5s self-timeout) |
| stdin payload | `{ tool_name, tool_input, cwd, session_id, ... }` | ⚠️ quality-gate-runner читает неправильно |

### Codex CLI Hooks — отличия от Claude Code

| Feature | Claude Code | Codex CLI | Проблема |
|---|---|---|---|
| Notification event | ✅ TaskCompleted | ❌ нет | task-completed-gate не работает в Codex |
| Skill event (PostToolUse) | ✅ | ❌ нет | pipeline-tracker не работает в Codex |
| Stop hook | ✅ | ✅ (есть в hooks.json) | ОК |
| Stdin format | JSON via stdin | JSON via stdin | ОК |
| hookSpecificOutput | ✅ | ✅ | ОК |

### Antigravity — специфика

Antigravity = VSCode-форк с Claude Code extension (`anthropic.claude-code-2.1.109-win32-x64`).
- Читает `~/.claude/settings.json` — те же хуки ✅
- Нет отдельной hooks конфигурации ✅
- Все 24 хука работают в Antigravity так же как в Claude Code CLI ✅
- НО: hooks запускаются в контексте IDE, где `process.cwd()` может быть workspace root а не project dir

**Потенциальная проблема:** В Antigravity `process.cwd()` в хуках — это директория воркспейса (открытая папка), не обязательно git project root. Хуки используют `input.cwd` при наличии — но не все хуки корректно fallback на `input.cwd`.

---

## 6. Production Readiness: детализированный скоринг

### Текущее состояние (post-fix)

```
Критические баги:     18/20  (2 исправлены, 2 некритических остались)
Hook coverage:        13/15  (нет CI/CD webhooks, нет HTTP hooks)
Reliability:           8/15  (silent failures, async timeouts, exit(2) в PostToolUse)
Testing:               6/10  (unit tests только, нет integration/e2e)
Documentation:         5/10  (GUIDE.md есть, нет architecture diagrams, нет INSTALL)
Configurability:       4/10  (все threshold хардкодированы)
Multi-tool sync:       8/10  (memory sync ✅, state не sync между инструментами)
Observability:         2/5   (нет error.log, нет metrics, нет dashboards)
Install UX:            1/3   (ручная установка, нет скрипта)
Versioning:            1/2   (нет semver в хуках)
────────────────────────────
TOTAL:                66/100
```

### Целевой скоринг для open-source release: 90+/100

```
Критические баги:     20/20  (все BUGs исправлены)
Hook coverage:        14/15  (+ HTTP hooks)
Reliability:          13/15  (unified stdin, error logger, exit(2) fix)
Testing:               8/10  (+ integration tests, + CI)
Documentation:         9/10  (+ README диаграммы, + INSTALL.sh)
Configurability:       8/10  (config.json с threshold'ами)
Multi-tool sync:      10/10  (+ state sync)
Observability:         5/5   (error.log, metrics.json, hook-stats CLI)
Install UX:            3/3   (install.sh / npm install)
Versioning:            2/2   (semver + changelog)
────────────────────────────
TARGET:               92/100
```

---

## 7. Sprint Plan для следующих сессий

### Sprint 1: Reliability (score: 66 → 76)
**Файлы:** `scope-guard.js`, `quality-gate-runner.js`, `edit-enforcer.js`, `context-budget-gate.js`, `lib/logger.js`

```
[x] BUG-1: ship-gate git scope fix           ✅ done
[x] BUG-2: context-budget-gate const→let     ✅ done
[ ] BUG-3: scope-guard exit(2) → additionalContext
[ ] BUG-4: quality-gate fast-path для docs-only коммитов
[ ] BUG-5: quality-gate cwd reading fix (input.cwd priority)
[ ] NEW:   lib/logger.js — centralized error logging
[ ] NEW:   test-all-hooks.js — integration scenarios (не только syntax)
[ ] CONF:  settings.json: SLASH_COMMAND_TOOL_CHAR_BUDGET: 25000
[ ] CONF:  settings.json: MAX_THINKING_TOKENS: 30000
[ ] CONF:  settings.json: CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: 65
```

### Sprint 2: Graphify Activation (score: 76 → 82)
```
[ ] graphify update . + hook install во всех playground проектах
[ ] graphify-session-init.js: async background update если graph >6h old
[ ] domain-agent-gate.js: добавить правило "graphify query first"
[ ] graphify-preuse.js: suggest creation если нет graph.json (не молча)
```

### Sprint 3: Configurability (score: 82 → 87)
```
[ ] ~/.claude/hooks/config.json — все threshold'ы
[ ] Все хуки читают config.json с fallback на defaults
[ ] Унифицировать stdin читение: все async → sync (fs.readFileSync(0))
```

### Sprint 4: Observability + Docs (score: 87 → 92)
```
[ ] lib/errors.log (rotated, 1MB max)
[ ] lib/metrics.json — счётчики событий
[ ] hook-stats.js CLI — статистика
[ ] README.md с architecture diagram
[ ] INSTALL.sh — установка за 5 минут
[ ] Semver в хуках (version поле)
```

---

## Приложение: Полная карта зависимостей хуков

```
/tmp/claude-session-focus/goal.json
  ← WRITE: session-focus-gate.js (SessionStart)
  → READ:  scope-guard.js (PostToolUse:TaskCreate)

/tmp/claude-inline-review/state.json
  ← WRITE: inline-review-gate.js (PostToolUse:Edit|Write)
  ← RESET: inline-review-tracker.js (PostToolUse:Agent)
  → READ:  edit-enforcer.js (PreToolUse:Write|Edit)
  → READ:  edit-enforcer.js Check4 (pipeline threshold)

/tmp/claude-context7-tracker/state.json
  ← WRITE: context7-reminder.js (PostToolUse:Edit|Write)
  ← MARK:  context7-tracker.js (PostToolUse:mcp__context7__)
  → READ:  edit-enforcer.js (PreToolUse:Write|Edit)

/tmp/claude-loop-guardian/history.json
  ← WRITE: loop-guardian.js (PostToolUse:Edit|Write|Bash)
  → READ:  edit-enforcer.js (loop detection)

/tmp/claude-pipeline-tracker/state.json
  ← WRITE: pipeline-tracker.js (PostToolUse:Skill)
  → READ:  edit-enforcer.js Check4

/tmp/claude-verification-gate/state-{hash}.json
  ← WRITE: verification-tracker.js (PostToolUse:Edit|Write|Bash)
  → READ:  stop-verification.js (Stop)
  → READ:  ship-gate.js (Stop, for sessionStart time)

/tmp/claude-ship-gate/skip-{hash}.json  ← NEW v2
  ← WRITE: manually via node -e command (skip bypass)
  → READ:  ship-gate.js (Stop, consume one-time bypass)

/tmp/claude-context-gate/state.json
  ← WRITE: context-budget-gate.js (UserPromptSubmit)
  (self-contained, no other readers)

/tmp/claude-domain-agent/state.json
  ← WRITE: domain-agent-gate.js (PreToolUse:Write|Edit)
  (fires once per domain per session, self-contained)

/tmp/claude-learn-gate/prompted-{hash}.json
  ← WRITE: stop-verification.js (Stop, prevents double-prompt)
  → READ:  stop-verification.js (same, idempotency check)
```
