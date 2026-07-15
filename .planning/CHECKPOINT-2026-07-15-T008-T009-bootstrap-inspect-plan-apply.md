# CHECKPOINT 2026-07-15 — T008+T009 закрыты (project-bootstrap inspect/plan/apply)

## Что сделано в этом чате

Roadmap `specs/005-elt-control-plane-convergence` (23 слайса, P0-A закрыт ранее T001–T007).
В этом чате закрыты два слайса P0-B:

- **T008** (`8c1888e`) — `project-bootstrap inspect`/`plan` как read-only модель target state:
  - `classifyKind(root)` — `code|docs|unknown` (манифесты → extension-эвристика через `rg --files`, ограничено `root`).
  - `inspectProject(root)` — read-only снимок (docs/harness/codegraph/git-gate), без побочных эффектов.
  - `planTargetState(root, {codegraph})` — детерминированные decisions по oracle/judge/codegraph/gitGate; `unknown`/`docs` никогда не получают выдуманный oracle; CodeGraph включается только явным `--codegraph`.
  - CLI: `node tools/project-bootstrap.js inspect|plan --root <project> --json`.
- **T009** (`73ad8e1`) — идемпотентный `project-bootstrap apply`:
  - `applyPlan(root, options)` — project-docs sync, `.planning/STATE.md` stub, managed `.githooks/pre-commit` (только для `code` kind, шаблон указывает на глобальный `$HOME/.claude/bin/elt.js gate`, не на repo-local путь).
  - Компенсирующая очистка `.rag/manifest.json` (создаётся `initOrSyncProjectDocs` как побочный эффект — файл вне `[files:]` этого слайса, поэтому не редактировался; вместо этого `applyPlan` удаляет `.rag`, если её не было до вызова).
  - `.harness/harness.json` никогда не изобретается — если `plan.decisions.oracle.source !== 'existing'` для code-kind, harness репортится в `blocked`, файл не создаётся.
  - Второй `apply` → `changes=[]`, hash дерева не меняется, protected blocks/user files байт-идентичны (доказано тестами).
  - CLI: `node tools/project-bootstrap.js apply --root <project> --json`.

Оба слайса: оракул `node tools/elt-oracle-runner.js` 42/42 зелёный, независимый судья (Agent tool, `model: sonnet`, свежий контекст) — `pass` на обоих. `.planning/COMMANDS-REFERENCE.md` обновлён (новые subcommand-примеры).

## Важный операционный gotcha (для следующего чата)

`elt commit` БЕЗ `--skip-oracle` перезапускает оракул заново перед коммитом — это меняет `oracleProofHash`
и делает ранее записанный `judge-proof` `stale-oracle`, даже если дерево не менялось. Рабочий паттерн:
1. `elt oracle` (пишет `oracle-proof.json`, ~140с на весь control-plane oracle).
2. Судья (Agent, `model: sonnet`) → `elt judge-proof write --task Txxx --verdict pass --model sonnet --reasons-json '[...]'`.
3. Сразу `elt commit --task Txxx --skip-oracle -m "..."` — `--skip-oracle` доверяет уже зелёному пруфу того же дерева (не гоняет оракул третий раз, не расходится с judge-proof).

## Git state

- Branch: `feature/elt-control-plane-convergence`.
- Дерево чистое (`git status --porcelain` пусто) после каждого коммита.
- Коммиты: `8c1888e` (T008), `73ad8e1` (T009).

## Дальше

`elt status` → next: **T010** — `project-bootstrap verify` как fail-closed semantic check
(docs, harness config, oracle/verifier, gate, skill availability, spec readiness, clean-tree signal;
verify НИКОГДА не чинит). Proof: по одному negative fixture на каждый контракт; JSON и text exit
semantics совпадают. Guard: отсутствие active spec в свежесозданном idle-проекте = explicit idle,
не fake PASS и не hard fail. `[files:tools/project-bootstrap.js,tools/project-bootstrap.test.js]`.

Далее по плану: T011 (live-fire bootstrap на disposable temp repo), T012 (skill YAML+thin
orchestrator), T013 (supply-chain critical set для elt/project-bootstrap) — весь P0-B блок
из `specs/005-elt-control-plane-convergence/tasks.md`.

## Resume prompt

```text
elt
Продолжай specs/005-elt-control-plane-convergence с T010 (project-bootstrap verify).
T001–T009 закрыты (P0-A целиком + T008/T009 из P0-B), см.
.planning/CHECKPOINT-2026-07-15-T008-T009-bootstrap-inspect-plan-apply.md.
Порядок закрытия слайса: failing/зелёный оракул → судья (Agent, model:sonnet, свежий
контекст) → elt oracle → elt judge-proof write → elt commit --task T0xx --skip-oracle.
Fleet не запускать до T021. Не менять global Codex/Claude config, не делать writes в
registry-проекты без отдельного подтверждения.
```
