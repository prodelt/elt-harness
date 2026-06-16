# Checkpoint - 2026-06-12 12:32

## Тема
Системная причина «пайплайн не работает / токены жрутся»: графы всех проектов забиты node_modules + раздутый MCP-слой в системном промпте.

### Build Status
- Compiles: n/a (правка одного хука .js)
- Lint: n/a
- Type check: n/a
- `node --check project-bootstrap-advisor.js`: **PASS**
- `node tools/doctor.js`: **PASS=34 WARN=4 FAIL=0**

### Test Metrics
- Хук-smoke: silent-exit на не-проекте ✓; ensureGitignore — `.gitignore exists: true, has node_modules/: true` ✓
- Граф (MCP codegraph_status, проба): Top5 2751→41, Morion C: →26, Morion D: →22, Garvis →315, Izi tracker →271, tg_bot →47

### Code Modifications Since Last Checkpoint
- Создано: `~/.claude.json.bak-*` (бэкап), `.gitignore` в 14 проектах Ametrin (где отсутствовал/неполный)
- Изменено: `~/.claude.json` (убраны MCP chrome-devtools+context7, claudeInChromeDefaultEnabled→false); `~/.claude/hooks/project-bootstrap-advisor.js` (+ensureGitignore перед codegraph init; путь bootstrap в payload → bootstrapScript())
- Память: `memory/project_codegraph_stale_node_modules_2026-06-12.md` + индекс MEMORY.md (строка не добавлена — см. Remaining)

### Git State
- Repo (Pipeline setupper): branch `amos/sprint1-kernel`; uncommitted: 1 M + 1 ?? (планнинг-handoffs, не относятся к задаче); last `1159d57`
- Config repo (~/.claude): `M hooks/project-bootstrap-advisor.js` — НЕ закоммичен

### Completed Tasks
- MCP-чистка системного промпта (chrome-devtools/context7/claude-in-chrome) — elt
- Нормализация графов 14 проектов в C:/ + D:/Ametrin projects (.gitignore + index --force) — elt
- Системный фикс: авто-.gitignore в bootstrap-advisor перед индексацией — elt
- Memory-запись об открытии — elt

### Remaining Work
- Закоммитить правку `~/.claude/hooks/project-bootstrap-advisor.js` в конфиг-репо — pending (нужен явный запрос)
- Добавить строку в `MEMORY.md` Активное (Edit упёрся в read-gate ранее) — pending
- Top5_sales: `git init` (нет .git → хуки/AMOS молча пропускают шаги) — на решении пользователя
- connectors claude.ai (Law/Supabase/Indeed/Gmail/Calendar/Drive) — отключены пользователем через /mcp в этой сессии; проверить что не вернулись

### Blockers
- Нет. Эффект MCP-чистки на токены проявится со СЛЕДУЮЩЕЙ сессии (системный промпт собирается на старте).

### Next Steps
1. По запросу — закоммитить hook-фикс в ~/.claude (`git add hooks/project-bootstrap-advisor.js`)
2. Top5_sales `git init` если нужен полный пайплайн
3. Проверить токены на старте новой сессии (должны упасть)
