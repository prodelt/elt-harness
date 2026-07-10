## Checkpoint - 2026-07-07 ~17:30

### Build Status
- Pipeline Setupper: не код-сессия (доки/презентации)
- prompt_party_demo: `cargo test --workspace` → **18 passed, 0 failed** (проверено живьём в этой сессии)

### Test Metrics
- prompt_party_demo oracle (`just test`): 18/18 passed
- `node tools/project-docs.js audit --root .` (prompt_party_demo) → WARN: drift (AGENTS.md/CLAUDE.md/GEMINI.md разъехались, не мёртвая утечка)

### Code Modifications Since Last Checkpoint
- Files created: `.planning/CHECKPOINT-2026-07-07-harness-talk-full-theory-script.md` (закрыт прошлым чекпоинтом)
- В этой сессии — только анализ, правок кода/файлов не делал (кроме чтения)

### Git State
- **Pipeline Setupper**: branch main, last commit `d9413aa`; `presentation/` всё ещё untracked; несколько CHECKPOINT-*.md untracked (не мешает, история)
- **prompt_party_demo** (`C:\Claude playground\prompt_party_demo`): branch по умолчанию, last commit `8eee6d2` (T010 final smoke cleanup); working tree чист кроме нового untracked checkpoint-файла

### Completed Tasks
- Проанализирован `prompt_party_demo` (новый демо-проект пользователя — Rust+Tauri Tetris, собран через elt-loop): spec `001-tetris-bootstrap` полностью закрыта (T001-T010), `.planning/loop-run-log.md` реально заполнен (дата/слайс/попытки/оракул/вердикт), oracle зелёный прямо сейчас (18/18 cargo test)
- **Найдена критическая дыра**: в `prompt_party_demo` НЕТ git pre-commit гейта (`.git/hooks/` только `.sample`, husky не установлен). Это значит Акт 3 демо-сценария (DEMO-RUNBOOK/SPEAKER-SCRIPT — «ломаю форматирование → коммит → гейт ОТКЛОНЯЕТ», главный money-shot доклада) **на этом проекте прямо сейчас не сработает** — коммит с плохим форматом просто пройдёт
- Второстепенно: AGENTS.md/CLAUDE.md/.gemini/GEMINI.md в prompt_party_demo разъехались (drift-warning от project-docs.js audit) — не блокер для демо, но стоит поправить раз уже делали то же для Izi Tracker
- Предложил пользователю: добавить pre-commit хук (fmt-check → clippy → test, PowerShell, т.к. justfile уже на PowerShell-шелле) — **пользователь ещё не ответил**, вместо этого написал непонятное сообщение про "чат с кодекс" — не проинтерпретировано, нужно уточнить в новом чате

### Remaining Work
- **Главное открытое действие**: установить git pre-commit гейт в `prompt_party_demo` (иначе Акт 3 демо не работает) — ждёт подтверждения пользователя
- Уточнить у пользователя, что он имел в виду под «чат с кодекс, они не поймут в чем дело» — вероятно про показ чего-то в Codex CLI/чате, сообщение оборвано
- Не забыть: harness-loop-talk.html визуально не проверена в браузере (осталось с прошлого чекпоинта)
- Не забыть: SPEAKER-SCRIPT.md не читан вслух с секундомером (осталось с прошлого чекпоинта)
- presentation/ (Pipeline Setupper) и prompt_party_demo (свои файлы AGENTS/CLAUDE/GEMINI drift) — ничего не закоммичено новыми правками в этой сессии, коммитить нечего пока

### Blockers
Нет технических блокеров. Смысловой блокер — не понял последнее сообщение пользователя, нужно уточнение в новом чате.

### Next Steps
1. В новом чате — уточнить, что пользователь имел в виду про "чат с кодекс, не поймут"
2. Если пользователь подтвердит — поставить git pre-commit хук в `prompt_party_demo` (fmt-check/clippy/test под PowerShell) для Акта 3
3. Затем — визуальная проверка `harness-loop-talk.html` в браузере + читка `SPEAKER-SCRIPT.md` с секундомером

### Resume Pointer
- Focus: демо-проект для доклада — `prompt_party_demo` (Rust+Tauri Tetris, спека закрыта, oracle зелёный), но БЕЗ git-гейта — главный money-shot доклада (Акт 3, «гейт отклоняет коммит») не воспроизведётся, пока не поставлен pre-commit хук.
- Resume: спросить пользователя, ставим ли pre-commit гейт в `C:\Claude playground\prompt_party_demo` (PowerShell-скрипт: `cargo fmt --check` → `cargo clippy -- -D warnings` → `just test`), затем поставить его; и уточнить обрывочное сообщение про "чат с кодекс".
