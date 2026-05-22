# Pipeline Efficiency Audit — 2026-05-06

## Диагностированные баги

### BUG-1 ✅ ИСПРАВЛЕНО — Graphify сообщает "0 edges" при 21 463 реальных рёбрах

**Симптом:** SessionStart показывает `GRAPHIFY ACTIVE: 10731 nodes, 0 edges`  
**Причина:** `graphify-session-init.js:82` читал `graph.edges`, но graph.json хранит рёбра под ключом `links` (networkx формат). Всегда `undefined → 0`.  
**Исправление:** `graph.links || graph.edges || []` — применено.  
**Влияние:** top-god-nodes тоже не вычислялись → подсказки "Key nodes" не показывались.

---

### BUG-2 — Graphify индексирует не ту директорию

**Симптом:** `graphify query "edit-enforcer"` возвращает файлы из `audit/S11_pipeline_top1/hooks/`, а не из `~/.claude/hooks/`.  
**Причина:** Граф построен в `C:\Claude playground\Pipiline setupper\graphify-out\graph.json` и покрывает весь Pipeline Setupper проект. Реальные хуки живут в `C:\Users\espad\.claude\hooks\` — за пределами этого репо.  
**Следствие:** Все рекомендации graphify-read-gate ("используй graphify вместо Read") бесполезны для работы с хуками в ~/.claude/ — граф там ничего не знает.  
**Решение:** Либо запустить `graphify update .` прямо из `~/.claude/hooks/` и указывать `--graph` явно, либо переместить хуки в репо. **Пока не исправлено** — требует архитектурного решения.

---

### BUG-3 — update-docs / update-codemaps не создают CODEMAPS в большинстве проектов

**Симптом:** Из 21 проекта только 1 (Taktika_bo-main) имеет `docs/CODEMAPS/`.  
**Причина (вероятная):** `update-codemaps` / `update-docs` — встроенные slash-команды Claude Code, реализованные через `doc-updater` subagent. Они не создают `docs/CODEMAPS` без явного вызова в рабочей директории конкретного проекта. Команды надо запускать **находясь в директории проекта** через `! claude --no-confirm "/update-codemaps"` или вручную.  
**Подтверждение:** CLAUDE.md есть у 20/21 проектов, AGENTS.md у 14/21, CODEMAPS у 1/21.  
**Рекомендация:** Для создания CODEMAPS запустить в каждом проекте:  
```bash
# Из директории проекта
/update-codemaps
/update-docs
```

---

## Анализ эффективности токенов

### Baseline
- **~90K токенов / сессия** (задокументировано)

### SessionStart налог (~800–1200 токенов каждый запуск)
| Хук | Примерный вес | Необходимость |
|-----|--------------|---------------|
| RAG context inject | ~500 tokens | Нужен |
| graphify stats | ~150 tokens | Нужен (теперь корректный) |
| memory-discipline | ~50 tokens | Нужен |
| project-docs-gate | ~100 tokens | Нужен |
| session-focus-gate | ~200 tokens | Нужен |
| harvest-injector | ~200 tokens | Частично нужен |
| **Итого** | **~1200 tokens** | — |

### Главный шумовой хук — graphify-read-gate

**За 7 дней (W19):** 45+ срабатываний ADVISE на одни и те же файлы:  
- `test-all-hooks.js` — 11× предупреждений  
- `page.tsx` — 10× предупреждений  
- `MeetingDetailsSheet.tsx` — 4×  

Хук срабатывает при каждом Read файла >80 строк и добавляет advisory в контекст. При работе над izi-tracker это создаёт спам т.к. компоненты 100–300 строк читаются многократно за сессию. **Экономия при дедупликации:** ~300–500 tokens/сессия.

### memory-discipline
7× блокировок MEMORY.md > 100 строк — MEMORY.md систематически переполняется. Текущее: 82 строки (предупреждение).

### loop-guardian
2 блокировки повторов за неделю (XLSX-обработка в izi-tracker, 6–7× одна команда) — работает корректно.

---

## Эффективность пайплайна

### Что работает хорошо
- **secret-scanner** — блокирует Bearer, OpenAI keys, stripe keys, rm -rf, force push ✅
- **loop-guardian** — ловит бесконечные повторы команд ✅  
- **project-docs-gate** — заблокировал Taktika_bo-main без docs (работает) ✅
- **context7-tracker** — фиксирует вызовы ctx7, 4 fires W19 ✅
- **skill-selector-gate** — ранжирование скилов интегрировано ✅

### Проблемы эффективности

**1. graphify-read-gate — спам без пользы**  
Хук советует "используй graphify query", но граф Pipeline Setupper не покрывает izi-tracker / law-assistant — там нет `graphify-out/`. Совет технически верен только для 1 проекта из 21.  
→ Хук должен проверять, существует ли `graphify-out/graph.json` в CWD перед выдачей advisory.

**2. MEMORY.md overflow — хронический**  
7 блокировок за неделю. Текущий процесс `/learn` вызывается вручную и нерегулярно.  
→ Добавить автоматический триггер `/learn` при >90 строк (сейчас block только при >100).

**3. Отсутствие CODEMAPS в 95% проектов**  
update-docs/update-codemaps никогда не запускались систематически.  
→ Нужен onboarding run для каждого проекта.

**4. graphify-auto-update.js — дебаунс 5 минут**  
При активной работе граф обновляется постоянно (каждые 5 мин), но это ~1–2 сек фонового процесса — приемлемо.

---

## Исправления (приоритет)

| # | Баг / Улучшение | Статус | Файл |
|---|----------------|--------|------|
| 1 | graphify "0 edges" | ✅ ИСПРАВЛЕНО | `graphify-session-init.js` |
| 2 | graphify-read-gate — проверять наличие graphify-out перед advisory | Нужно сделать | `graphify-read-gate.js` |
| 3 | Graphify для ~/.claude/hooks — отдельный граф | Архитектурный вопрос | — |
| 4 | update-codemaps запустить в проектах | Ручной онбординг | — |
| 5 | MEMORY.md — автотриггер /learn при >90 строк | Можно добавить | `memory-discipline.js` |

---

## Команды для проверки

```bash
# Проверить исправление edges
node C:/Users/espad/.claude/hooks/graphify-session-init.js

# Метрики
node ~/.claude/hooks/hook-stats.js
node ~/.claude/hooks/hook-stats.js --errors

# Weekly анализ
node ~/.claude/hooks/weekly-analysis.js

# Graphify — текущий проект (Pipeline Setupper)
cmd /c graphify query "edit-enforcer architecture"
cmd /c graphify query "session-focus-gate"
# Для хуков из ~/.claude нужен отдельный граф:
# cmd /c graphify update . (запустить из C:/Users/espad/.claude/hooks/)
```
