# S4 — Hook Bugfixes

**Date:** 2026-04-17
**Target bugs:** B01, B05, B06, B07, B10, B11, B15
**Status:** done — 80/80 тестов зелёные

## Что починено

### B01 — errors.log dead → live
`lib/logger.js` уже существовал (rotation, 5MB) но не импортировался. Подключил в 7 критичных хуков:

- `edit-enforcer.js` — logger.warn на BLOCK; metrics.inc на каждом пути (parse_error, skip_ext, skip_path, warned, blocked, allowed) → B07 дополняет.
- `loop-guardian.js` — logger.warn на BLOCK 6x+; logger.error в catch.
- `secret-scanner.js` — logger.warn на CAREFUL BLOCK и SECRET BLOCK; logger.error в catch.
- `memory-discipline.js` — logger.warn на BLOCK (>100 строк).
- `config-protection.js` — logger.warn на BLOCK edit.
- `graphify-read-gate.js` — logger.warn на BLOCK.
- `project-docs-gate.js` — logger.warn на BLOCK (no docs).
- `stop-verification.js` — logger.error в catch (edit-count check).

Результат: `errors.log` теперь живой — после прогона всех тестов содержит ~20 записей. Pruv:

```
$ ls -la ~/.claude/hooks/errors.log
-rw-r--r-- 1982 Apr 17 21:12 errors.log
```

### B05 — tool-results/ TTL cleanup
В `session-focus-gate.js` (SessionStart) добавлена safe-fire-and-forget функция `cleanupToolResults()`.

- TTL = `config.loopGuardian.toolResultsTtlDays` (7 дней по умолчанию).
- Sentinel-файл `tmp/claude-tool-results-cleanup.ts` rate-limit'ит запуск до ~1 в сутки.
- Перебирает `~/.claude/projects/*/tool-results/` и `~/.claude/projects/*/*/tool-results/` → удаляет `.txt` старше TTL.
- Никогда не крашит хук (двойной try/catch), никогда не блокирует.
- При реальной очистке пишет `metrics.inc('session-focus-gate', 'tool_results_purged')`.

### B06 — lowercase `d--` path normalization
Новая утилита `lib/pathnorm.js`:
- `normCwd(cwd)` — uppercase диск-letter, forward slashes, strip trailing slash.
- `encodeProjectDir(cwd)` — `C:/Users/user/foo` → `C--Users-user-foo`.
- `sameCwd(a, b)` — case-insensitive сравнение для Windows.

Применено в 5 хуках, берущих `input.cwd`:
- `graphify-session-init.js`
- `project-docs-gate.js`
- `autoskills-check.js`
- `graphify-read-gate.js`
- `stop-verification.js`

Все они теперь видят один и тот же нормализованный путь независимо от того, был ли `cd` сделан в cmd (`d:/`) или PowerShell (`D:/`).

### B07 — edit-enforcer metrics coverage
`edit-enforcer.js` теперь инкрементит метрики на каждом пути:

| Path | Counter |
|---|---|
| JSON parse fail | `parse_error` |
| skipExt match | `skip_ext` |
| skipPaths match | `skip_path` |
| deny output | `blocked` |
| warn output | `warned` |
| silent allow | `allowed` |

Прогон `hook-stats.js` после тестов больше не будет показывать "edit-enforcer тихий" — видно, где и почему он пропустил edit.

### B10/B11 — loop-guardian fingerprint upgrade
Добавлен второй слой детекции "same file" (Layer B):

- **Layer A — exact repeat** (существовал): same command / same `old_string` → warn at 3, **NEW: block at 6**.
- **Layer B — same file touched** (NEW): файл встречается в `fileTouches` массиве ≥ 5 раз (независимо от `old_string`) → advisory `FILE LOOP: X edited N times`.

Window для `fileTouches` расширен до 20 (Layer A window остался 10). Оба слоя перс
тят в том же `history.json` с sha session TTL.

### B15 — loopGuardian.blockAt
`config.json` и `lib/config.js` DEFAULTS:

```diff
 "loopGuardian": {
   "historyWindow": 10,
-  "repeatWarn": 3
+  "repeatWarn": 3,
+  "blockAt": 6,
+  "sameFileWarn": 5,
+  "toolResultsTtlDays": 7
 }
```

`loop-guardian.js` теперь имеет `BLOCK_AT = cfg.loopGuardian.blockAt || 6`:
- 3-5 повторов → warn (stderr + exit 2, как раньше).
- 6+ повторов → BLOCK с сообщением `LOOP BLOCK: ... (threshold=6). STOP. Re-read the error.`

## Test state isolation
Оба test runner'а теперь чистят TTL-state (`claude-loop-guardian`, `claude-context-gate`, `claude-session-focus`) перед прогоном — так stale history не кросс-контаминирует запуски.

Без этого fix'а после 3+ `npm test` подряд loop-guardian справедливо блокировал повтор actionKey `bash:npm test` в тестовом прогоне.

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

errors.log за время прогона тестов набрал ~20 записей (секреты, careful-blocks, memory-discipline block) — это экспектация, B01 починен.

## Что НЕ вошло (по scope-правилу из NEXT_SESSION_PROMPT)

- `/pipeline`, `/cto-playbook`, `/red-team` и прочие skills — это S5-S7.
- `/init-project` auto-invocation — S5 (B04).
- Edit tool_result 119KB burn — harness-level, S5/S6.
- Консолидация `settings.json` + `hooks/config.json` — S8 (B12).

## Snapshot

Все изменённые файлы в этой директории с префиксом `after-`. Before-версии доступны через `git show b41d941:<path>`.

## Next (S5)

Следующий чат — скиллы и автоматизация docs:
- B04: `/init-project` auto-invocation при отсутствующих CLAUDE.md на >10-файловых проектах.
- B08: `/pipeline` orchestration через реальный Skill tool вместо декларативного текста.
- B14: shared pipeline-state.json вместо многократной перезагрузки SKILL.md.
- B09/B18: эксперимент с lazy skill descriptions.
