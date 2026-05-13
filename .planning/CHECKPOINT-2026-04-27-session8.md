# Checkpoint — S11-session8 (2026-04-27)

## Git state
- Branch: feature/s11-task-43-init-project-upgrade-mode
- HEAD: da283ca fix(rag): robust 429/503 retry
- Tests: 111/111 PASS (32/32 + 37/37 + 42/42) — verified at session start

## Зроблено в цій сесії

### GAP-6 in progress — RAG izi+law індексація
- Діагноз: всі docs мали статус "failed" (LightRAG `filter_keys` пропускає failed docs)
- Root cause 1: `gemini_llm_complete` retry чекав 2/4s, API вимагав 34-60s (429 free tier)
- Root cause 2: `llm_model_max_async=4` флудив 4 паралельні запити → quota flood

### Фікси в tools/rag-ingest.py (commit da283ca)
1. `gemini_llm_complete`: 3→6 retry спроб
2. Парсинг `retryDelay` з API відповіді: `int(float(m.group(1))) + 5` секунд
3. 503/UNAVAILABLE: фіксовані 30s wait
4. `llm_model_max_async`: 4→1 (sequential, не флудить quota)
5. timeout: 60→90s

### Верифікація фіксу
- Перший запуск (стара логіка): `[llm 1/3] retry in 2s` → всі документи failed
- Другий запуск (нова логіка): `[llm 1/6] retry in 38s`, `[llm 2/6] retry in 59s` ✅

## ⚠ Висновок: Gemini Flash free tier = непридатний для ingest
- Квота 20 req/min, LightRAG + наш retry = подвійні спроби → quota flood
- Навіть 6 спроб по 60s не допомагають (квота вичерпана на довше)
- **Рішення: --llm ollama (qwen3:1.7b)** — локальна модель, без квот

## ✅ izi-tracker проіндексований (ollama qwen3:1.7b)
- vdb_chunks.json (300KB), vdb_entities.json (340KB), vdb_relationships.json (97KB)
- Query тест: "project overview" → відповідь про Supabase/Next.js/Vitest ✅
- Status: [OK]

## ✅ law-assistant проіндексований (ollama qwen3:1.7b)
- 14/15 docs processed (1 failed — non-critical)
- vdb_chunks.json (733KB), vdb_entities.json (3MB), vdb_relationships.json (3.3MB)
- Query тест: "project overview" → Flask/Redis/Elasticsearch/Docker/Kubernetes ✅

## ✅ GAP-6 CLOSED — обидва проекти проіндексовані

## Залишилось
1. Дочекатися завершення izi-tracker ingest (фон)
2. Запустити law-assistant ingest (31 документів)
3. Перевірити vdb_chunks.json у обох проектах
4. Протестувати rag-context-injector для izi-tracker (query)
5. Tasks 40+41: gstack agents для стартапу

## Пріоритети наступної сесії
1. Перевірити чи завершився izi-tracker ingest (ls .rag/index/)
2. Запустити law-assistant: `python tools/rag-ingest.py --project law-assistant --llm flash`
3. Після успіху — тест: `python tools/rag-ingest.py --query "project overview" --project izi-tracker --llm flash`
4. Tasks 40+41: дослідити gstack agents

## Команди для відновлення сесії
```bash
# Перевірка стану після ingest
ls "D:/Ametrin projects/Izi tracker/izi-tracker/.rag/index/"
ls "D:/Ametrin projects/Law_assistant/.rag/index/"

# Якщо не завершено — перезапустити (статуси потрібно очистити знову)
rm "D:/Ametrin projects/Izi tracker/izi-tracker/.rag/index/kv_store_doc_status.json"
rm "D:/Ametrin projects/Izi tracker/izi-tracker/.rag/index/kv_store_full_docs.json"
python tools/rag-ingest.py --project izi-tracker --llm flash

# Law-assistant
rm "D:/Ametrin projects/Law_assistant/.rag/index/kv_store_doc_status.json"
rm "D:/Ametrin projects/Law_assistant/.rag/index/kv_store_full_docs.json"
python tools/rag-ingest.py --project law-assistant --llm flash

# Тест query
python tools/rag-ingest.py --query "project overview architecture" --project izi-tracker --llm flash
```
