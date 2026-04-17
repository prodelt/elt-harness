# Prompt для новой сессии (S5)

Скопируй текст ниже в новый чат.

---

Продолжаем Pipeline Audit 2026-04-17. Предыдущие сессии: S1+S2+S3+S4 сделаны, закоммичены.

## Контекст (прочитай ТОЛЬКО эти файлы, не больше)

1. `C:\Claude playground\Pipiline setupper\PIPELINE_AUDIT_2026-04-17.md` — каталог 19 багов
2. `C:\Claude playground\Pipiline setupper\audit\S4_hook_bugfixes\CHANGES.md` — что сделано в S4
3. `C:\Users\espad\.claude\projects\C--\memory\MEMORY.md` — автопамять

НЕ читай все JSONL и не перечитывай S1/S2/S3 отчёты — они свою работу уже сделали.

## Что сделано

- **S1** (`c5710f0`): метрики из 3 проектов, найдены паттерны token burn
- **S2** (`c5710f0`): 19 багов с proof'ами
- **S3** (`b41d941`): autocompact 65→88, ctxBudget 80k→130k, warning 200→32ch. 80/80
- **S4**: errors.log жив, tool-results TTL cleanup, pathnorm helper, loop-guardian blockAt, edit-enforcer metrics. 80/80

Git репо: `C:\Claude playground\Pipiline setupper` (локальный, main branch). Ветка C:\ это другой репо — НЕ коммить туда.

## Что делать в S5 (skills + docs automation)

Скоуп: починить баги, связанные со скиллами и автогенерацией документации.

- **B04** — `/init-project` не вызывается автоматически: `project-docs-gate.js` только предупреждает. Задача: при отсутствии CLAUDE.md + наличии >10 файлов проекта → автоматически выполнить Skill tool (`/init-project`), не просто warning. Продумать как пробрасывать skill invocation из SessionStart хука. Если Claude Code harness не позволяет хуку запустить skill, то компромисс: hard block (exit 2) с единственно верным next-action.
- **B08** — `/pipeline` SKILL.md сейчас декларативный: "Step 1: read context ...". Переписать как orchestrator, реально вызывающий под-скиллы через Skill tool: `Skill("architect-first") → Skill("sprint") → Skill("inline-review") → Skill("ship")`. Добавить checkpoint между шагами.
- **B14** — каждый Skill() добавляет свой SKILL.md в контекст → nested skill = n×SKILL.md. Решение: shared `~/.claude/pipeline-state.json` — один раз пишется orchestrator'ом, sub-skills читают оттуда minimal context вместо re-injection.
- **B03 (частично)** — правило "файлы >500 LOC = red flag, требуют разбиения перед Edit" в `/architect-first` и `/cto-playbook`. Harness не починить, но организационная мера работает.

## Правила работы

1. **Real testing, не теория.** После правки скилла → реально запустить его в dev-проекте (sudovoi/tgbot), проверить что действительно срабатывают шаги, которые декларирует SKILL.md. Показать proof.
2. **Hook тесты тоже.** Если трогаешь хуки — 80/80 должны пройти (test-all, test-behavior, test-codex).
3. **Trust but verify subagents.** S1 subagent накосячил с тремя FALSE claims.
4. **Windows bash:** `;` вместо `&&`. Forward slashes в путях.
5. **Не раздувай область.** S5 = скиллы и автогенерация docs. Остальное в S6-S8.
6. **Context7 mandatory** перед любыми незнакомыми API вызовами.
7. **MEMORY.md >80 строк = warn, >100 = block.** Проверь актуальное состояние.

## Структура коммитов

Один коммит на спринт. Снэпшот изменённых файлов в `audit/S5_skills_refactor/`:

```
audit/S5_skills_refactor/
├── CHANGES.md
├── after-<file>.md  ← копии изменённых скиллов/хуков
```

Commit message: `audit: S5 skills + docs automation (B04, B08, B14)`.

## Что НЕ делать

- Не переписывать все 70+ скиллов — точечно B04, B08, B14.
- Не трогать хуки кроме `project-docs-gate.js` (для B04).
- Не менять settings.json глобально.
- `/red-team`, `/cto-playbook` полный рефактор — это S6-S7.

## Старт

TaskList → TaskCreate 4 задачи (B04, B08, B14, + commit) → в работу.

Когда закончишь S5 — пиши prompt для S6 в `audit/NEXT_SESSION_PROMPT.md` (перезапиши).

Цель S5: `/init-project` auto-invocation работает, `/pipeline` реально делегирует через Skill tool, pipeline-state.json внедрён, 80/80 hook тестов зелёные, один коммит.
