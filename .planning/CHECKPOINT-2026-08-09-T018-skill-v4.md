# CHECKPOINT 2026-08-09 — 014/T018: SKILL.md описывает маршрут v4

## ЧТО СДЕЛАНО

`~/.claude/skills/elt/SKILL.md` (канонический скилл, живёт ВНЕ репо) поднят до `4.0.0`.
Добавлены три раздела:

- **«Спекулятивний контур (v4)»** — `verify: "background"`, коммит возвращает управление
  (`committed-speculative`), четыре слоя в detached-worktree `.fleet-wt/bg-<hash>`,
  `smokeParallel`, `background.layers`; красное из фона = `kind:"bg-red"` в
  `review-queue.jsonl`; молчание фона = `bg-silent` в `health.jsonl` после
  `backgroundTimeoutMin`; три `bg-silent` подряд = вернуться на `sync` и спросить пользователя;
  авто-реверта нет.
- **«`elt brief` — живлення моделі ДО роботи»** — вызов ПЕРЕД слайсом, не после.
- **«Еволюція гейта»** — `--install-schedule` / `--daily`; `propose` в расписание не входит.

`PLAYBOOK.md` правлен по той же причине: он прямо утверждал «Схема B з асинхронним verify та
auto-revert не використовується» — то есть отрицал ровно то, что построили фазы B–C.

## ПРУФ

```
> node tools/sync-agent-surface.js --apply --force --target all --skill elt
[APPLIED] overwritten: codex/elt, gemini/elt

> node tools/sync-agent-surface.js --dry-run --target all --skill elt
[CODEX]  Missing: none  Up-to-date: 1
[GEMINI] Missing: none  Up-to-date: 1
[ANTIGRAVITY IDE] /elt global workflow: up-to-date

> node --test tools/elt-skill-frontgate-contract.test.js
tests 13  pass 13  fail 0
```

Четыре новых контракт-теста закрепляют именно маршрут, а не наличие текста: «коммит возвращает
управление», «красное — задача в очереди», «молчание — инцидент `bg-silent`», «`elt brief` перед
слайсом».

## ДЕФЕКТ, НАЙДЕННЫЙ ПО ХОДУ (починен здесь же)

`elt brief` **был мёртв в deploy-копии**: `node ~/.claude/bin/elt.js brief …` падал
`Cannot find module './elt-brief'`. T011 добавил команду, но не внёс `elt-brief.js` в замыкание
`tools/sync-bin.js`; `smoke-elt-deploy` этого не ловит. Пока скилл не звал `brief`, дефект был
невидим — ровно тот класс, что уже ловили на T009/T010 (`elt-mutate.js`, `fleet/gate.js`).
Файл добавлен в `ROOT_CLOSURE`, deploy-копия проверена живьём:

```
> node "$env:USERPROFILE\.claude\bin\elt.js" brief tools/elt.js
elt brief: 1 файл(ов), 220 прогонов, 56 красных …
  47×  judge-block   4×  red-stop
```

Это правка вне `[files:]` T018 (`tools/sync-bin.js`) — сознательная: скилл, который велит звать
команду, обязан оставить её работающей снаружи, иначе слайс закрывает документацию, а не маршрут.

## ЗАМЕР КОНТУРА (обязательная строка с T007)

Фоновый вердикт по T022 (`735c245`) **пришёл: `background-verify-pass`, судья `pass`.**
Это боевое подтверждение самого T022: два предыдущих слайса (T016 `275e41f`, T017 `ab891cc`)
получили ЛОЖНЫЙ `block` с причиной «рубрика относится к specs/002-elt-fleet», а первый слайс,
закоммиченный уже с фиксом, получил честный `pass`.
