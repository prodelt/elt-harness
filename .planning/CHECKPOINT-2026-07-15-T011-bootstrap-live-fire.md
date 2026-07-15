# CHECKPOINT 2026-07-15 — T011 закрыт (project-bootstrap live-fire)

## Что сделано в этом чате

`specs/005-elt-control-plane-convergence` (23 слайса). В этом чате закрыт **T011** (`bdb7485`) —
`project-bootstrap live-fire`: один детерминированный e2e-тест на disposable temp repo, без
платного API/LLM.

Новый файл `tools/project-bootstrap.e2e.test.js` (`project-bootstrap.js` не тронут — только
существующие экспорты `applyPlan`/`verifyProject`). Один сценарий гоняет полный жизненный цикл:

- **apply×2** — первый `applyPlan` создаёт docs/`.planning/STATE.md`/`.githooks/pre-commit`
  (`blocked: []`, т.к. harness.json с валидным oracle уже предзасеян в фикстуре); второй —
  истинный no-op (`changes: []`).
- **Реальный bootstrap-хук, не ручная заглушка.** Прежние e2e (`elt-gate.test.js`,
  `elt-commit-proof.test.js`) копируют `tools/elt.js` руками и резолвят его репо-относительно
  (`$(git rev-parse --show-toplevel)`) — это тестирует only локальный dev-хук. Продовый
  `GIT_GATE_TEMPLATE`, который `project-bootstrap apply` пишет для ВНЕШНИХ проектов, ссылается
  на `$HOME/.claude/bin/elt.js` (глобальный CLI). Тест впервые гоняет именно этот путь:
  фиктивный `$HOME` (env `HOME`/`USERPROFILE` override на temp-директорию) с гарантированно
  свежей копией `tools/elt.js`+`elt-config.js`+`run-log.js` — не зависит от того, синхронизирован
  ли реально установленный `~/.claude/bin/elt.js` на машине разработчика прямо сейчас.
- **Red→green oracle** — стенд-ин oracle-скрипт (`node oracle-check.js`, exit по
  `existsSync('IMPLEMENTED.txt')`) сначала красный, после создания фикстуры — зелёный.
- **Guarded commit, оба пути** — negative: прямой `git commit` без judge proof блокируется
  РЕАЛЬНЫМ хуком, коммит не создаётся (`commitCount` не меняется); positive: после
  `elt judge-proof write` (stub, `--model stub-e2e`, чисто механический CLI-вызов, никакого LLM)
  тот же staged tree коммитится успешно через хук.
- **Clean tree** — проверено и напрямую (`git status --porcelain`), и через `verifyProject(root,
  {supplyChain:false})` (T010): `cleanTree`/`docs`/`harnessConfig`/`oracleVerifier`/`gate`/`ok`
  все `true` — замыкает цикл T010-verify ↔ T011-live-fire на одном фикстурном дереве.

Судья (Agent, `model: sonnet`, свежий контекст) — **pass**, сам перепрогнал тест и часть
регресс-сьюта (не поверил описанию). Полный оракул (`node tools/elt-oracle-runner.js`) —
**43/43**, включая ранее флейковавший `tools/sync-agent-surface.test.js` (см. флейк-инцидент
T010; на этот раз прошёл чисто без вмешательства).

## Git state

- Branch: `feature/elt-control-plane-convergence`.
- Дерево чистое (`git status --porcelain` пусто).
- Коммит: `bdb7485` (T011, `[X]` в tasks.md).

## Дальше

`elt status` → next: **T012** — исправить strict YAML frontmatter и сократить skill
`project-bootstrap` до thin orchestrator одного CLI; синхронизировать Claude/Codex/Gemini
mirrors через штатный supply-chain workflow (`[files:skills/project-bootstrap/SKILL.md,
agent-skills.lock.json]`).

Далее по плану: T013 (supply-chain critical set для elt/project-bootstrap) — закрывает P0-B
целиком; затем P1-A (T014-T017).

## Resume prompt

```text
elt
Продолжай specs/005-elt-control-plane-convergence с T012 (project-bootstrap skill strict YAML
frontmatter + thin orchestrator, sync 3 mirrors). T001–T011 закрыты (P0-A целиком + T008-T011 из
P0-B), см. .planning/CHECKPOINT-2026-07-15-T011-bootstrap-live-fire.md.
Порядок закрытия слайса: failing/зелёный оракул → судья (Agent, model:sonnet, свежий
контекст) → elt oracle → elt judge-proof write → elt commit --task T0xx --skip-oracle.
Если полный оракул падает на CLI-spawn тесте с ETIMEDOUT — сначала tasklist на зависшие
cmd.exe/node.exe перед тем как считать это регрессией (учти: auto-mode классификатор блокирует
taskkill по PID, который сессия сама не порождала — просто перепрогнать изолированный тест-файл
вместо этого, флейк обычно проходит на втором прогоне).
Fleet не запускать до T021. Не менять global Codex/Claude config, не делать writes в
registry-проекты без отдельного подтверждения.
```
