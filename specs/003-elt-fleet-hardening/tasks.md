# tasks — ELT Fleet Hardening (specs/003-elt-fleet-hardening/spec.md)

> Оракул репо: `node tools/doctor.test.js && node --test tools/fleet/*.test.js` (bash-shell).
> `[live]` = слайс с реальными CLI/квотами — гнать при юзере, оракул = скрипт-проверка.
> `[P]` = параллелизуем, `[files:]` = зона правок. Порядок = зависимость: не-[P] ждёт предыдущие.
> Каждый код-слайс несёт свой `*.test.js` (стабы фейк-CLI/темп-репо, без платных вызовов).

## Phase G — заморозка + caps до spawn
- [X] **T018** Пометить Fleet experimental в доках (CLAUDE.md Commands, /elt SKILL.md, PLAYBOOK.md): «не для реальной работы, пока 003 не закрыт»; в шапке 002/tasks.md — ссылка на переоткрытие T008/T009/T012/T016/T017. Оракул: doctor docs-чеки зелёные. [files:CLAUDE.md,skills/elt/SKILL.md,tools/PLAYBOOK.md,specs/002-elt-fleet/tasks.md]
- [X] **T019** Явная модель на КАЖДОМ spawn (implementer/heal/judge) + lean CLI-профиль (флаг/env, отключающий глобальную массу skills/MCP/hooks для fleet-воркеров) — убить model-less opus/high вызовы и 25k-токенный профиль-догруз. Тест: аргументы spawn содержат `--model <явная>`, профиль-флаг проброшен. [files:tools/fleet/router.js,tools/fleet/providers.js]
- [X] **T020** Hard caps до любого spawn: `maxCalls`, `maxClaudeCalls`, `maxMinutes`, `concurrencyPerProvider` в `fleet.json`; превышение → слайс terminal-failed, прогон не спавнит дальше. Все провайдеры cooling/down = stop прогона (nonzero), НЕ fallback на остывающего. Добавить сигнатуру `session limit` в limit-детект (router.js:63). Тест на стабах: cap=4 → 5-й spawn заблокирован; все-cooling → stop. [files:tools/fleet/router.js,tools/fleet/fleet.js]

## Phase H — state machine + ограниченный heal
- [ ] **T021** Персистентная per-slice машина состояний `implementing → oracle → judge_pending → merge_pending → merged` в claims/state; judge недоступен → парковка на `judge_pending` с сохранением worktree (НЕ переделывать реализацию); crash-resume читает состояние и продолжает с этапа, не с нуля. Тест: убить процесс на judge_pending → resume не перезапускает implementer. [files:tools/fleet/claims.js,tools/fleet/fleet.js,tools/fleet/gate.js]
- [ ] **T022** Ограничить heal планом: красный оракул → ≤2 heal ВСЕГО на слайс (убрать ×3-размножение worker+2heal по батчам, дефект 1), суммарный потолок ≤4 LLM-вызова/слайс сверяется с cap из T020; `block`-причина судьи прокидывается в следующий prompt (не повтор того же). Тест: стаб-красный слайс → ровно ≤2 heal, счётчик Claude-вызовов ≤ maxClaudeCalls. [files:tools/fleet/heal.js,tools/fleet/gate.js]

## Phase I — честность merge и exit
- [ ] **T023** [P] Безопасный staging в merge.js: scoped `git add <файлы слайса из [files:]>` вместо `git add -A` (не захватывать чужие правки); убрать `git reset --hard` из error-path → безопасный abort (merge.js:47). Тест на темп-репо: посторонний dirty-файл вне [files:] остаётся нетронутым после merge и после ошибки. [files:tools/fleet/merge.js]
- [ ] **T024** Честность результата: non-conflict `m.ok=false` = terminal-failed (НЕ объявлять merged, дефект 5); обязательный integration-оракул после КАЖДОГО merge, включая production — снять возможность skip (fleet.js:209, дефект 4); любой failed/abandoned слайс → прогон возвращает nonzero exit. Тест на стабах: 1 abandoned слайс → CLI exit≠0, integration-оракул вызван после merge. [files:tools/fleet/merge.js,tools/fleet/fleet.js]

## Phase J — рубрика судьи + ledger
- [ ] **T025** [P] Судья получает рубрику: подать `spec.md` + `constitution.md` (если есть рядом с tasks.md) в промпт судьи вместе с диффом; `block`-причина персистится и переживает retry. Тест с фейк-судьёй: промпт содержит путь/текст spec, причина block читается на следующей попытке. [files:tools/fleet/gate.js]
- [ ] **T026** Полный per-phase call-ledger: одна строка run-log на КАЖДЫЙ spawn `{sliceId, phase: implement|heal|judge, provider, model, tokens, costUsd, durationSec, exit}` — heal и judge посчитаны, длительности фаз раздельны (дефект 7). Тест: прогон-стаб на N слайсов → ledger содержит по строке на каждый spawn с непустыми phase/model. [files:tools/fleet/router.js,tools/fleet/fleet.js]

## Phase K — владение процессами
- [ ] **T027** Настоящее владение child-процессами: трекинг PID каждого воркера; STOP → tree-kill (`taskkill /T /F` на win / kill process-group), STOP→мертво ≤10с (не 5-мин timeout, дефект 3); crash-resume не оставляет orphan `.fleet-wt`. Тест: спавн стаб-child со `sleep`, запись STOP → процесс мёртв ≤10с, worktree не осиротел. [files:tools/fleet/fleet.js,tools/fleet/worktree.js,tools/fleet/providers.js]

## Phase L — повторная валидация [live]
- [ ] **T028** [live] Идентичный бенч (переоткрытие T016): один и тот же честный [P]-план, `workers=1` baseline РЕАЛЬНО запущен vs `workers=2`; метрики wall-clock + Claude-токены из T026-ledger; ровно 2 воркера, все слайсы закрыты. Оракул = скрипт-сверка метрик. Итог → CHECKPOINT. [files:.planning]
- [ ] **T029** [live] Живой STOP/resume + реальный limit-failover (переоткрытие T017): запись STOP посреди прогона → child мёртв ≤10с, повторный run добирает остаток (resume по state); реальный/инъецированный лимит → failover виден в ledger (`failoverFrom`, `limitHit`). Итог → CHECKPOINT. [files:.planning]
- [ ] **T030** [live] Gate-вердикт: два повторяемых прогона против критериев жизни (spec §Критерии: 100% merged, speedup ≥1.5×, Claude ≤50%, ≤4 LLM/слайс, STOP ≤10с, exit-честность). Прошли → снять experimental, Fleet остаётся. Speedup <1.3× или Claude-экономия <30% → снять параллельный слой, полезное оставить как serial multi-provider failover в elt-loop. Решение + доказательства → CHECKPOINT-вердикт v2. [files:.planning]
