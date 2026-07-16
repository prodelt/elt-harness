# CHECKPOINT 2026-07-16 — T018 закрыт (ELT единственный active code route)

## Что сделано

`specs/005-elt-control-plane-convergence` T018 (`b28da8d`). P1-B стартовал. Это **deprecation + docs**
слайс, БЕЗ удаления production LOC (удаление — T019/T020). Судья sonnet: pass, оракул 44/44.

- **Депрецированы 4 legacy CLI entrypoint** (fail-closed exit 1 + actionable message на `/elt` +
  migration plan §9): `pipeline-state.js`, `harness-runner.js`, `harness-gates.js`,
  `install-harness-teeth.js`. Прямой `node tools/<x>.js` теперь падает с `DEPRECATED: ...`.
  ⚠ `module.exports` каждого файла **оставлены живыми** — их импортируют `doctor-core.js`
  (`checkArtifact` из harness-gates, pipeline-state helpers) и `git-workflow-audit.js`
  (`normalizePath`). Zero active CLI-callers доказан (`rg` по `*.ps1/*.md/*.json` — только
  JSON permission-allowlist и сгенерированные audit-снапшоты, не вызовы). Файлы удаляются в T019.
- **Stale health noise снят из doctor**: `checkHarnessRun` + `checkPipelineState` убраны из
  `runDoctor()` check-list (`doctor-core.js`) — их WARN'ы гнали юзера к retired route
  (`harness-gates.js run-gate`, `/pipeline`). Сами функции и их юнит-тесты (`doctor.test.js`)
  ЖИВЫ до T019/T020. `runDoctor`-тесты проверяют присутствие ID через `.some`/`.includes`, не
  общий счётчик → снятие 2 чеков их не ломает.
- **Доки — ELT единственный active code route** во всех 4 route-файлах:
  - `AGENTS.md` + `.gemini/GEMINI.md` были **устаревшими** (v1 `/elt-code` router + `/elt-loop`,
    doctor без fleet) — приведены к v2 `/elt` (парити с CLAUDE.md); + deprecation-note.
  - `CLAUDE.md` — добавлен deprecation-буллет (парити).
  - `PLAYBOOK.md` — `/elt` помечен «единственный active code route»; deprecation-банер;
    `/pipeline` убран из code-planning позиций дерева решений (ARCH → `/elt` план-шаг Mode 0;
    RESEARCH → `/research-autopilot`); не-код §2 → `/elt-work`/`/harness-method`.
- **Новый тест** `tools/legacy-deprecation.test.js`: spawn 4 CLI → assert exit≠0 + `DEPRECATED`
  + actionable needle + cite migration plan; + `testExportsStayLive` (exports doctor-а живы).

## Проверка (Proof)
```
node tools/elt-oracle-runner.js        → 44/44 passed, exit 0
node tools/legacy-deprecation.test.js  → PASS
node tools/doctor.test.js              → PASS (runDoctor-тесты зелёные после снятия 2 чеков)
node tools/doctor.js --root .          → Summary PASS=35 WARN=8 FAIL=1; harness:run/state:pipeline
                                         из отчёта исчезли (шум снят), краша нет
git status --porcelain                 → clean; git log → b28da8d, T018 [X]
судья (Agent model:sonnet, свежий контекст, независимо гонял оракул) → pass
```
⚠ **Flake:** `tools/sync-agent-surface.test.js` дал `spawnSync ETIMEDOUT` в CLI dry-run subprocess
на первом прогоне оракула; 3/3 перегона зелёные, к T018 отношения не имеет → карантин-пометка, не фикс.
⚠ Doctor «AGENTS.md/CLAUDE.md/GEMINI.md incomplete» — **pre-existing**: командный центр держит
7-секционную структуру, T014-verifier ждёт 9-секционный project-template. `##`-секции до/после
правок идентичны — не регрессия T018.

## 7-day usage baseline (сохранён для T019/T020 delete-proof)
Из `spec.md §2` (аудит 2026-07-15, срез 7 дней): **legacy runtime = 0 живых вызовов**
(harness-runner/gates: 0; RAG: 0; install-harness-teeth: 0). ELT: 260 вызовов / 53 сессии.
Это baseline, против которого T019/T020 доказывают zero-caller перед удалением файлов.

## Git state
- Branch: `feature/elt-control-plane-convergence`. Дерево чистое.
- Закрыто **18/23** (P0-A + P0-B + P1-A + **T018**). Открыто 5: T019-T023.

## Дальше — P1-B удаление (T019/T020)
- **T019** — удалить `harness-runner.js`/`harness-gates.js`/`pipeline-state.js` + тесты ПОСЛЕ
  zero-caller `rg`-proof. ⚠ Сначала расцепить `doctor-core.js` и `git-workflow-audit.js` от их
  exports (перенести нужные helpers — `checkArtifact`, `normalizePath`, pipeline-state helpers —
  в живой модуль или инлайн). Перенести ещё нужные негативные сценарии в ELT-тесты. LOC delta.
- **T020** — удалить `install-harness-teeth.js`/`codemap.js`/RAG/Graphify paths + doctor checks;
  архив AMOS/audit после link scan.
- **T021** — Fleet ledger правдивый. После T021 Fleet разрешён.

## Стоп-точки (НЕ закрою автономно)
- **T022** — Fleet-vs-solo A/B: внешний блок (Ametryn rate-limit пауза,
  `.planning/CHECKPOINT-2026-07-11-fleet-vs-solo-ab-ametryn.md`).
- **T023** — финальный release proof: живой user-approved pilot + live judge (платный).

## Порядок закрытия слайса (напоминание)
failing/зелёный оракул → судья (Agent, `model:sonnet`, свежий контекст, дифф+task+spec-рубрика) →
`elt oracle` → `elt judge-proof write --task T0xx --verdict pass --model sonnet` → `elt commit
--task T0xx --skip-oracle` (три команды подряд одной цепочкой — иначе tree-hash протухнет).
⚠ `sync-agent-surface.js --apply --force` бьёт по ВСЕМ конфликтам — точечно вручную.
Fleet не запускать до T021. Global Codex/Claude config не менять без явного подтверждения.

## Resume prompt
```text
elt
Продолжай specs/005-elt-control-plane-convergence с T019 (удалить harness-runner/harness-gates/
pipeline-state + тесты после zero-caller rg-proof; сначала расцепить doctor-core.js и
git-workflow-audit.js от их exports). T018 закрыт (b28da8d), см.
.planning/CHECKPOINT-2026-07-16-T018-elt-only-route.md. T022/T023 — стоп на внешних блокерах.
```
