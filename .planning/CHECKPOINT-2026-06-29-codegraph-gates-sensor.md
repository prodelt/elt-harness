# CHECKPOINT 2026-06-29 — codegraph-гейты + сенсор (аудит-правки)

Ветка: `feature/elt-code-judge-teeth`

## Контекст
Кросс-проектный аудит (5д, 78 сессий, сырой JSONL) → codegraph 2% использования,
4/7 активных проектов без индекса, сенсор `errors.log` = 90% тест-шум. Корень:
advisory-доктрина не меняет поведение, только tool-time enforcement (как git-guardrails).

## Сделано (с доказательством)
1. **Индексы codegraph во все слепые проекты** — Fasoli/Itstep_AI/Marketing_tg_bot/Route_API_1C
   (`codegraph init`+`index`, exit 0). Все 7 активных теперь индексированы.
   ⚠ Fasoli = 1.8Г (13.6k файлов, без node_modules) → нужен `.codegraphignore` + reindex.
2. **codegraph-гейты подключены глобально** — `~/.claude/settings.json` PreToolUse:
   `Read→codegraph-read-gate.js`, `Bash|PowerShell→codegraph-bash-gate.js`. settings.json
   валиден. Self-disable без индекса. **Действует со старта новой сессии.**
3. **bash-gate баг починен** — регексп обрывался на пробеле в пути (фикс: кавыченные пути).
   5+4 тест-кейса зелёные, 140мс.
4. **Сенсор починен в корне** — `test-all-hooks.js` → `CLAUDE_HOOK_TEST=1`, logger молчит при флаге
   (дельта 0 проверена). Старый лог (100% тест-шум) → `errors.log.testnoise-archive-20260629`.

## Resume Pointer (что дальше)
- **ПЕРЕЗАПУСТИТЬ сессию** → live-fire codegraph-гейтов в этом репо (индекс есть): Read код-файла
  >80 строк должен дать `deny` с подсказкой codegraph_context.
- **Fasoli 1.8Г**: разобраться что раздуло (`du -ah .codegraph` уже = только codegraph.db;
  проверить какие файлы/расширения индексатор взял), добавить `.codegraphignore`, reindex.
- **Долги usage** (не чинено): `/clear`→`/checkpoint` привычка; сессии avg 936КБ; мой Edit-before-Read.
- Коммит правок: gate-wire в settings.json (глобальный, не в репо), bash-gate/logger/test-all-hooks/harvest
  (в `~/.claude/`, не в этом репо) — это глобальный слой, НЕ коммитится в Pipiline setupper.
