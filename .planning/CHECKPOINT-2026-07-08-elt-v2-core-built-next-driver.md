# CHECKPOINT 2026-07-08 — ELT v2: ядро собрано, дальше драйвер + bootstrap v2

> **Для следующей сессии (модель: sonnet — токены беречь, всё уже спроектировано).**
> Дизайн и вердикты аудита: `.planning/ELT-V2-AUDIT-AND-DESIGN-2026-07-08.md` (читать разделы 4-5).
> Решения юзера: авто-ветка ДА, push по флагу, **судья ОБЯЗАТЕЛЕН в петле, model sonnet**,
> полигон автопилота = `C:\Ametrin projects\Ametrin web ecosystem 4` (AWE4).

## СДЕЛАНО сегодня (не переделывать)

| Что | Где | Проверка |
|---|---|---|
| block-dangerous-git v2 (fix false positives: strip кавычек → split → паттерны только на git-args) | `.claude/hooks/block-dangerous-git.js` (репо) = `~/.claude/hooks/` (глобально, подключён в settings.json PreToolUse Bash\|PowerShell) + копии в tg-bot/Marketing/Route_API/PDV/Fasoli | self-check 14/14 PASS (прогнан живьём) |
| codegraph read/bash gate → advisory | `~/.claude/hooks/config.json` → `blockLargeReads:false` ×2 | — |
| git init + baseline | Itstep_AI (`790e6b7`, mp4/кэши в .gitignore), lawyer_skill_ametrin (`93f29b9`) | git log |
| **elt CLI** — ядро инвариантов | `tools/elt.js` (репо, source of truth) = `~/.claude/bin/elt.js` (deployed) | e2e fixture-тест прогнан: красный оракул НЕ коммитит; зелёный → авто-ветка с main → `[X]` → commit → run-log.jsonl; `slice next` exit 3 = план закрыт |
| **dirty-exit-gate** Stop-хук (замена judge-closeout-gate) | `.claude/hooks/dirty-exit-gate.js` (репо) = `~/.claude/hooks/` + подключён глобально в settings.json Stop | 5 сценариев прогнаны: block только если СЕССИЯ правила файлы + дерево грязное; `.harness/` игнорится; opt-in = наличие `.harness/harness.json` |
| **/elt skill v2.0.0** (merge elt-code+elt-loop) | `~/.claude/skills/elt/SKILL.md`; elt-code/elt-loop = алиасы-форварды 2.0.0 | зеркала codex+gemini скопированы (verify grep 2.0.0 ×6 OK) |

`elt` CLI команды: `init --oracle "<cmd>" [--shell powershell] [--push]` · `status` · `slice next [--json]` (exit 3 = закрыт) · `oracle` · `commit [--task Txxx] [-m msg] [--skip-oracle] [--verdict pass] [--push]`.
Конфиг: `.harness/harness.json` `{oracle, shell, branchPolicy:"feature", push:false, judge:{enabled,model:"sonnet"}}`. Лог: `.harness/run-log.jsonl`.

## ЗАДАЧА A (следующая сессия): драйвер `tools/elt-loop.ps1`

PowerShell 5.1! (НЕ `&&`, НЕ тернарник, закрывающий `'@` в колонке 0, `-Encoding utf8`).

```
param([string]$Project=".", [int]$Slices=4, [int]$MaxMinutes=120,
      [string]$JudgeModel="sonnet", [switch]$DryRun)
```

Цикл (на слайс), рабочая директория = $Project:
1. Kill-switch: `Test-Path "$Project/.harness/STOP"` → break.
2. `$json = node "$env:USERPROFILE/.claude/bin/elt.js" slice next --json` (cwd=$Project).
   `$LASTEXITCODE -eq 3` → «план закрыт», break. Парс: `ConvertFrom-Json` → `.id`, `.text`.
3. Промпт имплементатора (here-string):
   «Ты выполняешь ОДИН слайс spec-driven плана. Задача {id}: {text}. Прочитай
   `.specify/memory/constitution.md` и spec.md рядом с tasks.md, если есть. Минимальная
   имплементация ТОЛЬКО этой задачи. НЕ коммить. НЕ правь tasks.md. Тесты не ослаблять/не удалять.»
4. `claude -p $prompt --dangerously-skip-permissions` из $Project; stdout →
   `.harness/loop-logs/<yyyyMMdd-HHmmss>-<id>-impl.log`. (git-guard хук активен и в headless —
   опасный git заблокируется; изоляция = авто-ветка elt commit.)
   Перед первым использованием проверить флаги: `claude --help` (нужно ли `--output-format text`).
5. `node elt.js oracle` → красный? ОДИН retry: `claude -p "оракул красный, вывод: <хвост лога
   100 строк>. Почини минимально, тесты не ослаблять"` → oracle снова → красный → append
   в run-log `{task, oracle:{exit}, result:"red-stop"}` (Add-Content JSONL) → break с отчётом.
6. **СУДЬЯ (обязателен, шаг кода):** `$diff = git diff HEAD` (+ `git status --porcelain`).
   `claude -p $judgePrompt --model $JudgeModel` (судья НЕ пишет код). Промпт:
   «Ты судья качества. Вход: задача "{id} {text}" + дифф. Стойка: ищи причины ОТКЛОНИТЬ:
   (1) сделано не то/больше, чем задача; (2) тесты удалены/ослаблены/замоканы до пустоты;
   (3) side-effects вне scope задачи; (4) оверинжиниринг. Ответь СТРОГО JSON:
   {"verdict":"pass"|"block","reasons":["..."]}» + дифф.
   Парс JSON из ответа (regex `\{[\s\S]*\}`); не распарсился → **block** (REJECT-default).
   block → лог + break, работу НЕ коммитить, отчёт юзеру. pass → шаг 7.
7. `node elt.js commit --task $id --skip-oracle --verdict pass` (push сам по флагу конфига).
8. Следующий слайс, пока < $Slices и < $MaxMinutes.

Финал: сводка в stdout (слайсы/коммиты/вердикты/время) + последняя строка run-log.
`-DryRun`: шаги 4-7 не исполнять, печатать что было бы.

## ЗАДАЧА B: live-fire на AWE4

1. AWE4 = `C:\Ametrin projects\Ametrin web ecosystem 4` — git main, clean, justfile есть, **specs/ НЕТ**.
2. Проверить оракул живьём: `just test` (может требовать `docker compose up -d db` — см. justfile; если да, поднять и записать в harness.json oracle полной строкой).
3. `elt init --oracle "<проверенная команда>"` в AWE4.
4. Микро-спека: `specs/001-elt-v2-livefire/tasks.md` с 2 МЕЛКИМИ реальными задачами
   (посмотреть AWE4 `.planning/STATE.md`/ROADMAP или спросить юзера; fallback: 2 мелких
   улучшения тестов/доков с проверяемым результатом). Формат: `- [ ] T001 <текст>`.
5. `powershell -File tools/elt-loop.ps1 -Project "C:\Ametrin projects\Ametrin web ecosystem 4" -Slices 2`
   (из терминала или Bash run_in_background).
6. **Acceptance (Definition of Done):** 2 коммита на `feature/*` ветке AWE4, `[X]` ×2 в tasks.md,
   2 строки run-log.jsonl с `verdict:"pass"`, лог-файлы судьи в `.harness/loop-logs/`,
   показать `git log --oneline -3` + хвост run-log юзеру.

## ЗАДАЧА C: project-bootstrap v2 («наводит порядок везде») — требование юзера

Прочитать текущий `~/.claude/skills/project-bootstrap/SKILL.md` (v1.5.0, уже умеет эталон-фикс
доков). Добавить/усилить фазы (идемпотентно!):
1. **git init** если не репо (+ .gitignore по типу проекта, baseline-коммит) — как сделано вручную для Itstep.
2. **`elt init`** — детект оракула (justfile → `just test`; pytest/npm test/cargo test; НЕ детектится → один вопрос юзеру), создать `.harness/harness.json`.
3. **Эталонизация CLAUDE.md/AGENTS.md/GEMINI.md** по `presentation/agents-md-reference.md`
   (9 секций, Memory=указатель, прунинг журнала → `.planning/STATE.md`/PROJECT-HISTORY) — юзер
   явно просил «эталон, а не сбор коротких правил». Использовать `tools/project-docs-core.js`.
4. **Регистрация** проекта в `~/.claude/harness-projects.json`: `{path, oracle, addedAt}` (создать если нет).
5. **Снять устаревшую обвязку**: удалить per-project `judge-closeout-gate.js` + его wiring из
   `.claude/settings.json` проекта (замена = глобальный dirty-exit-gate); per-project
   `block-dangerous-git.js` wiring тоже снять (глобальный стоит) — merge settings.json
   идемпотентно, НЕ затирая чужие ключи.
6. `tools/doctor.js`: режим `--fleet` по harness-projects.json (репо? dirty-возраст? оракул задан? хуки-версии?).

Прогнать bootstrap v2 по: tg-bot, PDV, Marketing_tg_bot, Route_API_1C, lawyer_skill_ametrin, Itstep_AI, Fasoli, AWE4. По одному, с показом диффа доков юзеру.

## ЗАДАЧА D (хвосты, мелочь)
- PLAYBOOK.md + CLAUDE.md этого репо: elt-code/elt-loop → `/elt`, упомянуть elt CLI и драйвер. CHEATSHEET.html — строка про v2.
- Грепнуть `elt-loop|elt-code` по `~/.claude/skills/*/SKILL.md` (checkpoint, pipeline, auto-ship…) — поправить ссылки на /elt.
- PDV: 59 dirty files на `bugfix/critical-fix` — разобрать С ЮЗЕРОМ (что коммитить/что мусор). Pipeline setupper: presentation/ закоммитить по команде юзера.
- Судья в интерактивных сессиях: `CLAUDE_CODE_SUBAGENT_MODEL=haiku` глобально в settings.json — субагент-судья должен вызываться с явным model sonnet (в /elt так и написано); проверить на первом живом слайсе.

## Грабли для дешёвой модели
- `elt slice next` exit 3 — это «план закрыт», НЕ ошибка.
- Node на Windows НЕ читает POSIX-пути `/c/...` — только `C:/...` (наступили сегодня в тесте).
- Stop-хуки: stdout = `{decision, reason}` JSON; PreToolUse block = exit 2 + stderr.
- PS 5.1: без `&&`/`||`, here-string `'@` в колонке 0, `Set-Content -Encoding utf8`.
- Хук-source в этом репо (`.claude/hooks/`, `tools/elt.js`) → deploy = cp в `~/.claude/hooks|bin` (после любой правки не забыть cp).
- Не коммитить чужие грязные файлы этого репо (presentation/, STATE.md правки прошлых сессий) — только свои.
