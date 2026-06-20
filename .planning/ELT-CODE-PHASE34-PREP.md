# Фаза 3+4 prep — зеркало + индекс judge_verdict

> Подготовлено агентом B (Sonnet) в команде Фазы 1, 2026-06-20. Фактические пути **проверены lead'ом**
> (`ls`): `tools/sync-agent-surface.js` ✓, `config/agent-skill-sources.json` ✓. **Только дизайн/runbook,
> не реализация.** Lead-поправки помечены ⚠.

## Фаза 3 — зеркалирование /elt-code

**Механизм:** `tools/sync-agent-surface.js` (Node). Источник правды `~/.claude/skills/`, цели
`~/.codex/skills/`, `~/.gemini/skills/`. Копирует недостающее рекурсивно, сверяет SHA256.

**Шаги (после того как судья вписан в скил — уже сделано, v0.2.0):**
1. ~~Добавить `/elt-code` в манифест `config/agent-skill-sources.json`~~ ⛔ **НЕВЕРНО (исправлено
   2026-06-20):** `sync-agent-surface.js` манифест **НЕ читает** — источник правды = директории в
   `~/.claude/skills/`. Скил уже там → скрипт видит его автоматически, правки манифеста НЕ нужны для
   зеркала. Манифест = только governance-запись. Опц.: добавить запись для governance-полноты, но на
   синк не влияет.
2. Dry-run: `node tools/sync-agent-surface.js --dry-run --target all --json` (покажет missing/conflicts).
3. Apply: `node tools/sync-agent-surface.js --apply --target all` (или `--target codex` / `--target gemini`).

⚠ **Lead-проверка перед apply:** убедиться, что `--target`/`--apply` флаги реально поддерживаются скриптом
(агент B их вывел из дизайна, не из чтения кода). Перед Фазой 3 — прочитать `sync-agent-surface.js`,
сверить CLI-интерфейс. Не запускать вслепую.

**Инлайн-судья в Codex/Antigravity (по дизайну, узел 8):**
- Codex не поддерживает native subagents → судья работает **инлайн** в той же сессии.
- Скил написан условно: есть механизм субагентов → spawn Sonnet/Opus; нет → инлайн. Рубрика идентична.
- Источник правды = файлы (`spec.md`/`constitution.md`/рубрика/`session-ledger.jsonl`) — те же для 3 CLI.
- Проверка: в Codex вызвать `/elt-code "..."`, судья гонит H0-H2+S1-S4, пишет `judge_verdict` в тот же
  ledger; Claude/Gemini видят те же строки.

## Фаза 4 — индекс judge_verdict (шов к B)

**Место:** `~/.claude/projects/_verdict-index/judge-verdicts.md` (глобальный, кросс-проектный; аналог
per-project `MEMORY.md`).

**Содержит:** таблицу по проектам (run#, дата, задача, complexity, H0/H1/H2, S-avg, модель, ссылка на
строку ledger) + агрегаты (total runs, % hard-block, тренд S-avg, распределение моделей).

**Источник:** парсит все `~/.claude/projects/*/session-ledger.jsonl`, фильтр `type==judge_verdict`,
дедуп по (projectKey, ts).

⚠ **Lead-поправка 1 (схема):** канон события — как в скиле/live-fire:
`{"type":"judge_verdict","ts","task","complexity","slice","model","verdict","hard":{H1,H2},"soft":{S1..S4},"summary"}`.
Индекс-ридер парсит ЭТУ схему (агент B предложил плоскую `{"ev":...,"h0":...}` — отвергнута, рассинхрон со
скилом). H0 в событие не пишем — это предусловие (closeout уже прошёл), не поле вердикта.

⚠ **Lead-поправка 2 (анти-AMOS):** индекс читается **on-demand** — на входе `/elt-code` (фильтр по
projectKey) или тулингом Фазы B. **НЕ** авто-инъекция через claude-mem и **НЕ** SessionStart-хук
(агент B это предлагал — нарушает узел 2: без SessionStart, без per-turn инъекции). Индекс — это
хранилище для анализа, не контекст каждой сессии.

**Обновление:** скрипт `tools/update-judge-verdicts-index.js` (НЕ реализован, дизайн) — find ledgers →
parse → dedup → append-merge (не truncate) → пересчёт агрегатов. Запуск on-demand/после прогона судьи,
не файл-watcher (анти-AMOS: ничего в фоне).

**Готовность к B:** корпус (spec, code-diff, verdict, model, S-scores) = старт для eval-флайвила без
перестройки сбора — только инструменты анализа сверху.
