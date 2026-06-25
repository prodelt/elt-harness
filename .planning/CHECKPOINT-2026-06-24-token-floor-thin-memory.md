## Checkpoint - 2026-06-24

### Что сделано (token-floor диагностика + тонкая память без claude-mem)
- **Диагноз:** корень «лимит с 3 запросов» = старт-floor ~67k токенов/сессия (vanilla ~20k, ×3),
  пере-читается каждый ход; множители Opus (×5) + effort high + длинные сессии. Не плагины (~3%).
- **settings.json:** model→sonnet (юзер вернул opus вручную — ОК), effort high→medium,
  MAX_THINKING_TOKENS 4000→2000, **claude-mem OFF**, ponytail ON. UserPromptSubmit-хук подключён.
- **checkpoint/SKILL.md v1.2:** вырезаны AMOS-остатки (Cost Snapshot, amos.js cost, dead auto-trigger).
- **context-autocompact-guard.js** (НОВЫЙ, standalone, без AMOS-deps): warn 120k/crit 144k,
  читает реальные токены из транскрипта. Тест 50k/130k/150k ✅. **Live-fire @77% ✅** (сработал в проде).
- **elt-code v0.5.0 Шаг 5:** обязательный closeout (авто-commit без показа диффа + доки/MEMORY + /checkpoint).
- **CLAUDE.md:** добавлена секция Project Map (codegraph как источник деталей).

### Git State
- Branch: feature/doc-hygiene-phase2
- Изменения репо: M CLAUDE.md (Project Map) + предсуществующие .planning/* , PLAYBOOK.md, tools/* (не мои).
- Глобальные правки (~/.claude/hooks, skills, settings) — вне git этого репо.

### Архитектура памяти (без claude-mem) — 3 дешёвых слоя
1. codegraph = структура (авто-watcher, codegraph_context, НЕ генерить mapping-файл)
2. MEMORY.md + memory/*.md = durable-знание (наполняется elt-code Шаг 5)
3. handoff-цепочка = continuity (guard → precompact-handoff → resume-handoff)

### Remaining Work / опционально
- Рестарт Claude Code чтобы подхватить хук/плагины (частично уже подхватилось — guard работает).
- Опц.: срезать floor дальше — отключить редкие плагины (skill-creator, claude-code-setup).
- На Opus лимит снова жжётся ×5 — если это не разовая тяжёлая сессия, вернуть sonnet.

### Resume Pointer
- Focus: система «тонкой памяти» собрана и проверена live; floor-диагностика закрыта.
- Resume: если продолжать оптимизацию floor — `/elt-code "срезать floor: отключить редкие плагины"`;
  иначе система готова к работе.
