# Hermes Agent — Документация

> Источник: https://hermes-agent.nousresearch.com/docs | GitHub: https://github.com/NousResearch/hermes-agent
> Дата: 2026-06-27

## Что это

Самосовершенствующийся AI-агент от Nous Research. Ключевая фишка — **закрытый обучающийся цикл**: агент создаёт навыки (skills) из опыта, улучшает их во время работы и помнит всё между сессиями.

---

## Установка (Windows)

```powershell
iex (irm https://hermes-agent.nousresearch.com/install.ps1)
```

Инсталлер автоматически ставит: Python 3.11, Node.js, ripgrep, ffmpeg, portable Git Bash.

После установки — первичная настройка:
```powershell
hermes setup --portal
```

---

## Ключевые возможности

| Категория | Детали |
|-----------|--------|
| **Память** | Agent-curated memory, FTS5-поиск по истории, user modeling |
| **Платформы** | Telegram, Discord, Slack, WhatsApp, Signal + CLI |
| **Инфраструктура** | Local / Docker / SSH / Modal / Daytona — любая |
| **LLM** | 300+ моделей через Nous Portal, OpenRouter, OpenAI, HuggingFace, custom |
| **Инструменты** | 40+ встроенных инструментов, MCP-интеграция |
| **Скиллы** | Автосоздание из задач + Skills Hub (88k+ на agentskills.io) |
| **Голос** | Транскрипция голосовых, TTS |
| **Автоматизация** | Cron-планировщик (ежедневные отчёты, ночные задачи) |
| **Параллельность** | Параллельный запуск субагентов |

---

## Команды CLI

```bash
hermes            # запустить чат
hermes setup      # мастер настройки
hermes model      # выбрать LLM-провайдера
hermes tools      # настроить инструменты
hermes gateway    # запустить мессенджер-шлюз (Telegram и т.д.)
hermes doctor     # проверка здоровья системы
hermes config set [key] [value]  # ручная настройка
```

## Команды внутри чата

```
/new, /reset     — новый разговор
/model [provider:model] — сменить модель
/personality [name] — установить личность
/undo, /retry   — отмена последнего хода
/skills          — просмотр скиллов
/<skill-name>    — вызвать скилл
/compress        — сжать контекст
/usage           — статистика токенов
/stop            — остановить задачу
```

---

## Провайдеры LLM

- **Nous Portal** — единая подписка, 300+ моделей, web search, image gen, TTS, cloud browser
- OpenRouter (200+ моделей)
- NovitaAI
- NVIDIA NIM (Nemotron)
- Hugging Face
- OpenAI
- Custom endpoints (любой OpenAI-совместимый)

---

## Skills (навыки)

- Автосоздание: агент сам создаёт skill после сложной задачи
- Самосовершенствование в процессе использования
- Открытый стандарт: совместимо с agentskills.io
- Установка: `/skills` → поиск → install

---

## Память

- Персистентная через сессии
- User profile learning (Honcho dialectic modeling)
- Периодические «напоминания» для закрепления знаний
- Cross-session recall через LLM summarization

---

## MCP-интеграция

Подключение любого MCP-сервера. Поддержка `computer-use-linux` для desktop control.

---

## Автоматизация (Cron)

Планировщик задач на естественном языке:
- Ежедневные отчёты
- Ночные бэкапы
- Еженедельные аудиты

Доставка в любой мессенджер.

---

## Ссылки

- Документация: https://hermes-agent.nousresearch.com/docs
- Skills Hub: https://agentskills.io
- GitHub: https://github.com/NousResearch/hermes-agent
- Discord: https://discord.gg/NousResearch
