# Prompt для новой сессии (S6)

Скопируй текст ниже в новый чат.

---

Продолжаем Pipeline Audit 2026-04-17. Предыдущие сессии: S1+S2+S3+S4+S5 сделаны, закоммичены.

## Контекст (прочитай ТОЛЬКО эти файлы, не больше)

1. `C:\Claude playground\Pipiline setupper\PIPELINE_AUDIT_2026-04-17.md` — каталог 19 багов
2. `C:\Claude playground\Pipiline setupper\audit\S5_skills_refactor\CHANGES.md` — что сделано в S5
3. `C:\Users\user\.claude\projects\C--\memory\MEMORY.md` — автопамять

НЕ читай все JSONL и не перечитывай S1/S2/S3/S4 отчёты — они свою работу уже сделали.

## Что сделано

- **S1** (`c5710f0`): метрики из 3 проектов, найдены паттерны token burn
- **S2** (`c5710f0`): 19 багов с proof'ами
- **S3** (`b41d941`): autocompact 65→88, ctxBudget 80k→130k, warning 200→32ch. 80/80
- **S4** (`3570047`): errors.log жив, tool-results TTL cleanup, pathnorm helper, loop-guardian blockAt, edit-enforcer metrics. 80/80
- **S5**: project-docs-gate hard-block с `Skill(init-project)`, /pipeline v3 orchestrator, pipeline-state.json schema + sub-skills integration. 80/80

Git репо: `C:\Claude playground\Pipiline setupper` (локальный, main branch). Ветка C:\ это другой репо — НЕ коммить туда.

## Что делать в S6 (architect-first + cto-playbook + file-size discipline)

Скоуп: organizational rules + скиллы для core development workflow.

- **B03 (organizational fix)** — Edit tool_result 30K burn: добавить в `/architect-first` и `/cto-playbook` жёсткое правило "файлы >500 LOC = red flag, требуют разбиения ПЕРЕД Edit". В `/pipeline` precheck: если target файл >500 LOC → warn + предложить сначала split. Harness-level fix невозможен, но организационная мера работает.
- **`/cto-playbook` refactor** — сейчас 76K+ с тяжёлыми промптами. Профайл: что реально используется? Выжать до core 150 строк + ссылки на references (split в sub-docs). Проверить что `ENABLE_TOOL_SEARCH=auto:10` действительно держит его lazy.
- **`/architect-first` integration с pipeline-state.json** — уже preamble добавлен в S5, но сам skill всё ещё велик. Аудит на overlap с cto-playbook (оба про architecture) — deduplicate.
- **Real-world тест**: открыть sudovoi или tgbot → запустить `/pipeline` → проверить что `~/.claude/pipeline-state.json` реально создаётся, `Skill(inline-review)` вызывается, checkpoints обновляются. Показать proof.

## Правила работы

1. **Real testing, не теория.** После правки скилла → реально запустить в dev-проекте, проверить что отрабатывают декларированные шаги. Показать proof (tool-call traces или metrics).
2. **Hook тесты тоже.** Если трогаешь хуки — 80/80 должны пройти (test-all, test-behavior, test-codex).
3. **Trust but verify subagents.** Reminder из S1: три FALSE claims от subagent'а.
4. **Windows bash:** `;` вместо `&&`. Forward slashes в путях.
5. **Не раздувай область.** S6 = architect-first + cto-playbook + file-size rule. Остальное в S7-S8.
6. **Context7 mandatory** перед любыми незнакомыми API вызовами.
7. **MEMORY.md >80 строк = warn, >100 = block.** Сейчас ~82 — аккуратно с добавлениями, предпочесть /learn compression.

## Структура коммитов

Один коммит на спринт. Снэпшот изменённых файлов в `audit/S6_architect_cto/`:

```
audit/S6_architect_cto/
├── CHANGES.md
├── after-<file>.md
```

Commit message: `audit: S6 architect-first + cto-playbook + file-size rule (B03)`.

## Что НЕ делать

- Не трогать /pipeline (S5 done).
- Не менять хуки (S4 done), кроме добавления file-size check в edit-enforcer если критично.
- Не рефакторить /red-team — это S7.
- Не трогать `settings.json` / `hooks/config.json` консолидацию — S8.

## Старт

TaskList → TaskCreate 4 задачи (B03 rule, cto-playbook diet, architect-first dedup, real-world test) → в работу.

Когда закончишь S6 — пиши prompt для S7 в `audit/NEXT_SESSION_PROMPT.md` (перезапиши).

Цель S6: file-size rule работает в 2 скиллах, cto-playbook slim, architect-first без overlap с cto, real proof через sudovoi/tgbot, 80/80 hook тестов зелёные, один коммит.
