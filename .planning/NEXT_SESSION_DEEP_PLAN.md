# Deep System Audit + Working Rules — План сессии S12

**Создан**: 2026-04-28  
**Цель**: Верифицировать ВСЮ систему реально, задокументировать правила работы  
**Старт сессии**: `/prime` → сразу Блок A  
**Ожидаемое время**: ~4h  
**Done when**: все 5 блоков выполнены, WORKING_RULES.md написан, score ≥ 99/100

---

## Предварительный контекст (прочитать перед стартом)

### Текущий статус системы
- **47 хуков**, 33/33 sanity PASS, 37/37 behavior PASS (не проверялось с 2026-04-27)
- **89 skill digests** (47 base + 42 gstack), TTL 48h
- **RAG**: 4 проекта, 24h кеш, SessionStart inject
- **bun v1.3.13** установлен → gstack /browse /qa активны
- **skill-promote 8/8 PASS** (SHA-256 byte-identical)

### Известные наблюдения из errors.log
- Все 559 строк в errors.log — из behavior-тестов (фикстуры), не реальные ошибки
- `stop-auto-checkpoint` = 0 fires — потенциально не работает в реальных сессиях
- `memory-discipline` BLOCK при 101 строке — MEMORY.md нужно держать ≤ 100

---

## БЛОК A — Полное тестирование хуков (30–45 мин)

### A1. Sanity + Behavior тесты

```bash
# Sanity (должно быть 33/33)
node ~/.claude/hooks/test-all-hooks.js | grep "Result:"

# Behavior — BLOCK/ALLOW матрица (должно быть 37/37)
node ~/.claude/hooks/test-hooks-behavior.js

# Codex sync (должно быть 42/42)
node ~/.codex/test-codex-hooks.js | grep "Result:"
```

**Критерий PASS**: все три показывают ожидаемые цифры.  
**Если FAIL**: читать конкретный упавший тест, найти root cause, починить.

### A2. Ручные сценарии (по одному за раз, проверить вывод)

**config-protection — BLOCK:**
```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"/project/.eslintrc","old_string":"a","new_string":"b"}}' \
  | node ~/.claude/hooks/config-protection.js
# Ожидать: JSON с permissionDecision: "deny"
```

**secret-scanner — BLOCK при реальном секрете:**
```bash
echo '{"tool_name":"Bash","tool_input":{"command":"curl -H \"Authorization: Bearer ghp_realtoken123\" api.github.com"}}' \
  | node ~/.claude/hooks/secret-scanner.js
# Ожидать: JSON с permissionDecision: "deny"
```

**loop-guardian — WARN при 3 одинаковых Edit:**
```bash
for i in 1 2 3; do
  echo '{"tool_name":"Edit","tool_input":{"file_path":"/test/file.js","old_string":"foo","new_string":"bar"}}' \
    | node ~/.claude/hooks/loop-guardian.js
done
# На 3-й раз: JSON с additionalContext (предупреждение)
```

**skill-selector-gate — альтернативы при delta > 0.15:**
```bash
echo '{"tool_name":"Skill","tool_input":{"skill":"ship","args":"deploy auth feature to production"}}' \
  | node ~/.claude/hooks/skill-selector-gate.js
# Ожидать: тихий exit 0 (топ-ранк) ИЛИ JSON с альтернативами

echo '{"tool_name":"Skill","tool_input":{"skill":"checkpoint","args":""}}' \
  | node ~/.claude/hooks/skill-selector-gate.js
# Ожидать: тихий exit 0 (SKIP_SKILLS)
```

**auto-branch — создание ветки на main:**
```bash
# Переключиться на main временно, попробовать Edit → должна создаться session/... ветка
# ОСТОРОЖНО — только проверить логику, не коммитить
echo '{"tool_name":"Edit","tool_input":{"file_path":"/test.txt","old_string":"a","new_string":"b"},"cwd":"C:/Claude playground/Pipiline setupper"}' \
  | node ~/.claude/hooks/auto-branch.js
# Ожидать: вывод о создании ветки session/YYYY-MM-DD-HHmm
```

**stop-auto-checkpoint — проверить что fires:**
```bash
echo '{"stop_reason":"end_turn","cwd":"C:/Claude playground/Pipiline setupper"}' \
  | node ~/.claude/hooks/stop-auto-checkpoint.js
# Ожидать: exit 0 или создание checkpoint файла
```

### A3. Итог блока A

Заполнить таблицу:
| Хук | Тип | Ожидаемо | Факт | PASS/FAIL |
|---|---|---|---|---|
| config-protection | BLOCK | deny JSON | ? | ? |
| secret-scanner | BLOCK | deny JSON | ? | ? |
| loop-guardian | WARN | additionalContext | ? | ? |
| skill-selector-gate skip | SILENT | exit 0 | ? | ? |
| auto-branch | CREATE | ветка | ? | ? |
| stop-auto-checkpoint | FIRE | exit 0 | ? | ? |

---

## БЛОК B — Pipeline End-to-End сценарии (60–75 мин)

### Подготовка
```bash
# Сбросить pipeline-state перед каждым тестом
rm ~/.claude/pipeline-state.json 2>/dev/null; echo "clean"
```

### B1. Сценарий TRIVIAL — "исправь опечатку"

**Задача пользователя**: `"в README.md написано 'Pipiline' — исправь на 'Pipeline'"`

**Ожидаемый путь pipeline:**
1. Step 0 precheck → файл ≤ 500 LOC → OK
2. Step 0.3b → не "integrate/add library" → skip discovery
3. Step 0.5 → TRIVIAL → skip interview
4. Step 1 → classify: ULTRA-TRIVIAL (1 файл, 1 строка, typo)
5. Прямое Edit → готово без sub-skills
6. Никакого `/architect-first`, никакого `/tdd`

**Проверить**: pipeline не вызвал лишних скилов, Edit прошёл без блоков.

### B2. Сценарий MEDIUM — "добавь валидацию"

**Задача пользователя**: `"в proxy_core.js добавь валидацию что порт — число от 1 до 65535, с тестом"`

**Ожидаемый путь pipeline:**
1. Step 0 precheck → OK
2. Step 0.5 → MEDIUM → 1-2 вопроса: scope, done criteria
3. Step 1 → MEDIUM (1 файл, <50 LOC изменений, есть тест)
4. → Skill(tdd) → RED (failing test first) → GREEN → REFACTOR
5. → Skill(inline-review) → оценка
6. Никакого `/architect-first`

**Проверить**: tdd вызван, тест написан ДО кода, inline-review в конце.

### B3. Сценарий COMPLEX — "рефактори hook registry"

**Задача пользователя**: `"hook infrastructure разрослась — предложи как реорганизовать hooks/ директорию"`

**Ожидаемый путь pipeline:**
1. Step 0.5 → COMPLEX → все 3 вопроса: scope, constraints, done criteria
2. Step 1 → COMPLEX (3+ файлов, архитектурное решение)
3. → Skill(architect-first) → design first, no code yet
4. → Plan Mode → ждёт подтверждения
5. НЕ приступать к имплементации без ОК

**Проверить**: architect-first вызван, план показан, имплементация НЕ начата без ответа.

### B4. Сценарий BUG — "хук падает"

**Задача пользователя**: `"rag-context-injector.js иногда падает с timeout — разберись"`

**Ожидаемый путь pipeline:**
1. Step 1 → BUG bucket
2. → Skill(diagnose) → reproduce → minimise → hypothesis → instrument
3. Показать hypothesis без слепого фикса

**Проверить**: diagnose вызван, есть reproduce-шаг.

### B5. Проверить pipeline-state.json

После каждого сценария:
```bash
cat ~/.claude/pipeline-state.json 2>/dev/null | python -m json.tool
```
Должен содержать: `cwd`, `ts`, `phase`, `bucket`, `task_summary`.

---

## БЛОК C — RAG верификация (20–30 мин)

### C1. SessionStart inject

```bash
echo '{"cwd":"C:/Claude playground/Pipiline setupper"}' \
  | node ~/.claude/hooks/rag-context-injector.js
# Ожидать: JSON с additionalContext > 500 bytes, время < 500ms (кеш)

# Форс промах кеша (удалить кеш):
rm ~/.claude/rag-cache/pipeline.json
echo '{"cwd":"C:/Claude playground/Pipiline setupper"}' \
  | node ~/.claude/hooks/rag-context-injector.js
# Ожидать: то же содержимое, но время > 30s (реальный запрос к ollama)
```

### C2. Прямые RAG запросы

```bash
# Тест 1 — pipeline проект
python "C:/Claude playground/Pipiline setupper/tools/rag-ingest.py" \
  --query "как работает loop-guardian хук" --project pipeline --llm ollama
# Ожидать: осмысленный ответ про edit counter, repeatWarn threshold

# Тест 2 — izi-tracker
python "C:/Claude playground/Pipiline setupper/tools/rag-ingest.py" \
  --query "какие сущности в базе данных" --project izi-tracker --llm ollama
# Ожидать: таблицы/модели из izi-tracker

# Тест 3 — закон
python "C:/Claude playground/Pipiline setupper/tools/rag-ingest.py" \
  --query "статья про договор поставки" --project law-assistant --llm ollama
```

### C3. Route policy верификация

Задать вопрос который есть в RAG → убедиться что ответ идёт из RAG (не из Read/Grep).  
Задать вопрос которого нет в RAG → убедиться что fallback работает (Graphify → Read/Grep).

---

## БЛОК D — Написать WORKING_RULES.md (45–60 мин)

**Файл**: `~/.claude/WORKING_RULES.md`  
**Размер**: ≤ 150 строк (для контекста)

### Структура документа

```markdown
# Working Rules — Claude Code Pipeline

## Начало сессии
1. /prime — загрузить контекст
2. Определить ONE GOAL (Focus: [X] Done when: [Y])
3. /careful если работа в prod/critical файлах

## Таблица скилов
| Ситуация | Скил |
|---|---|
| Любая задача — точка входа | /pipeline |
| Архитектура / 3+ файлов | /architect-first |
| Новая фича + TDD | /tdd |
| Баг с неясной причиной | /diagnose |
| После кода | /inline-review |
| Релиз / merge | /ship |
| Безопасность auth/input | /security-best-practices |
| Новый проект без docs | /init-project |
| Docs устарели | /sync-docs |
| Сложная задача, нужно интервью | /grill-me |
| Browser QA | /gstack (требует bun) |

## Когда останавливаться и спрашивать
- Задача vague ("сделай лучше") → задать max 3 вопроса через Step 0.5
- Два+ равносильных подхода → спросить constraint
- Касается архитектуры/новых зависимостей → /architect-first + Plan Mode
- Файл > 500 LOC → объявить, предложить split
- Нет CLAUDE.md → /init-project сначала

## Commit discipline
- Формат: type(scope): description
- Types: feat/fix/refactor/docs/test/chore
- Когда: после каждой логической единицы (не батчить 5 задач в 1 коммит)
- НЕ коммитить: .env, secrets, временные файлы

## /learn + /checkpoint — когда обязательны
- /checkpoint: конец каждой сессии > 30 мин
- /learn: если паттерн повторился 3+ раз в сессии
- /checkpoint перед /compact (если сессия > 400KB)

## Правила RAG
- Перед Read/Grep → сначала RAG query
- RAG ответил → использовать, не читать файл заново
- RAG недостаточно → Graphify → Read/Grep (в таком порядке)
- Доверять RAG для архитектурных вопросов, верифицировать для конкретных значений
- 4 проекта: pipeline, izi-tracker, law-assistant, sudoviy-master

## Правила промоции скилов
1. Написать SKILL.md в staging (audit/S11_pipeline_top1/skills/)
2. Запустить skill-promote.test.js
3. ./skill-promote.ps1 -Name <skill> -StagingRoot <path>
4. Проверить в ~/.claude/skills/, ~/.codex/skills/, ~/.gemini/skills/
5. При проблемах: ./skill-rollback.ps1 -Name <skill>

## Context7 — обязательно
- Перед ЛЮБЫМ использованием внешней библиотеки
- ctx7 library <name> → ctx7 docs <id> <query>
- НЕ угадывать API из памяти — API меняются между версиями

## Правила безопасности
- Secrets только в .env, никогда в коде
- secret-scanner блокирует sh/sk-/Bearer в bash командах
- config-protection блокирует .eslintrc/.prettierrc.json (не трогать)
- rm -rf / git reset --hard / git push --force → подтвердить у пользователя

## Score система (текущий: 96/100)
- Отнимает: test failures, missed /checkpoint, unhealthy hooks, MEMORY.md > 100 строк
- Добавляет: реальные доказательства, behavior tests pass, docs актуальны
```

---

## БЛОК E — Score Audit 96 → 100 (20–30 мин)

### E1. Диагностика текущих минусов

```bash
# Реальные метрики
node ~/.claude/hooks/hook-stats.js
node ~/.claude/hooks/hook-stats.js --errors | tail -20

# stop-auto-checkpoint: почему 0 fires?
echo '{"stop_reason":"end_turn","cwd":"C:/Claude playground/Pipiline setupper"}' \
  | node ~/.claude/hooks/stop-auto-checkpoint.js; echo "exit: $?"

# MEMORY.md размер
wc -l ~/.claude/projects/C--Claude-playground-Pipiline-setupper/memory/MEMORY.md
# Должно быть < 80 строк (warn) и < 100 (block)
```

### E2. Известные проблемы для починки

1. **stop-auto-checkpoint 0 fires** — проверить регистрацию в settings.json, убедиться что hook запускается при реальном Stop
2. **MEMORY.md дисциплина** — если > 80 строк → запустить /learn для архивации
3. **behavior тесты** — если < 37/37 → найти деградировавший хук и починить

### E3. Целевой score 99/100

| Критерий | Текущий | Цель |
|---|---|---|
| Sanity tests | 33/33 ✅ | 33/33 |
| Behavior tests | 37/37 (не проверялось) | 37/37 |
| Codex sync | 42/42 (не проверялось) | 42/42 |
| WORKING_RULES.md | ❌ нет | ✅ написан |
| stop-auto-checkpoint | 0 fires ⚠ | fires при Stop |
| MEMORY.md | ок | < 80 строк |
| Документация актуальна | CLAUDE.md ✅ | AGENTS.md + GEMINI.md синк |

---

## Порядок выполнения

```
/prime
  ↓
Блок A: node test-all-hooks.js + test-hooks-behavior.js + test-codex-hooks.js
  ↓ все PASS →
Блок A ручные сценарии (6 штук, показать вывод)
  ↓
Блок B: pipeline e2e (4 сценария — TRIVIAL/MEDIUM/COMPLEX/BUG)
  ↓
Блок C: RAG inject + прямые query + route policy
  ↓
Блок D: написать ~/.claude/WORKING_RULES.md
  ↓
Блок E: stop-auto-checkpoint fix + AGENTS.md sync + финальный score
  ↓
/checkpoint + /learn + коммит
```

---

## Команды восстановления (если сессия прервалась)

```bash
# Где остановились
cat ~/.claude/pipeline-state.json 2>/dev/null

# Быстрый health check
node ~/.claude/hooks/test-all-hooks.js | grep "Result:"
bun --version

# Продолжить с конкретного блока
# Просто запустить команды из нужного блока выше
```
