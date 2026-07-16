# S11 — Вердикты по новым инструментам и стратегиям

## 1. zilliztech/claude-context — CONDITIONAL YES

**Решение**: ставить per-project в **Law-assistant** (топ-1 по активности, 34 сессии/нед) → если ROI подтвердится, раскатить на **Izi-tracker** и **sudoviy-master-try-3**.

### Почему не заменяет Graphify
- Graphify — структурный граф (символы, зависимости, AST-based)
- claude-context — семантический embedding (natural-language query)
- Комплементарны, не конкурируют

### Cost
- Voyage AI `voyage-code-3`: ~$0.18 за 1M токенов input
- Кодбаза 50K LOC ≈ 500K токенов → **$0.09 разовый индекс**
- Инкрементал (merkle tree) — центы

### Windows установка (Task 27)
```bash
npm i -g @zilliztech/claude-context-mcp
# Voyage API key в vault → ~/.bashrc:
# export VOYAGE_API_KEY="voy-..."
# затем в /d/Ametrin projects/Law-assistant/.claude/settings.json:
# "mcpServers": { "claude-context": { "command": "npx", "args": ["-y", "@zilliztech/claude-context-mcp"] } }
```

### Почему per-project, не global
- Включать для всех 7 проектов = +300-500 токенов контекста каждую сессию
- Только Law-assistant / Izi-tracker / sudoviy-master стоят overhead (крупные кодбазы)

### Конфликт с хуками
- `graphify-read-gate` может блокнуть большие read в indexed файлах
- **Fix**: добавить исключение в хук: `if (mcpServers.includes('claude-context')) skipBlock()`

### Критерий ROI (решить после спайка)
- Если semantic-search в 5× быстрее `Grep` и возвращает релевантнее → YES, раскатать на Izi + sudoviy
- Если нет → оставить только в Law-assistant или удалить

---

## 2. MCP аудит — финальный вердикт

### KEEP GLOBAL (минимальный overhead, все 5 проектов выигрывают)
- `code-review`
- `github`
- `commit-commands`
- `firecrawl` (web scraping + search, замена WebFetch)
- `skill-creator`
- `typescript-lsp`

### KEEP PER-PROJECT (только где реально нужен)
| Плагин | Проекты |
|--------|---------|
| `vercel` | CV, Izi-tracker (если деплой на Vercel) |
| `supabase` | Izi-tracker, Law-assistant |
| `playwright` | Izi-tracker (E2E тесты) |
| `chrome-devtools-mcp` | временно, при security/perf аудите |
| `frontend-design` | проекты с фронтендом (Izi, CV) |
| `claude-context` | Law-assistant, Izi-tracker (после спайка) |

### REMOVE (уже сделано в S10)
- ✅ `awwwards-web-design`
- ✅ `claude-in-chrome`
- ✅ `context7` плагин (мигрирован на CLI)

### ANTIGRAVITY mcp.json — убрать
- `playwright` — дубликат (Antigravity читает через Claude Code MCP)
- `notebooklm` — специфично для phoenix-ai, перенести в `D:\phoenix-ai\.gemini\mcp.json`

### Ожидаемая экономия
Per-project профили → ~400 токенов/сессию × 20 сессий/неделю = **~8K токенов/неделю сэкономлено**.

---

## 3. Creative UI — замена awwwards

### Вердикт
`frontend-design` плагин (vercel suite) закрывает 80% кейсов.
Для оставшихся 20% (award-level wow-эффект):

**Паттерн**:
1. Пользователь присылает URL с awwwards.com или dribbble.com
2. `firecrawl scrape <url>` — получить HTML/CSS/JS + markdown
3. `reference-design-adaptation` — извлечь design tokens, layout, анимации
4. `frontend-design` — применить к текущему проекту

### НЕ восстанавливать awwwards skill
- Был шумным триггером (работал по ключевому слову)
- Дублировал `frontend-design`
- Удаление правильно, возврат не нужен

### Правило в `~/.claude/rules/rules.md`
```markdown
## UI задачи
- Стандартный dashboard/форма/CRUD → frontend-design
- Clone конкретного reference → reference-design-adaptation + firecrawl
- Award-level creative → reference-design-adaptation с 2-3 awwwards/dribbble URLs
```

---

## 4. SkillAnything — workflow синка

### Проблема
3 инструмента (Claude/Codex/Antigravity) → 3 разных директории скиллов → drift.

### Архитектура

```
~/.claude/skills/ (SINGLE SOURCE OF TRUTH)
      ↓ PostToolUse hook — skill-sync-mirror.js
      ├─→ cp → ~/.codex/skills/<name>/
      │   (drop FileChanged/Notification references — Codex не поддерживает)
      └─→ cp → ~/.gemini/skills/<name>/
          (адаптер: inject category: general если отсутствует)
```

### Auto-install нового скилла через SkillAnything
```bash
# Пользователь обнаружил новый CLI, хочет скилл:
skill-anything /path/to/cli/docs
# → генерирует dist/claude-code, dist/codex, dist/generic
# skill-sync-mirror детектит новые файлы → распределяет
# → обновляет MEMORY.md индекс
```

### Конфликт-резолюция
Если Codex или Antigravity отредактировали свою копию:
- `skill-sync-mirror` детектит drift (hash diff)
- Создаёт `~/.claude/skills/<name>/DRIFT.md` с diff
- **НЕ перезаписывает молча** — просит ревью пользователя

---

## 5. Graphify auto-update

### Проблема
Никто не запускает `cmd /c graphify update .` после коммитов → граф устаревает.

### Решение (Task 25)
PostToolUse[Bash] хук `graphify-post-commit.js`:
```javascript
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
if (!input.tool_input?.command?.match(/^git commit/)) process.exit(0);
if (input.tool_response?.exit_code !== 0) process.exit(0);
const cwd = input.cwd;
require('child_process').spawn('cmd', ['/c', 'graphify', 'update', '.'],
  { cwd, detached: true, stdio: 'ignore' }).unref();
process.exit(0);
```

### Ключевое
`detached + unref` → graphify крутится в фоне, не блокирует сессию.

### Для claude-context (если установлен)
Тот же хук параллельно триггерит incremental re-index через merkle.

---

## 6. depwire/depwire — NO (рано)

**Решение**: не ставить сейчас, мониторить рост до >500 ⭐.

### Почему
- 22 ⭐ — недостаточная зрелость, ранние баги
- TypeScript-first, но не production-tested на наших проектах
- Graphify покрывает структурный анализ, claude-context — семантический
- Добавит ещё один MCP сервер → +200 токенов контекста

### Когда пересматривать
- >500 ⭐ И >6 месяцев существования
- Есть reference кейсы от solo-dev с Windows
- Нет overlap с уже используемым стеком
