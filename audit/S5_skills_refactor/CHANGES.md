# S5 — Skills + Docs Automation

**Date:** 2026-04-17
**Target bugs:** B04, B08, B14
**Status:** done — 80/80 тестов зелёные

## Что починено

### B04 — /init-project force-invoke через hook (hard block)

Harness-ограничение: SessionStart хук не может напрямую запустить Skill tool (это делает LLM, не runtime). Компромисс: `project-docs-gate.js` теперь hard-блокирует с чётким single-action сообщением, явно инструктирующим Claude вызвать `Skill(skill="init-project")`.

**Изменения в `hooks/project-docs-gate.js`:**

1. **Дополнительная project-detection** (`CODE_EXTS` + `CODE_DIRS`): если нет indicator-файлов (package.json и т.д.) но есть `.ts/.py/.go/...` файлы в `cwd` или `src/app/lib/pages/...` — это всё равно проект. Избегает false-positive в `$HOME/Documents` style folders.
2. **Переписан block-message:**
   - Теперь содержит `Skill(skill="init-project")` явной инструкцией.
   - Перечисляет detected indicators (или пометку "via file count").
   - Явный запрет на обходные пути (answer before docs, create docs manually, bypass via other tool).

**Proof:**
```bash
$ TEMP_PROJ="$USERPROFILE/AppData/Local/Temp/fakeproj-10921"
$ mkdir -p "$TEMP_PROJ"; touch "$TEMP_PROJ/package.json"
$ echo "{\"cwd\": \"C:/Users/user/AppData/Local/Temp/fakeproj-10921\"}" | node project-docs-gate.js
PROJECT DOCS MISSING — CANNOT START WORK
...
REQUIRED NEXT ACTION — invoke the Skill tool now:
    Skill(skill="init-project")
exit=2
```

### B08 — /pipeline orchestrator v3 (real Skill tool delegation)

`~/.claude/skills/pipeline/SKILL.md` полностью переписан: декларативный "Step 1: Read context" → исполняемый orchestrator с явными `Skill()` вызовами.

**Новая структура:**
- Step 0: precheck (docs + resume existing state)
- Step 1: classify (complexity verdict)
- Step 2: write `~/.claude/pipeline-state.json` (mandatory, before any Skill call)
- Step 3: route
  - MEDIUM → `Skill(inline-review)` → `Skill(ship)` with checkpoints
  - COMPLEX → `Skill(architect-first)` → `Skill(sprint)` → `Skill(inline-review)` → `Skill(ship)`
- Step 7: clear state on successful ship

**Ключевой элемент:** между каждым Skill()-вызовом orchestrator append'ит `{ phase, ts }` в `checkpoints[]` → это способ верифицировать, что sub-skill реально отработал.

### B14 — pipeline-state.json shared context

**Новый файл `~/.claude/skills/pipeline/state-schema.md`:** документирует схему state-файла, lifecycle, staleness rule, минимальные bash ops для read/write.

**Формат state:**
```json
{
  "cwd": "...",
  "task": "...",
  "complexity": "MEDIUM|COMPLEX|...",
  "stack": "...",
  "commands": { "test": "...", "lint": "...", "build": "..." },
  "domain": "frontend|backend|...",
  "phase": "classified|architected|implementing|reviewed|shipped",
  "checkpoints": [{ "phase": "...", "ts": "..." }],
  "ts": "ISO"
}
```

**Интеграция в sub-skills:** добавлен preamble `## pipeline-state (B14)` в:
- `architect-first/SKILL.md`
- `sprint/SKILL.md`
- `inline-review/SKILL.md`
- `ship/SKILL.md`

Sub-skill protocol:
1. Read state → use `task`, `stack`, `commands`, `domain` instead of re-parsing CLAUDE.md.
2. Staleness: `cwd` mismatch OR `ts` older than 24h → ignore, treat as fresh.
3. После завершения → append checkpoint entry.

**Expected token saving:** 15-25% на pipeline-run (каждый sub-skill не перечитывает CLAUDE.md ~150 строк = ~1.5K tokens × 4 sub-skills = ~6K saved).

## Proof тестов

```
$ node ~/.claude/hooks/test-all-hooks.js
Result: 26/26 PASS, 0 FAIL

$ node ~/.claude/hooks/test-hooks-behavior.js
Result: 29/29 PASS, 0 FAIL

$ node ~/.codex/test-codex-hooks.js
Result: 25/25 PASS, 0 FAIL

Total: 80/80 PASS
```

## Harness-ограничения (задокументировано)

**Claude Code hooks cannot invoke Skill tool directly.** SessionStart хуки возвращают `additionalContext` или `exit(2)` с stderr — но не могут вызвать Skill как инструмент. Fix B04 — это максимум из того, что достижимо hook-layer'ом: hard block + явная action-forcing инструкция для LLM.

Если в будущем появится `hookSpecificOutput.invokeSkill` или подобный API — можно будет переключиться на auto-invoke. Пока же rely on LLM following hard-block guidance.

## Что НЕ вошло

- `/red-team`, `/cto-playbook` полный рефактор — S6-S7.
- Edit tool_result 119KB burn (B03) — harness-level, S6.
- Конфиг-консолидация (B12) — S8.
- Real-world тест на dev-проекте (sudovoi/tgbot) — stretch goal, требует отдельной ручной сессии для proof.

## Snapshot

Все изменённые файлы в этой директории с префиксом `after-`. Before-версии — через `git show b41d941:<path>` (последний S4 коммит).

## Next (S6)

См. `../NEXT_SESSION_PROMPT.md` (перезаписан на S6 scope).
