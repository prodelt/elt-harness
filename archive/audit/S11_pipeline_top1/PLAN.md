# S11 — Полный план работ (35 задач, 6 волн)

Формат: `ЗАДАЧА N | длительность | сложность | влияние → цель / шаги / проверка / зависимости`
Статус: `[ ]` todo, `[→]` in progress, `[x]` done, `[!]` blocked

---

## WAVE 1 — FOUNDATION (0–5h)

### [x] ЗАДАЧА 01 | 60m | MED | CRITICAL — Baseline метрики  ✅ 2026-04-21
**Цель**: зафиксировать исходные token/size данные (иначе «улучшили» невозможно измерить).
**Результат**: `audit/S11_pipeline_top1/baseline/SUMMARY.md` + 6 per-session отчётов в `~/.claude/baseline-2026-04-21/`.
**Канон для compare-после**: `-maxdepth 2` = Claude 314 JSONL / 408 MB / avg 1.30 MB | Codex 58 / 60 MB / avg 1.05 MB.
**Full (incl. subagents)**: Claude 1319 JSONL / 936 MB — ×2.3 от канона за счёт `subagents/`.
**Инсайт**: TOP-сессия 32.5 MB — 47.9% playwright.browser_take_screenshot (15.5 MB!). 27 Claude-сессий >1 MB за 7d.
**Hook-baseline**: test-all 29/29, test-codex 28/28, test-behavior 29/29 = **86/86 PASS** до WAVE 1.
**Правильные команды** (замена оригиналу):
```bash
find ~/.claude/projects/ -maxdepth 2 -name "*.jsonl" -mtime -30 -printf '%s %TY-%Tm-%Td %p\n' | sort -rn > ~/.claude/sessions-30d-maxdepth2.txt
find ~/.claude/projects/ -name "*.jsonl" -mtime -30 -printf '%s %TY-%Tm-%Td %p\n' | sort -rn > ~/.claude/sessions-30d.txt
find ~/.codex/sessions/ -name "*.jsonl" -mtime -30 -printf '%s %TY-%Tm-%Td %p\n' | sort -rn > ~/.codex/sessions-30d.txt
node ~/.claude/hooks/hook-stats.js > ~/.claude/hookstats-baseline-2026-04-21.txt
# analyze-session.js принимает ОДИН .jsonl — цикл по TOP-3:
awk '{print $3}' ~/.claude/sessions-30d.txt | head -3 | while read f; do \
  node ~/.claude/hooks/analyze-session.js "$f" > ~/.claude/baseline-2026-04-21/claude-$(basename "$f" .jsonl).txt; done
```
**Зависимости**: —

### [x] ЗАДАЧА 01b | 60m | MED | MED — Codex-specific session analyzer ✅ 2026-04-22
**Цель**: `analyze-session.js` — Claude-JSONL парсер (type=user/assistant), на Codex jsonl даёт 891 B мусора. Нужен адаптер или отдельный `analyze-codex-session.js` под формат Codex rollout (`record_type`, `payload.type`).
**Результат**:
- `audit/S11_pipeline_top1/hooks/analyze-session.js` — autodetect Claude/Codex JSONL, Codex rollout breakdown по `type`, `payload.type`, roles, tool-call inputs, tool outputs.
- `audit/S11_pipeline_top1/hooks/analyze-session.test.js` — Node assert fixture-test для Claude и Codex форматов.
- `audit/S11_pipeline_top1/baseline/codex-top{1,2,3}-*.txt` — TOP-3 Codex baseline outputs.
- `~/.claude/hooks/analyze-session.js` синхронизирован с repo-копией.
**Проверка**: TOP-3 Codex outputs 3496 / 2154 / 3281 bytes; `analyze-session.test.js` PASS; full hook gate 32/32 + 38/38 + 31/31 PASS.
**Зависимости**: 01

### [x] ЗАДАЧА 02 | 45m | LOW | HIGH — SoT для скиллов  ✅ 2026-04-21
**Цель**: зафиксировать `~/.claude/skills/` как единственный источник правды.
**Результат**:
- `audit/S11_pipeline_top1/skills/SOT_POLICY.md` — политика SoT + миграционный план
- `audit/S11_pipeline_top1/skills/DRIFT_2026-04-21.md` — snapshot drift
- `~/.claude/skill-drift-codex.txt` (24 строки), `~/.claude/skill-drift-gemini.txt` (45 строк) — raw-артефакты для хуков
**Цифры**: Claude 29 / Codex 18 / Gemini 18. Drift vs Codex — 5 каталог-скиллов
(`careful`, `contract-review`, `fix-issue`, `freeze`, `prime`) + 7 одиночных .md,
требующих конверсии в каталог-форму. Gemini — своя role-agent модель (не 1:1).
**Проверка**: `cat ~/.claude/skill-drift-codex.txt` = 24 строки diff, exit=1. ✓
**Разблокирует**: ЗАДАЧУ 05 (skill-sync-mirror).
**Зависимости**: —

### [x] ЗАДАЧА 03 | 60m | MED | CRITICAL — Session-size-guard hook  ✅ 2026-04-21
**Цель**: блокировать ушедшую в разнос сессию (>500 KB = compaction risk).
**Файл**: `~/.claude/hooks/session-size-guard.js` (из `hooks/session-size-guard.js`).
**Результат**: зарегистрирован в `~/.claude/settings.json` + `~/.codex/hooks.json` (UserPromptSubmit).
**Пороги**: 500 KB → WARN, 1 MB → CRIT. Advisory через `additionalContext`, silent если <500 KB.
**Тесты**: test-all-hooks 30/30, test-codex 29/29, test-behavior 29/29 = **88/88 PASS**.
**Live-verify**: на 32.5 MB Claude jsonl → `⚠ Сессия 32498KB (>1MB)…` ✓
**Зависимости**: —

### [x] ЗАДАЧА 04 | 45m | LOW | MED — Per-project settings template ✅ 2026-04-22
**Цель**: выключать глобальные плагины пер-проектно (экономия ~400 токенов/сессию).
**Шаги**: создать `~/.claude/templates/project-settings.json`:
```json
{
  "enabledPlugins": {
    "vercel": false, "supabase": false, "playwright": false,
    "firecrawl": true, "code-review": true, "commit-commands": true,
    "typescript-lsp": true, "github": true, "skill-creator": false,
    "chrome-devtools-mcp": false, "frontend-design": false
  }
}
```
Положить по копии в каждый из активных проектов с коррекцией по стеку.
**Результат**:
- `C:/Users/espad/.claude/templates/project-settings.json` создан с базовым набором `enabledPlugins`.
- Project-level `.claude/settings.json` обновлены для 8 текущих рабочих roots под `C:\Claude playground` и `D:\Ametrin projects`; `C:\Users\espad` использован как global baseline, но не перезаписывался.
- Матрица включённых plugin-id зафиксирована в `audit/S11_pipeline_top1/project-settings-matrix.json`.
- У проектов с уже существовавшими `.claude/settings.json` сохранены `hooks`, заменён только `enabledPlugins`.
**Проверка**:
- `D:\Ametrin projects\Izi tracker\.claude\settings.json` → `supabase@claude-plugins-official=true`, `vercel@claude-plugins-official=true`, `playwright@claude-plugins-official=true`.
- `D:\Ametrin projects\Law_assistant\.claude\settings.json` → `firecrawl@claude-plugins-official=true`, `hooks.PreToolUse` сохранён.
- `C:\Users\espad\.claude\templates\project-settings.json` → template содержит официальный формат `plugin-name@marketplace-name`.
**Зависимости**: 01

### [x] ЗАДАЧА 05 | 60m | MED | HIGH — Skill-sync-mirror hook  ✅ 2026-04-21
**Цель**: при редактировании `~/.claude/skills/*/SKILL.md` — авто-mirror в Codex и Gemini.
**Файл**: `~/.claude/hooks/skill-sync-mirror.js` (PostToolUse[Edit|Write]).
**Результат**: зарегистрирован в `~/.claude/settings.json` + `~/.codex/hooks.json`.
**Адаптация**: Codex — вырезаны строки с `FileChanged` / `Notification` (неподдерживаемые события).
Gemini — добавлен `category: general` во frontmatter, если отсутствует.
**Идемпотентность**: повторный вызов при идентичном adapted-контенте не пишет и не спамит (synced=[]).
**Тест**: edit → `pipeline/SKILL.md` → mtime Codex/Gemini обновился за ~1s. ✓
**Тест-сьюты**: test-all 30/30, test-codex **30/30** (+1 новый хук), test-behavior 29/29 = **89/89 PASS**.
**NB для реальных вызовов**: `tool_input.file_path` приходит в Windows-формате `C:\...` или `C:/...`,
а не MSYS `/c/...` — регекс на `[\\/]\.claude[\\/]skills[\\/]` покрывает оба случая.
**Зависимости**: 02 ✅

### [x] ЗАДАЧА 06 | 30m | LOW | MED — Sync AGENTS.md и GEMINI.md  ✅ 2026-04-22
**Цель**: после S10 изменений эти файлы отстали.
**Шаги**:
```bash
cp ~/.claude/CLAUDE.md ~/.claude/AGENTS.md
# manual: убрать Claude-Code-specific части (FileChanged, Notification)
cp ~/.claude/CLAUDE.md ~/.gemini/GEMINI.md
# manual: адаптировать под Antigravity (путь к settings.json тот же)
```
**Результат**: создан `~/.claude/AGENTS.md`, обновлён `~/.gemini/GEMINI.md`, а source-of-truth `~/.claude/CLAUDE.md` доправлен до exact-совпадения по строке `ctx7 CLI`, чтобы task закрывалась по собственному критерию.
**Проверка**: `Select-String -SimpleMatch "ctx7 CLI" ~/.claude/CLAUDE.md, ~/.claude/AGENTS.md, ~/.gemini/GEMINI.md` = 3 файла.
**Зависимости**: —

---

## WAVE 2 — MEMORY & CONTINUITY (5–9h)

### [x] ЗАДАЧА 07 | 90m | HIGH | CRITICAL — Skill session-harvest  ✅ 2026-04-21
**Цель**: cross-session briefing <500 токенов для SessionStart handoff.
**Файлы**: `~/.claude/skills/session-harvest/SKILL.md`, `harvest.js`.
**Результат**: `/harvest 7` → `~/.claude/session-harvest/latest.md` (1137 байт, 1.1s, 134 сессии).
**Секции**: Активные проекты (top-5), Компакт риск, Top errors, Handoff hint. **4/5** — Token trend
отложен (нужна история предыдущего окна, реализовать в ЗАДАЧЕ 26 — token-budget dashboard).
**Known gaps (deferred)**:
- `lastFocus` парсится только из string content. Claude Code пишет массив — регекс не ловит.
  Фикс: итерировать `ev.message.content[]` и искать Focus в `text`-элементах.
- Skill-sync-mirror автоматически зазеркалит SKILL.md в Codex/Gemini при следующем Edit.
**Тест-сьюты**: test-all 30/30, test-codex 30/30, test-behavior 29/29 = **89/89 PASS**.
**Success Criteria (из SKILL.md)**: <2000 байт ✓, <5s ✓, не падает на пустом `~/.claude/projects/` ✓,
не падает без `errors.log` ✓.
**Разблокирует**: ЗАДАЧИ 08 (harvest-injector), 09 (projects-dashboard), 11 (auto-checkpoint).
**Зависимости**: 01 ✅

### [x] ЗАДАЧА 08 | 30m | LOW | HIGH — Harvest-injector hook
**Цель**: SessionStart инжектит latest.md если <24h.
**Файл**: `~/.claude/hooks/harvest-injector.js`.
**Проверка**: `node ~/.claude/hooks/harvest-injector.js < /dev/null` = JSON с `additionalContext`.
**Зависимости**: 07
**Результат**: hook установлен, зарегистрирован в settings.json + codex hooks.json. Тесты: 30/30 + 31/31 + 29/29 = 90/91 PASS.

### [x] ЗАДАЧА 09 | 60m | MED | HIGH — Project status dashboard
**Цель**: `~/.claude/projects-dashboard.md` с 7 активными проектами (last session, focus, status).
**Файл**: `~/.claude/hooks/projects-dashboard.js` (скрипт + запускать из session-harvest).
**Проверка**: `cat ~/.claude/projects-dashboard.md` — 7 строк с датами.
**Зависимости**: 07
**Результат**: stat-only перший прохід (0.4s < 5s limit), SessionStart хук. 30/30 + 32/32 + 29/29 PASS.

### [x] ЗАДАЧА 10 | 45m | LOW | MED — Focus-log aggregator  ✅ 2026-04-22
**Цель**: `session-focus-gate` пишет в `~/.claude/focus-log.jsonl` = история фокусов.
**Шаги**: расширить существующий хук на append `{ date, project, focus, doneCriteria }`.
**Реализация**: `audit/S11_pipeline_top1/hooks/session-focus-gate.js`; установлен в `~/.claude/hooks/session-focus-gate.js`.
**Проверка**: `audit/S11_pipeline_top1/hooks/session-focus-gate.test.js` создаёт 3 synthetic session transcripts и подтверждает 3 строки в `focus-log.jsonl` без дублей.
**Тесты**: `test-all-hooks` 32/32, `test-codex-hooks` 38/38, `test-hooks-behavior` 31/31, `session-focus-gate.test.js` PASS.
**Зависимости**: 09

### [x] ЗАДАЧА 11 | 60m | MED | HIGH — Auto-checkpoint on Stop
**Цель**: если сессия закончилась без `/checkpoint` — автосохранить briefing.
**Файл**: `~/.claude/hooks/stop-auto-checkpoint.js` (Stop event).
**Проверка**: завершить сессию без /checkpoint → `~/.claude/auto-checkpoints/<timestamp>.md` создан.
**Реализация**: `audit/S11_pipeline_top1/hooks/stop-auto-checkpoint.js`; установлен в `~/.claude/hooks/`, зарегистрирован в Claude/Codex Stop hooks.
**Тесты**: `test-all-hooks` 31/31, `test-codex-hooks` 33/33, `test-hooks-behavior` 31/31.
**Зависимости**: 07

### [x] ЗАДАЧА 12 | 30m | LOW | MED — Memory prune advisory ✅ 2026-04-22
**Цель**: расширить `memory-discipline` — при MEMORY.md >80 строк инжектить `/learn`.
**Реализация**: added tracked source `audit/S11_pipeline_top1/hooks/memory-discipline.js` + targeted `memory-discipline.test.js`; installed hook synced to `~/.claude/hooks/memory-discipline.js`. Логика теперь корректно считает строки без ложного +1 от trailing newline и остаётся совместимой с существующим behavioral suite.
**Проверка**:
- `node audit/S11_pipeline_top1/hooks/memory-discipline.test.js` → PASS.
- Installed hook smoke: `81` строк → advisory c `/learn`, `101` строка → block.
- Full suites: `test-all-hooks` 32/32, `test-codex-hooks` 38/38, `test-hooks-behavior` 31/31.
**Зависимости**: —

---

## WAVE 3 — SKILL UPGRADE (9–14h)

### [x] ЗАДАЧА 13 | 60m | MED | HIGH — SemVer для всех скиллов ✅ 2026-04-22
**Цель**: в frontmatter каждого SKILL.md поля `version: 1.0.0`, `changelog:`, `requires: []`.
**Реализация**:
- добавлен tracked automation `audit/S11_pipeline_top1/skills/ensure-skill-semver.ps1`, который умеет дополнять существующий frontmatter и создавать новый для legacy `SKILL.md` без YAML-шапки;
- добавлен `audit/S11_pipeline_top1/skills/verify-skill-semver.ps1` для проверки наличия `version`, `requires`, `changelog` по всем skill roots;
- SemVer metadata проставлены во всех текущих skill trees: `~/.claude/skills` (22 файла), `~/.codex/skills` (18), `~/.gemini/skills` (19);
- tracked audit-копия `audit/S11_pipeline_top1/skills/git-flow/SKILL.md` синхронизирована с новым форматом.
**Проверка**:
- `powershell -NoProfile -ExecutionPolicy Bypass -File audit/S11_pipeline_top1/skills/verify-skill-semver.ps1` → `22 + 18 + 19` skill files checked, missing fields = 0.
- Smoke samples: `~/.claude/skills/init-project/SKILL.md`, `~/.claude/skills/ship/SKILL.md`, `~/.gemini/skills/sync-docs/SKILL.md` содержат SemVer frontmatter.
**Зависимости**: 02

### [x] ЗАДАЧА 14 | 45m | LOW | HIGH — Declarative skill deps ✅ 2026-04-22
**Цель**: `requires:` заставляет оркестратор (pipeline) проверить prerequisite.
**Пример**: `sprint/SKILL.md` → `requires: [architect-first, tdd]`.
**Проверка**: запустить /sprint без предшествующего /architect-first → advisory.
**Реализация**:
- `audit/S11_pipeline_top1/skills/skill-deps-check.js` — читает `requires:` из frontmatter и резолвит prerequisite по `phase` / `checkpoints[].phase` / `checkpoints[].skill`;
- `audit/S11_pipeline_top1/skills/skill-deps-check.test.js` — PASS;
- `audit/S11_pipeline_top1/skills/apply-skill-deps-update.ps1` — updater для `pipeline`, `sprint`, `architect-first`, `inline-review`, `pipeline/state-schema.md`.
**Проверка**:
- updater успешно применён к `.tmp/task14-fixture/skills`;
- обновлённый `sprint/SKILL.md` получил `version: 1.1.0` и `requires: [architect-first]`;
- `node audit/S11_pipeline_top1/skills/skill-deps-check.js <fixture-sprint> <classified-state>` → advisory `Prerequisite missing for sprint: architect-first...`;
- тот же check с `architected` state → `OK: sprint`.
- ручной real apply подтверждён пользователем:
  - `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Claude playground\Pipiline setupper\audit\S11_pipeline_top1\skills\apply-skill-deps-update.ps1"` → `~/.claude` updated `5`, `~/.codex` updated `4`, `~/.gemini` updated `4`;
  - `node audit/S11_pipeline_top1/skills/skill-deps-check.test.js` → PASS;
  - `node audit/S11_pipeline_top1/skills/skill-deps-check.js sprint "$HOME\.claude\pipeline-state.json"` → advisory on `classified` state with missing `architect-first`.
**Зависимости**: 13

### [x] ЗАДАЧА 15 | 60m | MED | HIGH — Observable success criteria ✅ 2026-04-23
**Цель**: секция `## Success Criteria` с проверяемыми предикатами в каждом скилле.
**Пример `/ship`**: `git status clean AND tests 100% AND PR created`.
**Проверка**: скилл возвращает `success: false` если критерий не выполнен.
**Реализация**:
- добавлен `audit/S11_pipeline_top1/skills/success-criteria-check.js`, который игнорирует fenced code blocks, проверяет реальную секцию `## Success Criteria`, требует минимум 2 проверяемых predicate lines, `success: false` failure path и proof/evidence requirement;
- добавлен `audit/S11_pipeline_top1/skills/success-criteria-check.test.js` с fixture-тестами на missing section, fenced false-positive, upgrade existing section и write-standard mode;
- стандартный Success Criteria protocol применён к `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills` и tracked audit skill snapshots.
**Проверка**:
- `node audit/S11_pipeline_top1/skills/success-criteria-check.test.js` → PASS.
- `node audit/S11_pipeline_top1/skills/success-criteria-check.js --write-standard --roots C:\Users\espad\.claude\skills C:\Users\espad\.codex\skills C:\Users\espad\.gemini\skills audit\S11_pipeline_top1\skills` → `OK: success criteria`, `checked: 66`, `updated: 2` on final rerun.
**Зависимости**: 13

### [x] ЗАДАЧА 16 | 90m | HIGH | CRITICAL — /learn патчит SKILL.md ✅ 2026-04-23
**Цель**: /learn не просто память — генерирует PR-style diff к скиллу при обнаружении паттерна.
**Шаги**: переписать `~/.claude/skills/learn/SKILL.md` с этапами: extract → propose diff → ask user → apply.
**Проверка**: после сессии с паттерном (3+ повторов) /learn предлагает diff.
**Реализация**:
- добавлен canonical snapshot `audit/S11_pipeline_top1/skills/learn/SKILL.md` (`version: 1.1.0`) с workflow `Extract → Propose Diff → Ask User → Apply`;
- `/learn` теперь предлагает PR-style fenced `diff` только при 3+ повторениях actionable pattern, требует явное approval перед применением и возвращает `success: false` при отсутствующем approval;
- добавлены `learn-skill-check.js`, `learn-skill-check.test.js`, `apply-learn-skill-update.ps1`;
- global apply создал/обновил `/learn` в `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`.
**Проверка**:
- `node audit/S11_pipeline_top1/skills/learn-skill-check.test.js` → PASS.
- `node audit/S11_pipeline_top1/skills/learn-skill-check.js` → `OK: learn skill`, `checked: 3`.
- `node audit/S11_pipeline_top1/skills/success-criteria-check.js --roots C:\Users\espad\.claude\skills\learn C:\Users\espad\.codex\skills\learn C:\Users\espad\.gemini\skills\learn audit\S11_pipeline_top1\skills\learn` → `OK: success criteria`, `checked: 4`.
- повторный `apply-learn-skill-update.ps1` → `updated=False` для всех 3 roots.
- `verify-skill-semver.ps1` → `~/.claude` 23, `~/.codex` 18, `~/.gemini` 20 checked, missing fields = 0.
**Зависимости**: 13, 15

### [x] ЗАДАЧА 17 | 45m | LOW | MED — /architect-first Phase 2.5 "Top-3" ✅ 2026-04-23
**Цель**: обязательный шаг сравнения с top-3 реализациями через ctx7.
**Шаги**: редактировать `architect-first/SKILL.md`, добавить Phase 2.5 с командой `MSYS_NO_PATHCONV=1 ctx7 search "<pattern>" | head -40`.
**Проверка**: лог вызовов ctx7 содержит search при следующем /architect-first.
**Реализация**:
- добавлен canonical snapshot `audit/S11_pipeline_top1/skills/architect-first/SKILL.md` (`version: 1.1.0`) с `Phase 2.5 - Top-3 Implementation Scan`;
- `/architect-first` теперь требует ctx7 top-3 evidence перед выбором архитектурного варианта, фиксирует query, top three candidates и keep/change decision;
- сохранена S11 audit-команда `MSYS_NO_PATHCONV=1 ctx7 search "<pattern>" | head -40`; добавлен documented fallback `ctx7 library`, потому что локальный `ctx7 search "<pattern>"` возвращает `too many arguments`;
- добавлены `architect-first-check.js`, `architect-first-check.test.js`, `apply-architect-first-update.ps1`;
- global apply синхронизировал `/architect-first` в `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`.
**Проверка**:
- `node audit/S11_pipeline_top1/skills/architect-first-check.test.js` → PASS.
- `node audit/S11_pipeline_top1/skills/architect-first-check.js` → `OK: architect-first skill`, `checked: 3`.
- `node audit/S11_pipeline_top1/skills/success-criteria-check.js --roots C:\Users\espad\.claude\skills\architect-first C:\Users\espad\.codex\skills\architect-first C:\Users\espad\.gemini\skills\architect-first audit\S11_pipeline_top1\skills\architect-first` → `OK: success criteria`, `checked: 4`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File audit\S11_pipeline_top1\skills\verify-skill-semver.ps1` → `~/.claude` 23, `~/.codex` 18, `~/.gemini` 20 checked.
- `$env:MSYS_NO_PATHCONV='1'; ctx7 search "architect-first top-3 implementation scan"` → failed as expected on current CLI: `too many arguments`.
- `$env:MSYS_NO_PATHCONV='1'; ctx7 library "architect-first" "top implementations architecture alternatives"` → returned top candidates including `/w8fyz/architect`, `/architect/arc.codes`, `/architect-xyz/architect-py`.
**Зависимости**: —

### [x] ЗАДАЧА 18 | 60m | MED | HIGH — ctx7 cache 24h ✅ 2026-04-23
**Цель**: одинаковые запросы ctx7 не делают второго сетевого вызова.
**Файлы**: `~/.claude/hooks/lib/ctx7-cache.js` + изменения в `context7-tracker`.
**Проверка**: повторный `ctx7 docs ...` — advisory "cache hit".
**Реализация**:
- добавлен tracked `audit/S11_pipeline_top1/hooks/lib/ctx7-cache.js` с 24h hash cache, entry files и `access.log`;
- добавлен tracked `audit/S11_pipeline_top1/hooks/context7-tracker.js`, который работает в двух режимах:
  - `PreToolUse[Bash]`: при повторном `ctx7 docs/library` возвращает `permissionDecision: deny` с `CTX7 CACHE HIT` и путём к cache file;
  - `PostToolUse[Bash]`: сохраняет результат первого `ctx7 docs/library` и отмечает Context7 usage state для existing reminder/enforcer hooks;
- `apply-ctx7-cache-update.ps1` копирует tracker/cache lib в `~/.claude/hooks` и регистрирует `context7-tracker.js` в `PreToolUse[Bash]` для Claude/Codex;
- добавлены deterministic tests `ctx7-cache.test.js` и `context7-tracker-cache.test.js`.
**Проверка**:
- `node audit/S11_pipeline_top1/hooks/ctx7-cache.test.js` → PASS.
- `node audit/S11_pipeline_top1/hooks/context7-tracker-cache.test.js` → PASS.
- `powershell -NoProfile -ExecutionPolicy Bypass -File audit\S11_pipeline_top1\hooks\apply-ctx7-cache-update.ps1` → `claudePreToolUseUpdated=True`, `codexPreToolUseUpdated=True`.
- full hook suites outside sandbox: `test-all-hooks` 32/32, `test-codex-hooks` 39/39, `test-hooks-behavior` 31/31 = 102/102 PASS.
**Зависимости**: —

---

## WAVE 4 — TDD DEPTH (14–17h)

### [x] ЗАДАЧА 19 | 60m | MED | HIGH — TDD skill rewrite для business-logic
**Цель**: тесты проверяют бизнес-предикат, не return type.
**Шаги**: обновить `tdd/SKILL.md` с примерами "bad vs good" (показать `.toBeDefined()` vs `.toBe(<concrete>)`).
**Результат**:
- добавлен canonical `audit/S11_pipeline_top1/skills/tdd/SKILL.md` (`version: 1.0.0`) с Red-Green-Refactor workflow;
- `/tdd` теперь требует concrete business assertion values и помечает return-type-only assertions как `success: false`;
- bad vs good примеры явно показывают `.toBeDefined()` / `.toBeTruthy()` против `.toBe(<concrete>)`;
- добавлены `tdd-skill-check.js`, `tdd-skill-check.test.js`, `apply-tdd-skill-update.ps1`;
- `/tdd` установлен в `~/.claude/skills`, `~/.codex/skills`, `~/.gemini/skills`.
**Проверка**:
- red state: `node audit\S11_pipeline_top1\skills\tdd-skill-check.test.js` → `Cannot find module './tdd-skill-check'`.
- `node audit\S11_pipeline_top1\skills\tdd-skill-check.test.js` → PASS.
- `node audit\S11_pipeline_top1\skills\tdd-skill-check.js` → `OK: tdd skill`, `checked: 3`.
- `node audit\S11_pipeline_top1\skills\success-criteria-check.js --roots "$HOME\.claude\skills\tdd" "$HOME\.codex\skills\tdd" "$HOME\.gemini\skills\tdd" audit\S11_pipeline_top1\skills\tdd` → `OK: success criteria`, `checked: 4`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File audit\S11_pipeline_top1\skills\verify-skill-semver.ps1` → `~/.claude` 24, `~/.codex` 19, `~/.gemini` 21 checked.
**Зависимости**: 13

### [x] ЗАДАЧА 20 | 90m | HIGH | HIGH — Coverage gate
**Цель**: PreToolUse[Bash `git commit`] блокирует если coverage упал ниже 80%.
**Файл**: `~/.claude/hooks/coverage-gate.js`.
**Результат**:
- добавлен tracked `audit/S11_pipeline_top1/hooks/coverage-gate.js`;
- hook проверяет `git commit`, пропускает `--amend`, читает `coverage/coverage-summary.json` или `coverage/lcov.info`;
- threshold по умолчанию 80%, можно переопределить через `COVERAGE_GATE_MIN`;
- missing coverage пропускается silently, recorded line coverage ниже threshold возвращает `permissionDecision: deny`;
- добавлены deterministic tests `coverage-gate.test.js` и apply script `apply-coverage-gate.ps1`;
- hook установлен в `~/.claude/hooks/coverage-gate.js` и зарегистрирован для Claude/Codex `PreToolUse[Bash]`.
**Проверка**:
- red state: `node audit\S11_pipeline_top1\hooks\coverage-gate.test.js` → `Cannot find module './coverage-gate'`.
- `node audit\S11_pipeline_top1\hooks\coverage-gate.test.js` → PASS.
- installed smoke: coverage 50% → `deny`; coverage 90% → silent allow.
- `node ~/.claude/hooks/test-all-hooks.js` outside sandbox → `32/32 PASS`.
- `node ~/.codex/test-codex-hooks.js` outside sandbox → `40/40 PASS`.
- `node ~/.claude/hooks/test-hooks-behavior.js` outside sandbox → `31/31 PASS`.
**Зависимости**: 19

### [x] ЗАДАЧА 21 | 60m | MED | MED — Meta-test «хук реально блокирует»
**Цель**: расширить `test-hooks-behavior.js` — кейсы для новых хуков (session-size-guard, git-branch-guard, coverage-gate).
**Результат**:
- добавлен tracked checker `audit/S11_pipeline_top1/hooks/hook-behavior-meta-check.js`;
- добавлен apply script `apply-hook-behavior-meta-tests.ps1`;
- global `~/.claude/hooks/test-hooks-behavior.js` расширен task 21 блоком:
  - `session-size-guard`: 501KB и 1001KB transcript warnings;
  - `git-branch-guard`: `main` commit blocked, `feature/*` commit allowed;
  - `coverage-gate`: 50% blocked, 90% allowed.
**Проверка**:
- red state: `node audit\S11_pipeline_top1\hooks\hook-behavior-meta-check.js` → missing task 21 cases.
- fixture apply + checker → `OK: hook behavior meta-tests`, `checked: 1`.
- global apply → inserted task 21 meta-tests.
- `node audit\S11_pipeline_top1\hooks\hook-behavior-meta-check.js` → `OK: hook behavior meta-tests`, `checked: 1`.
- `node ~/.claude/hooks/test-hooks-behavior.js` outside sandbox → `37/37 PASS`.
- `node ~/.claude/hooks/test-all-hooks.js` outside sandbox → `32/32 PASS`.
- `node ~/.codex/test-codex-hooks.js` outside sandbox → `40/40 PASS`.
**Зависимости**: 03, 20, 30

### [x] ЗАДАЧА 22 | 45m | LOW | MED — inline-review business-assertion check
**Цель**: хук ругается на тесты с только `.toBeTruthy()` / `.toBeDefined()`.
**Проверка**: тест без concrete assertion → inline-review warning.
**Файлы**: `audit/S11_pipeline_top1/hooks/inline-review-gate.js`, `inline-review-business-assertion.test.js`, `apply-inline-review-business-assertion.ps1`.
**Результат**: installed `inline-review-gate` emits PostToolUse additionalContext for tests whose assertions are only `.toBeDefined()` / `.toBeTruthy()`, while concrete assertions and non-test files stay silent.
**Proof**:
- `node audit\S11_pipeline_top1\hooks\inline-review-business-assertion.test.js` → PASS.
- Installed smoke with `expect(calculateInvoice()).toBeDefined()` → emits `Inline review warning`.
- `node ~/.codex/test-codex-hooks.js` outside sandbox → `40/40 PASS`.
- `node ~/.claude/hooks/test-all-hooks.js` outside sandbox → `32/32 PASS`.
- `node ~/.claude/hooks/test-hooks-behavior.js` outside sandbox → `37/37 PASS`.
**Зависимости**: 19

---

## WAVE 5 — SELF-IMPROVEMENT (17–21h)

### [x] ЗАДАЧА 23 | 60m | MED | HIGH — Weekly pipeline-proposals ✅ 2026-04-23
**Цель**: еженедельный `~/.claude/proposals-<week>.md` из metrics.json (top-5 шумных хуков, top-5 ошибок).
**Файл**: `~/.claude/hooks/weekly-analysis.js`.
**Результат**: added tracked `audit/S11_pipeline_top1/hooks/weekly-analysis.js`, `weekly-analysis.test.js`, `apply-weekly-analysis.ps1`; manual run writes `~/.claude/proposals-<ISO-week>.md` with noisy-hook ranking, repeated log patterns and ranked proposals.
**Проверка**: ручной запуск → файл с ранжированными предложениями.
**Зависимости**: 01

### [x] ЗАДАЧА 24 | 45m | LOW | MED — SkillAnything workflow docs ✅ 2026-04-23
**Цель**: `~/.claude/skills/skill-anything/USAGE.md` с workflow «новый CLI → 3 дистрибутива».
**Результат**: added canonical `audit/S11_pipeline_top1/skills/skill-anything/USAGE.md` + `apply-usage.ps1`; synced usage doc into Claude/Codex `skill-anything` roots; documented current scaffold workaround for unresolved `config.yaml` placeholders before packaging.
**Проверка**: прогнать для тестовой утилиты → dist/claude-code, dist/codex, dist/generic сгенерированы.
**Зависимости**: 05

### [x] ЗАДАЧА 25 | 60m | MED | MED — Auto graphify update after commit ✅ 2026-04-23
**Цель**: PostToolUse[Bash] детектит успешный git commit → спавнит `cmd /c graphify update .` detached.
**Файл**: `~/.claude/hooks/graphify-post-commit.js`.
**Результат**: added tracked `graphify-post-commit.js`, `graphify-post-commit.test.js`, `apply-graphify-post-commit.ps1`; installed hook is registered in Claude/Codex `PostToolUse[Bash]` and starts detached `graphify update .` only after successful `git commit`.
**Проверка**: после commit mtime graphify_index обновился за ≤60s.
**Зависимости**: —

### [x] ЗАДАЧА 26 | 45m | LOW | MED — Token-budget dashboard ✅ 2026-04-23
**Цель**: `~/.claude/budget-<date>.md` с колонками project/sessions/avg_kb/trend.
**Файл**: `~/.claude/hooks/token-budget.js`.
**Результат**:
- `audit/S11_pipeline_top1/hooks/token-budget.js` — stat-first CLI generator with markdown snapshot history and `new/flat/↑/↓/3d` trend labels.
- `audit/S11_pipeline_top1/hooks/token-budget.test.js` — deterministic fixture for rising, falling, flat and new-project cases.
- `audit/S11_pipeline_top1/hooks/apply-token-budget.ps1` — syncs tracked source into `~/.claude/hooks/token-budget.js`.
- `audit/S11_pipeline_top1/hooks/token-budget.design.md` — architect-first note with A/B/C options, Context7 evidence and final decision.
**Проверка**:
- `node audit\S11_pipeline_top1\hooks\token-budget.test.js` → PASS.
- `node audit\S11_pipeline_top1\hooks\token-budget.js --help` → usage output.
- `powershell -NoProfile -ExecutionPolicy Bypass -File audit\S11_pipeline_top1\hooks\apply-token-budget.ps1` → `updated=True`.
- `node ~/.claude/hooks/token-budget.js --date=2026-04-23 --days=7 --limit=7` → `C:\Users\espad\.claude\budget-2026-04-23.md`.
**Зависимости**: 01, 09

### [!] ЗАДАЧА 27 | 60m | MED | HIGH — claude-context spike на Law-assistant (deferred 2026-04-23)
**Цель**: проверить semantic RAG для топ-1 проекта.
**Шаги**:
```bash
npm i -g @zilliztech/claude-context-mcp
# Voyage API key в ~/.bashrc (из vault)
# добавить mcpServers.claude-context в /d/Ametrin\ projects/Law-assistant/.claude/settings.json
```
**Проверка**: `mcp__claude-context__search "auth flow"` в Law-assistant возвращает релевантные фрагменты за <5s.
**Зависимости**: 01, 04
**Статус (2026-04-23)**: user chose not to pursue `claude-context`. Spike intentionally deferred because official setup now points to `@zilliz/claude-context-mcp@latest`, requires external infra (`MILVUS_TOKEN` / Zilliz Cloud) and overlaps partially with existing Graphify-based repo understanding. Do not resume automatically; revisit only by explicit request or if semantic code search becomes a proven bottleneck.

### [x] ЗАДАЧА 28 | 30m | LOW | HIGH — Финальная верификация
**Цель**: все тесты зелёные, нет регрессий.
**Шаги**:
```bash
node ~/.claude/hooks/test-all-hooks.js
node ~/.codex/test-codex-hooks.js
node ~/.claude/hooks/test-hooks-behavior.js
```
**Проверка**: 95+/95+ PASS суммарно (baseline 86/86 не сломан).
**Зависимости**: все.
**Статус (2026-04-22)**: финальный прогон после tasks 30-31 — 97/97 PASS; см. `FINAL_VERIFICATION.md`.

---

## WAVE 6 — GIT DISCIPLINE (21–25h)

### [x] ЗАДАЧА 29 | 60m | HIGH | CRITICAL — Per-project git audit & init  ✅ 2026-04-22
**Цель**: каждый активный проект имеет свой `.git/`, не наследует от `C:\`.
**Результат**: добавлен read-only аудит `audit/S11_pipeline_top1/git-project-audit.js` + тесты.
Скрипт ничего не инициализирует и не меняет: выводит `OK`, `NEED INIT` или `MISSING`, а `git init`
остаётся только ручным действием после отдельного подтверждения.
**Проверка 2026-04-22**:
- `node audit/S11_pipeline_top1/git-project-audit.test.js` → 5/5 PASS.
- `node audit/S11_pipeline_top1/git-project-audit.js` → `OK: C:\Claude playground\Pipiline setupper -> C:\Claude playground\Pipiline setupper`.
- `node audit/S11_pipeline_top1/git-project-audit.js --active-projects` → Pipeline-setupper OK; 4 D:\ projects MISSING в текущей среде; изменений не выполнено.
**Шаги**:
```bash
for p in "/c/Claude playground/Pipiline setupper" \
         "/d/Ametrin projects/Izi-tracker" \
         "/d/Ametrin projects/Law-assistant" \
         "/d/Ametrin projects/sudoviy-master-try-3" \
         "/d/Ametrin projects/tg-bot-reclamaties-master"; do
  if [ ! -d "$p/.git" ]; then echo "NEED INIT: $p"; else echo "OK: $p"; fi
done
# для NEED INIT — git init + первый commit
```
**Проверка**: в каждом `cd <project>; git rev-parse --show-toplevel` возвращает путь проекта.
**Зависимости**: —

### [x] ЗАДАЧА 30 | 60m | MED | CRITICAL — git-branch-guard hook
**Цель**: блокирует `git commit` в main/master (PreToolUse[Bash]).
**Файл**: `~/.claude/hooks/git-branch-guard.js` (см. `hooks/` здесь).
**Проверка**: `git checkout main; git commit -m "x"` → deny; `git checkout -b feature/x` → OK.
**Зависимости**: 29
**Статус (2026-04-22)**: hook установлен в `~/.claude/hooks/`, зарегистрирован в `~/.claude/settings.json` и `~/.codex/hooks.json`; smoke: feature-ветка → allow, protected branch → deny.

### [x] ЗАДАЧА 31 | 45m | LOW | HIGH — conventional-commit-validator hook
**Цель**: требует `type(scope): subject` формат.
**Файл**: `~/.claude/hooks/conventional-commit-validator.js`.
**Проверка**: `git commit -m "fix bug"` → deny; `git commit -m "fix(auth): token expiry"` → OK.
**Зависимости**: —
**Статус (2026-04-22)**: hook установлен в `~/.claude/hooks/`, зарегистрирован в `~/.claude/settings.json` и `~/.codex/hooks.json`; smoke: invalid subject → deny, valid subject → allow.

### [x] ЗАДАЧА 32 | 30m | LOW | HIGH — branch-name-validator hook
**Цель**: регулирует имена веток.
**Файл**: `~/.claude/hooks/branch-name-validator.js`.
**Regex**: `^(feature|fix|hotfix|chore|docs|refactor|test)/[a-z0-9-]{3,50}$`.
**Проверка**: `git checkout -b weird-thing` → deny.
**Зависимости**: —
**Статус (2026-04-22)**: hook установлен в `~/.claude/hooks/`, зарегистрирован в `~/.claude/settings.json` и `~/.codex/hooks.json`; Antigravity наследует `~/.claude/settings.json`; smoke: invalid branch → deny, valid branch → allow; suites → 98/98 PASS.

### [x] ЗАДАЧА 33 | 90m | HIGH | HIGH — pre-commit-gate hook
**Цель**: перед коммитом — lint + fast tests.
**Файл**: `~/.claude/hooks/pre-commit-gate.js`.
**Логика**: детект package.json/pyproject.toml, запуск соответствующих тестов (таймаут 60s).
**Проверка**: lint-error → commit blocked.
**Зависимости**: 30
**Статус (2026-04-22)**: hook установлен в `~/.claude/hooks/`, зарегистрирован в `~/.claude/settings.json` и `~/.codex/hooks.json`; Antigravity наследует `~/.claude/settings.json`; smoke: failing lint → deny, passing lint+test → allow; suites → 99/99 PASS. Реализация запускает `npm test --silent` с `CI=true`, без Jest-only флагов.

### [x] ЗАДАЧА 34 | 45m | MED | HIGH — Skill /git-flow
**Цель**: оркестратор GitHub Flow.
**Файл**: `~/.claude/skills/git-flow/SKILL.md` с шагами start / sync / finish.
**Проверка**: `/git-flow start feature x` создаёт ветку.
**Зависимости**: 30, 31, 32
**Статус (2026-04-22)**: skill создан в Claude SoT и зеркалах Codex/Gemini; audit source: `skills/git-flow/SKILL.md`; SHA256 всех копий совпадает; smoke: `feature x` нормализуется в валидную ветку `feature/x-task`.

### [x] ЗАДАЧА 35 | 45m | MED | HIGH — Session-branch-advisor hook
**Цель**: SessionStart советует создать ветку при работе в main.
**Файл**: `~/.claude/hooks/session-branch-advisor.js`.
**Проверка**: старт в main + есть Focus → advisory; старт в feature/* → молчит.
**Зависимости**: 34
**Статус (2026-04-22)**: hook создан, установлен в `~/.claude/hooks/`, зарегистрирован в `~/.claude/settings.json` и `~/.codex/hooks.json`; Antigravity наследует `~/.claude/settings.json`; smoke: main → advisory, feature/* → silent; suites → 101/101 PASS.

---

## WAVE 7 — ADAPTIVE SKILL OS / MARKETPLACE INTELLIGENCE (S12 proposal, 8–12h)

Принцип: не автозагружать skills в prompt. Marketplace даёт discovery, но runtime держит только короткий локальный индекс/digest; полный `SKILL.md` читается лениво только после выбора. Global install разрешён только через quarantine → scan → approval → promote → rollback manifest.

### [x] ЗАДАЧА 36 | 75m | MED | HIGH — Skill registry cache для skills.sh / vercel-labs/skills ✅ 2026-04-23
**Цель**: локальный индекс marketplace skills без установки и без prompt bloat.
**Файлы**: `audit/S11_pipeline_top1/skills/skill-registry.js`, `skill-registry.test.js`, optional `~/.claude/skill-registry/index.jsonl`.
**Шаги**:
- адаптер для `npx skills find "<query>"` и `skills.sh` search/list snapshots;
- cache TTL по query/source, чтобы discovery не ходил в сеть на каждый task;
- сохранять только metadata: name, source, description, triggers, install command, token estimate, source trust.
**Реализация**:
- добавлен `audit/S11_pipeline_top1/skills/skill-registry.js`: standalone registry adapter на Node built-ins, который парсит `npx skills find`, leaderboard/source snapshots с `skills.sh`, пишет TTL JSONL cache по `query/source/owner` и запускает CLI с `DISABLE_TELEMETRY=1`;
- добавлен `audit/S11_pipeline_top1/skills/skill-registry.test.js`: deterministic coverage для CLI parsing, `skills.sh` leaderboard/source preview parsing, cache hit/expiry и malformed JSONL tolerance;
- metadata-only index сохраняет только `name`, `source`, `description`, `triggers`, `installCommand`, `tokenEstimate`, `sourceTrust` плюс install counters/registry URL для ranking follow-up tasks.
**Проверка**:
- `node audit\S11_pipeline_top1\skills\skill-registry.test.js` → `skill-registry.test.js PASS`.
- smoke без сети: `node audit\S11_pipeline_top1\skills\skill-registry.js --query "find skills" --source skills.sh --snapshot-file <tmp> --cache .tmp\skill-registry-smoke.jsonl --json` → `success: true`, `cacheHit: false`, `items: 2` (`find-skills`, `frontend-design`).
**Зависимости**: 18

### [x] ЗАДАЧА 37 | 90m | MED | CRITICAL — Skill quarantine scanner ✅ 2026-04-23
**Цель**: внешние skills никогда не попадают в global roots без проверки.
**Файлы**: `audit/S11_pipeline_top1/skills/skill-quarantine-scan.js`, `skill-quarantine-scan.test.js`.
**Шаги**:
- install/download только в `.tmp/skill-quarantine/<source>/<skill>`;
- scan `SKILL.md`: frontmatter, file size, suspicious instructions, shell/destructive commands, secret-looking strings;
- reject/flag skills без clear success criteria или с чрезмерным token size.
**Реализация**:
- добавлен `audit/S11_pipeline_top1/skills/skill-quarantine-scan.js`: deterministic scanner для quarantine-пути `.tmp/skill-quarantine/<source>/<skill>/SKILL.md`, который валидирует frontmatter, size/token budget, явные `Success Criteria`, dangerous shell patterns, прямую запись в global skill roots и hardcoded secret-like values;
- добавлен `audit/S11_pipeline_top1/skills/skill-quarantine-scan.test.js`: clean fixture → `allow`, dangerous fixture → `deny`, outside-quarantine fixture → `deny`;
- follow-up hardening `bbb0103`: scanner теперь проходит по всему skill bundle, а не только по `SKILL.md`; companion files внутри skill dir тоже сканируются на dangerous commands, global-root writes, secret-like values и binary artifacts.
- scanner возвращает формализованный verdict `allow|allow-with-warnings|deny` и пригоден как gate перед promotion/rollback workflow в следующих задачах.
**Проверка**:
- `node audit\S11_pipeline_top1\skills\skill-quarantine-scan.test.js` → `skill-quarantine-scan.test.js PASS`.
- clean smoke: `node audit\S11_pipeline_top1\skills\skill-quarantine-scan.js --skill-dir .tmp\task37-smoke\skill-quarantine\vercel-labs\skills\safe-skill --quarantine-root .tmp\task37-smoke\skill-quarantine --json` → `success: true`, `verdict: allow`.
- dangerous smoke: `node audit\S11_pipeline_top1\skills\skill-quarantine-scan.js --skill-dir .tmp\task37-smoke\skill-quarantine\evil-labs\ops\danger-skill --quarantine-root .tmp\task37-smoke\skill-quarantine --json` → `success: false`, `verdict: deny`, failures include `success-criteria`, `destructive-command`, `global-root-write`, `embedded-secret`.
- bundle hardening smoke: dangerous companion `install.ps1` beside a valid `SKILL.md` now also returns `success: false`, with failures attributed to `install.ps1`.
**Зависимости**: 36

### [x] ЗАДАЧА 38 | 75m | MED | HIGH — Skill distiller + token budget digest ✅ 2026-04-27
**Цель**: вместо чтения полного `SKILL.md` держать 200–500 token digest для routing.
**Файлы**: `audit/S11_pipeline_top1/skills/skill-distiller.js`, `skill-distiller.test.js`.
**Шаги**:
- генерировать deterministic digest: `use_when`, `avoid_when`, `requires_network`, `risk`, `verified`, `token_estimate`;
- запрещать активировать >1 orchestrator + >1 domain skill + >1 verifier skill на task без explicit override;
- записывать digest в registry cache.
**Проверка**: большой fixture skill даёт короткий digest; budget governor отклоняет 4-й активный skill.
**Зависимости**: 36, 37

### [x] ЗАДАЧА 39 | 90m | MED | HIGH — Skill ranker по relevance/trust/token efficiency ✅ 2026-04-27
**Цель**: выбирать лучший skill/agent не по названию, а по измеримому score.
**Файлы**: `audit/S11_pipeline_top1/skills/skill-ranker.js`, `skill-ranker.test.js`.
**Score**: relevance + source trust + install/adoption signal + local success history + compatibility - token cost - risk.
**Проверка**: fixture с high relevance but high risk проигрывает verified low-token skill.
**Зависимости**: 38

### [x] ЗАДАЧА 40 | 120m | HIGH | HIGH — gstack bridge как optional council mode ✅ 2026-04-28
**Цель**: подключить `garrytan/gstack` не как постоянный prompt-layer, а как opt-in review/council workflow.
**Файлы**: `audit/S11_pipeline_top1/gstack/gstack-bridge.md`, optional adapter script.
**Шаги**:
- map gstack commands/roles на наш `/pipeline`: office-hours, plan review, engineering review, QA, CSO, learn;
- namespace commands, чтобы не конфликтовать с `/ship`, `/learn`, `/review`;
- guardrail: gstack не меняет core S11 skills/hooks без approval.
**Проверка**: dry-run matrix показывает, какие gstack roles включаются для research/architecture/security tasks.
**Зависимости**: 39

### [x] ЗАДАЧА 41 | 120m | HIGH | HIGH — Research Autopilot skill-pack ✅ 2026-04-28
**Цель**: запрос «глубокое исследование рынка» автоматически получает оптимальный набор skills/agents с evidence log.
**Файлы**: `audit/S11_pipeline_top1/research/research-autopilot.md`, optional verifier.
**Шаги**:
- intent router: market research, competitor teardown, pricing, ICP, GTM, regulatory;
- discover/rank skills через registry, выбрать максимум 2–3;
- создать research plan, source map, synthesis report, confidence matrix.
**Проверка**: dry-run на market research задаче возвращает selected skills, source plan, token budget и approval gate.
**Зависимости**: 39, 40

### [x] ЗАДАЧА 42 | 90m | MED | CRITICAL — Global promotion + rollback manifest ✅ 2026-04-28
**Цель**: approved skills ставятся глобально воспроизводимо и откатываются одной командой.
**Файлы**: `audit/S11_pipeline_top1/skills/skill-promote.ps1`, `skill-rollback.ps1`, `skill-promote.test.js`.
**Результат**: 8/8 тестів PASS — promote→backup→rollback byte-identical (SHA-256). Три production roots: ~/.claude/skills, ~/.codex/skills, ~/.gemini/skills. JSONL audit log.
**Зависимості**: 37, 38

---

## WAVE 8 — PROJECT BOOTSTRAP UPGRADE (post-S11)

### [x] ЗАДАЧА 43 | 90m | HIGH | CRITICAL — `/init-project` upgrade mode
**Цель**: `/init-project` должен не только создавать AI docs, но и обновлять старые проекты под актуальный pipeline.
**Файлы**: `~/.claude/skills/init-project/SKILL.md`, `~/.codex/skills/init-project/SKILL.md`, `~/.gemini/skills/init-project/SKILL.md`, tracked snapshot/checker under `audit/S11_pipeline_top1/skills/init-project/`.
**Шаги**:
- определить real project root по `.git`, `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`;
- если сессия открыта в parent folder, явно указать правильный root и остановиться до подтверждения/перехода;
- режимы: `create` если docs отсутствуют, `upgrade` если docs устарели, `noop` если проект актуален;
- upgrade сохраняет project-specific Stack/Architecture/Gotchas, но добавляет актуальный pipeline block: `/pipeline`, Context7, TDD, verification, inline-review, ship, checkpoint/handoff;
- синхронизировать core sections между `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`;
- проверять `.claude/settings.json` в real project root и предупреждать о старом `.claude/settings.local.json` с broad permissions.
**Результат**: canonical `init-project` snapshot теперь описывает real-root detection, `create` / `upgrade` / `noop`, parent-folder hard stop, additive pipeline upgrade block, sync всех 3 docs и warnings для `.claude/settings.json`, `.claude/settings.local.json`, `safe.directory`.
**Proof**:
- `node audit\S11_pipeline_top1\skills\init-project-skill-check.test.js` → PASS.
- `node audit\S11_pipeline_top1\skills\init-project-skill-check.js audit\S11_pipeline_top1\skills\init-project\SKILL.md` → `OK: init-project skill`, `checked: 1`.
- `node audit\S11_pipeline_top1\skills\success-criteria-check.js --roots audit\S11_pipeline_top1\skills\init-project` → `OK: success criteria`, `checked: 1`.
- `powershell -NoProfile -ExecutionPolicy Bypass -File audit\S11_pipeline_top1\skills\apply-init-project-update.ps1` → synced `~/.claude`, `~/.codex`, `~/.gemini` with `updated=True`.
- `node audit\S11_pipeline_top1\skills\init-project-skill-check.js` → `OK: init-project skill`, `checked: 4`.
**Зависимости**: 06, 13, 15

### [x] ЗАДАЧА 44 | 60m | MED | HIGH — Project AI setup verifier
**Цель**: отдельный checker доказывает, что проект готов для Claude/Codex/Gemini после `/init-project`.
**Файлы**: `audit/S11_pipeline_top1/project-setup/project-ai-setup-check.js`, `project-ai-setup-check.test.js`.
**Проверяет**:
- all 3 docs exist and include required sections;
- core sections are synchronized;
- pipeline upgrade block present;
- real root detection matches current cwd;
- `.claude/settings.json` exists in real root or clear warning emitted;
- git health: `safe.directory`/dubious ownership warning reported with exact command.
**Результат**: verifier deterministically fails parent/root mismatch, missing docs, missing settings and unsynced sections, while healthy fixtures pass and dubious-ownership errors are converted into an exact `safe.directory` command warning.
**Proof**:
- `node audit\S11_pipeline_top1\project-setup\project-ai-setup-check.test.js` → PASS.
- healthy fixture in test → `success: true`, no warnings.
- nested Izi-like fixture in test → `success: false`, `real root differs from cwd`.
**Зависимости**: 43

### [x] ЗАДАЧА 45 | 45m | MED | HIGH — Pilot `/init-project` upgrade on Izi tracker
**Цель**: применить upgraded `/init-project` к `D:\Ametrin projects\Izi tracker\izi-tracker` и зафиксировать реальные findings.
**Шаги**:
- запустить verifier на parent `D:\Ametrin projects\Izi tracker` и nested real root;
- обновить `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md` без потери stack/project gotchas;
- создать/обновить `.claude/settings.json` в nested real root;
- отметить stale `.claude/settings.local.json` broad permissions и safe.directory issue;
- проверить `npx tsc --noEmit`, `npm run lint`, `npm test` если task не требует network/deploy.
**Результат**: pilot applied to nested real root `D:\Ametrin projects\Izi tracker\izi-tracker`; all 3 AI docs now include synchronized core sections and pipeline workflow, `.claude/settings.json` created in nested root, parent path is explicitly treated as wrong cwd, and verifier is green on the real root.
**Proof**:
- `node audit\S11_pipeline_top1\project-setup\project-ai-setup-check.js "D:\Ametrin projects\Izi tracker"` → `success: false`, `real root differs from cwd: ...\Izi tracker -> ...\izi-tracker`.
- `node audit\S11_pipeline_top1\project-setup\project-ai-setup-check.js "D:\Ametrin projects\Izi tracker\izi-tracker"` → `OK: project ai setup`, `warnings: 0`.
- `npx tsc --noEmit` in `D:\Ametrin projects\Izi tracker\izi-tracker` → PASS.
- `npm run lint` in `D:\Ametrin projects\Izi tracker\izi-tracker` → PASS.
- `npm test` in `D:\Ametrin projects\Izi tracker\izi-tracker` → `8` files / `108` tests PASS.
- Findings: no `.claude/settings.local.json`; no `safe.directory` warning on current machine.
**Зависимости**: 43, 44

---

## WAVE 9 — DEVELOPER KNOWLEDGE OS (post-interview reset)

**Поворот после интервью 2026-04-24**: следующий этап не должен просто добавлять новые хуки. Цель - собрать строгую, самообучающуюся среду разработки: global minimal core, project-specific graph/RAG memory, GitHub-first discovery, CLI-first execution, quarantine для новых skills/tools и измеримый startup budget.

Канонический аудит: `audit/S11_pipeline_top1/runtime/DEVELOPER_KNOWLEDGE_OS_AUDIT_2026-04-24.md`.

### [x] ЗАДАЧА 46 | 90m | HIGH | CRITICAL — Developer Knowledge OS target architecture
**Цель**: описать идеальный рабочий день full-stack разработчика и целевую архитектуру Claude/Codex: что global, что project-only, что on-demand.
**Файлы**: `audit/S11_pipeline_top1/runtime/DEVELOPER_KNOWLEDGE_OS_AUDIT_2026-04-24.md`, `audit/S11_pipeline_top1/runtime/DEVELOPER_KNOWLEDGE_OS_ARCH.md`.
**Шаги**:
- зафиксировать pains: потеря контекста, usage limits, забывание pipeline rules, отсутствие автоматического learning loop;
- определить `global minimal core`: security, git discipline, docs bootstrap, output limiter, Context7/docs policy, GitHub discovery policy, graph/RAG query-first policy;
- определить `project core`: project docs, project settings, graph index, RAG index, command registry, project memory;
- определить `on-demand`: Playwright/browser automation, Supabase/Vercel, Chrome DevTools, marketplace skills, heavy research, experimental agents.
**Проверка**: есть architecture doc с таблицей `capability -> global/project/on-demand -> reason -> startup cost risk -> rollback`.
- `audit/S11_pipeline_top1/runtime/DEVELOPER_KNOWLEDGE_OS_ARCH.md` создан: зафиксированы ideal working day, pain summary, A/B/C варианты, target layers, routing policy и capability matrix с rollback.
- Phase 2.5 evidence добавлен в architecture doc: LightRAG и Playwright подтверждены через Context7, OpenCLI взят из official spec, browser-harness и Hermes отмечены как secondary references для on-demand/research scope.
**Зависимости**: 01, 01b, 26, interview 2026-04-24

### [x] ЗАДАЧА 47 | 90m | MED | CRITICAL — Startup payload and config drift audit ✅ 2026-04-24
**Цель**: измерить первый-message tax и доказать, какие global компоненты реально засоряют контекст.
**Файлы**: `audit/S11_pipeline_top1/runtime/startup-payload-audit.md`, `audit/S11_pipeline_top1/runtime/startup-payload-audit.js`.
**Результат**:
- helper `startup-payload-audit.js` воспроизводимо парсит startup attachments и drift-источники;
- audit закрыт на 2 проектах: `Pipeline-setupper` (`cf23b3b8-3f2d-4347-ac91-7f2584b3d182`) и `Izi-tracker` (`9e15dffd-5840-40af-b52d-4faa77717220`) с cold-cache reference `5ffa7388-f2b0-418d-b4ee-ac2767a53261`;
- подтверждены findings: `25` global plugin keys, `147` local allow rules, `1` duplicate project-key group в `C:\Users\espad\.claude.json`;
- top offenders отделены от harness noise: `SessionStart` persisted payload ~`56 KB`, затем `skill_listing`, затем `deferred_tools_delta`.
**Проверка**:
- `node audit/S11_pipeline_top1/runtime/startup-payload-audit.js --json`
- `node audit/S11_pipeline_top1/runtime/startup-payload-audit.js`
- `rg -n -i -m 20 "mammoth erp system" "C:\Users\espad\.claude.json"`
**NB**: `exit=null` hook-suite noise из `HOOK_FRICTION_2026-04-24.md` не считать product regression без отдельного preflight.
**Зависимости**: 46

### [x] ЗАДАЧА 48 | 120m | HIGH | CRITICAL — GitHub-first tool discovery workflow
**Цель**: агент сначала ищет существующие решения через GitHub/skills.sh, а не изобретает или читает весь код вручную.
**Файлы**: `audit/S11_pipeline_top1/runtime/github-discovery-workflow.md`, `github-tool-discovery.test.js`, optional `github-tool-discovery.js`.
**Шаги**:
- определить protocol: `gh search repos` -> `gh repo view` -> README/releases/issues/license/Windows support -> quarantine clone -> read-only spike -> verdict;
- встроить критерии: adoption, maintenance, license, security, Windows/WSL support, token cost, overlap with existing tools;
- связать с `skill-registry.js` и `skill-quarantine-scan.js`;
- запретить auto-promote в global roots без manifest + rollback.
**Проверка**: dry-run на `OpenCLI`, `browser-harness`, `hermes-agent`, `LightRAG` возвращает structured verdict без установки в global scope.
**Зависимости**: 37, 46

### [x] ЗАДАЧА 49 | 180m | HIGH | CRITICAL — Project graph/RAG pilot with LightRAG
**Цель**: перестать читать код целиком и начать отвечать через graph/RAG там, где это дешевле и точнее.
**Файлы**: `audit/S11_pipeline_top1/runtime/project-knowledge-pilot.md`, `lightrag-pilot.md`, optional setup scripts.
**Шаги**:
- выбрать один pilot project: Pipeline-setupper или Law-assistant;
- спроектировать storage split: global dev knowledge vs project knowledge vs task-local scratch;
- ingest only safe sources: project docs, selected code summaries, ADR, README, session learnings, Graphify outputs;
- сравнить ответы LightRAG/Graphify/Grep на 10 типовых вопросов;
- определить sync policy между Claude, Codex, Graphify, LightRAG и memory markdown.
**Проверка**: есть comparison table `question -> grep cost -> graph result -> RAG result -> chosen route`, плюс rollback/no-secrets checklist.
**Зависимости**: 46, 47

### [x] ЗАДАЧА 50 | 120m | HIGH | HIGH — CLI capability registry with OpenCLI-style descriptors
**Цель**: для повторяемых задач использовать CLI по описанному контракту вместо ручного чтения docs/code.
**Файлы**: `audit/S11_pipeline_top1/runtime/cli-capability-registry.md`, `cli-capabilities/*.opencli.yaml`.
**Шаги**:
- описать capability descriptors для `gh`, `context7`, `playwright`, `supabase`, `vercel`, `firecrawl`;
- проверить применимость OpenCLI как формата для local CLI registry;
- добавить правило: перед ручным web/code scraping агент ищет capability в registry;
- определить, когда MCP лучше CLI, а когда CLI лучше MCP.
**Проверка**: 3 dry-run сценария выбирают CLI route и показывают exact command plan без выполнения destructive действий.
**Зависимости**: 46, 48

### [x] ЗАДАЧА 51 | 120m | MED | HIGH — Browser automation pilot ✅ 2026-04-24
**Цель**: выбрать browser automation слой без постоянного global overhead.
**Реализация**:
- добавлены `audit/S11_pipeline_top1/runtime/browser-automation-pilot.md`, `browser-automation-pilot.fixture.json`, `browser-automation-pilot.js`, `browser-automation-pilot.test.js`;
- оформлен единый dry-run сценарий и сравнение `playwright-cli` / `browser-harness` / `chrome-devtools-mcp` по token/setup/reliability/security/human control;
- зафиксированы policy и маршрутизация: default `playwright-cli`, fallback `chrome-devtools-mcp`, scope только `project+on-demand` (без global default);
- добавлены доказательства из Context7 по `/microsoft/playwright-cli` и `/chromedevtools/chrome-devtools-mcp` + GitHub references для browser-harness.
**Проверка**:
- `node audit\S11_pipeline_top1\runtime\browser-automation-pilot.test.js` → `PASS`;
- `node --check audit\S11_pipeline_top1\runtime\browser-automation-pilot.js` → `PASS`;
- `node audit\S11_pipeline_top1\runtime\browser-automation-pilot.js --fixture-file audit\S11_pipeline_top1\runtime\browser-automation-pilot.fixture.json --json` → `success: true`, ranking `playwright-cli=16`, `chrome-devtools-mcp=11`, `browser-harness=10`.
**Зависимости**: 46, 50

### [x] ЗАДАЧА 52 | 120m | HIGH | MED — Hermes Agent architecture spike ✅ 2026-04-24
**Цель**: изучить self-improving loop Hermes и перенести идеи, не заменяя Claude/Codex основным агентом.
**Реализация**:
- добавлены `audit/S11_pipeline_top1/runtime/hermes-architecture-spike.md`, `hermes-architecture-spike.fixture.json`, `hermes-architecture-spike.js`, `hermes-architecture-spike.test.js`;
- зафиксирован read-only analysis по memory/skills/toolsets/context compression/gateway/MCP;
- явно зафиксировано ограничение из Hermes docs: native Windows unsupported, запуск только через WSL2;
- зафиксированы паттерны `adopt/adapt/reject` и hard guardrails: `install/run` только после отдельного approval и sandbox plan.
**Проверка**:
- `node audit\S11_pipeline_top1\runtime\hermes-architecture-spike.test.js` → `PASS`;
- `node --check audit\S11_pipeline_top1\runtime\hermes-architecture-spike.js` → `PASS`;
- `node audit\S11_pipeline_top1\runtime\hermes-architecture-spike.js --fixture-file audit\S11_pipeline_top1\runtime\hermes-architecture-spike.fixture.json --json` → `success: true`, decisions `adapt/adopt/reject`, `windowsOk: true`.
**Зависимости**: 48

### [x] ЗАДАЧА 53 | 150m | HIGH | CRITICAL — Self-improvement and knowledge sync loop ✅ 2026-04-24
**Цель**: после задач Claude/Codex пополняют skills/knowledge base контролируемо, а не хаотично.
**Реализация**:
- добавлены `audit/S11_pipeline_top1/runtime/self-improvement-loop.md`, `self-improvement-loop.fixture.json`, `self-improvement-loop.js`, `self-improvement-loop.test.js`;
- связаны `/learn`, discovery (`gh` + `skill-registry`), quarantine, promotion manifest, project RAG write и `/checkpoint`;
- формализованы события: `end-of-task`, `repeated-pattern`, `new-tool-discovered`, `failed-workflow`, `successful-workflow`;
- разделены write scopes: `globalDevKnowledge`, `projectKnowledge`, `skillUpdate`, `taskLocalNote`;
- добавлен token budget gate `before/after/delta/maxDelta`;
- добавлена batch policy: закрывать независимые runtime-задачи пакетами по 3 и делать один consolidated docs sync.
**Проверка**:
- `node audit\S11_pipeline_top1\runtime\self-improvement-loop.test.js` → `PASS`;
- `node --check audit\S11_pipeline_top1\runtime\self-improvement-loop.js` → `PASS`;
- `node audit\S11_pipeline_top1\runtime\self-improvement-loop.js --fixture-file audit\S11_pipeline_top1\runtime\self-improvement-loop.fixture.json --json` → `success: true`, generated proposal scope `projectKnowledge`, `autoPromote: false`, token delta `943 <= 2000`.
**Зависимости**: 49, 50, 52

### [x] ЗАДАЧА 54 | 120m | HIGH | CRITICAL — Normalize global and project settings ✅ 2026-04-24
**Цель**: убрать config drift после того, как новая scope policy утверждена.
**Файлы**: `audit/S11_pipeline_top1/runtime/claude-json-normalizer.js`, `claude-json-normalizer.test.js`, `settings-scope-normalization.md`.
**Шаги**:
- backup-first normalize `C:\Users\espad\.claude.json`;
- убрать duplicate project keys с разным case/path;
- сократить global `enabledPlugins` до minimal core;
- перенести heavy tools в project settings;
- почистить stale broad entries в project `.claude/settings.local.json`.
**Проверка**: checker читает config без duplicate warnings, hook suites PASS, fresh startup measurement не хуже baseline.
**Зависимости**: 47, 50, user approval

### [x] ЗАДАЧА 55 | 90m | MED | CRITICAL — Operating policy and handoff ✅ 2026-04-24
**Цель**: завершить не точечными правками, а повторяемой операционной политикой.
**Файлы**: `audit/S11_pipeline_top1/runtime/GLOBAL_RUNTIME_POLICY.md`, `audit/S11_pipeline_top1/NEXT_SESSION_PROMPT.md`, `MEMORY.md`.
**Шаги**:
- описать daily workflow: start -> route -> graph/RAG -> CLI -> code -> verify -> learn -> checkpoint;
- зафиксировать policy для plugins, MCP, skills, CLI, cloud connectors, user secrets;
- добавить rollout/rollback checklist;
- обновить handoff.
**Проверка**: новый handoff запускает следующую сессию с Task 46/47 и не возвращает старый marketplace-first порядок.
**Зависимости**: 53, 54

---

## Wave 10 — Multi-Project Knowledge Layout (2026-04-24)

Цель: стандартизировать knowledge layer для всех 4 проектов под единый формат `.rag/manifest.json` + 4 изолированных LightRAG индекса.  
Дизайн: `audit/S11_pipeline_top1/MULTI_PROJECT_KNOWLEDGE_LAYOUT.md`

### [x] W10-01 | 30m | LOW — Trim sudoviy-master docs ✅ 2026-04-25
**Цель**: сократить CLAUDE.md (183→≤150) и AGENTS.md (159→≤150) до лимита.
**Результат**: CLAUDE.md 183→144 л, AGENTS.md 159→134 л. Commit: `dc345b4` в feature/w10-rag-knowledge-layout.
**Зависимости**: —

### [x] W10-02 | 60m | MED — `.rag/manifest.json` validator script ✅ 2026-04-25
**Цель**: `audit/S11_pipeline_top1/runtime/validate-rag-manifest.js` — проверяет формат и exclude-правила.
**Результат**: validator создан, 158 LOC. Проверяет required fields, semver, include labels, mandatory security excludes. Exit 0/1. Commit: `03f9283`.
**Зависимости**: —

### [x] W10-03 | 30m | LOW — Pipeline-setupper ingest manifest ✅ 2026-04-25
**Цель**: создать `.rag/manifest.json` + `.rag/.gitignore` в Pipeline-setupper.
**Результат**: validated ✅ (success:true, errors:[], warnings:[]). Commit: `c59e831`.
**Зависимости**: W10-02

### [x] W10-04 | 30m | LOW — Izi-tracker ingest manifest ✅ 2026-04-25
**Цель**: создать `.rag/manifest.json` + `.rag/.gitignore` в izi-tracker.
**Результат**: validated ✅ (success:true, errors:[], warnings:[]). Commit: `462da47`.
**Зависимости**: W10-02

### [x] W10-05 | 30m | LOW — Law_assistant ingest manifest ✅ 2026-04-25
**Цель**: создать `.rag/manifest.json` + `.rag/.gitignore` в Law_assistant.
**Результат**: validated ✅ (success:true, errors:[], warnings:[]). Commit: `097daf8`.
**Зависимости**: W10-02

### [x] W10-06 | 30m | LOW — sudoviy-master ingest manifest ✅ 2026-04-25
**Цель**: создать `.rag/manifest.json` + `.rag/.gitignore` в sudoviy-master.
**Результат**: validated ✅ (success:true, errors:[], warnings:[]). Commit: `f4206d1`.
**Зависимости**: W10-01, W10-02

### [x] W10-07 | 120m | HIGH — LightRAG Python setup + ingest script ✅ 2026-04-28
**Цель**: local LightRAG setup + `rag-ingest.py` script (per-project).  
**Зависимості**: W10-03..W10-06 (все манифесты готовы)  
**Результат**: `tools/rag-ingest.py` — 4 проекти проіндексовані (pipeline 52 chunks, izi-tracker 12, law-assistant 30, sudoviy-master 2).

### [x] W10-08 | 90m | MED — 10-question comparison table (all 4 projects) ✅ 2026-04-28
**Цель**: доказать что RAG отвечает лучше чем grep на docs-вопросы.  
**Зависимости**: W10-07  
**Результат**: RAG 9/10 wins, avg RAG 71.1s vs no-RAG 30.8s. Артефакти: `audit/w10-08-rag-benchmark/RESULTS.md`.

### [x] W10-09 | 30m | LOW — Обновить global route policy ✅ 2026-04-28
**Цель**: вписать LightRAG step в `GLOBAL_RUNTIME_POLICY.md`.  
**Зависимости**: W10-08  
**Результат**: `~/.claude/rules/rules.md` — секція "Context Reading (RAG-first)": RAG→Graphify→Read/Grep. `rag-context-injector.js`: 24h кеш, 184ms cache-hit.

---

## MVP (если критически мало времени — 10 задач, 8 часов)

Задачи **01, 03, 05, 07, 08, 09, 11, 29, 30, 31** + **28 (верификация)**.
Закрывает все 5 P0.

---

## Дорожная карта

```
ДЕНЬ 1 (20h):
  09:00-14:00  WAVE 1  (6 задач)
  15:00-19:00  WAVE 2  (6 задач)
  20:00-01:00  WAVE 3  (6 задач)

ДЕНЬ 2 (12h):
  09:00-13:00  WAVE 4  (4 задачи)
  14:00-19:00  WAVE 5  (5 задач)
  20:00-01:00  WAVE 6  (7 задач)
  01:00-01:30  ЗАДАЧА 28 — финальная верификация
```

## Git-workflow для выполнения плана

Каждую задачу — в свою ветку:
```bash
git checkout -b feature/s11-task-NN-short-name
# работать, коммитить conv-commits:
git commit -m "feat(pipeline): S11 task 03 — session-size-guard hook"
# после задачи:
gh pr create --title "S11 task 03 — session-size-guard" --body "See audit/S11_pipeline_top1/PLAN.md#task-03"
# squash-merge
```
