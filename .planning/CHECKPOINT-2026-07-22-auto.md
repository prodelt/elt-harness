# Checkpoint — 2026-07-22 (сессия закрывается по порогу контекста, не по задаче)

## Что закрыто в этой сессии
- **006 T019 закрыт** (`a148655` в Pipeline Setupper): routing-фикс `elt slice next --spec
  specs/NNN-slug` + `elt-loop.ps1 -SpecDir <path>` — обходит алфавитный скан `findTasks()`,
  который иначе всегда резолвил `specs/005-...` (не утверждена) вместо активной 006. Синхронно
  правится `~/.claude/bin/elt.js` И `tools/elt.js` этого репо (побайтовые зеркала).
- **`~/.claude` git-репо наведён в порядок** (4 коммита: `61a48d7`, `227a9ae`, `ac664d2` + один
  auto-checkpoint коммит `57e9021` в Pipeline Setupper): `.gitignore` расширен под runtime-каталоги
  (`plugins/` 116К файлов, `security/` с Python venv, `mcp-servers/`, `sessions/`, кэши/бэкапы,
  `__pycache__`), закоммичен весь накопленный курируемый контент (60 новых скиллов, ~39 хуков,
  критичные `bin/elt-config.js`+`bin/run-log.js`), формализована миграция 16 `agents/*.md` →
  native agent library. Оба репо (`~/.claude` и Pipeline Setupper) сейчас **чистые**.

## Что НЕ закрыто — 2 отдельных пункта на следующий чат

### 1. `~/.claude/skills/gstack` и `~/.claude/skills/skill-anything` — вложенные git-репо с драйфом
Обнаружены как **gitlinks** (submodule-режим, mode 160000) внутри `~/.claude` — у каждого свой
`.git`, склонированы с `github.com/garrytan/gstack` и `github.com/AgentSkillOS/SkillAnything`.
Внутри у обоих реальный незакоммиченный дрифт относительно своего же `origin/main`:
- `gstack`: ~52 изменённых файла (почти все `*/SKILL.md` + `openclaw/gstack-*-CLAUDE.md` +
  `scripts/proactive-suggestions.json`) — похоже на результат `gstack-upgrade` или локальной
  правки промптов, никогда не закоммиченный.
- `skill-anything`: `SKILL.md` изменён + новый `USAGE.md` untracked.
**Не трогал вообще** (только `git status`/`git branch`/`git remote -v` read-only) — решение
неочевидное: закоммитить локально (fork от upstream), сравнить diff и понять что реально
поменялось (может быть просто версия apstream подтянулась криво), или `git reset --hard
origin/main` чтобы просто откатить к чистому upstream и потерять локальные правки. Нужно сначала
посмотреть **содержание** диффа (не только stat) прежде чем решать — не делал из-за нехватки
контекста в этой сессии.

### 2. Спека 006 — резюме с T007
Судья заблокировал T007 (grill-me v2), потому что `judge-invoke.js` кормится только `git diff
HEAD` репо Pipeline Setupper и не видит правки в `~/.claude` (отдельный репо). Реализация T007
реально существует на диске (`~/.claude/skills/grill-me/SKILL.md` + codex/gemini зеркала,
**теперь уже закоммичены** в рамках наведения порядка выше) — просто судья её не видел ТОГДА.
Нужно либо (a) починить `judge-invoke.js`, чтобы кормить судье diff обоих репо явно, либо (b)
для skill-задач подавать судье готовый диф `~/.claude` вручную в промпте. Частичный тест-файл
T007 лежит в session scratchpad (потерян при смене чата — придётся заново проверить, что там
было, или просто пересмотреть diff `~/.claude` напрямую, раз он уже закоммичен `ac664d2`).
Полный разбор находок — `project_elt_front_gate_006_2026-07-20.md` в памяти проекта.

## Resume Prompt (выбери с чего начать)
```
/elt — резюме 006: T007 (grill-me v2) заблокирован судьёй из-за межрепо-слепоты judge-invoke.js
(~/.claude — отдельный git от Pipeline Setupper). SKILL.md-правки T007 уже реально в git
(~/.claude commit ac664d2). Почини judge-invoke.js чтобы он видел diff обоих репо, либо перекорми
судью явным diff ~/.claude в промпте для skill-задач. Дальше продолжай roadmap specs/006-elt-front-gate
(T007-T018) через elt-loop.ps1 -SpecDir specs/006-elt-front-gate.
```
Или, если сначала гигиена вложенных репо:
```
Разберись с ~/.claude/skills/gstack и skills/skill-anything — вложенные git-репо (gitlinks) с
незакоммиченным локальным дрифтом относительно origin/main. Посмотри РЕАЛЬНЫЙ дифф (не только
stat) каждого прежде чем решать: коммитить локально как форк, или git reset --hard origin/main.
```
