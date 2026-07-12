# AGENTS.md — Law Assistant (Юрко)

## Overview
Юрко автоматизує юридичну перевірку договорів поставки для публічних закупівель
і фармацевтики України. Skill аналізує DOCX-договори; MCP-сервер шукає й дістає
офіційні тексти законів.

## Stack
- Python 3.12+, FastMCP, Starlette / uvicorn
- python-docx, Pillow — звіти · beautifulsoup4, lxml — парсинг
- pytest, black, isort, flake8, mypy — тести й лінт
- Docker + Render — деплой

## Structure
- `mcp-server/` — MCP-сервер: кеш законів, скрапінг, пошук
- `skill/` — покрокова перевірка договору → DOCX-висновок
- `tests/` — тестові договори й артефакти звітів
- `docs/` — API, архітектура, roadmap

## Commands
- Запуск: `python mcp-server/server.py`
- Тести:  `pytest mcp-server/tests/ -v`
- Лінт:   `black . ; isort . ; flake8 .`
- Деплой: push у репо → Render піднімає сам

## Code style
- Іменування: `snake_case` для функцій, `PascalCase` для класів
- Валідація входів через Pydantic на межах системи
- Жодних секретів у коді — тільки env-змінні

## Testing
- Нові тести → `mcp-server/tests/`, файли `test_*.py`
- Спершу падаючий тест, потім код (TDD)
- Не видаляти й не скіпати «червоні» тести — чинити код

## Commit & PR
- Формат коміту: `<type>: <опис>` (feat, fix, docs, test)
- PR: заголовок < 70 символів; тіло = Summary + Test plan
- Не комітити: `.env`, секрети, згенеровані DOCX/ZIP

## Gotchas
- Потрібен Python ≥ 3.12; нижчі версії не підтримуються
- HTTP-режим вимагає `UKRAINE_LAWS_API_KEY`; stdio-режим — ні
- Кеш на Render ефемерний — не покладатися на довге збереження
