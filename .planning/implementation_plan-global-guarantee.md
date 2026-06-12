# Implementation Plan — «Гарантированно работает глобально»

> Цель: закрыть три пробела «негарантированности» во всех проектах: авто-граф,
> дисциплина 3+ файлов, напоминание про /pipeline. Решения пользователя:
> (1) ужесточить advisory→block; (2) авто-граф в фоне на SessionStart.

## Что технически возможно (честная граница)

| Слой | Сейчас | Можно ли «block» | План |
|---|---|---|---|
| Защита (secrets/git/commit/config/ctx7/tool-policy) | 14 hard-block, глобально | уже block | проверить, что срабатывает в любом cwd |
| Дисциплина 3+ файлов | текст в domain-agent-gate (`allow`) | **да**, PreToolUse Write\|Edit | **новый hard-block с escape** |
| Выбор /pipeline на старте | текст (SessionStart) | **нет** (нет subject) | усилить формулировку |
| Stop-гейты (ship/harness/verify) | advisory | **нет** (block=петля) | не трогаю |
| Граф per-project | первичная сборка ручная | n/a | **авто-сборка в фоне** |

Дословное «ВСЁ advisory→block» невозможно для SessionStart/Stop — там блокировать
нечего/опасно. Ужесточаю там, где блок осмыслен и безопасен.

## Изменения

### 1. Авто-граф: первичная фоновая сборка (`hooks/graphify-session-init.js`)
- Ветка `if (!graphPath)` (стр. 68): вместо silent-exit — запустить
  `spawn(bin, ['update','.'], {cwd, detached, stdio:'ignore'}).unref()`.
- **Throttle**: lock-файл `os.tmpdir()/claude-graph-init/<hash(cwd)>.ts`, не запускать
  чаще раза в 24ч (иначе сборка на каждый SessionStart = нагрузка).
- Только для реальных проектов (isProject уже проверен, стр. 32-35).
- Инжектить строку: «GRAPH BOOTSTRAP started in background — ready next turn».

### 2. Дисциплина 3+ файлов → hard-block (новый `hooks/plan-enforcement-gate.js`)
- PreToolUse, matcher `Write|Edit`.
- Трекать уникальные пути, отредактированные за сессию (state в `os.tmpdir`, 4ч окно).
- На **3-м** новом файле → `permissionDecision: 'deny'` с подсказкой «Запусти
  /architect-first или /pipeline — план для 3+ файлов».
- **Escape-клапаны (allow), чтобы не сломать легитимную работу:**
  - есть `implementation_plan.md` / `*implementation_plan*.md` в cwd;
  - pipeline/architect уже вызван (читать pipeline-tracker state);
  - env `AMOS_NO_PLAN_GATE=1` (аварийный обход);
  - правки внутри `~/.claude/` (саму инфраструктуру не блокируем).
- Регистрация в `settings.json` → PreToolUse Write|Edit (после domain-agent-gate).

### 3. Усилить напоминание про /pipeline (`hooks/autoskills-check.js`)
- Добавить строку: «Нетривиальная задача (3+ файлов/новая фича)? Запусти /pipeline ПЕРВЫМ — иначе plan-gate заблокирует 3-й файл.»
- Остаётся SessionStart-текст (не block), но теперь предупреждает о новом гейте.

### 4. Починить WARN doctor
- `node tools/git-workflow-audit.js --root .` (stale от 2026-06-03).

## Верификация (пруфы до «done»)
1. `node ~/.claude/hooks/test-all-hooks.js` → 35/35 (новый хук не ломает).
2. `node ~/.claude/hooks/test-hooks-behavior.js` → BLOCK/ALLOW, включая новый кейс plan-gate (3-й файл deny, escape allow).
3. Ручной тест глобальности: прогнать plan-gate с `cwd` = tmp-репо (не этот проект) → deny срабатывает.
4. `node tools/doctor.js` → без WARN.
5. Авто-граф: зайти в проект без графа → лог фоновой сборки, lock создан.

## Риск / откат
- Всё в git (`~/.claude` @ 00ce87e чистый). Откат = `git revert` / удалить новый хук + строку в settings.
- plan-gate имеет 4 escape-клапана + env-обход → не может «запереть» работу.
- Throttle графа исключает повторную сборку-нагрузку.

## Объём: 3 правки + 1 новый файл + settings.json + аудит. Тесты обязательны.
