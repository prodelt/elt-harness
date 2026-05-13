# Session Memory — Index

## Active Audit
- **S11 Pipeline TOP-1 Audit** (2026-04-21) → `audit/S11_pipeline_top1/`
  - `README.md` — overview + 5 P0 + 6 waves
  - `ANALYSIS.md` — реальные данные сессий (Claude 313/407MB, Codex 58/60MB)
  - `PLAN.md` — 35 задач, 2 дня
  - `GIT_STANDARDS.md` — GitHub Flow + Conv Commits + 5 хуков
  - `P0_FIXES.md` — 5 критических проблем с точными фиксами
  - `SUCCESS_CRITERIA.md` — 12 измеримых метрик + bash script
  - `VERDICTS.md` — claude-context, MCP audit, creative UI, SkillAnything, Graphify
  - `hooks/` — production код (session-size-guard, memory-discipline, git-branch-guard, conv-validator, branch-validator, pre-commit-gate, harvest-injector, skill-sync-mirror, stop-auto-checkpoint)
  - `skills/session-harvest/` — SKILL.md + harvest.js (готовое к копированию)

## Session Handoff Rule
- В конце каждой S11-сессии обязательно обновлять `audit/S11_pipeline_top1/NEXT_SESSION_PROMPT.md`: актуальная ветка/HEAD, закрытые задачи, тесты, следующий task и первая команда. Иначе следующая сессия может повторить уже закрытую задачу.

## Active Projects (7, по анализу 2026-04-21)
| Проект | Сессий/нед | Приоритет |
|--------|-----------|-----------|
| Law-assistant | 34 | HIGH |
| Izi-tracker | 16 | HIGH |
| sudoviy-master-try-3 | 16 | HIGH |
| Pipeline-setupper | 15 | MED |
| tg-bot-reclamaties-master | 5 | MED |
| CV | 1 | LOW |
| Ametrin-platform | — | LOW |

## Key Findings
- **Law-assistant** — топ-1 по активности (было неверно: Izi-tracker)
- **62 project-dirs** из которых 7 активны (55 мёртвых)
- **Средняя сессия 1.33 MB** — 3.3× хуже цели 400 KB
- **Git-root на `C:\`** — монорепо всего диска C, без веток → critical debt
- **Codex bloat симметричен** Claude (avg 1.07 MB, max 4.4 MB)

## Historical Topics
### Zero-Token Proxy (предыдущий фокус)
- Verified Context Efficiency Layer for Coding Agents (не "new physics")
- Fokus: exact-prefix caching + context pruning + prompt compression
- Sources: Anthropic docs, montevive/autocache, zilliztech/GPTCache, LMCache, SWE-Pruner, LLMLingua
- Next step: 2-4 недели MVP — measurement-first middleware

### Proposed Pipeline Upgrade — Skill Marketplace + gstack (2026-04-23)
- User idea: temporarily pause linear S11 execution and add a higher-order pipeline layer that can discover best skills/agents for a task, install them globally, verify them, and use them to improve future sessions.
- External sources checked: `vercel-labs/skills` CLI (`npx skills find/add/list/update`, global install, Codex/Claude/Gemini paths), `skills.sh` leaderboard/search, `garrytan/gstack` virtual-team workflow.
- Candidate concept: `skill-intelligence-layer` with discovery → risk scoring → sandbox install → compatibility normalization → verifier generation → global promotion → routing telemetry.
- Example routing: user asks for deep market research → discover research/Firecrawl/agent-browser/gstack investigate/office-hours style skills, compare install count/source/repo quality, install only after approval, then run research workflow with evidence log.
- Guardrail: never auto-install untrusted skills directly into global roots; use quarantine + static scan + explicit approval + rollback manifest.

## Score (итог S11 планирования)
- Baseline: **32/90 (35%)**
- Target: **78/90 (87%)**
- Gap: 46 пунктов по 9 осям

## Next Action
S11 MVP закрыт через задачи 29, 30, 31 и 28. Текущая цепочка коммитов:
- `8a07dd8 docs(audit): S11 mark task 30 done`
- `85d0bd1 docs(audit): S11 mark task 31 done`
- `5502898 docs(audit): S11 final verification`
- `31adba1 docs(audit): note Antigravity hook inheritance`

`ЗАДАЧА 32` закрыта: `branch-name-validator` hook установлен и зарегистрирован для Claude/Codex; Antigravity наследует Claude settings; suites 98/98 PASS.
`ЗАДАЧА 33` закрыта: `pre-commit-gate` hook установлен/зарегистрирован; smoke прошёл после фикса test-команды (`npm test --silent` + `CI=true`, без Jest-only flags); suites 99/99 PASS.
`ЗАДАЧА 34` закрыта: Skill `/git-flow` создан в Claude SoT и зеркалах Codex/Gemini; `start feature x` нормализуется в `feature/x-task`.
`ЗАДАЧА 35` закрыта: `session-branch-advisor` hook создан/установлен/зарегистрирован; main → advisory, feature/* → silent; suites 101/101 PASS.
`ЗАДАЧА 01b` закрыта: `d5a51af` — `analyze-session.js` расширен под Codex rollout JSONL (`session_meta`/`event_msg`/`response_item`/`turn_context`, `payload.type`, tool outputs by call_id); TOP-3 Codex baseline outputs 3496 / 2154 / 3281 bytes; analyzer synced to `~/.claude/hooks/`; full hook gate 32/32 + 38/38 + 31/31 PASS.
`ЗАДАЧА 04` закрыта: создан `C:/Users/user/.claude/templates/project-settings.json`; project-level `.claude/settings.json` разложены по 8 текущим рабочим roots в `C:\Claude playground` и `D:\Ametrin projects`; matrix зафиксирован в `audit/S11_pipeline_top1/project-settings-matrix.json`; существующие project hooks сохранены.
`ЗАДАЧА 06` закрыта: создан глобальный `~/.claude/AGENTS.md`, обновлён `~/.gemini/GEMINI.md`, а `~/.claude/CLAUDE.md` доведён до exact-строки `ctx7 CLI`; `Select-String -SimpleMatch "ctx7 CLI"` по трём файлам даёт 3 совпадения.
`ЗАДАЧА 10` закрыта: `session-focus-gate` теперь агрегирует `Focus:`/`Done when:` из Claude session jsonl в `~/.claude/focus-log.jsonl` с dedupe по `sessionId`; smoke `session-focus-gate.test.js` PASS; full hook gate остаётся 32/32 + 38/38 + 31/31 PASS.
`ЗАДАЧА 12` закрыта: `memory-discipline` вынесен в tracked source `audit/S11_pipeline_top1/hooks/memory-discipline.js`, получил deterministic test `memory-discipline.test.js`, корректный подсчёт строк без false positive от trailing newline и сохранил совместимость с `test-hooks-behavior.js`; installed hook в `~/.claude/hooks/` синхронизирован; smoke `81 -> advisory`, `101 -> block`; full hook gate 32/32 + 38/38 + 31/31 PASS.
`ЗАДАЧА 13` закрыта: добавлены `ensure-skill-semver.ps1` и `verify-skill-semver.ps1` в `audit/S11_pipeline_top1/skills/`; SemVer frontmatter (`version`, `requires`, `changelog`) теперь есть во всех существующих `SKILL.md` в `~/.claude/skills` (22), `~/.codex/skills` (18) и `~/.gemini/skills` (19); legacy skills без YAML-frontmatter (`init-project`, `ship`, `inline-review`, `sync-docs`) получили bootstrap-метаданные.
`ЗАДАЧА 14` закрыта: добавлены `skill-deps-check.js`, `skill-deps-check.test.js`, `apply-skill-deps-update.ps1`; ручной global apply подтверждён пользователем (`~/.claude` 5, `~/.codex` 4, `~/.gemini` 4 updated); `skill-deps-check.test.js` PASS; реальный smoke на `sprint` против `~/.claude/pipeline-state.json` даёт advisory `Prerequisite missing for sprint: architect-first...` на `classified` state.
`ЗАДАЧА 15` закрыта: добавлены `success-criteria-check.js` и `success-criteria-check.test.js`; checker игнорирует fenced `## Success Criteria`, требует проверяемые predicates, `success: false` failure path и proof/evidence; стандартный protocol применён к `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills` и tracked audit skill snapshots; final check `checked: 66`, `updated: 2`, `OK: success criteria`.
`ЗАДАЧА 16` закрыта: добавлен canonical `audit/S11_pipeline_top1/skills/learn/SKILL.md` (`version: 1.1.0`) с workflow Extract → Propose Diff → Ask User → Apply; `/learn` предлагает PR-style fenced diff при 3+ повторах pattern, требует explicit approval и возвращает `success: false` без approval; добавлены `learn-skill-check.js`, `learn-skill-check.test.js`, `apply-learn-skill-update.ps1`; global apply создал/обновил `/learn` в Claude/Codex/Gemini; `learn-skill-check.js` проверяет 3 roots OK.
`ЗАДАЧА 17` закрыта: `3848dc7` — добавлен canonical `audit/S11_pipeline_top1/skills/architect-first/SKILL.md` (`version: 1.1.0`) с Phase 2.5 Top-3 Implementation Scan; `/architect-first` синхронизирован в Claude/Codex/Gemini; добавлены `architect-first-check.js`, `architect-first-check.test.js`, `apply-architect-first-update.ps1`; локальный `ctx7 search "<pattern>"` smoke зафиксировал `too many arguments`, documented fallback `ctx7 library` успешно вернул top candidates.
`ЗАДАЧА 18` закрыта: добавлены tracked `hooks/lib/ctx7-cache.js`, `hooks/context7-tracker.js`, `ctx7-cache.test.js`, `context7-tracker-cache.test.js`, `apply-ctx7-cache-update.ps1`; установленный `context7-tracker` теперь работает в PreToolUse[Bash] как 24h cache gate (`CTX7 CACHE HIT` + deny повторного network call) и в PostToolUse[Bash] как store/Context7 usage tracker; Codex hooks теперь 39/39 PASS.
`ЗАДАЧА 19` закрыта: `69b9690` — добавлен canonical `audit/S11_pipeline_top1/skills/tdd/SKILL.md` (`version: 1.0.0`) с Red-Green-Refactor workflow, bad vs good примерами `.toBeDefined()` vs `.toBe(<concrete>)`, concrete business assertions и `success: false` для return-type-only tests; добавлены `tdd-skill-check.js`, `tdd-skill-check.test.js`, `apply-tdd-skill-update.ps1`; `/tdd` установлен в Claude/Codex/Gemini skill roots.
`ЗАДАЧА 20` закрыта: `fb1cbc2` — добавлен tracked `audit/S11_pipeline_top1/hooks/coverage-gate.js`, `coverage-gate.test.js`, `apply-coverage-gate.ps1`; installed hook читает `coverage-summary.json`/`lcov.info`, блокирует `git commit` при line coverage ниже 80% (`COVERAGE_GATE_MIN` override), missing coverage пропускает; Claude/Codex PreToolUse[Bash] registration выполнен; smoke 50% -> deny, 90% -> allow.
`ЗАДАЧА 21` закрыта: `9096305` — добавлены `hook-behavior-meta-check.js` и `apply-hook-behavior-meta-tests.ps1`; global `~/.claude/hooks/test-hooks-behavior.js` расширен cases для `session-size-guard`, `git-branch-guard`, `coverage-gate`; behavior suite теперь `37/37 PASS`.

## Next Session Handoff (updated 2026-04-23)
- Текущая ветка handoff: `feature/s11-task-43-init-project-upgrade-mode`
- Последний закрытый task commit в цепочке: `c914229` — `feat(hooks): close S11 task 26 token budget`.
- Task 21 repo changes: tracked behavior meta-test checker/apply script, обновления `PLAN.md`.
- Global apply уже выполнен: `~/.claude/hooks/test-hooks-behavior.js` содержит task 21 block.
- Task 22 закрыта: tracked `inline-review-gate.js`, deterministic test and apply script added; global `~/.claude/hooks/inline-review-gate.js` synced.
- Task 22 proof: `node audit\S11_pipeline_top1\hooks\inline-review-business-assertion.test.js` PASS; installed smoke warns on `expect(calculateInvoice()).toBeDefined()`; full suites `40/40`, `32/32`, `37/37` PASS outside sandbox.
- Task 23 закрыта: tracked `weekly-analysis.js`, `weekly-analysis.test.js`, `apply-weekly-analysis.ps1` added; global `~/.claude/hooks/weekly-analysis.js` installed and writes weekly ranked proposals from `metrics.json` + `errors.log`.
- Task 23 proof: `node audit\S11_pipeline_top1\hooks\weekly-analysis.test.js` PASS; `node C:\Users\user\.claude\hooks\weekly-analysis.js` → `C:\Users\user\.claude\proposals-2026-W17.md`.
- Task 24 закрыта: tracked `audit/S11_pipeline_top1/skills/skill-anything/USAGE.md` + `apply-usage.ps1` added; usage doc synced into Claude/Codex skill-anything roots; fast-path workflow for `git` CLI documents the current scaffold workaround before packaging.
- Task 24 proof: `python -m scripts.analyze_target` → `analysis.json`; `python -m scripts.design_skill` → `architecture.json`; `python -m scripts.init_skill` scaffolds `git-assistant`; after removing generated `config.yaml`, `python -m scripts.package_multiplatform ... --platforms claude-code,codex,generic` creates all 3 dist targets.
- Task 25 закрыта: tracked `graphify-post-commit.js`, `graphify-post-commit.test.js`, `apply-graphify-post-commit.ps1` added; hook installed in `~/.claude/hooks` and registered in Claude/Codex `PostToolUse[Bash]`.
- Task 25 proof: `node audit\S11_pipeline_top1\hooks\graphify-post-commit.test.js` PASS; temp repo smoke shows `graphify-out\graph.json` mtime changed from `2026-04-23T17:25:26.0398493Z` to `2026-04-23T17:25:29.1235778Z` after successful commit hook trigger.
- Task 26 закрыта: tracked `token-budget.js`, `token-budget.test.js`, `apply-token-budget.ps1`, `token-budget.design.md` added; global `~/.claude/hooks/token-budget.js` installed and writes daily `budget-YYYY-MM-DD.md` snapshots with `new/flat/↑/↓/3d` trend labels parsed from earlier budget reports.
- Task 26 proof: `node audit\S11_pipeline_top1\hooks\token-budget.test.js` PASS; `powershell -NoProfile -ExecutionPolicy Bypass -File audit\S11_pipeline_top1\hooks\apply-token-budget.ps1` → `updated=True`; `node ~/.claude/hooks/token-budget.js --date=2026-04-23 --days=7 --limit=7` → `C:\Users\user\.claude\budget-2026-04-23.md`; full suites outside sandbox `32/32`, `41/41`, `37/37` PASS.
- Tasks 43-45 закрыты: canonical `/init-project` upgrade snapshot + checker + apply script added; `project-ai-setup-check` added with nested-root and safe.directory detection; pilot applied to `D:\Ametrin projects\Izi tracker\izi-tracker`.
- Izi findings: parent folder `D:\Ametrin projects\Izi tracker` is wrong cwd; nested root verifier is green; `.claude/settings.json` created; no `.claude/settings.local.json`; `npx tsc --noEmit`, `npm run lint`, `npm test` PASS.
- Izi worktree after pilot is not clean: modified `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`, plus service file `.claude/checkpoints.log`; if continuing in that repo, either commit docs/settings separately or restage only the intended files.
- Task 27 deferred by user: do not continue `claude-context` spike automatically. Reason: extra external infra (`MILVUS_TOKEN` / Zilliz Cloud), lower immediate ROI versus existing Graphify, and explicit decision to move on.
- Research note: official docs now point to `@zilliz/claude-context-mcp@latest`; this is not a zero-config local add-on.
- Task 36 закрыта: `bc38c17` — добавлены `audit/S11_pipeline_top1/skills/skill-registry.js` и `skill-registry.test.js`; registry adapter умеет парсить `npx skills find`, leaderboard/source snapshots с `skills.sh`, TTL-cache по `query/source/owner` и tolerant read для битого JSONL.
- Task 36 proof: `node audit\S11_pipeline_top1\skills\skill-registry.test.js` → PASS; offline smoke `skill-registry.js --query "find skills" --source skills.sh --snapshot-file <tmp> --cache .tmp\skill-registry-smoke.jsonl --json` → `success: true`, `items: 2`.
- Task 37 закрыта: `bde5051` + `12d0bd5` — добавлены `audit/S11_pipeline_top1/skills/skill-quarantine-scan.js` и `skill-quarantine-scan.test.js`; scanner жёстко валидирует quarantine path, frontmatter, success criteria, token budget, destructive commands, direct writes в global roots и secret-like values, а fixture переведён на safe synthetic secret pattern для совместимости с repo secret-scanner.
- Task 37 proof: `node audit\S11_pipeline_top1\skills\skill-quarantine-scan.test.js` → PASS; clean smoke → `success: true`, dangerous smoke → `success: false` с deny по `success-criteria`, `destructive-command`, `global-root-write`, `embedded-secret`.
- Task 37 hardening: `bbb0103` — scanner больше не ограничен `SKILL.md`; теперь он обходит весь quarantined skill bundle, инспектирует companion files (`install.ps1`, `scripts/*.js` и т.д.), deny'ит binary artifacts и ловит dangerous writes/secrets в соседних файлах.
- Task 37 hardening proof: bundle smoke с безопасным `SKILL.md` + опасным `install.ps1` возвращает `success: false` с deny по `destructive-command`, `global-root-write`, `embedded-secret` именно из `install.ps1`.
- Superseded next action: `ЗАДАЧА 38 — Skill distiller + token budget digest` was the next step before the 2026-04-24 Developer Knowledge OS interview.
- `ЗАДАЧА 46` закрыта: создан `audit/S11_pipeline_top1/runtime/DEVELOPER_KNOWLEDGE_OS_ARCH.md` с layered target architecture, capability placement matrix, startup cost policy, routing order и rollout plan для задач 47-55.
- Current next action after interview: `ЗАДАЧА 47 — Startup payload and config drift audit`; old marketplace/ranker flow remains superseded.
## 2026-04-24 - Claude Startup Token Audit
- New evidence from `izi-tracker`: after disabling `vercel` and `superpowers`, first-message startup was still `58,683` cache-creation input tokens.
- Primary current tax is startup runtime payload, not only hooks: `deferred_tools_delta` (~88 tools), `mcp_instructions_delta`, `skill_listing` (~55 skills, ~13 KB visible payload).
- Project trim applied for `D:\Ametrin projects\Izi tracker\izi-tracker`: `skillListingMaxDescChars=128`, `skillListingBudgetFraction=0.002`, and noisy plugins disabled (`supabase`, `playwright`, `firecrawl`, `code-review`, `commit-commands`, `github`).
- Project-scoped MCP disable list added in `C:\Users\user\.claude.json` for `izi-tracker`: `context7`, `skillsmp`, `ukraine-laws`, `claude.ai Gmail`, `claude.ai Google Calendar`, `claude.ai Google Drive`, `claude.ai Indeed`, `plugin:github:github`, `plugin:playwright:playwright`, `plugin:supabase:supabase`.
- Structural debt: global `C:\Users\user\.claude.json` has duplicate project keys differing only by case, which breaks standard JSON parsing and points to long-term config drift.
- Architectural conclusion: Claude is carrying persistent global startup clutter; the problem is system-level and needs a separate cleanup pass across global settings, MCP inventory, plugin inventory, and skill catalog policy.

## 2026-04-24 - Developer Knowledge OS Pivot
- User interview changed S11 direction: main goal is not more hooks, but a strict self-improving full-stack workspace for all active projects.
- Core pains: context loss, usage limits, occasional pipeline-rule drift, lack of automatic learning from GitHub/skills/tools, and lack of synchronized global/project knowledge bases.
- New target: global minimal core, project-specific graph/RAG memory, GitHub-first discovery via `gh`, CLI-first execution, quarantine before promoting new skills/tools, and measured startup budget.
- New audit written: `audit/S11_pipeline_top1/runtime/DEVELOPER_KNOWLEDGE_OS_AUDIT_2026-04-24.md`.
- S11 `PLAN.md` Wave 9 replaced with tasks 46-55: Knowledge OS architecture, startup/config audit, GitHub discovery workflow, LightRAG pilot, OpenCLI-style CLI registry, browser automation pilot, Hermes architecture spike, self-improvement loop, settings normalization, final operating policy.
- `NEXT_SESSION_PROMPT.md` updated twice during 2026-04-24: сначала next task switched to Task 46, после закрытия Task 46 и фиксации hook friction следующий шаг закреплён как Task 47 Startup payload and config drift audit.

## 2026-04-24 - Hook Friction During Task 46
- Added `audit/S11_pipeline_top1/runtime/HOOK_FRICTION_2026-04-24.md` to capture real workflow blockers and token sinks.
- Main finding 1: Context7 enforcement did not accept MCP `resolve/query_docs`; edit flow unblocked only after explicit `cmd /c npx ctx7 docs ...` CLI call.
- Main finding 2: `node C:\Users\user\.claude\hooks\test-all-hooks.js` and `node C:\Users\user\.codex\test-codex-hooks.js` collapsed to `exit=null` mass-fail patterns (`0/32`, `0/41`) inside current sandbox, so hook self-tests are not trustworthy without a preflight health check.
- Main finding 3: `node C:\Users\user\.claude\hooks\test-hooks-behavior.js` produced `15/37 PASS`, `22 FAIL`, but many failures were secondary noise from broken harness, not isolated hook regressions.
- Main finding 4: output warnings fired only after oversized `Get-Content` / `git diff` payloads had already entered context, so the current limiter is reactive rather than preventive.
- Next follow-up: fold these findings into Task 47 and prioritize transport-agnostic Context7 tracking plus fast-fail preflight for hook suites.

## 2026-04-24 - Task 47 Startup Payload And Config Drift Audit
- Added reproducible helper: `audit/S11_pipeline_top1/runtime/startup-payload-audit.js`.
- Added final report: `audit/S11_pipeline_top1/runtime/startup-payload-audit.md`.
- `Pipeline-setupper` proof session `cf23b3b8-3f2d-4347-ac91-7f2584b3d182`:
  - `deferred_tools_delta`: `120` / `10,463 B`
  - `mcp_instructions_delta`: `2` / `748 B`
  - `skill_listing`: `87` / `19,517 B`
  - `cache_creation_input_tokens`: `34,645`
- `Izi-tracker` proof session `9e15dffd-5840-40af-b52d-4faa77717220`:
  - `deferred_tools_delta`: `93` / `6,873 B`
  - `mcp_instructions_delta`: `2` / `748 B`
  - `skill_listing`: `84` / `18,530 B`
  - `cache_creation_input_tokens`: `16,447`
  - `cache_read_input_tokens`: `14,882`
  - cold-cache reference `5ffa7388-f2b0-418d-b4ee-ac2767a53261`: `30,834` create / `0` read
- Main startup offender in both projects: `SessionStart` persisted payload около `56 KB` before the first assistant event.
- Config drift confirmed:
  - `C:\Users\user\.claude\settings.json` has `25` global plugin keys, `11` truthy-enabled.
  - `C:\Claude playground\Pipiline setupper\.claude/settings.local.json` has `147` allow rules.
  - `C:\Users\user\.claude.json` has `1` duplicate project-key group for `D:/Mammoth ERP system` across lines `1352`, `1507`, `1544`.
- Important separation: `exit=null` hook-suite failures stay in `HOOK_FRICTION_2026-04-24.md` and are not counted as Task 47 product/config findings.
- Next task after closing Task 47: `ЗАДАЧА 48 — GitHub-first tool discovery workflow`.

## 2026-04-24 - Task 48 GitHub-First Tool Discovery Workflow
- Added design doc: `audit/S11_pipeline_top1/runtime/github-discovery-workflow.md`.
- Added verifier: `audit/S11_pipeline_top1/runtime/github-tool-discovery.js`.
- Added dry-run proof fixture: `audit/S11_pipeline_top1/runtime/github-tool-discovery.fixture.json`.
- Added tests: `audit/S11_pipeline_top1/runtime/github-tool-discovery.test.js`.
- Protocol is now fixed as: `gh search repos` -> shortlist -> `gh repo view` -> README/releases/issues/license/Windows review -> optional `skill-registry.js` overlap check -> quarantine clone -> read-only spike -> structured verdict.
- Gates are explicit: adoption, maintenance, license, security, Windows/WSL support, token cost, overlap with existing tools.
- Auto-promotion is explicitly forbidden by default: the verifier always returns `autoPromote: false` and requires manifest + rollback before any future promotion.
- Integration with existing S11 tooling is implemented in code:
  - `skill-registry.js` contributes registry/adoption overlap signals.
  - `skill-quarantine-scan.js` can gate quarantined skill bundles before any promotion path.
- Verification proof:
  - `node audit\S11_pipeline_top1\runtime\github-tool-discovery.test.js` -> PASS.
  - `node --check audit\S11_pipeline_top1\runtime\github-tool-discovery.js` -> PASS.
  - `node audit\S11_pipeline_top1\runtime\github-tool-discovery.js --fixture-file audit\S11_pipeline_top1\runtime\github-tool-discovery.fixture.json --json` -> structured dry-run verdicts:
    - `OpenCLI` -> `adopt-spec` (`project`, `autoPromote=false`)
    - `browser-harness` -> `quarantine-readonly-spike` (`on-demand`, `autoPromote=false`)
    - `hermes-agent` -> `research-only` (`research`, `autoPromote=false`)
    - `LightRAG` -> `quarantine-readonly-spike` (`project`, `autoPromote=false`)
- Next task after closing Task 48: `ЗАДАЧА 49 — Project graph/RAG pilot with LightRAG`.

## 2026-04-24 - Tasks 49 and 50 Project Knowledge + CLI Registry
- Added Task 49 artifacts:
  - `audit/S11_pipeline_top1/runtime/project-knowledge-pilot.md`
  - `audit/S11_pipeline_top1/runtime/lightrag-pilot.md`
  - `audit/S11_pipeline_top1/runtime/project-knowledge-pilot.fixture.json`
  - `audit/S11_pipeline_top1/runtime/project-knowledge-pilot.js`
  - `audit/S11_pipeline_top1/runtime/project-knowledge-pilot.test.js`
- Task 49 decision: pilot project is `Pipeline-setupper`, not `Law-assistant`, to validate route order in the current repo first.
- Task 49 storage split is now explicit:
  - global: cross-project engineering policies
  - project: docs, runtime audit notes, Graphify outputs, selected code summaries, session learnings
  - task-local: temporary comparisons and scratch notes
- Task 49 proof:
  - `node audit\S11_pipeline_top1\runtime\project-knowledge-pilot.test.js` -> PASS
  - `node --check audit\S11_pipeline_top1\runtime\project-knowledge-pilot.js` -> PASS
  - `node audit\S11_pipeline_top1\runtime\project-knowledge-pilot.js --fixture-file audit\S11_pipeline_top1\runtime\project-knowledge-pilot.fixture.json --json` -> `success: true`, `questionCount: 10`, routes `graphify=4`, `lightrag=4`, `grep=2`
- Task 49 result: query-first routing is fixed as `CLI registry -> Graphify/LightRAG -> docs/memory -> grep/read`, with a 10-question comparison table and rollback/no-secrets checklist.
- Added Task 50 artifacts:
  - `audit/S11_pipeline_top1/runtime/cli-capability-registry.md`
  - `audit/S11_pipeline_top1/runtime/cli-capability-registry.fixture.json`
  - `audit/S11_pipeline_top1/runtime/cli-capability-registry.js`
  - `audit/S11_pipeline_top1/runtime/cli-capability-registry.test.js`
  - `audit/S11_pipeline_top1/runtime/cli-capabilities/*.opencli.yaml` for `gh`, `context7`, `playwright`, `supabase`, `vercel`, `firecrawl`
- Task 50 decision: use OpenCLI-style descriptors as JSON-compatible YAML, but do not add an OpenCLI runtime dependency.
- Task 50 proof:
  - `node audit\S11_pipeline_top1\runtime\cli-capability-registry.test.js` -> PASS
  - `node --check audit\S11_pipeline_top1\runtime\cli-capability-registry.js` -> PASS
  - `node audit\S11_pipeline_top1\runtime\cli-capability-registry.js --fixture-file audit\S11_pipeline_top1\runtime\cli-capability-registry.fixture.json --json` -> `success: true`, `descriptorCount: 6`
- Task 50 dry-run routes:
  - `gh` -> `gh search repos "lightrag graph rag" --limit 5`
  - `firecrawl` -> `firecrawl crawl https://docs.example.com --limit 50 --max-depth 2 --wait -o docs.json`
  - `vercel` -> `vercel logs my-app-production`
- Task 50 transport preferences are explicit:
  - `context7` -> prefer `mcp` for official API docs
  - `playwright` -> prefer `mcp` for interactive browser control
  - `gh` -> prefer `cli` for repository discovery
- Next task after closing Tasks 49 and 50: `ЗАДАЧА 51 — Browser automation pilot`.

## 2026-04-24 - Automatic Handoff Prompt Sync
- Added project opt-in config: `.claude/handoff-automation.json`.
- Added generator: `audit/S11_pipeline_top1/hooks/handoff-sync.js`.
- Updated `stop-auto-checkpoint.js`: it now runs project handoff sync on Stop even when `/checkpoint` was used, as long as the project has `.claude/handoff-automation.json`.
- Auto outputs:
  - `.planning/AUTO_NEXT_SESSION_PROMPT.md`
  - `.planning/AUTO_HANDOFF_STATUS.md`
- Current project config is anchored to `## WAVE 9 — DEVELOPER KNOWLEDGE OS`, so the generated prompt follows the next open task from that wave instead of stale unchecked tasks from older waves.
- Verified locally before Task 47 closure: direct generator run returned Task 47, and targeted tests `handoff-sync.test.js` plus `stop-auto-checkpoint-handoff.test.js` passed.

## 2026-04-24 - Tasks 51, 52, 53 Closed In One Batch
- Added Task 51 artifacts:
  - `audit/S11_pipeline_top1/runtime/browser-automation-pilot.md`
  - `audit/S11_pipeline_top1/runtime/browser-automation-pilot.fixture.json`
  - `audit/S11_pipeline_top1/runtime/browser-automation-pilot.js`
  - `audit/S11_pipeline_top1/runtime/browser-automation-pilot.test.js`
- Task 51 decision:
  - default browser layer: `playwright-cli`
  - fallback: `chrome-devtools-mcp`
  - `browser-harness` kept as optional on-demand path only
  - scope policy forbids global default browser automation
- Task 51 proof:
  - `node audit\S11_pipeline_top1\runtime\browser-automation-pilot.test.js` -> PASS
  - `node --check audit\S11_pipeline_top1\runtime\browser-automation-pilot.js` -> PASS
  - `node audit\S11_pipeline_top1\runtime\browser-automation-pilot.js --fixture-file audit\S11_pipeline_top1\runtime\browser-automation-pilot.fixture.json --json` -> `success: true`, ranking `playwright-cli=16`, `chrome-devtools-mcp=11`, `browser-harness=10`
- Added Task 52 artifacts:
  - `audit/S11_pipeline_top1/runtime/hermes-architecture-spike.md`
  - `audit/S11_pipeline_top1/runtime/hermes-architecture-spike.fixture.json`
  - `audit/S11_pipeline_top1/runtime/hermes-architecture-spike.js`
  - `audit/S11_pipeline_top1/runtime/hermes-architecture-spike.test.js`
- Task 52 decisions:
  - patterns fixed as `adapt` (learning loop), `adopt` (searchable memory), `reject` (multi-channel gateway)
  - native Windows support for Hermes is explicitly marked unsupported; only WSL2 path is acceptable
  - install/run remains forbidden without separate approval + sandbox plan
- Task 52 proof:
  - `node audit\S11_pipeline_top1\runtime\hermes-architecture-spike.test.js` -> PASS
  - `node --check audit\S11_pipeline_top1\runtime\hermes-architecture-spike.js` -> PASS
  - `node audit\S11_pipeline_top1\runtime\hermes-architecture-spike.js --fixture-file audit\S11_pipeline_top1\runtime\hermes-architecture-spike.fixture.json --json` -> `success: true`
- Added Task 53 artifacts:
  - `audit/S11_pipeline_top1/runtime/self-improvement-loop.md`
  - `audit/S11_pipeline_top1/runtime/self-improvement-loop.fixture.json`
  - `audit/S11_pipeline_top1/runtime/self-improvement-loop.js`
  - `audit/S11_pipeline_top1/runtime/self-improvement-loop.test.js`
- Task 53 decisions:
  - events fixed: `end-of-task`, `repeated-pattern`, `new-tool-discovered`, `failed-workflow`, `successful-workflow`
  - write scopes fixed: `globalDevKnowledge`, `projectKnowledge`, `skillUpdate`, `taskLocalNote`
  - no-auto-promote policy enforced by dry-run proposal checks
  - token budget gate added (`before/after/delta/maxDelta`)
- Task 53 proof:
  - `node audit\S11_pipeline_top1\runtime\self-improvement-loop.test.js` -> PASS
  - `node --check audit\S11_pipeline_top1\runtime\self-improvement-loop.js` -> PASS
  - `node audit\S11_pipeline_top1\runtime\self-improvement-loop.js --fixture-file audit\S11_pipeline_top1\runtime\self-improvement-loop.fixture.json --json` -> `success: true`, `autoPromote=false`, token `delta=943`
- New batch documentation policy:
  - close independent runtime tasks in packs of `3` where feasible
  - run one consolidated docs sync (`PLAN.md`, `MEMORY.md`, `NEXT_SESSION_PROMPT.md`, auto-handoff files) after the batch
- Next task after closing 51-53: `ЗАДАЧА 54 — Normalize global and project settings`.
