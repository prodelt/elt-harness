# CHECKPOINT 2026-07-15 — T010 закрыт (project-bootstrap verify)

## Что сделано в этом чате

`specs/005-elt-control-plane-convergence` (23 слайса), P0-A + P0-B(T008,T009) закрыты ранее.
В этом чате закрыт **T010** (`a8079b7`) — `project-bootstrap verify` как fail-closed semantic check:

- `verifyProject(root, options)` — read-only, никогда не чинит. Пять gating-контрактов
  (`Object.values(contracts).every(c => c.ok)` формирует итоговый `ok`):
  - `docs` — `verifyProjectDocs` ok+coreIdentical.
  - `harnessConfig` — `.harness/harness.json` существует и schema-valid (`readHarnessConfig`).
  - `oracleVerifier` — заявленный `oracle` (code) / `artifactVerifier` (docs/office) непустой.
  - `gate` — managed `.githooks/pre-commit` установлен (для `code` kind).
  - `skillAvailability` — переиспользует существующий `supplyChainStatus`.
  Для `kind==='unknown'` все пять — явный `skipped:true`, не выдуманный pass и не hard fail.
- Два информационных **сигнала** (не гейтят `ok`, только репортят честно):
  - `specReadiness` — сканирует `specs/*/tasks.md` (свой мини-парсер `[ ]`/`[X]`, не завязан на
    `tools/elt.js` — тот не модуль, а CLI-скрипт без exports). Пустой проект → `status:'idle'`,
    `ok:true` (guard из задачи: не fake PASS, не hard fail).
  - `cleanTree` — `git status --porcelain`; не git-репо → `skipped:true`.
- CLI: `node tools/project-bootstrap.js verify --root <project> [--json]`; exit-код 1 при `!ok`,
  одинаковый в JSON и text режимах (доказано реальным spawn CLI в тесте, не только in-process).
- 13 новых тестов в `tools/project-bootstrap.test.js` — по негативному фикстуру на каждый из
  7 контрактов/сигналов + read-only-инвариант + CLI json/text exit-parity. 16 старых тестов не
  тронуты.

Судья (Agent, `model: sonnet`, свежий контекст, рубрика `spec.md` §5.4 + AC07-AC11) — **pass**,
проверил сам (git diff, оба теста, оракул) вместо доверия описанию.

## Флейк-инцидент (важно для следующего чата)

Полный оракул (`node tools/elt-oracle-runner.js`) падал **3 раза подряд** на одной и той же строке
в НЕ моём файле — `tools/sync-agent-surface.test.js`, Suite 12 CLI dry-run:
`spawnSync C:\Windows\system32\cmd.exe ETIMEDOUT`. Изолированный прогон
(`node tools/sync-agent-surface.test.js`) прошёл 43/43 с первого раза — подтверждённый флейк,
не регрессия от T010 (модуль вообще не пересекается с project-bootstrap.js).

Корень оказался операционным: `tasklist` нашёл 3 зависших `cmd.exe` (по 4MB) от предыдущих
таймаутов — вероятно, ранее убитые/оборванные попытки не почистили дочерние процессы.
`taskkill /F` по трём PID → следующий прогон оракула зелёный (`42/42`, exit 0, 299s).
**Урок:** если полный оракул стабильно падает на одном и том же CLI-spawn тесте с ETIMEDOUT,
сначала проверить `tasklist` на зависшие `cmd.exe`/`node.exe` от прошлых прогонов, прежде чем
трактовать это как регрессию или карантинить тест.

## Git state

- Branch: `feature/elt-control-plane-convergence`.
- Дерево чистое (`git status --porcelain` пусто).
- Коммит: `a8079b7` (T010).

## Дальше

`elt status` → next: **T011** — `project-bootstrap live-fire` на disposable temp repo:
apply×2 → red oracle → green implementation fixture → stub judge proof → guarded commit → clean
tree, ОДНА команда/тест без платного API/LLM (`.e2e.test.js`).
`[files:tools/project-bootstrap.js,tools/project-bootstrap.e2e.test.js]`.

Далее по плану: T012 (skill YAML strict + thin orchestrator, sync 3 mirrors), T013 (supply-chain
critical set для elt/project-bootstrap) — закрывает P0-B целиком.

## Resume prompt

```text
elt
Продолжай specs/005-elt-control-plane-convergence с T011 (project-bootstrap live-fire,
disposable temp repo). T001–T010 закрыты (P0-A целиком + T008-T010 из P0-B), см.
.planning/CHECKPOINT-2026-07-15-T010-bootstrap-verify.md.
Порядок закрытия слайса: failing/зелёный оракул → судья (Agent, model:sonnet, свежий
контекст) → elt oracle → elt judge-proof write → elt commit --task T0xx --skip-oracle.
Если полный оракул падает на CLI-spawn тесте с ETIMEDOUT — сначала tasklist на зависшие
cmd.exe/node.exe перед тем как считать это регрессией.
Fleet не запускать до T021. Не менять global Codex/Claude config, не делать writes в
registry-проекты без отдельного подтверждения.
```
