# Tool Stack Vision — 2026-04-26 (від користувача)

## 1. Читання коду / контексту
- **Завжди через RAG + Graphify** — не прямий Read/Grep
- Прямий Read тільки якщо RAG не дав відповіді (fallback)
- Якщо індексу немає → спочатку створити, потім працювати

## 2. Веб-пошук і браузер
- **Порівняти і вибрати ONE**:
  - https://github.com/browser-use/browser-harness
  - https://github.com/h4ckf0r0day/obscura
- Всі дії з браузером — тільки через обраний інструмент
- MCP chrome tools — **заборонено** (застарілі)
- Виняток: DevTools MCP або CLI тільки для пошуку вразливостей / pentest
- Дослідити кращі інструменти для security/pentest (окрема задача)

## 3. Агенти (gstack)
- Зібрати gstack-збірку для стартапу:
  - Marketing агент
  - SEO агент
  - Product Management агент
  - (і далі не тільки програмування)
- Запуск вручну, окремо від pipeline
- Це Task 40-41 з плану S11

## 4. GitHub
- **Строго CLI** (`gh` команди)
- У pipeline є пункт пошуку існуючих рішень:
  - Context7 → документація бібліотек
  - `gh search repos` / `gh search code` → готові рішення на GitHub
  - Це **обов'язковий** крок, не опціональний

## 5. Планування
- Об'єднати `/pipeline` з вбудованим Plan Mode (Claude/Codex/Gemini)
- В Plan Mode **обов'язкове інтерв'ю** — реальне, не для галочки:
  - Уточнити scope, обмеження, пріоритети
  - Сформувати великий детальний план (як PLAN.md в S11)
- Після інтерв'ю → великий структурований план → approve → execute

## 6. Skills
- При виборі скіла → **шукати схожі/корисні** для задачі (SkillsMP + GitHub)
- **Обов'язкова верифікація** перед встановленням:
  - Перевірка на шкідливий код
  - Оцінка контекст-вартості (token cost)
  - Тест на реальній задачі
- Після встановлення → **авто-запуск** `python tools/rag-ingest.py` для оновлення індексу

## 7. Крос-сесійна синхронізація (головна ціль)
- **Одна база даних** для всіх агентів (Claude Code / Codex / Gemini)
- RAG-граф система = єдина пам'ять
- При відкритті нової сесії → агенти синхронізовані, контекст свіжий
- SessionStart хук → query RAG → inject context → старт без "хто ти і що тут?"

## Пріоритет задач (нова черга)
1. W10-09 — інтеграція RAG в SessionStart (критично для крос-сесійності)
2. Порівняти browser-use vs obscura → вибрати і задокументувати
3. Plan Mode upgrade — реальне інтерв'ю + великий план
4. Task 42 — global promotion + rollback manifest (CRITICAL)
5. gstack agents для стартапу (Task 40-41)
6. Skill discovery + verification pipeline (Task 38-39)
7. Security/pentest tools audit
