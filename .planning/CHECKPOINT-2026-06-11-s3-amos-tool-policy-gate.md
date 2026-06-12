# CHECKPOINT — AMOS Sprint 3: Tool Policy Gate (2026-06-11)

## Цель сессии
Закрыть AMOS Sprint 3 (Tool Policy Gate) полностью — `policy.json` + `amos event pre-tool` гейт +
`amos doctor browser` auto-repair, wired в PreToolUse Claude/Codex/Gemini, все тесты зелёные,
sync+commit+checkpoint.

## Реализовано

### 1. `~/.amos/policy.json` (NEW)
Декларативный набор deny+redirect правил:
- `mcp__claude-in-chrome__*` → redirect `agent-browser`
- `mcp__chrome-devtools__*` → redirect `agent-browser`
- `mcp__context7__*` → redirect `context7-cli` (`ctx7 library` / `ctx7 docs`)
- `WebSearch` (exact) → redirect `agent-browser`

### 2. `~/.amos/lib/policy.js` (NEW)
`loadPolicy()`, `evaluateToolPolicy(toolName, policy)`, `matchRule()`. Fail-soft: отсутствующий/битый
`policy.json` → `{rules: []}` → всё разрешено.

### 3. `~/.amos/lib/browser-doctor.js` (NEW)
`checkBrowserHealth(runner)`, `repairBrowser(runner)`, `runBrowserDoctor({repair, runner})`. Инжектируемый
runner для детерминированных юнит-тестов «сломан → чинит → smoke PASS» без сети.

### 4. `~/.amos/bin/amos.js` (MODIFIED)
- `event pre-tool`: deny → `{hookSpecificOutput:{hookEventName:'PreToolUse', permissionDecision:'deny',
  permissionDecisionReason}}`; allow → silent exit 0.
- `doctor browser [--repair]`: реальная проверка `agent-browser --version` +
  `agent-browser doctor --offline --quick`, с `--repair` — `npm i -g agent-browser` + `agent-browser install`
  + re-check.
- `doctor` (full report): добавлены 3 PreToolUse wiring-чека (Claude/Codex/Gemini) + секция
  "Browser Tooling".

### 5. Wiring в 3 клиентах (PreToolUse, matcher
   `mcp__claude-in-chrome|mcp__chrome-devtools|mcp__context7|WebSearch`):
- `~/.claude/settings.json` — заменён `tool-policy-gate.js` → `amos.js event pre-tool`
- `~/.gemini/settings.json` — аналогично
- `~/.codex/hooks.json` — добавлена новая PreToolUse-группа (раньше отсутствовала)

Старые `~/.claude/hooks/tool-policy-gate.js` и `~/.gemini/hooks/tool-policy-gate.js` оставлены на диске,
не зарегистрированы (по прецеденту S2.4 со `stop-auto-checkpoint.js`).

## Тесты (доказательства)

```
~/.amos:        node --test tests/*.test.js  → 121/121 PASS (was ~98 before S3: +23 new tests)
Claude hooks:   node ~/.claude/hooks/test-all-hooks.js       → 35/35 PASS
Codex hooks:    node ~/.codex/test-codex-hooks.js            → 49/49 PASS (было 48/48, +1 PreToolUse)
Behavior:       node ~/.claude/hooks/test-hooks-behavior.js  → 44/44 PASS
doctor:         node tools/doctor.js                          → PASS=32 WARN=6 FAIL=0
```

Новые тестовые файлы: `tests/policy.test.js` (29 тестов), `tests/browser-doctor.test.js` (12 тестов),
+3 теста в `tests/doctor-hooks.test.js` (PreToolUse wiring INFO/PASS/WARN).

## Acceptance criteria — mapping

| Критерий (из ARCHITECTURE) | Статус | Доказательство |
|---|---|---|
| policy.json deny+redirect rule set | ✅ | `~/.amos/policy.json` |
| `amos event pre-tool` гейт wired в PreToolUse 3 клиентов | ✅ | settings.json/hooks.json diffs + doctor PASS x3 |
| Матрица: каждый запрещённый инструмент отклонён с правильным redirect | ✅ | `policy.test.js` — deny для `mcp__claude-in-chrome__*`, `mcp__chrome-devtools__*`, `mcp__context7__*`, `WebSearch`; allow для остального |
| `amos doctor browser` с авто-починкой | ✅ | `lib/browser-doctor.js` + `amos doctor browser --repair` |
| agent-browser сломан искусственно → doctor чинит → smoke PASS | ✅ | `browser-doctor.test.js`: "runBrowserDoctor: broken agent-browser is auto-repaired and re-checked PASS" |

## WARN=6 в doctor (вне скоупа Sprint 3)
Все 6 WARN — устаревшие time-based отчёты (датированы 2026-05-29…2026-06-03, сейчас 12 дней): agent
surface audit stale, docs gate stale, harness checklist stale, harness run stale, git workflow audit stale,
agent skill supply chain drift. Не связаны с изменениями Sprint 3, FAIL=0 — критерий выполнен.

## Git state

- `~/.amos` (отдельный git-репо): branch `feature/amos-sprint3-tool-policy-gate`, commit `7aff155`
  "feat(amos): add tool policy gate with browser doctor repair"
- Pipeline Setupper: branch `amos/sprint1-kernel`, commit `1abb12f`
  "feat(amos): sync S3 tool policy gate core copies" (синхронизированы 7 файлов `amos/`)

## ВНИМАНИЕ — не закоммичено намеренно
`~/.claude/settings.json`, `~/.gemini/settings.json`, `~/.codex/hooks.json` отредактированы (новый
PreToolUse wiring), но **НЕ закоммичены**:
- `~/.claude/settings.json` содержит plaintext `GITHUB_PERSONAL_ACCESS_TOKEN` (отдельный известный issue,
  флагован ещё в S2.3/S2.4) — нельзя бандлить секрет в коммит.
- `~/.codex` и `~/.gemini` — не git-репозитории вовсе.

Это та же ситуация, что в S2.3/S2.4 — повторно флагуется здесь.

## NEXT
Sprint 4 — Preflight (skill-router v2), per `.planning/ARCHITECTURE-2026-06-10-amos-agent-mini-os.md`.
