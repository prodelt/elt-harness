# Research Autopilot — Skill Pack

## Концепция

Research Autopilot — набор скилов для автоматизации стартап-исследований. Вместо ручного поиска и анализа по отдельным запросам — единый **intent router**, который определяет тип исследования и запускает правильный агент.

**Принцип**: один вход → intent detection → специализированный агент → структурированный отчёт.

---

## Intent Router

Пользователь пишет запрос в свободной форме. Роутер определяет категорию и вызывает соответствующий модуль.

### Категории и триггеры

| Категория | Ключевые слова | Агент |
|-----------|---------------|-------|
| **Market Research** | "рынок", "объём", "TAM", "тренды", "market size" | `market-research` |
| **Competitor Teardown** | "конкурент", "аналог", "сравни", "competitor", "vs" | `competitor-teardown` |
| **Pricing Analysis** | "цена", "pricing", "монетизация", "тарифы", "freemium" | `pricing-analysis` |
| **ICP Definition** | "клиент", "ICP", "persona", "целевая аудитория", "сегмент" | `icp-definition` |
| **GTM Strategy** | "запуск", "GTM", "go-to-market", "канал", "acquisition" | `gtm-strategy` |
| **Regulatory / Legal** | "закон", "compliance", "GDPR", "ліцензія", "регулятор" | `regulatory-check` |

---

## Модули

### 1. Market Research
**Задача**: оценить объём и динамику рынка.

**Входные данные**: описание продукта / ниши.

**Выходной отчёт**:
```
## Market Research: [Название ниши]
### TAM / SAM / SOM
- TAM: $Xbn (источник)
- SAM: $Xm (географический фокус / сегмент)
- SOM: $Xm (реалистичная доля за 3 года)

### Тренды (последние 2 года)
- [тренд 1 + источник]
- [тренд 2 + источник]

### Ключевые игроки
| Игрок | Оценка | Доля рынка | Модель |
|-------|--------|-----------|--------|

### Вывод
[1-2 предложения: стоит ли входить, почему]
```

**Инструменты**: `gh search repos`, WebFetch (статьи/отчёты), контекст из RAG (law-assistant для регуляторики).

---

### 2. Competitor Teardown
**Задача**: глубокий анализ конкретного конкурента.

**Входные данные**: название конкурента или URL.

**Выходной отчёт**:
```
## Competitor Teardown: [Название]

### Продукт
- Core value prop:
- Key features:
- Tech stack (если видно):

### Бизнес-модель
- Pricing:
- Revenue model:
- Funded / bootstrapped:

### Сильные стороны
- [1-3 пункта]

### Слабые стороны / Gaps
- [1-3 пункта — это наши возможности]

### Дифференциация
[Как мы отличаемся / где бьём конкурента]
```

**Инструменты**: WebFetch (сайт/pricing), `gh search repos` (open-source аналоги), browser-harness (если нужен скрапинг).

---

### 3. Pricing Analysis
**Задача**: определить оптимальную ценовую модель.

**Входные данные**: описание продукта + конкуренты (опционально).

**Выходной отчёт**:
```
## Pricing Analysis: [Продукт]

### Конкурентный benchmark
| Продукт | Free tier | Paid от | Enterprise |
|---------|-----------|---------|-----------|

### Рекомендуемые модели
1. [Модель 1]: pros / cons / when to use
2. [Модель 2]: pros / cons / when to use

### Рекомендация
- Модель: [freemium / usage-based / seat / flat]
- Entry price: $X/мес
- Rationale: [почему]

### Риски
- [ценовое давление / churn сценарии]
```

---

### 4. ICP Definition
**Задача**: сформулировать профиль идеального клиента.

**Входные данные**: описание продукта + текущие пользователи (если есть).

**Выходной отчёт**:
```
## ICP: [Продукт]

### Primary ICP
- Компания: [размер / индустрия / стадия]
- Роль покупателя: [title]
- Роль пользователя: [title]
- Jobs to be done: [3 ключевых]
- Pain points: [3 главных]
- Бюджет / WTP: $X-Y

### Secondary ICP
[аналогично]

### Анти-ICP (кому НЕ продавать)
[признаки плохого клиента]

### Discovery channels
[где найти этих людей]
```

---

### 5. GTM Strategy
**Задача**: план выхода на рынок.

**Входные данные**: продукт + ICP + текущая стадия (pre-launch / launch / growth).

**Выходной отчёт**:
```
## GTM Strategy: [Продукт] — [Стадия]

### Канальная стратегия
| Канал | Priority | Effort | Expected CAC |
|-------|----------|--------|-------------|

### Первые 90 дней
- Day 1-30: [фокус + метрика]
- Day 31-60: [фокус + метрика]
- Day 61-90: [фокус + метрика]

### Key metrics
- Activation: [определение]
- Retention: [D7/D30 цели]
- CAC target: $X

### Quick wins
[3 действия, которые можно сделать сегодня]
```

---

### 6. Regulatory Check
**Задача**: выявить регуляторные требования для продукта/рынка.

**Входные данные**: описание продукта + целевые рынки (UA / EU / US).

**Выходной отчёт**:
```
## Regulatory Check: [Продукт] — [Рынки]

### Применимые регуляции
| Регуляция | Рынок | Требование | Риск |
|-----------|-------|-----------|------|

### Обязательные действия до запуска
- [ ] [действие 1]
- [ ] [действие 2]

### Долгосрочный compliance roadmap
[квартальный план]

### Рекомендация
[нужен ли юрист + срок]
```

**Инструменты**: RAG запрос к law-assistant (`python tools/rag-ingest.py --query "..." --project law-assistant --llm ollama`).

---

## Запуск (CLI interface)

```bash
# Через pipeline как скил — пока manual trigger
# Формат: описание запроса в свободной форме

# Примеры:
python tools/research-autopilot.py "анализ рынка B2B SaaS для строительных компаний в Украине"
python tools/research-autopilot.py "конкуренты izi-tracker: что делают Linear, Jira, Notion"
python tools/research-autopilot.py "какая pricing модель лучше для izi-tracker"
python tools/research-autopilot.py "ICP для law-assistant: кто покупает юридические AI инструменты"
python tools/research-autopilot.py "GTM план для запуска izi-tracker в Украине"
python tools/research-autopilot.py "GDPR и украинские законы для SaaS с данными пользователей"
```

---

## Интеграция с существующим стеком

| Компонент | Роль |
|-----------|------|
| RAG (law-assistant) | Источник для Regulatory Check |
| RAG (izi-tracker) | Контекст о продукте |
| browser-harness | Скрапинг сайтов конкурентов |
| `gh search repos` | Поиск open-source аналогов |
| gstack `/office-hours` | Уточнение ICP через forcing questions |

---

## Имплементация (TODO)

### Фаза 1 — документ (✅ этот файл)
Спецификация всех 6 модулей и форматов отчётов.

### Фаза 2 — скил (следующий шаг)
```
~/.claude/skills/research-autopilot/SKILL.md
```
Скил-файл с intent router как prompt и вызовом нужного шаблона.

### Фаза 3 — автоматизация (опционально)
```
tools/research-autopilot.py
```
Python скрипт с keyword detection + RAG query + WebFetch + структурированный output.

---

## Статус Task 41

- [x] Документ создан (research-autopilot.md)
- [ ] SKILL.md создан в `~/.claude/skills/research-autopilot/`
- [ ] Intent router протестирован на 6 категориях
- [ ] Интеграция с RAG law-assistant для Regulatory Check
