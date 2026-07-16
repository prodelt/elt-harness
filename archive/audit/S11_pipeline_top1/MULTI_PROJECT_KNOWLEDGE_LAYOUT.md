# Multi-Project Knowledge Layout
## Design Document — Wave 10

**Дата**: 2026-04-24  
**Статус**: DESIGN (без реального ingest)  
**Scope**: 4 project-scoped RAG индекса + глобальный policy слой

---

## 1. Цель

Создать единый стандарт организации knowledge layer для всех проектов:
- структуру каталогов (`.rag/`)
- формат ingest manifest (`.rag/manifest.json`)
- правила что вносить / что исключать
- trigger-политику пересборки

Каждый проект хранит собственный изолированный RAG индекс. Межпроектный обмен — только через global policy layer (не через shared index).

---

## 2. Аудит текущего состояния

| Проект | Путь | CLAUDE.md | AGENTS.md | GEMINI.md | Graphify | RAG | Проблемы |
|--------|------|-----------|-----------|-----------|----------|-----|----------|
| Pipeline-setupper | `C:\Claude playground\Pipiline setupper` | ✅ 104 л | ✅ 91 л | ✅ 81 л | ✅ | ❌ | — |
| Izi-tracker | `D:\Ametrin projects\Izi tracker\izi-tracker` | ✅ 90 л | ✅ 98 л | ✅ ? л | ✅ | ❌ | — |
| Law_assistant | `D:\Ametrin projects\Law_assistant` | ✅ 81 л | ✅ 85 л | ✅ ? л | ✅ | ❌ | — |
| sudoviy-master | `D:\Ametrin projects\sudoviy master try 3` | ⚠️ **183 л** | ⚠️ **159 л** | ✅ 134 л | ✅ | ❌ | Docs >150 строк — нарушают лимит |

**Pre-condition для sudoviy-master**: trim CLAUDE.md до ≤150 строк, AGENTS.md до ≤150 строк перед ingest.

---

## 3. Слои знаний

### 3.1 Global policy layer (кросс-проектный)
Хранится: `~/.claude/` и `~/.codex/`  
Содержимое (только policy, не project knowledge):
- git discipline rules
- security scanners
- Context7 / docs lookup policy
- GitHub-first discovery policy
- route-order policy (Graphify → RAG → grep → WebSearch)
- docs bootstrap verifier

**Не включается**: project-specific architecture, project secrets, stack-specific commands.

### 3.2 Project knowledge layer (per-project)
Хранится: `<project-root>/.rag/`  
Уникален для каждого проекта. Содержимое — определяется `.rag/manifest.json`.

### 3.3 Task-local scratch
Временные артефакты. Живут в `.planning/` или `.tmp/`. Не индексируются.

---

## 4. Стандарт `.rag/manifest.json`

Каждый проект должен иметь `.rag/manifest.json` следующей структуры:

```json
{
  "project": "<project-name>",
  "path": "<absolute-project-root>",
  "version": "1.0.0",
  "include": [
    { "glob": "CLAUDE.md", "label": "project-docs" },
    { "glob": "AGENTS.md", "label": "project-docs" },
    { "glob": ".gemini/GEMINI.md", "label": "project-docs" },
    { "glob": "MEMORY.md", "label": "memory" },
    { "glob": "docs/**/*.md", "label": "architecture" },
    { "glob": "audit/**/*.md", "label": "audit-notes", "optional": true },
    { "glob": "graphify-out/GRAPH_REPORT.md", "label": "graph-summary", "optional": true }
  ],
  "exclude": [
    "**/.env*",
    "**/secrets*",
    "**/node_modules/**",
    "**/*.lock",
    "**/*.log",
    "graphify-out/wiki/**",
    ".rag/index/**"
  ],
  "rebuild_triggers": [
    "CLAUDE.md changed",
    "AGENTS.md changed",
    "major task closure (>3 tasks)",
    "architecture refactor"
  ],
  "index_dir": ".rag/index/",
  "last_built": null,
  "provider": "lightrag",
  "query_modes": {
    "policy_summary": "global",
    "entity_specific": "local",
    "mixed_context": "mix",
    "fallback": "naive"
  }
}
```

---

## 5. Структура каталога `.rag/` в каждом проекте

```
<project-root>/
└── .rag/
    ├── manifest.json       ← ingest manifest (в git)
    ├── index/              ← LightRAG index (в .gitignore)
    │   ├── kv_store_full_docs.json
    │   ├── kv_store_text_chunks.json
    │   ├── graph_chunk_entity_relation.graphml
    │   └── ...
    └── .gitignore          ← исключает index/
```

**`.rag/index/` всегда в `.gitignore`** — индексы не коммитятся, пересобираются локально.

---

## 6. Approved ingest scope по проектам

### Pipeline-setupper
```
CLAUDE.md, AGENTS.md, .gemini/GEMINI.md
MEMORY.md
audit/S11_pipeline_top1/runtime/*.md
audit/S11_pipeline_top1/PLAN.md
graphify-out/GRAPH_REPORT.md
```
Исключить: `.env*`, `audit/1c-dev-pilot/`, `tools/`, `.tmp/`, `*.jsonl`

### Izi-tracker
```
CLAUDE.md, AGENTS.md, .gemini/GEMINI.md
MEMORY.md
docs/**/*.md (если есть)
graphify-out/GRAPH_REPORT.md
```
Исключить: `.env*`, `node_modules/`, `*.lock`, `supabase/migrations/`, `.next/`

### Law_assistant
```
CLAUDE.md, AGENTS.md, .gemini/GEMINI.md
docs/**/*.md
graphify-out/GRAPH_REPORT.md
```
Исключить: `.env*`, `tests/*.docx`, `tests/*.zip`, `graphify-out/wiki/`, `mcp-server/cache/`

### sudoviy-master
```
CLAUDE.md, AGENTS.md, .gemini/GEMINI.md
docs/**/*.md (если есть)
graphify-out/GRAPH_REPORT.md
```
Исключить: `.env*`, `*.xlsx`, `dist/`, `*.exe`, `logs/`

---

## 7. Query routing policy (кросс-проектная)

```
1. CLI capability registry         → команды и разрешённые routes
2. graphify query "..."            → structural / code-ownership вопросы
3. LightRAG query (project-scoped) → docs / policy / memory вопросы
4. grep / targeted read            → точный поиск по строке
5. WebSearch                       → внешние источники (последний)
```

Межпроектные запросы через LightRAG **запрещены** — каждый проект отвечает только за свои данные.

---

## 8. Rebuild triggers

| Событие | Действие |
|---------|----------|
| Закрытие 3+ задач | `lightrag ingest --project <name>` |
| Изменение CLAUDE.md / AGENTS.md | Пересборка |
| Архитектурный рефактор | Полная пересборка |
| Подозрение на scope contamination | Удалить `.rag/index/`, пересобрать |
| Квартальное обслуживание | Пересборка всех 4 проектов |

---

## 9. Pre-conditions (что должно быть выполнено до ingest)

| Проект | Pre-condition | Статус |
|--------|--------------|--------|
| Pipeline-setupper | AI docs ≤150 строк, graphify актуален | ✅ Готов |
| Izi-tracker | AI docs ≤150 строк, graphify актуален | ✅ Готов |
| Law_assistant | AI docs ≤150 строк, graphify актуален | ✅ Готов |
| sudoviy-master | **Trim CLAUDE.md (183→≤150), AGENTS.md (159→≤150)** | ❌ Нужна задача |

---

## 10. Wave 10 — Task Breakdown

| Task | Описание | Зависит от |
|------|----------|-----------|
| **W10-01** | Trim sudoviy-master CLAUDE.md + AGENTS.md до ≤150 строк | — |
| **W10-02** | Создать `.rag/manifest.json` validator script (`validate-rag-manifest.js`) | — |
| **W10-03** | Создать `.rag/manifest.json` для Pipeline-setupper | W10-02 |
| **W10-04** | Создать `.rag/manifest.json` для Izi-tracker | W10-02 |
| **W10-05** | Создать `.rag/manifest.json` для Law_assistant | W10-02 |
| **W10-06** | Создать `.rag/manifest.json` для sudoviy-master | W10-01, W10-02 |
| **W10-07** | LightRAG Python setup (local, project-scoped) + ingest script | W10-03..06 |
| **W10-08** | Тест 10 вопросов по каждому проекту (comparison table) | W10-07 |
| **W10-09** | Обновить global route policy: добавить LightRAG step | W10-08 |

**Границы Wave 10**: W10-01..06 = design + manifests (no Python).  
W10-07..09 = отдельная сессия с Python/credentials setup.

---

## 11. Rollback policy

- `.rag/index/` — всегда можно удалить и пересобрать
- `.rag/manifest.json` — в git, rollback через `git revert`
- Межпроектные утечки — пересобрать подозрительный индекс с нуля
- Secrets в ingest — немедленно удалить `.rag/index/`, проверить exclude правила
