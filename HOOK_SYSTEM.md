# Hook System — Полный справочник

> Версия: v12 | Дата: 2026-04-16 | 27 хуков, 3 инструмента

## Содержание
1. [Архитектура](#архитектура)
2. [Таблица всех хуков](#таблица-всех-хуков)
3. [Форматы вывода](#форматы-вывода)
4. [Конфиг threshold'ов](#конфиг-thresholdов)
5. [Cross-tool синхронизация](#cross-tool-синхронизация)
6. [Как работает каждый хук](#как-работает-каждый-хук)
7. [Важные gotcha'ы](#важные-gotchaы)
8. [Тестирование](#тестирование)
9. [Добавление нового хука](#добавление-нового-хука)

---

## Архитектура

```
Инструмент (Claude Code / Codex / Antigravity)
    │
    ├─ Событие (SessionStart, PreToolUse, PostToolUse, Stop...)
    │       │
    │       └─ hooks/*.js  ← Node.js скрипты, одни и те же для всех 3 инструментов
    │               │
    │               ├─ читают stdin (JSON с контекстом события)
    │               ├─ используют hooks/lib/{config,logger,metrics}.js
    │               └─ пишут в stdout (JSON решение) или exit(2) для блокировки
    │
    ├─ ~/.claude/settings.json  ← Claude Code + Antigravity
    └─ ~/.codex/hooks.json      ← Codex CLI (те же .js файлы)
```

**Входной JSON на stdin** (все события):
```json
{
  "tool_name": "Edit",
  "tool_input": { "file_path": "src/foo.ts", "old_string": "...", "new_string": "..." },
  "tool_response": { "content": "..." },
  "cwd": "D:/Ametrin projects/my-project",
  "sessionId": "abc123"
}
```

---

## Таблица всех хуков

### SessionStart (5 хуков)

| Хук | Что делает | Блокирует? |
|-----|-----------|-----------|
| `project-docs-gate.js` | Проверяет CLAUDE.md/AGENTS.md/.gemini/GEMINI.md. Отсутствие всех → exit(2) | ✅ если нет ни одного |
| `session-focus-gate.js` | Сбрасывает goal.json в tmpdir. Просит определить 1 цель. | Нет (advisory) |
| `autoskills-check.js` | Определяет tech stack по CWD, инжектирует контекст | Нет |
| `graphify-session-init.js` | Если граф >6h → запускает `graphify update .` фоном. Инжектирует stats | Нет |
| `memory-discipline.js` | Считает строки MEMORY.md. >80 → warn, >100 → exit(2) | ✅ если >100 строк |

### UserPromptSubmit (1 хук)

| Хук | Что делает | Блокирует? |
|-----|-----------|-----------|
| `context-budget-gate.js` | Считает токены (chars/6). >80k → warn. Повторяет каждые 20k | Нет (advisory) |

### PreToolUse (7 хуков)

| Хук | Матчер | Что делает | Блокирует? |
|-----|--------|-----------|-----------|
| `graphify-read-gate.js` | Read | Если граф есть + файл >80 строк + нет limit<150 → deny. Советует graphify query | ✅ |
| `graphify-preuse.js` | Glob\|Grep | Если граф есть → советует graphify query вместо сканирования | ✅ опционально |
| `config-protection.js` | Write\|Edit | Защищает .eslintrc, .prettierrc, eslint.config.*, biome.json, .golangci.yml и др. | ✅ |
| `domain-agent-gate.js` | Write\|Edit | На первый едит: инжектирует domain rules (frontend/backend/security/qa/devops) | Нет |
| `edit-enforcer.js` | Write\|Edit | Warn при 3 едитах без Context7, block при 9. Warn при 7 без review, block при 15 | ✅ при limit |
| `secret-scanner.js` | Bash | Сканирует команды на секреты (sk-, AKIA, ghp_, sk_live_...). В careful mode → block rm/reset/force | ✅ |
| `quality-gate-runner.js` | Bash | После изменений кода запускает tsc/eslint/go vet/ruff. Warn если проблемы | Нет (advisory) |

### PostToolUse (10 хуков)

| Хук | Матчер | Что делает |
|-----|--------|-----------|
| `post-edit-combined.js` | Edit\|Write | Инжектирует контекст: что изменилось, советы по следующему шагу |
| `context7-reminder.js` | Edit\|Write | SILENT. Счётчик в tmpdir для edit-enforcer. Не выводит ничего |
| `inline-review-gate.js` | Edit\|Write | Warn при warnAt=7 едитах без code review, block при blockAt=15 |
| `verification-tracker.js` | Edit\|Write\|Bash | Отслеживает: были ли запущены тесты/build после изменений |
| `loop-guardian.js` | Edit\|Write\|Bash | Блокирует при 3+ повторениях ОДНОГО действия (для Edit: same old_string fingerprint) |
| `secret-output-scanner.js` | Bash | Сканирует stdout команды на утечку секретов |
| `inline-review-tracker.js` | Agent | Отслеживает code-reviewer агентов, обновляет счётчик |
| `scope-guard.js` | TaskCreate | Warn при 5 задачах, block при 8 — защита от scope creep |
| `context7-tracker.js` | mcp__context7__* | Записывает что Context7 был использован → сбрасывает счётчик edit-enforcer |
| `pipeline-tracker.js` | Skill | Записывает вызовы pipeline скилла |

### Stop (2 хука)

| Хук | Что делает | Блокирует? |
|-----|-----------|-----------|
| `stop-verification.js` | Проверяет незакоммиченные изменения в CWD (`git diff HEAD -- .`) | ✅ если есть uncommitted |
| `ship-gate.js` | Аналогично, дополнительная проверка перед завершением сессии | ✅ если есть uncommitted |

### Claude Code Only

| Хук | Событие | Что делает |
|-----|---------|-----------|
| `task-completed-gate.js` | Notification | При завершении задачи → проверяет quality checklist |
| `env-change-watcher.js` | FileChanged | Сканирует .env/.envrc на секреты при изменении |

---

## Форматы вывода

**КРИТИЧНО**: Формат зависит от события. Неправильный формат = хук игнорируется.

```javascript
// PreToolUse — БЛОКИРОВАТЬ
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    permissionDecision: 'deny',
    permissionDecisionReason: 'Почему запрещено'
  }
}));

// SessionStart / PostToolUse — СОВЕТ (не блокирует)
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',  // или PostToolUse
    additionalContext: 'Сообщение для Claude'
  }
}));

// Stop — БЛОКИРОВАТЬ выход (формат ДРУГОЙ!)
process.stdout.write(JSON.stringify({
  decision: 'block',
  reason: 'Почему нельзя завершить'
}));

// SessionStart — HARD BLOCK (exit code 2, НЕ JSON)
process.stderr.write('Сообщение об ошибке\n');
process.exit(2);

// Разрешить без комментариев
process.exit(0);  // без stdout
```

---

## Конфиг threshold'ов

Файл: `~/.claude/hooks/config.json`

```json
{
  "session": {
    "ttlHours": 4,              // TTL для session state файлов
    "scopeGuardTtlHours": 8
  },
  "editEnforcer": {
    "warnAt": 3,                // Warn: 3 едита кода без Context7
    "blockAt": 9                // Block: 9 едитов без Context7
    // + warnAt=7 / blockAt=15 без code review (в inline-review-gate.js)
  },
  "loopGuardian": {
    "historyWindow": 10,        // Последние N действий в истории
    "repeatWarn": 3             // Блок при N повторениях одного действия
  },
  "contextBudget": {
    "thresholdTokens": 80000,   // Warn порог токенов
    "repeatIntervalTokens": 20000,
    "singlePromptWarnTokens": 40000
  },
  "inlineReview": {
    "warnAt": 7,
    "blockAt": 15
  },
  "context7": {
    "warnAtReminders": 1,
    "blockAtReminders": 3,
    "gracePeriodMs": 600000     // 10 минут grace period
  },
  "scopeGuard": {
    "warnAtTasks": 5,
    "blockAtTasks": 8
  }
}
```

**Изменение порогов**: редактировать `config.json` — хуки читают его при каждом вызове.

---

## Cross-tool синхронизация

```
Claude Code  ←── ~/.claude/settings.json ───── 27 хуков
Antigravity  ←── ~/.claude/settings.json ───── 27 хуков (читает тот же файл!)
Codex CLI    ←── ~/.codex/hooks.json     ───── 25 хуков (те же .js файлы)
```

**Почему Codex = 25, а не 27:**
- `FileChanged` — Codex не поддерживает это событие
- `Notification` — Codex не поддерживает это событие
- Все остальные события идентичны

**При добавлении нового хука — обновить оба файла:**
1. `~/.claude/settings.json` — для Claude Code + Antigravity
2. `~/.codex/hooks.json` — для Codex (если событие поддерживается)

**Antigravity** = VSCode-форк (автоматически в синке, отдельный конфиг не нужен).

**Порядок SessionStart** (одинаковый в обоих файлах):
```
project-docs-gate → session-focus-gate → autoskills-check → graphify-session-init → memory-discipline
```

---

## Как работает каждый хук

### graphify-read-gate.js — алгоритм блокировки

```
1. Читаем input.cwd (НЕ process.cwd() — это было багом!)
2. Проверяем: есть ли graphify-out/graph.json в CWD
3. Если нет графа → exit(0), пропускаем
4. Если tool_input.limit != null → exit(0), партиальный рид = агент действует осознанно
5. Проверяем whitelist: .json/.md/CLAUDE.md/README.md → exit(0)
6. Только code расширения: .py .js .ts .tsx .jsx .go .java etc.
7. Считаем строки (кешируем в tmpdir)
8. Если < 80 строк → exit(0)
9. Если ≥ 80 строк → DENY + совет: cmd /c graphify query "..."
```

### loop-guardian.js — как различает петлю и нормальную работу

```
Edit A→B в файле  →  actionKey = "edit:path/file.ts:old_string_first_60_chars_A"
Edit C→D в файле  →  actionKey = "edit:path/file.ts:old_string_first_60_chars_C"  ← РАЗНЫЕ ключи → не петля
Edit A→B снова    →  actionKey = "edit:path/file.ts:old_string_first_60_chars_A"  ← 2x тот же → счётчик
Edit A→B снова    →  3x → BLOCK (петля обнаружена)
```

### secret-scanner.js — careful mode

```
Обычный режим: блокирует только СЕКРЕТЫ (sk-AAA...32+, sk_live_BBB...24+, etc.)
Careful mode:  блокирует ДЕСТРУКТИВНЫЕ команды (rm -rf, git reset --hard, git push --force)

Как включить careful mode:
  /careful  → создаёт ~/.tmp/claude-careful-mode/state.json с TTL 8h
Как выключить:
  /careful off  → удаляет state.json
```

### edit-enforcer.js — счётчик Context7

```
Context7 used (context7-tracker.js) → counter сбрасывается
Edit code file → counter++
Warn при count >= 3 (без Context7 в этой сессии)
Block при count >= 9

Параллельно: inline-review счётчик
Edit → edit_count++
code-reviewer agent → edit_count сбрасывается
Warn при edit_count >= 7
Block при edit_count >= 15
```

### memory-discipline.js — защита MEMORY.md

```
При каждом SessionStart:
1. Читает ~/.claude/projects/C--/memory/MEMORY.md
2. Считает строки
3. < 80 строк → silent (exit 0)
4. 80-100 строк → advisory (additionalContext с предупреждением)
5. > 100 строк → hard block (exit 2, stderr)

Исправить: /learn → сжать, архивировать старые записи в memory/archive/
```

---

## Важные gotcha'ы

### cwd — самый частый баг
```javascript
// НЕПРАВИЛЬНО (было в graphify-read-gate до фикса):
const cwd = process.cwd();  // вернёт ~/.claude/hooks/ ← НЕВЕРНО!

// ПРАВИЛЬНО:
let input = JSON.parse(fs.readFileSync(0, 'utf8'));
const cwd = (input && input.cwd) ? input.cwd : process.cwd();
```

### Чтение stdin на Windows
```javascript
// ПРАВИЛЬНО для Windows:
const input = JSON.parse(fs.readFileSync(0, 'utf8'));

// НЕ РАБОТАЕТ на Windows:
// process.stdin.read() — может вернуть null
// fs.readFileSync('/dev/stdin') — /dev/stdin не существует на Windows
```

### graphify на Windows
```bash
# ЗАПРЕЩЕНО:
graphify claude install  # создаёт bash-хуки → exit 1 в PowerShell

# ПРАВИЛЬНО:
cmd /c graphify update .          # обновить граф
cmd /c graphify query "вопрос"    # запросить граф
# или полный путь:
"C:/Users/user/AppData/Local/Programs/Python/Python311/Scripts/graphify.exe" update .
```

### git в хуках (git root = C:\)
```javascript
// Весь диск C: — один git-репо. git status без ограничений = весь C:!
// ПРАВИЛЬНО:
execSync('git diff HEAD -- .', { cwd: input.cwd })   // -- . ограничивает к CWD
execSync('git status -- .', { cwd: input.cwd })
```

### Stop vs PreToolUse формат вывода
```javascript
// Очень легко перепутать! PreToolUse:
{ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: '...' } }

// Stop (ДРУГОЙ формат):
{ decision: 'block', reason: '...' }
```

---

## Тестирование

### Три уровня тестов

```bash
# 1. Sanity — exit 0 + valid JSON для всех 26 хуков Claude Code
node ~/.claude/hooks/test-all-hooks.js

# 2. Codex sync — все 25 хуков в codex hooks.json работают
node ~/.codex/test-codex-hooks.js

# 3. Behavioral — реальные BLOCK/ALLOW решения (29 сценариев)
node ~/.claude/hooks/test-hooks-behavior.js
```

### Как добавить behavioral тест

```javascript
// В test-hooks-behavior.js:

// Тест BLOCK/ALLOW:
test(
  'BLOCK: описание',
  'hook-name.js',
  { tool_name: 'Bash', tool_input: { command: '...' }, cwd: '/project' },
  true,          // expectDenied: true = ожидаем DENY
  'keyword'      // ожидаем это слово в сообщении (опционально)
);

// Тест SILENT (для PostToolUse хуков без вывода):
testSilent(
  'SILENT: описание',
  'hook-name.js',
  { tool_name: 'Edit', tool_input: { file_path: 'src/a.ts' }, cwd: '/project' }
);

// Тест Stop хука:
testStop(
  'APPROVE: описание',
  'ship-gate.js',
  { cwd: os.tmpdir(), sessionId: 'test' },
  true   // expectApprove: true
);
```

---

## Добавление нового хука

### Шаги

1. **Создать файл** `~/.claude/hooks/my-hook.js`:
```javascript
#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const metrics = require('./lib/metrics');

metrics.inc('my-hook', 'fired');

// Читаем stdin
let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = (input && input.cwd) ? input.cwd : process.cwd();

// Логика...

// Советуем (PostToolUse/SessionStart):
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { additionalContext: 'Сообщение' }
}));

// Блокируем (PreToolUse):
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'Причина' }
}));

process.exit(0);
```

2. **Добавить в settings.json** (Claude Code + Antigravity):
```json
{
  "matcher": "Edit|Write",
  "hooks": [{ "type": "command", "command": "node \"C:/Users/user/.claude/hooks/my-hook.js\"" }]
}
```

3. **Добавить в ~/.codex/hooks.json** (Codex, без кавычек вокруг пути):
```json
{
  "matcher": "Edit|Write",
  "hooks": [{ "type": "command", "command": "node C:/Users/user/.claude/hooks/my-hook.js" }]
}
```

4. **Добавить в test-all-hooks.js** (массив HOOKS):
```javascript
['my-hook.js', 'edit', 'PreToolUse Write|Edit: описание'],
```

5. **Запустить тесты**:
```bash
node ~/.claude/hooks/test-all-hooks.js
node ~/.codex/test-codex-hooks.js
```

### Правила хука
- Всегда `metrics.inc(name, 'fired')` в начале
- Всегда читать `cwd` из `input.cwd`, не из `process.cwd()`
- Таймаут обработки: 5 секунд (Claude Code убивает хук)
- Silent exit (exit 0 без stdout) = разрешить
- Не бросать исключения — обернуть в try/catch

---

## Shared Infrastructure

### lib/metrics.js
```javascript
const metrics = require('./lib/metrics');
metrics.inc('hook-name', 'fired');    // обычный вызов
metrics.inc('hook-name', 'blocked'); // когда блокирует
metrics.inc('hook-name', 'warned');  // когда предупреждает
// Данные → ~/.claude/hooks/metrics.json
// Просмотр: node ~/.claude/hooks/hook-stats.js
```

### lib/logger.js
```javascript
const logger = require('./lib/logger');
logger.error('hook-name', 'Описание ошибки', { context: 'данные' });
// Данные → ~/.claude/hooks/errors.log (append-only)
// Просмотр: node ~/.claude/hooks/hook-stats.js --errors
```

### lib/config.js
```javascript
const cfg = require('./lib/config');
const warnAt = cfg.editEnforcer.warnAt;  // читает config.json
```

---

*Полный план оптимизации: `ZERO_WASTE_CONTEXT_PLAN.md`*
*Тесты: `test-all-hooks.js`, `~/.codex/test-codex-hooks.js`, `test-hooks-behavior.js`*
