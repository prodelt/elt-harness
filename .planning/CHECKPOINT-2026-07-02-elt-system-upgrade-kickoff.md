# CHECKPOINT 2026-07-02 — elt-система: апгрейд до эталона (kickoff, план утверждён)

> **Resume Pointer:** выполнить шаги A→F ниже ПО ПОРЯДКУ. Анализ и обоснования —
> `.planning/ELT-SYSTEM-AUDIT-2026-07-02.md` (читать при сомнении, не пересобирать заново).
> Решения юзера приняты, ничего не переспрашивать кроме отмеченного ⚠.
> Дедлайн-контекст: демо 07.07.2026 — петлю elt-loop на AWE3 не ломать.

## Решения юзера (2026-07-02)

1. Делать A–F по порядку.
2. Ветку `feature/elt-code-judge-teeth` — **в архив** (сохранить; на ней вся свежая история, включая
   `bc75d8c`/`8a384e1`). Не удалять.
3. **Судья-гейт должен существовать** — независимая «проверка со стороны» поверх оракула (не вместо).
4. Зеркалить elt-code/elt-loop/elt-work в codex/gemini. Cron-аудит ставить.

## Шаги (каждый закрывается доказательством: вывод команды/live-fire, затем commit)

### A. Гигиена (30 мин)
- `~/.claude/settings.json`: `"model": "claude-fable-5[1m]"` → `"claude-fable-5"` (ANSI-мусор от /model).
- Там же: решить с `WebSearch`/`WebFetch` в allow (противоречат правилу памяти «WebSearch запрещён,
  agent-browser для поиска») — снять из allow или ⚠ спросить юзера одной строкой.
- Проектный `settings.local.json` (~240 allow-правил): срезать археологию (red-team curl, /tmp-скрипты,
  разовые cp/awk), ОСОБО оптовые `Bash(git *)`, `Bash(python *)`, `Bash(node:*)`, `Bash(powershell *)`,
  `Bash(cmd *)`. Оставить ~20 живых (ctx7, gh, codegraph, git -C status/log).
- Удалить мусор-копии: `.claude/checkpoints (1).log`, `.claude/settings (1).local.json`.
- `~/.claude/skills/elt-code/spec-template.md` — сирота (роутер v1.0.0 его не упоминает): удалить.
- **Git:** ветка `feature/elt-code-judge-teeth` = текущая и несёт всю живую работу → merge в `main`
  (это и есть «архив» истории), дальше работать с новых веток per шаг. Judge-файлы
  (`.claude/hooks/judge-closeout-gate.js`, `tools/pipeline-state.js`, `tools/scan-stale-gates.js`) НЕ удалять.
- DoD: `node tools/doctor.js` зелёный; `git log main --oneline -3` показывает merge.

### B. elt-loop v0.2 — guide (малый дифф SKILL.md; ~/.claude/skills/elt-loop/SKILL.md)
1. **Run-log:** шаг CLOSEOUT дописывает строку в `.planning/loop-run-log.md` проекта:
   `| дата | slice | attempts | oracle cmd + exit | commit | verdict |` (одна md-таблица, append-only).
2. **Красная линия:** «в tasks.md разрешено только `[ ]`→`[X]`; формулировки задач не редактировать;
   нельзя отмечать задачу, чей оракул не гонялся в этой сессии» (урок T043).
3. **Fresh context:** прогон >2 слайсов — через native `/loop` (dynamic) ИЛИ чекпоинт + `/clear` каждые
   2-3 слайса. Одна растущая сессия до автокомпакта = анти-паттерн (context rot).
4. **Flake-правило:** красный оракул, зеленеющий при ре-ране без правок = flake → карантин/отметка в
   STATE, НЕ «чинить» кодом (loop-eng: не маскировать инфра-проблемы).
5. **Prune:** на завершении петли перенести закрытые записи журнала STATE.md → PROJECT-HISTORY.md
   (STATE = короткий хребет, не журнал).
6. **Шаг 5 петли (судья)** переписать под дизайн E ниже: независимый субагент, а не inline-вызов.
- Версия → 0.2.0 + changelog. DoD: SKILL.md дифф показан, `/skills` видит версию.

### C. elt-work v0.2 + зеркала
- Механический сенсор ПЕРЕД человеческим чеклистом: проверка артефакта — файл существует, >0 байт,
  парсится соответствующей либой (`python-docx`/`openpyxl`/`pypdf` через `py -3`; ~15 строк, инлайн в
  SKILL или крошечный скрипт). Человеческое подтверждение остаётся финальным оракулом.
- Версия → 0.2.0. Затем **зеркала**: `sync-agent-surface.js` (или хирургический cp) elt-code/elt-loop/
  elt-work → `~/.codex/skills`, `~/.gemini/skills`; сверить версии.
- DoD: сенсор пойман на подсунутом 0-байтном файле (live-fire); `ls` зеркал показывает 3 скила.

### D. Cron-наблюдаемость
- Еженедельный прогон session-harvest/usage-audit с 3 метриками: % route-line у elt-code вызовов,
  слайсы/красные/эскалации elt-loop (из loop-run-log), вызовы+подтверждения elt-work.
- ⚠ Механизм: сессионный `CronCreate` recurring **авто-истекает через 7 дней** → для настоящей
  еженедельки предпочесть **Windows Task Scheduler → `claude -p "/session-harvest ..."`** (headless)
  или durable CronCreate с осознанным ре-армом. Выбрать в сессии, зафиксировать выбор в STATE.
- DoD: задача видна в планировщике + один ручной прогон отчёта показан.

### E. Судья-гейт v2 — gate + live-fire (дизайн, не переспрашивать)
Доктрина: **оракул (тесты) — первый гейт и единственный, кто закрывает слайс. Судья — вторая,
НЕЗАВИСИМАЯ пара глаз («со стороны»), гейт на closeout.** Судья не может «простить» красный оракул.
1. Судья = **отдельный субагент** (Task/sidechain, свежий контекст). Вход: diff слайса + текст задачи
   из tasks.md + красные линии конституции. Стойка: «найди причины отклонить» (REJECT-default).
   Судья НЕ перегоняет тесты (это оракул), смотрит scope creep / удалённые-ослабленные тесты /
   side-effects / соответствие задаче.
2. Модель судьи: НЕ haiku (глобальный `CLAUDE_CODE_SUBAGENT_MODEL=haiku` переопределить в Task-вызове,
   `model: sonnet`) — loop-eng: «stronger model on verifier».
3. Вердикт → `tools/pipeline-state.js log-verdict` (CLI уже есть, bf54f1d).
4. Stop-хук `judge-closeout-gate.js` re-wire (project-scope `settings.json` этого репо + AWE3):
   блокирует «done» на MEDIUM+ без СВЕЖИХ (а) оракул-зелёного, (б) judge_verdict. Зуб изоляции
   (c87a991: pass без sidechain = inline self-judge = block) и staleness-guard (9301d69: state >24ч =
   заброшен → allow) — ОСТАЮТСЯ, они уже по новой доктрине.
5. Сбой/таймаут судьи-инфраструктуры: НЕ авто-pass и НЕ силент-игнор → сёрфейс юзеру, решение за
   человеком. Retry 1 раз.
6. Бюджет: 1 судья-вызов на слайс.
- DoD (live-fire, все 4, с выводом): done-без-вердикта → block; inline self-judge → block;
  субагент-pass → allow; staleness >24ч → allow. Плюс regression: block-dangerous-git жив.

### F. doctor.js (опционально, если остаётся время)
- Чек «версии скилов расходятся между claude/codex/gemini» → WARN.
- Мини-«Loop Ready» скор: 10 да/нет по Loop Design Checklist (см. аудит-файл).
- DoD: `node tools/doctor.js` вывод показан.

## Красные линии сессии
- Петлю elt-loop на AWE3 не гонять и не ломать до демо 07.07 (см. STATE.md AWE3-гочту про dev-БД).
- Каждый шаг = отдельный коммит с доказательством. Никаких «done» без вывода команды.
- Собирать из готового; новый код минимальный; ничего глобального не вешать.
