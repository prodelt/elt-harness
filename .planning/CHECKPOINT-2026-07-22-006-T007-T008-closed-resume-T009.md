# Checkpoint — 2026-07-22 (006 T007+T008 закрыты, resume T009)

## Что закрыто в этой сессии
- **Блокер судьи (межрепо-слепота) починен** (`8ea6a55`): `tools/fleet/gate.js` теперь находит
  git-корень файлов из `[files:]`-зоны задачи ВНЕ cwd-репо (`expandHome`/`gitRoot`/
  `externalRepoRoots`/`slurpExternalDiffs`) и подмешивает их diff в промпт судьи отдельной
  секцией «ВНЕШНИЙ РЕПО» — раньше судья видел пустой/нерелевантный дифф cwd-репо и REJECT-default
  блокировал легитимную работу в `~/.claude` (задокументировано в прошлом чекпоинте). 3 новых
  теста в `gate.test.js` (16/16 зелёные), проверено sonnet-судьёй (pass).
  - ⚠ Первый заход на судью был через `codex:rescue` (Codex-форк) — завис на PowerShell-разведке
    (codegraph signing policy + сам сгенерировал битый PS while-цикл), >20 мин без вердикта.
    Прерван по просьбе юзера, баг зафиксирован в памяти
    (`feedback_codex_rescue_fork_hangs_powershell.md`), переключились на sonnet-судью (Agent tool,
    `model: "sonnet"` явно) — с тех пор весь чат идёт на sonnet-судье.
- **006 T007 закрыт** (`3d77205`): grill-me v2 SKILL.md уже существовал с прошлой сессии
  (`~/.claude` commit `ac664d2`), закрыт был только контракт-тест
  `tools/skills-frontgate-contract.test.js` (7 тестов: наличие, frontmatter, протокол v2,
  4 категории вопросов, UI-варианты, секция «## Решения», побайтовая идентичность зеркал
  codex/gemini). Судья sonnet — pass.
- **006 T008 закрыт** (`d382049`): `~/.claude/skills/elt/SKILL.md` → v2.5.0 — (1) `grill-me`
  обязателен (не «если непонятно») в 3 случаях: новый проект / нет зафиксированных решений /
  UI-задача; (2) шаблон `spec.md` = секции `elt spec lint` + обязательная Mermaid-схема; (3)
  судейская рубрика += «Спека утверждена?» как вторая независимая линия защиты рядом с CLI-гейтом
  T002. Зеркала codex/gemini синхронизированы хирургическим cp (НЕ `sync-agent-surface --force`
  — см. [[feedback_sync_agent_surface_force_scope]]). Контракт-тест
  `tools/elt-skill-frontgate-contract.test.js` (5 тестов). Судья sonnet — pass.
  - Гочта по пути: `elt commit --task T008` дважды падал — сначала approval `stale` (T007 сделал
    `[X]` после последнего approve → тихий re-approve разрешён, т.к. diff tasks.md был
    ИСКЛЮЧИТЕЛЬНО `[ ]`→`[X]`), затем judge proof `stale-tree` (approval.json пересобрал tree
    hash уже ПОСЛЕ записи judge proof) → судья писал proof ДВАЖДЫ, второй раз после
    `elt spec approve`. Порядок операций на будущее: commit → approve (если stale) → judge-proof
    write (после approve, не до) → commit.

Оракул проекта: 41/41 (был 39 → +1 T007-тест → +1 T008-тест).

## Дальше — Фаза C, T009 (следующий по roadmap)
`specs/006-elt-front-gate/tasks.md`:
```
- [ ] **T009** `elt loop [N] [--model X] [--dry-run]`: подкоманда спавнит драйвер (Node spawn,
  не PS-заклинание); путь драйвера: env `ELT_DRIVER` → дефолт
  «C:\Claude playground\Pipiline setupper\tools\elt-loop.ps1»; флаги прокидываются.
  Тест (dry-run). [files: ~/.claude/bin/elt.js, tools/elt-loop-cmd.test.js]
```
Разведка уже сделана (НЕ закоммичено, чисто read-only): `elt.js` диспетчит команды через
`if (cmd === '...')` начиная со строки 313, argv = `process.argv.slice(2)`, `[cmd, sub] =
process.argv.slice(2)`. `elt-loop.ps1` параметры (строки 8-14): `-Project "."`, `-Slices 4`,
`-MaxMinutes 120`, `-JudgeModel "sonnet"`, `-SpecDir ""`, `-DryRun` (switch). Новую команду
`loop` нужно добавить как `if (cmd === 'loop') { ... }` перед финальным usage-блоком (строка
602), спавнить `powershell -File <ELT_DRIVER> -Project <cwd> -Slices <N> -JudgeModel <model
из --model> ...` через `spawnSync`/`spawn` (не строкой в `sh()`), с `--dry-run` → `-DryRun`
switch. Тест `tools/elt-loop-cmd.test.js` — по паттерну других `elt-*-cmd`/`elt-*.test.js`
(temp-репо, стаб вместо реального PS-драйвера, проверка что argv драйвера собран правильно и
что `--dry-run` не запускает реальный прогон).

## Resume Prompt
```
/elt продолжай roadmap specs/006-elt-front-gate: T009 (`elt loop [N] [--model X] [--dry-run]`
подкоманда в ~/.claude/bin/elt.js, спавнит tools/elt-loop.ps1 через Node spawn, ENV ELT_DRIVER
переопределяет путь). Разведка кода уже сделана в прошлой сессии (см. чекпоинт), сама
реализация ещё не начата.
```
