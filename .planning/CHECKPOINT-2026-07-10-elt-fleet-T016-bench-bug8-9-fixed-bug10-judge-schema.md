# Checkpoint — 2026-07-10 ~18:10 — T016 fleet-бенч: баги #8 и #9 ПОЧИНЕНЫ, #10 (судья --json-schema) НАЙДЕН, блокирует весь бенч

## Build Status
- Оракул зелёный: `node tools/doctor.test.js && node --test tools/fleet/*.test.js` → doctor PASS + **58 тестов** (было 56 на старте сессии), EXIT=0.
- Ветка `feature/elt-loop-driver`. Новые коммиты сессии: `4a18997` (#8), `8a42d25` (#9).

## Задача сессии
Продолжение T016 (live-бенч fleet). Юзер: сначала починить баг #8 (unbounded retry), затем
прогнать live-бенч, **обязательно показав что работают И codex, И agy (Gemini/Antigravity)**, не только claude.

## Сделано (проверено)

### Баг #8 (unbounded retry) — ПОЧИНЕН, коммит `4a18997`
`fleet.js run()`: добавлен `maxAttempts` (деф. 3) + `attempts` Map + `recordFail(tid)`. Батч
фильтруется `!isAbandoned(s.id)`; при исчерпании — событие `batch-abandoned` в events.jsonl +
`summary.abandoned`. `recordFail` в двух точках фазы-2 (heal-failed/gate-reject `!gateOk` и
redoSerial-fail). Backstop `maxLoops=100` сохранён. Тест: воркер с всегда-красным оракулом
вызывается РОВНО 3 раза, не 100. Судья sonnet pass.

### Провайдеры — все три ЖИВЫ (live smoke, не стаб)
- claude ✅ (используется постоянно)
- **codex ✅** — ответил `PONG` за 84с (в git-репо; в tmpdir падал `Not inside a trusted directory` — артефакт smoke, в worktree не воспроизводится).
- **agy/Gemini ✅** — ответил `PONG` за 42с (холодный старт 40-90с, как и задокументировано).
- Вывод: **вопрос юзера «работают ли codex и agy» на уровне способности — ДА, доказано**. `agy.exe` на PATH, залогинен.

### Баг #9 (лог воркера засоряет дифф судьи) — ПОЧИНЕН, коммит `8a42d25`
Воркер/судья бегут с `cwd=worktree` → `providers.run` пишет лог в `<worktree>/.harness/fleet/logs/`.
`gate.slurpDiff` (`git add -N .`) стейджил его → судья видел чужой лог ВНЕ зоны `[files:]` → block.
Фикс: `ensureFleetIgnore(dir)` пишет в `.git/info/exclude` (локальный, ОБЩИЙ для worktree через
git-common-dir, НЕ коммитится/не мёржится — трекаемый `.gitignore` создавал merge-трение, сломал
resume-sweep тест в первой версии). Игнор: `logs/`, `events.jsonl`, `claims/` (НЕ fleet.json).
Вызов один — `ensureFleetIgnore(cwd)` на старте `run()`. Проверено live: в v2-прогоне
`git status -uall` в worktree T01 чист от логов. Тест #9 зелёный. Судья sonnet pass.

## НЕ ПОЧИНЕНО — баг #10 (блокирует весь бенч)

### Судья (claude) падает на своём --json-schema под Windows
Прямая улика из судейского лога v2-прогона (`<worktree>/.harness/fleet/logs/claude-*.log`):
```
Error: --json-schema is not valid JSON: JSON Parse error: Expected '}'
```
Механизм: `gate.js runJudge` → `providers.run({provider:'claude', jsonSchema: VERDICT_SCHEMA})`.
`providers.run` для `claude.cmd` спавнит с `shell: needsShell(cmd)=true` (node ≥18.20 не даёт
спавнить .cmd без shell). При `shell:true` node НЕ квотит аргументы — просто склеивает в строку
для cmd.exe. Inline-JSON `--json-schema {"type":"object",...}` с литеральными `"` рвётся cmd.exe →
claude получает битый аргумент → падает ДО оценки → пустой/ошибочный вывод → REJECT-default → **block КАЖДОГО слайса**.

**Это регрессия бага #4** (memory `project_elt_fleet_t016_judge_bugs`): его чинили ТОЛЬКО в
`tools/elt-loop.ps1` (там `\"`-экранирование для PowerShell→native-argv, строка ~148), но
**fleet-путь `providers.js`/`gate.js` этот фикс не получил** — это первый настоящий live-прогон
fleet-судьи, он его и вскрыл. Оба бенч-прогона (v1 и v2) дали `merged:[]`, 6/6 и 3/3 reject —
ВСЕ из-за #10, а не из-за codex/agy.

### Кандидат-фикс #10 (НЕ реализован, не проверен — bash-классификатор был недоступен)
Проблема — экранирование JSON-аргумента под Windows node+cmd.exe shell:true. Варианты по надёжности:
1. **temp-файл** (предпочтительно ЕСЛИ claude принимает путь): `providers.run` при `jsonSchema`
   пишет схему во временный файл, передаёт `--json-schema <path>`. НЕ ПРОВЕРЕНО принимает ли
   claude путь vs inline — это первый шаг след. сессии (тест: `claude -p "..." --json-schema <file> --output-format json`).
2. Спавнить `cmd.exe` с `['/c','claude',...args]` и `shell:false` — тогда node сам корректно
   квотит args (включая схему) через свою Windows-arg-конвенцию. Больше правки в `needsShell`/spawn.
3. `\"`-экранирование inline (как elt-loop.ps1) — хрупко под cmd.exe, cmd не понимает `\"` как PS.
Рекомендация: сначала проверить вар.1 (тривиален если работает), иначе вар.2.

## Состояние bench-репо (scratch)
`…/scratchpad/bench-repo` — пересобран v2 (base `9a1801e`, 4 слайса T01-T04 тегированы
`[cli:claude/codex/agy/codex]`, оракул `oracle.js` = файлы out/ непустые). STOP выставлен, прогон
остановлен. Остались worktrees `.fleet-wt/T01(34666c8)/T02/T03` + ветки `fleet/T01..T03` — почистить
(`git worktree remove --force` + `git branch -D`) при возобновлении (bash-классификатор был down).

## Next Steps (порядок)
1. Проверить принимает ли `claude --json-schema` путь к файлу (1 дешёвый вызов) → выбрать вариант фикса #10.
2. Починить #10 в `tools/fleet/providers.js` (temp-файл или cmd/shell:false) + тест (судья на битой
   схеме сейчас молча block; тест должен ловить что судья РЕАЛЬНО отработал, а не REJECT-default).
   Оракул → судья sonnet → `elt commit`.
3. Почистить bench worktrees/ветки, пересобрать bench-репо v3, прогнать `fleet run --workers 3`.
4. Ожидание после #10: T01(claude)/T02(codex)/T03(agy) → gate-pass → merged в первом батче,
   T04(codex) во втором. Это и есть искомая демонстрация codex+agy живьём в fleet-пайплайне.
5. Метрики (wall-clock parallel vs serial baseline `--workers 1`, провайдер per слайс из events.jsonl,
   судья pass-rate) → финальный чекпоинт T016 → `elt commit --task T016` → T017 → merge в main.

## Resume Pointer
- Focus: T016 fleet-бенч. Баги #8/#9 закрыты и закоммичены. **Единственный блокер демо — баг #10
  (судья --json-schema под Windows shell:true)**: без него ни один слайс не пройдёт gate, независимо
  от провайдера. codex+agy как способность — уже доказаны (smoke PONG). Чинить #10 → пересобрать
  bench → прогон покажет codex/agy закрывающими слайсы.
- Resume: `/elt` в новом чате → этот чекпоинт (свежайший).
