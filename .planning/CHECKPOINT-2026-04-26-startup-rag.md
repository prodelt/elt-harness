# Checkpoint 2026-04-26 — Startup Optimization + RAG Ingest

## Commit: 4427604 | Branch: feature/s11-task-43-init-project-upgrade-mode

## Что сделано в этой сессии

### Startup Token Optimization
- `skillListingMaxDescChars`: 512 → 120 в `~/.claude/settings.json`
  → экономия ~9KB (~2.3K токенов) каждый старт
- **Диагноз startup payload** (из audit JSONL):
  - Старый офендер: `vercel@claude-plugins-official` inject-claude-md.mjs = 48KB — УЖЕ отключён
  - Текущий startup: 31KB (не 96KB как раньше)
  - Браузерные плагины в `settings.local.json` = 9.7KB deferred_tools_delta (pending решение)
  - skill_listing был 13.6KB → теперь меньше после изменения maxDescChars

### RAG Ingest (W10-07)
- Удалили старый index (1024-dim mxbai → несовместим с Google 3072-dim)
- `.env` файл с GOOGLE_API_KEY создан в корне проекта
- **Pipeline ingest запущен**: 24 чанка embedded, 5 entities, LLM cache 642KB
  - gemma4:e4b работает (CPU offload: 2.2GB VRAM + 7.4GB RAM) — медленно но работает
  - Статус: IN PROGRESS (фоновый процесс)

## Что осталось

### W10-07 (текущий)
- [ ] Дождаться завершения pipeline ingest
- [ ] Запустить 3+ test queries для pipeline
- [ ] Ingest для izi-tracker, law-assistant, sudoviy-master

### Startup Optimization (✅ done)
- [x] Browser plugins отключены в settings.local.json (saves 9.7KB)
  - `chrome-devtools-mcp`, `playwright`, `firecrawl` → false
  - Включить обратно: поставить true в settings.local.json когда нужна browser automation

### W10-08
- [ ] 10-question comparison table (RAG vs без RAG)

### W10-09
- [ ] Обновить global route policy

## First Commands следующей сессии

```bash
# 1. Проверить статус pipeline ingest
python -c "
import json, os
idx = r'C:\Claude playground\Pipiline setupper\.rag\index'
vdb = os.path.join(idx, 'vdb_chunks.json')
ents = os.path.join(idx, 'vdb_entities.json')
with open(vdb) as f: chunks = len(json.load(f).get('data',[]))
with open(ents) as f: entities = len(json.load(f).get('data',[]))
print(f'chunks: {chunks}, entities: {entities}')
"

# 2. Если ingest завершён — test queries
cd "/c/Claude playground/Pipiline setupper"
export $(grep GOOGLE_API_KEY .env | tr -d '\r')
python tools/rag-ingest.py --query "что такое Pipeline-setupper" --project pipeline
python tools/rag-ingest.py --query "как работают хуки" --project pipeline --mode global
python tools/rag-ingest.py --query "loop-guardian порог" --project pipeline --mode local

# 3. Если нужен повторный запуск ingest
python tools/rag-ingest.py --project pipeline 2>&1 | grep -E "DONE|ERROR|entities|Completed|\[INGEST\]"

# 4. Следующие проекты
python tools/rag-ingest.py --project izi-tracker
python tools/rag-ingest.py --project law-assistant
python tools/rag-ingest.py --project sudoviy-master
```

## Важные находки

- **GOOGLE_API_KEY**: хранится в `.env` в корне проекта, НЕ в коде
  - Загрузка: `export $(grep GOOGLE_API_KEY .env | tr -d '\r')`
  - Прямой инлайн в команде блокируется secret-scanner хуком
- **gemma4:e4b timeout**: модель медленная на CPU — timeout=300s в rag-ingest.py достаточно
- **Startup 31KB** (текущее) = skill_listing(13.6KB) + deferred_tools(9.7KB) + NEXT_SESSION_PROMPT(4.1KB) + hooks(1.5KB)
