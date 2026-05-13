---
name: session-harvest
description: Собирает cross-session briefing из JSONL логов за N дней. Триггерится SessionStart хуком при устаревании latest.md >24h. Продуцирует ≤500-токеновый markdown для автоматического handoff между сессиями.
version: 1.0.0
type: infrastructure
requires: []
changelog:
  - 1.0.0 (2026-04-21): initial release — 5 секций (проекты, риски, ошибки, trend, handoff)
---

## Trigger
- `/harvest [days]` — ручной запуск (default 7 дней)
- SessionStart автоматически через `harvest-injector.js`, если `latest.md` старше 24h
- Weekly-analysis (Task 23) вызывает `harvest.js 30` раз в неделю

## Output

Файл `~/.claude/session-harvest/latest.md` содержит:
1. **Активные проекты** — top-5 по количеству сессий за окно
2. **Компакт риск** — количество сессий >1MB (compaction loss ожидается)
3. **Top errors (7d)** — из `~/.claude/hooks/errors.log`
4. **Handoff hint** — последний focus последнего активного проекта
5. **Token trend** — изменение avg_kb за window vs предыдущее окно

## Steps

```bash
# Ручной
node ~/.claude/skills/session-harvest/harvest.js 7

# Проверить результат
cat ~/.claude/session-harvest/latest.md

# Auto: harvest-injector.js при SessionStart читает latest.md если <24h
```

## Success Criteria
- Файл `latest.md` существует и <2000 байт
- Содержит все 5 секций выше
- Генерация за <5s на 50+ JSONL файлах
- Не падает при пустой `~/.claude/projects/` (первая установка)
- Не падает при отсутствии `errors.log`

- If any predicate cannot be verified, return `success: false` with `remaining_work` and the blocking reason.

- Final response includes proof/evidence for each checked predicate, including exact command names when commands are used.

## Integration points
- SessionStart: `~/.claude/hooks/harvest-injector.js` инжектит в контекст
- Stop: `~/.claude/hooks/stop-auto-checkpoint.js` дополняет last.md если был coding-session
- `~/.claude/hooks/projects-dashboard.js` — использует те же парс-функции для dashboard

## Failure modes
- JSONL повреждён → парсер skip строку, продолжает (safe())
- errors.log не существует → пустая секция
- Нет сессий за N дней → отдельное сообщение вместо пустого файла
- Права доступа → логирует в errors.log, не блокирует SessionStart

## Maintenance
- Если формат JSONL изменится (Claude Code update) — проверить `parseSession()` в harvest.js
- При добавлении новых типов событий (не user/assistant) — игнорировать безопасно
