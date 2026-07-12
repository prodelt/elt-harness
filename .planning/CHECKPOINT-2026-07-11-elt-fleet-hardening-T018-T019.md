## Checkpoint - 2026-07-11 09:45

### Build Status
- Compiles: n/a (Node.js, no build step)
- Lint: not configured
- Type check: not configured (JS)

### Test Metrics
- Total: 66 | Passed: 66 | Failed: 0 | Skipped: 0
- Coverage: not measured
- New tests this sprint: 6 (T019, providers.test.js)
- Oracle: `node tools/doctor.test.js; if ($LASTEXITCODE -eq 0) { node --test tools/fleet/*.test.js }` → PASS (doctor + 66/66)

### Code Modifications Since Last Checkpoint
(baseline: CHECKPOINT-2026-07-10-elt-fleet-T017-closed-verdict-v1.md)
- Files created: `specs/003-elt-fleet-hardening/{spec.md,tasks.md}` (13 задач T018–T030, написаны юзером/предыдущей сессией — застал уже готовыми)
- Files modified (T018): `CLAUDE.md`, `PLAYBOOK.md`, `specs/002-elt-fleet/tasks.md`, `C:\Users\user\.claude\skills\elt\SKILL.md` (глобальный, вне git-репо, 2.3.0→2.3.1) — Fleet помечен experimental
- Files modified (T019): `tools/fleet/router.js` (DEFAULT_MODELS + modelFor + loadPolicy.models), `tools/fleet/providers.js` (resolvedModel всегда непустой, lean-флаги --safe-mode/--ignore-user-config, FLEET_LEAN=0), `tools/fleet/providers.test.js` (+6 тестов)
- Files deleted: нет

### Git State
- Branch: `feature/elt-loop-driver`
- Uncommitted changes: 0
- Last commit: `1250b81` docs(checkpoint): T018/T019 закрыты, ELT Fleet hardening 003 в работе (`ade9e7f` chore: run-log перед ним)
- Слайс-коммиты: `f696683` T018, `7594487` T019 (оба судья=pass, оракул зелёный)

### Completed Tasks
- T018 Fleet помечен experimental в доках (CLAUDE.md/PLAYBOOK.md/002-tasks.md/глобальный SKILL.md) — судья pass
- T019 Явная `--model` на КАЖДОМ spawn (router.modelFor: claude=sonnet, codex=gpt-5.6-sol, agy=gemini-3.1-pro-preview) + lean-профиль по умолчанию (claude --safe-mode, codex --ignore-user-config, agy — нет такого флага у CLI) — судья pass

### Remaining Work
specs/003-elt-fleet-hardening/tasks.md — 11 открытых слайсов:
- **T020** Hard caps до spawn (maxCalls/maxClaudeCalls/maxMinutes/concurrencyPerProvider в fleet.json; все-cooling→stop nonzero; session-limit сигнатура) [files:router.js,fleet.js]
- T021 Персистентная state machine слайса (implementing→oracle→judge_pending→merge_pending→merged), crash-resume
- T022 Heal ограничен ≤2 суммарно (снять ×3-размножение), block-причина в следующий prompt
- T023 [P] Scoped `git add <files:>` вместо `-A` в merge.js, убрать `git reset --hard` из error-path
- T024 non-conflict `m.ok=false` = terminal-failed (не «merged»); integration-оракул обязателен без skip; failed→nonzero exit
- T025 [P] Судья получает spec.md+constitution.md как рубрику; block-причина переживает retry
- T026 Полный per-phase call-ledger (implement/heal/judge, tokens/cost/duration раздельно)
- T027 Владение child-процессами: PID-трекинг, tree-kill, STOP→мертво ≤10с, ноль orphan-worktree
- T028 [live] Идентичный бенч workers=1 baseline vs workers=2 (переоткрытие T016)
- T029 [live] Живой STOP/resume + реальный limit-failover (переоткрытие T017)
- T030 [live] Финальный gate-вердикт против критериев жизни спеки §Критерии

### Blockers
Нет.

### Next Steps
1. T020 — hard caps до spawn. Router.js уже содержит cooldown/policy инфраструктуру (T019 добавил models) — T020 добавляет туда же лимиты вызовов и arg `session limit` в LIMIT_SIGNATURES; fleet.js получает cap-проверки ПЕРЕД spawn воркера.
2. Далее по порядку фаз G→H→I→J→K→L (T021…T030), [live]-слайсы (T028-T030) требуют юзера рядом (реальные CLI/квоты).

### Resume Pointer
- Focus: `specs/003-elt-fleet-hardening` — закрыть Phase G (T020) и Phase H (T021, T022) hardening-слайсы ELT Fleet.
- Resume: `/elt` (голый вызов подхватит `elt status` → next=T020) или прямо продолжить с T020: hard caps в `tools/fleet/router.js` + `tools/fleet/fleet.js`.
