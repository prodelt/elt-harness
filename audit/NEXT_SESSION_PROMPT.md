# Prompt для новой сессии (S7)

Скопируй текст ниже в новый чат.

---

Продолжаем Pipeline Audit 2026-04-17. Предыдущие сессии: S1+S2+S3+S4+S5+S6 сделаны, закоммичены.

## Контекст (прочитай ТОЛЬКО эти файлы)

1. `C:\Claude playground\Pipiline setupper\PIPELINE_AUDIT_2026-04-17.md` — каталог 19 багов (если ещё актуален)
2. `C:\Claude playground\Pipiline setupper\audit\S6_architect_cto\CHANGES.md` — что сделано в S6
3. `C:\Users\user\.claude\projects\C--\memory\MEMORY.md` — автопамять

НЕ читай все JSONL и не перечитывай отчёты S1-S5 — они свою работу уже сделали.

## Что сделано

- **S1** (`c5710f0`): метрики из 3 проектов, найдены паттерны token burn
- **S2** (`c5710f0`): 19 багов с proof'ами
- **S3** (`b41d941`): autocompact 65→88, ctxBudget 80k→130k, warning 200→32ch. 80/80
- **S4** (`3570047`): errors.log жив, tool-results TTL cleanup, pathnorm helper, loop-guardian blockAt, edit-enforcer metrics. 80/80
- **S5** (`3bdc8af`): project-docs-gate hard-block с `Skill(init-project)`, /pipeline v3 orchestrator, pipeline-state.json schema + sub-skills integration. 80/80
- **S6**: B03 file-size rule (CHECK 5 в edit-enforcer + precheck в /pipeline + non-negotiable в architect-first + §1 в cto-playbook), scope-разделитель architect-first ↔ cto-playbook, real-world test в Izi tracker. 80/80.

Git репо: `C:\Claude playground\Pipiline setupper` (локальный, main branch). Ветка C:\ — другой репо, НЕ коммить туда.

## Что делать в S7 (red-team refactor + /prime audit)

Скоуп: скиллы для audit/security + cold-start workflows.

- **`/red-team` refactor** — если SKILL.md >5K или дублирует `/security-best-practices`: разделить, оставить в red-team оффенсив (OWASP Top 10 scanners, exploit verification), а в security-best-practices — defensive-by-default coding.
- **`/prime` cold-start smoke test** — запустить в Izi tracker и в одном свежем проекте (например sudoviy master try 3 → sudovi-master). Проверить что context7 подхватывается, CLAUDE.md парсится, env vars перечисляются. Если padding/redundancy → подрезать.
- **`/checkpoint` + `/learn` integration** — после ship-gate проверить что /learn экстрактит паттерны в `~/.claude/skills/learned/`, `/checkpoint` пишет snapshot. Fix любые pipes, которые не дотекают.
- **Cross-tool sync** — проверить что `~/.codex/hooks.json` и `~/.claude/settings.json` не расходятся после S3-S6 (особенно config.json reference). Если Codex не видит config.json — добавить.

## Правила работы

1. **Real testing, не теория.** Любое трогание скилла → тестируется в dev-проекте. Прикладывать tool-call trace или metrics diff.
2. **Hook тесты.** 80/80 должны пройти (test-all, test-behavior, test-codex).
3. **Trust but verify subagents.** Reminder из S1.
4. **Windows bash:** `;` вместо `&&`. Forward slashes в путях.
5. **Не раздувай область.** S7 = red-team + prime + learn/checkpoint + codex sync. Остальное в S8.
6. **Context7 mandatory** перед любыми незнакомыми API вызовами.
7. **MEMORY.md ~82 строк сейчас (warn at 80)** — при добавлении сжимать через /learn.

## Структура коммитов

Один коммит на спринт. Снэпшот в `audit/S7_redteam_prime/`:

```
audit/S7_redteam_prime/
├── CHANGES.md
└── after-<file>.{md,js,json}
```

Commit message: `audit: S7 red-team refactor + prime smoke + codex sync`.

## Что НЕ делать

- Не трогать /pipeline, /architect-first, /cto-playbook (S5+S6 done).
- Не менять хуки кроме минимальных edge-case фиксов.
- Не рефакторить settings.json consolidation — S8.

## Старт

TaskList → TaskCreate 4 задачи (red-team audit, prime smoke, learn/checkpoint pipe, codex sync) → в работу.

Когда закончишь S7 — пиши prompt для S8 в `audit/NEXT_SESSION_PROMPT.md` (перезапиши).

Цель S7: red-team чёткий и не дублирует defensive, /prime работает в cold-start, /learn + /checkpoint реально пишут артефакты, Codex config в синке, 80/80 хук-тестов, один коммит.
