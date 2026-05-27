# P3.1 Browser Tooling Pilot — Evaluation Report

Date: 2026-05-27  
Status: **PASS — dry-run successful**  
Candidate: **Vercel Labs agent-browser v0.27.0**

## Dry-Run Evidence

```
npx agent-browser open "https://example.com"
→ ✓ Example Domain / https://example.com/

npx agent-browser snapshot -i
→ - heading "Example Domain" [level=1, ref=e1]
→ - link "Learn more" [ref=e2]

npx agent-browser screenshot
→ ✓ Screenshot saved to ~/.agent-browser/tmp/screenshots/screenshot-*.png
  (5 223 bytes, copied to .planning/pilot-screenshot.png)

npx agent-browser close
→ ✓ Browser closed
```

Snapshot artifact: `.planning/pilot-snapshot.txt` (154 bytes, 2 elements)  
Screenshot artifact: `.planning/pilot-screenshot.png` (5 223 bytes)

## Candidate Matrix

| Критерий | agent-browser | browser-harness | Playwright MCP |
|---|---|---|---|
| Token cost | ✅ Низкий — accessibility tree, не screenshot | ⚠️ CDP raw, много шума | ✅ Низкий — ARIA snapshots |
| Deterministic | ✅ ref-based (`@e1`, `@e2`) — стабильные | ⚠️ selector-based | ✅ ref-based |
| Auth/credentials | ✅ `--storage-state`, cookies, `--secrets` | ⚠️ ручной CDP | ✅ storage state |
| Windows support | ✅ native win32 exe (Rust) + Node fallback | ✅ работает | ✅ npm |
| Local vs cloud | ✅ полностью локальный | ✅ локальный | ✅ локальный |
| CI compatibility | ✅ headless by default, npx install | ⚠️ требует debug port 9222 | ✅ headless |
| Artifact output | ✅ screenshot PNG, snapshot text, diff | ⚠️ нет встроенных | ✅ screenshot |
| AI-first design | ✅ ref-system, `skills get core`, 50+ cmds | ❌ generic CDP | ⚠️ MCP protocol overhead |
| Install size | ⚠️ 183MB (Chrome) — однократно | ✅ маленький | ⚠️ ~50MB |
| Статус | ✅ v0.27.0 доступен | ⚠️ legacy, требует порт 9222 | ✅ v0.0.75 |

## Выбранный победитель: agent-browser

**Почему agent-browser, а не Playwright MCP:**
1. **Ref-based snapshots** — `[ref=e1]` детерминированы и не зависят от CSS. Playwright MCP использует похожий подход, но требует MCP-сервер (отдельный процесс).
2. **AI-first CLI** — 50+ команд, встроенные skills (`agent-browser skills get core`), команда `diff` для visual regression.
3. **Прямой CLI** — `npx agent-browser open url && snapshot && click @ref` без MCP-overhead.
4. **Windows native** — Rust-бинарь для win32, Node.js fallback.
5. **Активная разработка** — agent-browser.dev, benchmark score 94.75.

**Почему НЕ Playwright MCP:**
- Требует запуска MCP-сервера → сложность интеграции в CLI-сессии
- Уже есть `mcp__chrome-devtools__*` в деплое, но правила запрещают MCP-chrome tools

**Почему НЕ browser-harness:**
- Требует Chrome на debug port 9222 (внешняя зависимость)
- Нет accessibility snapshots — только CDP raw
- Нет diff/regression команд
- `--no-mcp-chrome` правило в CLAUDE.md было именно про это

## Рекомендация

| Действие | Приоритет |
|---|---|
| Использовать `npx agent-browser` для всех browser tasks | Немедленно |
| Обновить CLAUDE.md: browser-harness → legacy, agent-browser → primary | В этой сессии |
| Добавить `agent-browser skills get core` в onboarding | Следующая сессия |
| Настроить как MCP-сервер в settings.json (SSE mode) | Опционально — P3.2 |

## Известные ограничения

- Первый запуск: `npx agent-browser install` скачивает 183MB Chrome
- Screenshot path на Windows: использовать без аргумента (→ `~/.agent-browser/tmp/`) или forward slashes
- `--executable-path` с системным Chrome зависал (system Chrome имеет конфликтующие флаги)

## Команды для использования в сессиях

```bash
# Стандартный workflow для AI-агентов
npx agent-browser open "https://example.com"
npx agent-browser snapshot -i          # accessibility tree + refs
npx agent-browser click @e2            # клик по ref
npx agent-browser fill @e3 "text"      # заполнить поле
npx agent-browser screenshot           # сохранить в ~/.agent-browser/tmp/
npx agent-browser close

# Guides встроены в CLI
npx agent-browser skills get core --full
```
