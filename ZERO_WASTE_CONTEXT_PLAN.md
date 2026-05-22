# Zero-Waste Context Architecture — Повний план
_Дата: 2026-04-16 | Автор: Аудит сесії_

---

## Контекст: чому виник цей план

Аудит від 2026-04-16 виявив що попередній Score 82/100 був за написаний код, не за реальну ефективність.

**Реальний Score після аудиту: ~42/100**

Ключові проблеми:
- При старті Python-проєкту (sudoviy) вантажиться ~82k токенів — 57k з них tool definitions від плагінів які не потрібні
- graphify advisory ігнорується Claude у ~90% випадків
- lib/metrics.js і lib/logger.js написані але жоден хук їх не використовує
- post-edit-combined.js використовує exit(2)+stderr замість JSON stdout (ломає Codex)
- stop-verification.js має баг git diff HEAD без -- . (видить весь C:\ repo)
- /pipeline = markdown шпаргалка, не оркестратор
- Codex hooks.json має невідповідності (TaskCompleted, Skill matcher)

---

## Причини 70k+ токенів при старті (Breakdown)

| Джерело | Токени | Статус |
|---------|--------|--------|
| claude-in-chrome (32 tools) | ~12,800 | Зайве в Python/Node проєктах |
| chrome-devtools-mcp (30 tools) | ~12,000 | Зайве в Python/Node проєктах |
| playwright (25 tools) | ~10,000 | Зайве в Python/Node проєктах |
| Core Claude tools (20) | ~8,000 | Потрібно |
| supabase, github, firecrawl | ~9,600 | Частково потрібно |
| ukraine-laws, Law_MCP | ~3,000 | Тільки для legal проєктів |
| System prompt base | ~10,000 | Фіксовано |
| global CLAUDE.md + rules.md | ~2,200 | Можна скоротити |
| global MEMORY.md | ~2,100 | Можна скоротити |
| project CLAUDE.md | ~2,000 | Можна скоротити |
| SessionStart hooks × 4 | ~1,600 | Можна скоротити |
| settings.local.json (накопичений) | ~1,500 | Очищати регулярно |
| MCP server instructions | ~1,500 | Частково фіксовано |
| Deferred tools names list | ~1,500 | Фіксовано |
| Skills listing | ~500 | Фіксовано |
| **РАЗОМ** | **~82,300** | |

**Головна причина:** 10 включених плагінів = 57k tokens tool definitions — більшість непотрібні для конкретного проєкту.

---

## Знайдені баги (потрібно пофіксити ПЕРЕД новими фічами)

### BUG-1: post-edit-combined.js — неправильний формат (КРИТИЧНО, ломає Codex)
- **Файл:** `~/.claude/hooks/post-edit-combined.js:110-111`
- **Проблема:** `process.exit(2) + stderr` замість JSON stdout з `additionalContext`
- **Фікс:** Замінити на `process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: messages.join(' | ') } })); process.exit(0);`

### BUG-2: stop-verification.js — git scope баг
- **Файл:** `~/.claude/hooks/stop-verification.js:25`
- **Проблема:** `git diff --name-only HEAD` без `-- .` → бачить весь C:\ repo
- **Фікс:** `git diff --name-only HEAD -- .`

### BUG-3: domain-agent-gate.js — хардкод шляху graphify
- **Файл:** `~/.claude/hooks/domain-agent-gate.js:129`
- **Проблема:** `const GRAPHIFY_BIN = 'C:/Users/espad/...'` — зламається при зміні шляху
- **Фікс:** Читати з config.json або шукати в PATH

### BUG-4: lib/metrics.js — мертвий код
- **Проблема:** Написаний але жоден хук не робить `require('./lib/metrics')`
- **Фікс:** Або додати metrics.inc() в кожен хук, або видалити

### BUG-5: lib/logger.js — мертвий код
- **Проблема:** Написаний але не використовується
- **Фікс:** Або додати в хуки, або видалити

### BUG-6: Codex hooks.json — невідповідності
- **Файл:** `~/.codex/hooks.json`
- **Проблема 1:** Є `TaskCompleted` event якого немає в Codex API
- **Проблема 2:** Є `Skill` matcher якого немає в Codex (Skill — концепція тільки Claude Code)
- **Проблема 3:** Відсутній `FileChanged` event (env-change-watcher не запускається)
- **Фікс:** Видалити TaskCompleted і Skill matcher з Codex hooks.json; прийняти що FileChanged в Codex не підтримується

### BUG-7: graphify-preuse.js — advisory ігнорується
- **Проблема:** `additionalContext` = порада яку Claude ігнорує у ~90% випадків
- **Фікс:** Sprint B — перетворити на blocking hook (graphify-read-gate.js)

---

## ПЛАН СПРИНТІВ

---

### Sprint A0 — ENABLE_TOOL_SEARCH (5 хвилин, -85% tokens від плагінів)
**Пріоритет: 0 — РОБИТИ ПЕРШИМ, найвищий ROI, 5 хвилин**
**Час: 5 хв | Економія: -35-50k tokens при кожному старті**

**Офіційний механізм** (Claude Code ≥2.1.7, Anthropic docs підтверджено):
- `ENABLE_TOOL_SEARCH: "auto:10"` в `~/.claude/settings.json` env секції
- MCP tool schemas НЕ вантажаться в context при старті сесії
- Claude використовує `ToolSearch` on-demand коли потрібен конкретний tool
- Знижує tool definitions з ~57k до ~1.5k tokens (вже deferred tools видно в системному рем'айндері)

**Задачі:**
- [ ] A0-1: Додати в `~/.claude/settings.json` → `env`:
  ```json
  "ENABLE_TOOL_SEARCH": "auto:10"
  ```
- [ ] A0-2: `.claudeignore` в кожному Python-проєкті:
  ```
  # Не давати читати великі data/output директорії
  graphify-out/wiki/
  output/
  dist/
  __pycache__/
  *.pyc
  ```
- [ ] A0-3: `.claudeignore` в Next.js проєктах:
  ```
  .next/
  node_modules/
  dist/
  graphify-out/wiki/
  ```
- [ ] A0-4: Виміряти токени ДО і ПІСЛЯ (просто відкрити судовий проєкт і порахувати з системного prompt)

**Важливо:** Після увімкнення — плагіни (playwright, chrome-devtools, etc.) залишаться активними але схеми tool definitions не завантажаться автоматично. Коли реально потрібен browser tool — Claude сам зробить ToolSearch.

**Розрахунок:**
```
До: 82k tokens (sudoviy)
Після A0: ~30-35k tokens (plugin schemas deferred)
Ще після A+C: ~18-22k tokens
```

---

### Sprint E — Metrics & Observability Foundation
**Пріоритет: 1 (робити першим — без метрик не виміряти ефект)**
**Час: 2 год**

**Задачі:**
- [ ] E1: Додати `metrics.inc(hookName, 'fired')` на початок кожного хука (24 хуки)
- [ ] E2: Додати `metrics.inc(hookName, 'warned')` при кожному попередженні
- [ ] E3: Додати `metrics.inc(hookName, 'blocked')` при кожному блокуванні
- [ ] E4: `session-token-estimator.js` — новий SessionStart хук:
  - Підраховує розмір усіх файлів які вантажаться
  - Виводить estimate: "~82k tokens loaded this session (57k = plugins)"
- [ ] E5: hook-stats.js — додати колонку "tokens_saved" (graphify blocks × avg saved)
- [ ] E6: Оновити test-all-hooks.js для нових хуків

**Результат:** hook-stats.js покаже реальні цифри. Можна вимірювати кожен наступний Sprint.

---

### Sprint A — Per-Project Plugin Profiles
**Пріоритет: 2 (найбільший ROI по токенах)**
**Час: 2-3 год | Економія: -35-40k tokens при кожному старті Python/Node проєкту**

**Механіка:** Project-level `.claude/settings.json` overrides глобальний settings.json

**Задачі:**
- [ ] A1: Дослідити чи справді project-level settings може відключати enabledPlugins
- [ ] A2: Створити plugin profiles:
  - `profiles/python.json` — вимкнути: playwright, chrome-devtools-mcp, claude-in-chrome, supabase, frontend-design, typescript-lsp, firecrawl
  - `profiles/nextjs.json` — вимкнути: claude-in-chrome, ukraine-laws, Law_MCP
  - `profiles/node-api.json` — вимкнути: playwright, chrome-devtools-mcp, claude-in-chrome, frontend-design
  - `profiles/legal.json` — вимкнути: playwright, chrome-devtools, frontend-design, supabase
- [ ] A3: Розгорнути профілі:
  - sudoviy master try 3 → python.json
  - tg_bot_reclamaties → python.json
  - Ametrin website → nextjs.json
  - ELT Studio → nextjs.json
  - Law assistant → legal.json
- [ ] A4: `settings-local-cleanup.js` — новий SessionStart хук:
  - Якщо settings.local.json > 2KB → очистити entries старше 14 днів
  - Зберегти тільки permanent permissions (не одноразові Bash команди з довгими regex)
- [ ] A5: Документувати в CLAUDE.md як додавати новий проєкт

**Розрахунок:**
```
До: 82k tokens (судовий бот)
Після: ~42k tokens
Економія: -40k tokens × 10 сесій/тиждень = -400k/тиждень
```

---

### Sprint B1 — Bug Fixes (критичні)
**Пріоритет: 3 (фіксуємо що зламано)**
**Час: 1-2 год**

**Задачі:**
- [ ] B1-1: Фіксуємо `post-edit-combined.js` — exit(2)+stderr → JSON stdout
- [ ] B1-2: Фіксуємо `stop-verification.js` — додаємо `-- .` до git diff
- [ ] B1-3: Фіксуємо `domain-agent-gate.js` — graphify path з config або автодетект
- [ ] B1-4: Фіксуємо Codex hooks.json — видалити TaskCompleted, Skill matcher
- [ ] B1-5: Вирішити долю metrics.js та logger.js (або підключити всюди, або видалити)
- [ ] B1-6: Запустити test-all-hooks.js після всіх фіксів — має бути 24/24 PASS

---

### Sprint B2 — Graphify Hard Enforcement
**Пріоритет: 4 (найбільша економія в сесії)**
**Час: 3-4 год | Економія: 50-70% від file reads в сесії**

**Механіка:** При Read(file) де файл > 50 рядків і graphify-out/graph.json існує → DENY + підказка query

**Логіка хука `graphify-read-gate.js`:**
```javascript
// PreToolUse: Read
// Якщо: cwd має graphify-out/graph.json
//   AND file_path > 50 рядків (кеш розмірів файлів)
//   AND file не в whitelist (CLAUDE.md, configs, невеликі файли)
//   AND graphify --version доступний
// → DENY з підказкою: "Use: cmd /c graphify query '<що шукаєш>'"
// + вказати схожі команди для типових запитів
```

**Задачі:**
- [ ] B2-1: `graphify-read-gate.js` — новий PreToolUse:Read хук з DENY
- [ ] B2-2: Кеш розмірів файлів у tmpdir (оновлюється при SessionStart) для швидкої перевірки
- [ ] B2-3: Whitelist: CLAUDE.md, AGENTS.md, MEMORY.md, config файли, файли < 50 рядків
- [ ] B2-4: Fallback: якщо graphify бінарник недоступний → allow з warning
- [ ] B2-5: Перевірка що файл є в graphify (перевірити через graph.json nodes список)
- [ ] B2-6: Smart bypass: якщо юзер написав "read file X" → allow (user intent overrides)
- [ ] B2-7: Додати до settings.json matcher: `"PreToolUse": Read`
- [ ] B2-8: Додати до Codex hooks.json
- [ ] B2-9: Тестування на sudoviy та tg_bot проєктах

**Розрахунок:**
```
Типова сесія sudoviy: ~50 Read × avg 3,000 tokens = 150k tokens
З graphify blocking: ~10 Read (дрібні файли) × 3k + 40 graphify queries × 1.5k = 90k
Економія: -60k tokens за сесію
```

---

### Sprint C — Context Compression
**Пріоритет: 5**
**Час: 2-3 год | Економія: -12-15k tokens baseline**

**Задачі:**
- [ ] C1: Компрес global CLAUDE.md → максимум 30 рядків:
  - Тільки: посилання на rules.md + 3 критичних gotchas
  - Видалити дублювання з rules.md
- [ ] C2: MEMORY.md auto-discipline:
  - SessionStart хук перевіряє розмір MEMORY.md
  - При > 80 рядків → inject: "MEMORY OVERFLOW: архівуй старі записи перед продовженням"
  - При > 100 рядків → BLOCK + обов'язковий /learn
- [ ] C3: SessionStart hooks lacy mode:
  - graphify-session-init: якщо граф < 2h old → одна коротка стрічка (не блок тексту)
  - project-docs-gate: тільки critical warnings (не advisory)
  - autoskills-check: пропускати якщо CLAUDE.md є і не порожній
  - session-focus-gate: скорочений output
- [ ] C4: settings.local.json auto-purge хук (вже описано в A4)
- [ ] C5: Перевірити розмір project CLAUDE.md усіх проєктів → очистити застарілі секції

---

### Sprint D — Pipeline v2: Real Orchestrator
**Пріоритет: 6**
**Час: 4-5 год | Якість роботи: +40%**

**Проблема:** /pipeline = текстовий checklist. Claude читає і часто ігнорує.

**Рішення:** Pipeline SKILL що:
1. Читає CLAUDE.md проєкту (stack, gotchas)
2. Читає git status (скільки файлів змінено)
3. Аналізує промпт юзера
4. Генерує **персоналізований** план замість generic checklist
5. Автоматично викликає перший потрібний скілл

**Задачі:**
- [ ] D1: Новий `pipeline/SKILL.md` що інструктує Claude:
  - Крок 1: Read CLAUDE.md → визначити stack
  - Крок 2: `git status -- .` → порахувати файли
  - Крок 3: Класифікувати (TRIVIAL/MEDIUM/COMPLEX) з конкретними критеріями
  - Крок 4: АВТОМАТИЧНО викликати потрібний скілл (не чекати юзера)
- [ ] D2: Tailored checklists per stack:
  - Python: pytest + ruff кроки
  - Next.js: TypeScript check + Lighthouse кроки
  - Node API: zod validation check + security review кроки
- [ ] D3: Pipeline auto-агентинг:
  - При COMPLEX → `Skill("architect-first")` вже в тілі SKILL.md
  - При 3+ Python файлів → spawn code-reviewer(haiku) автоматично
  - При auth/security файлах → spawn security-reviewer(sonnet) автоматично
- [ ] D4: `pipeline-tracker.js` розширення:
  - Зберігати яку складність визначив pipeline
  - Зберігати які скілли були викликані після
  - hook-stats.js показує pipeline usage stats
- [ ] D5: Тестування на реальних задачах (sudoviy + tg_bot)

---

### Sprint F — Cross-Tool Sync
**Пріоритет: 7**
**Час: 1-2 год**

**Задачі:**
- [ ] F1: Синхронізувати Codex hooks.json після всіх змін (Sprint B1, B2, C, D)
- [ ] F2: Перевірити Antigravity settings.json читає всі нові хуки
- [ ] F3: Оновити AGENTS.md (Codex) і GEMINI.md (Antigravity) з новою архітектурою
- [ ] F4: test-all-hooks.js — фінальний прогін після всіх спринтів
- [ ] F5: README.md — документація для нових хуків

---

## Загальна карта економії токенів

```
                    ЗАРАЗ    ПІСЛЯ A+B2+C    ЕКОНОМІЯ
Старт сесії:         82k        22-28k         -67%
Типова сесія:        300k       90-120k        -65%
Тиждень (10 сесій):  3M         0.95M          -68%
Рік (500 сесій):     150M       48M            -68%
```

---

## Порядок виконання

```
Sprint A0 (ENABLE_TOOL_SEARCH) ← 5 хвилин, -85% plugin tokens ЗАРАЗ
  ↓
Sprint E (metrics baseline) ← вимірюємо ефект A0 та встановлюємо baseline
  ↓
Sprint A (plugin profiles) ← додатковий контроль per-project
  ↓
Sprint B1 (bug fixes) ← фіксуємо зломане
  ↓
Sprint B2 (graphify blocking) ← найбільша економія токенів в сесії
  ↓
Sprint C (compression) ← полірування
  ↓
Sprint D (pipeline v2) ← якісне покращення
  ↓
Sprint F (cross-tool sync) ← завершення
```

---

## Цільовий Score після всіх спринтів

| Модуль | Зараз | Ціль |
|--------|-------|------|
| graphify integration | 3/10 | 9/10 |
| metrics/observability | 0/10 | 8/10 |
| token efficiency | 2/10 | 9/10 |
| bug-free hooks | 5/10 | 10/10 |
| /pipeline effectiveness | 5/10 | 8/10 |
| cross-tool consistency | 6/10 | 9/10 |
| **Загальний** | **~42/100** | **~88/100** |

---

## Файли що будуть створені/змінені

### Нові файли:
- `~/.claude/hooks/session-token-estimator.js`
- `~/.claude/hooks/graphify-read-gate.js`
- `~/.claude/hooks/settings-local-cleanup.js`
- `~/.claude/hooks/profiles/python.json`
- `~/.claude/hooks/profiles/nextjs.json`
- `~/.claude/hooks/profiles/node-api.json`
- `~/.claude/hooks/profiles/legal.json`
- Per-project `.claude/settings.json` в 5 проєктах

### Змінені файли:
- `~/.claude/hooks/post-edit-combined.js` (BUG-1)
- `~/.claude/hooks/stop-verification.js` (BUG-2)
- `~/.claude/hooks/domain-agent-gate.js` (BUG-3)
- `~/.claude/hooks/graphify-preuse.js` (advisory → посилання на read-gate)
- `~/.claude/hooks/test-all-hooks.js` (нові тести)
- `~/.claude/hooks/hook-stats.js` (tokens_saved колонка)
- `~/.claude/skills/pipeline/SKILL.md` (v2 orchestrator)
- `~/.codex/hooks.json` (видалити TaskCompleted, Skill matcher)
- `~/.claude/CLAUDE.md` (compression)
- `~/.claude/settings.json` (додати Read matcher для graphify-read-gate)

---

## Відкриті питання (потребують перевірки)

1. **Чи підтримує project-level settings.json відключення enabledPlugins?** — потрібно перевірити офіційну документацію Claude Code. Якщо ні — альтернатива: скрипт який модифікує глобальний settings.json при відкритті конкретного проєкту.

2. **graphify-read-gate threshold:** 50 рядків може бути занадто агресивним. Можливо краще 100 рядків або перевіряти чи файл є в nodes graphify.

3. **Deferred tools:** Частина tools вже deferred (не вантажаться в context). Потрібно перевірити чи chrome-devtools/playwright deferred чи ні.

4. **Codex FileChanged event:** Чи підтримує Codex FileChanged? Якщо ні — env-change-watcher треба видалити з Codex hooks.json.

---

_Версія: 1.0 | Наступний огляд після Sprint E_
