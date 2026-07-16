# Промпт для новой сессии (Wave 10 — W10-07 run + W10-08)

Скопируй всё между `===` в новую сессию Claude Code в проекте Pipeline-setupper.

===

Focus: W10-07 finish — запустить ingest для всех 4 проектов + 3 test queries
Done when: .rag/index/ наполнен для всех 4 проектов; 3+ запроса отвечают; W10-08 начат

## Контекст

- Ветка: `feature/s11-task-43-init-project-upgrade-mode`, последний commit `5cd30bf`
- RAG стек: qwen3:1.7b (Ollama, 1GB, 100% GPU) + gemini-embedding-2 (Google API)

## Что уже готово

- `tools/rag-ingest.py` — полностью рабочий, commit `5cd30bf`
- LLM: `qwen3:1.7b` (установлена локально, бесплатно, 100% GPU)
- Embeddings: `gemini-embedding-2` (Google API, требует GOOGLE_API_KEY)
- chunk_token_size=300, llm_model_max_async=1, retry/timeout встроен
- `--llm flash|ollama` флаг (flash требует billing, использовать ollama)

## ⚠️ Известные проблемы этой сессии

1. `gemini-2.0-flash-lite` — free tier limit=0 (billing нужен). НЕ использовать.
2. `gemini-2.0-flash` — тоже не free tier для этого API ключа.
3. Используем только `--llm ollama` (дефолт).

## First Commands

```bash
# 1. Установить API ключ для embeddings
# ! set GOOGLE_API_KEY=<key>

# 2. Smoke test — один проект
cd "/c/Claude playground/Pipiline setupper"
python tools/rag-ingest.py --project pipeline

# 3. Следить за GPU (в отдельном терминале)
ollama ps

# 4. Test queries (после ingest)
python tools/rag-ingest.py --query "что такое Pipeline-setupper" --project pipeline
python tools/rag-ingest.py --query "как работают хуки" --project pipeline
python tools/rag-ingest.py --query "loop-guardian порог" --project pipeline

# 5. Остальные проекты
python tools/rag-ingest.py --project izi-tracker
python tools/rag-ingest.py --project law-assistant
python tools/rag-ingest.py --project sudoviy-master
```

## Пути проектов

| Проект | Путь |
|--------|------|
| Pipeline-setupper | `C:\Claude playground\Pipiline setupper` |
| Izi-tracker | `D:\Ametrin projects\Izi tracker\izi-tracker` |
| Law_assistant | `D:\Ametrin projects\Law_assistant` |
| sudoviy-master | `D:\Ametrin projects\sudoviy master try 3` |

## Wave 10 — Статус

| Task | Описание | Статус |
|------|----------|--------|
| W10-01..06 | manifest.json для всех проектов | ✅ |
| W10-07 | rag-ingest.py готов, ingest не запущен до конца | 🔄 |
| W10-08 | 10-question comparison table | ⬜ |
| W10-09 | Обновить global route policy | ⬜ |

## Скорость ожидаемая

| Метрика | gemma4:e4b (было) | qwen3:1.7b (сейчас) |
|---------|-------------------|----------------------|
| Размер | 9.6 GB | 1 GB |
| GPU | 21% | ~100% |
| сек/чанк | ~30 сек | ~1-3 сек |
| Все 4 проекта | ~3 часа | ~10-20 мин |

## Rules

1. Windows: no `&&`; используй `;` или отдельные команды.
2. Не коммитить в `main`.
3. Conventional Commits: `type(scope): subject`.
4. Context7 перед внешними библиотеками.

===
