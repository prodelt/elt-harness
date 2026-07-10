# Checkpoint - 2026-07-07

## Focus темы
Переделка двух презентаций под структуру «теория → наша система», синхронизация теста,
эталонный AGENTS.md + фикс скилла project-bootstrap.

### Build / Verify Status
- HTML структурная валидация: `node -e` tag-balance — все OK (index 16/16, agents-md-talk 16/16, tests 14 Q по 1 correct).
- Тесты движка доков: `node --test tools/project-docs.test.js` + `project-bootstrap.test.js` — PASS.
- ⚠ `tools/codemap-benchmark.test.js` — FAIL, но **pre-existing** (падает и с ревертнутой моей правкой), к делу не относится.

### Code Modifications Since Last Checkpoint
- Создано:
  - `presentation/agents-md-reference.md` — ЭТАЛОН AGENTS.md (Izi Tracker, 9 секций, Memory=указатель)
  - `presentation/index.html` — переписан целиком (Акт I теория каркаса part1+2 / Акт II наша система + таблица-мост)
  - (агенты-мд/тест — модификация, ниже)
- Изменено:
  - `presentation/agents-md-talk.html` — пример Юрко→Izi (сл. 8–11), +«как у нас» (project-bootstrap мирроринг), +2 теор.слайда в начало (RAM/диск, память=1 из 12 компонентов) → 16 слайдов
  - `presentation/tests.html` — +4 теор.вопроса в начало (каркас/RAM/Черни/«каркас=продукт»), счётчик динамический (10→14), пороги пересчитаны
  - `tools/project-docs-core.js` — `toolPreamble`: заголовок `# AGENTS.md — <name>` вместо «Claude Code Instructions» (тест на строку отсутствовал, риск мин.)
  - `~/.claude/skills/project-bootstrap/SKILL.md` — **v1.4.0 → v1.5.0** (ГЛОБАЛЬНО, не в этом репо): эталонная анатомия (таблица 9 секций), жёсткие правила, шаг ПРУНИНГА раздутого файла, closeout проверяет audit

### Git State
- Branch: main
- presentation/ — ПОЛНОСТЬЮ untracked (все презентации не в git)
- Modified: `tools/project-docs-core.js`, `.planning/STATE.md`, `.planning/elt-system-audit-latest.md`
- Last commit: d9413aa feat(doctor): step F

### Completed
- 2 презентации приведены к единой структуре «теория → разбор нашей системы»
- Тест синхронизирован с презентацией (4 теория + 10 практика = 14)
- Эталон AGENTS.md создан; project-bootstrap чинит к нему (SKILL v1.5.0 + движок)

### Remaining Work (OPEN)
1. **Привести живые файлы Izi к эталону** — `C:\Ametrin projects\Izi tracker\izi-tracker\AGENTS.md` + `CLAUDE.md` всё ещё старые (126 строк, `## Current State`-журнал, `## Claude Notes`, «Claude Code Instructions»). Перенести журнал → `.planning/STATE.md`, убрать boilerplate, заголовок → `# AGENTS.md — IZI Tracker`, затем `node tools/project-docs.js audit --root .` (без memory-leak). Это доказательство работы фикса.
2. **git-коммит `presentation/`** — вся папка untracked (index/agents-md-talk/tests/agents-md-reference/harness-loop-talk/DEMO-RUNBOOK/prompt_party_materials). Коммитить на ветке.
3. Опц.: зеркалить SKILL project-bootstrap v1.5.0 в `~/.codex/skills` + `~/.gemini/skills` (parity).

### Resume Pointer
- Focus: привести живые Izi AGENTS.md/CLAUDE.md к эталону `presentation/agents-md-reference.md` (доказать фикс bootstrap)
- Resume: открыть `C:\Ametrin projects\Izi tracker\izi-tracker\AGENTS.md`, перенести `## Current State`(стр.73-111) в `.planning/STATE.md`, убрать `## Claude Notes`/`## Pipeline Workflow`, заголовок → `# AGENTS.md — IZI Tracker`; потом `cd izi-tracker && node "C:/Claude playground/Pipiline setupper/tools/project-docs.js" audit --root .`
