# CHECKPOINT 2026-07-16 — P1-A закрыт целиком (T014-T017)

## Что сделано в этом чате

`specs/005-elt-control-plane-convergence` (23 слайса). Закрыт **весь блок P1-A** (T014-T017),
серийным экономным прогоном (я режу слайс в тёплом контексте → оракул → sonnet-судья Agent
свежий контекст → `elt commit`). Каждый слайс: оракул 43/43 + судья pass.

- **T014** (`60aae58`) — project-docs semantic verifier честный: `CORE_SECTIONS` 4→**9**
  (`Overview/Stack/Structure/Commands/Code style/Testing/Commit & PR/Gotchas/Memory`);
  `verifyProjectDocs.ok` теперь fail-closed (missing секция ∨ drift/`coreIdentical=false` ∨
  unprotected non-core `##` секция → red); `unknownSectionTitles()` исключает заголовки внутри
  protected-блоков; sync НЕ удаляет unknown-контент молча (guard, тест доказывает); снят
  `ensureRagManifest` — `.rag` больше не создаётся. Ripple (обязателен): `project-bootstrap.test.js`
  .rag-ассерта флип (старый `applySafeActions` путь). Files: project-docs-core.js, project-docs.js,
  project-docs.test.js (+ ripple bootstrap.test.js).
- **T015** (`3c48038`) — `doctor --fleet` domain-aware: `checkFleetProject` делегирует в
  T010 `inspectProject`, различает **7 классов** missing/non-git/code/docs(office)/unknown/
  invalid-harness/ready; эффективный kind = объявленный `harness.config.kind` (валидный) иначе
  эвристика classifyKind; PASS только при полном контракте типа (code: harness+oracle+gate;
  docs/office: harness+artifactVerifier, БЕЗ code-gate — guard); harness.ok ⇒ oracle non-empty
  (T001), так что файл-плейсхолдер не даёт false-green. Table-driven тест (7 fixtures) +
  text/JSON count parity. Files: doctor-core.js (+require project-bootstrap, цикла нет), doctor.test.js.
- **T016** (`7f4d020`) — read-only fleet migration planner: `project-bootstrap migration-plan`
  (+ `migrationPlan`/`planProjectMigration`), поверх read-only `planTargetState`; per-project
  domain/actions/risk (risk: unknown→review, code-без-oracle→manual, docs→safe, missing→missing);
  totals reconcile к registry; missing paths не крашат; **никаких writes** (hashTree before==after
  в тесте, CLI dry-run тоже). Никакого apply-all (guard). Files: project-bootstrap.js, .test.js.
- **T017** (`529c0b3`) — Codex profiles doctor signal + docs: `checkCodexSandbox()` встроен в
  `checkCodexDefaults` (model-finding = `[0]` сохранён, sandbox = `[1]`); `danger-full-access`+
  `approval=never` → **fail (high-risk)**, full-access+approvals → warn, safe → pass; checker
  read-only (тест: config.toml unchanged). Новый `docs/CODEX-PROFILES.md` (safe default +
  privileged emergency + high-risk combo + OpenAI sandboxing ref). Config НЕ меняется авто (guard).
  Files: docs/CODEX-PROFILES.md, doctor-core.js, doctor.test.js.

## Проверка (Proof)
```
node tools/elt-oracle-runner.js   → 43/43 passed, exit 0 (после каждого слайса)
git status --porcelain            → clean
git log --oneline (T014..T017)    → 60aae58, 3c48038, 7f4d020, 529c0b3, все [X] в tasks.md
судья (Agent model:sonnet, свежий контекст) → pass на всех 4, независимо гонял оракул
```

## Git state
- Branch: `feature/elt-control-plane-convergence`.
- Дерево чистое. Закрыто 17/23 (P0-A + P0-B + **P1-A**). Открыто 6: T018-T023.

## Дальше — P1-B (convergence + удаление legacy)
- **T018** — объявить ELT единственным active code route (PLAYBOOK/AGENTS/CLAUDE/.gemini/GEMINI/
  skills); Pipeline v3 / old harness / install-harness-teeth → deprecated error со ссылкой на
  migration plan; снять stale health noise. Файлы: PLAYBOOK.md, AGENTS.md, CLAUDE.md,
  .gemini/GEMINI.md, doctor-core.js. **⚠ doctor-core.js — hotspot (T015/T017 его уже трогали).**
- **T019** — удалить harness-runner/harness-gates/pipeline-state + тесты ПОСЛЕ zero-caller `rg`-proof.
- **T020** — удалить install-harness-teeth/codemap/RAG-Graphify paths + doctor checks; архив AMOS/audit.
- **T021** — Fleet ledger правдивый (phase/provider/model/duration/exit; unknown≠0). После T021 Fleet разрешён.

## Стоп-точки (НЕ закрою автономно)
- **T022** — Fleet-vs-solo A/B: заблокирован извне (Ametryn rate-limit пауза, см.
  `.planning/CHECKPOINT-2026-07-11-fleet-vs-solo-ab-ametryn.md`). Inconclusive без live proof.
- **T023** — финальный release proof: нужен живой user-approved pilot + live judge (платный).

## Порядок закрытия слайса (напоминание)
failing/зелёный оракул → судья (Agent, `model:sonnet`, свежий контекст, дифф+task+spec-рубрика) →
`elt oracle` → `elt judge-proof write --task T0xx --verdict pass --model sonnet` → `elt commit
--task T0xx --skip-oracle` (три команды подряд одной цепочкой — иначе tree-hash протухнет).
⚠ `sync-agent-surface.js --apply --target all --force` бьёт по ВСЕМ конфликтам — точечно копировать вручную.
Fleet не запускать до T021. Global Codex/Claude config не менять без явного подтверждения.

## Resume prompt
```text
elt
Продолжай specs/005-elt-control-plane-convergence с T018 (объявить ELT единственным active code
route + deprecate Pipeline v3/old harness/install-harness-teeth в deprecated error). P1-A закрыт
целиком (T014-T017), см. .planning/CHECKPOINT-2026-07-16-P1A-closed-T014-T017.md. doctor-core.js —
hotspot. T022/T023 — стоп на внешних блокерах (rate-limit / живой pilot).
```
