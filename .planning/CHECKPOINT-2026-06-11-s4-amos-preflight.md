# CHECKPOINT — AMOS Sprint 4: Preflight (skill-router v2) (2026-06-11)

## Цель сессии
Реализовать `amos preflight "<task>"` (Sprint 4 из `.planning/ARCHITECTURE-2026-06-10-amos-agent-mini-os.md`)
и подключить gate "preflight обязателен перед COMPLEX-кодом" в `harness-gates.js` (`plan_design`).

## Реализовано

### 1. `~/.amos/lib/preflight.js` (NEW)
- `detectDomain(query)` — coding/marketing/planning/general по словарям терминов.
- `DOMAIN_HINTS` — 6 портированных + 3 новых gstack-хинта (`gstack/landing-report`,
  `gstack/retro`, `gstack/plan-ceo-review`) для marketing/planning запросов.
- `rankLocalSkills()` — обёртка над `skill-ranker.js` + 43 gstack-скила из registry.
- `runSkillgrab()` — кэш `~/.amos/.cache/skillgrab-cache.json` (TTL 1ч), fail-soft,
  вызывается только для coding-домена.
- `context7Hint()` / `codemapHint()` — компактные подсказки.
- `buildPreflight()` / `formatPreflightContext()` — единый record + текстовый блок ≤1.5KB.
- `checkPreflightArtifact()` — читает `.planning/preflight-latest.json`, TTL 24ч.
- `PREFLIGHT_BENCHMARKS` — 15 кейсов (10 портированных из skill-router benchmark + 5 новых).

### 2. `~/.amos/bin/amos.js` (MODIFIED)
- Новая команда `amos preflight "<task>" [--json] [--write] [--benchmark]`.

### 3. `~/.amos/tests/preflight.test.js` (NEW)
- 25 тестов: domain detection, gstack hints, skillgrab caching/fail-soft, context7/codemap
  hints, buildPreflight, checkPreflightArtifact, benchmark 15/15, CLI integration.

### 4. `tools/harness-gates.js` — `gatePlanDesign` (MODIFIED)
COMPLEX-изменение (по `.planning/docs-gate-latest.json`) без свежего (≤24ч)
`.planning/preflight-latest.json` → `passed=false` + `high`-finding
"COMPLEX change requires `amos preflight \"<task>\" --write` before planning".
Fail-soft (try/catch), не ломает существующие сценарии без docs-gate отчёта.

### 5. `tools/harness-gates.test.js` (MODIFIED)
+2 новых теста (`gatePlanDesign` COMPLEX+missing-preflight → fail,
COMPLEX+fresh-preflight → pass) + добавлен `preflight-latest.json` в фикстуры
3 существующих closeout-тестов (иначе COMPLEX docs-gate в этих фикстурах
блокировал бы `plan_design` после правки).

## Тесты (доказательства)

```
~/.amos:            node --test tests/*.test.js          → 146/146 PASS (was 121/121)
tools/harness-gates: node tools/harness-gates.test.js     → 40/40 PASS (was 38, +2 new)
Claude hooks:       node ~/.claude/hooks/test-all-hooks.js → 35/35 PASS
Codex hooks:        node ~/.codex/test-codex-hooks.js      → 49/49 PASS
Behavior:           node ~/.claude/hooks/test-hooks-behavior.js → 44/44 PASS
doctor:             node tools/doctor.js                   → PASS=32 WARN=6 FAIL=0
```

## Acceptance criteria — mapping

| Критерий (из ARCHITECTURE) | Статус | Доказательство |
|---|---|---|
| `amos preflight "<task>"` объединяет local registry + skillgrab + gstack + Context7 + codemap, ≤1.5KB | ✅ | `lib/preflight.js`, `formatPreflightContext` budget assertions |
| 10/10 исходный benchmark сохранён + 5 новых (marketing/planning→gstack, coding→skillgrab) PASS | ✅ | `PREFLIGHT_BENCHMARKS` 15/15 PASS |
| Execution time <5s | ✅ | CLI test измеряет `elapsed < 5000` (~80-300ms на практике) |
| Гейт plan_design требует preflight перед COMPLEX-кодом | ✅ | `gatePlanDesign` + 2 новых теста в `harness-gates.test.js` |

## Попутно — найден и устранён orphan-процесс
Во время сессии обнаружен и убит "осиротевший" `agent-browser-win32-x64.exe` (PID 4112,
запущен ~8ч назад, родитель уже завершён) + дерево дочерних `chrome.exe` — это было
видимое на скриншоте окно "Новая вкладка / Chrome for Testing".

## Открытый вопрос — раздувание контекста (НЕ решено в этой сессии)
Пользователь сообщил, что контекст в сессиях "заканчивается за секунду" из-за большого
объёма данных, инжектируемых в каждое сообщение (advisory-хуки edit-enforcer/inline-review/
context7-reminder + системные блоки deferred-tools/MCP-инструкций). На момент чекпоинта:
`session-size-guard` — 654KB/1307KB (>350KB warn), `context-budget-gate` — ~112k tokens
(>90k threshold). Требует отдельного исследования в новой сессии (не специфично для
Sprint 4, общая проблема всех сессий ~/.claude).

## Git state

- `~/.amos` (отдельный git-репо): branch `feature/amos-sprint4-preflight`, commit `5cd9f0a`
  "feat(amos): Sprint 4 preflight (skill-router v2) - 146/146 tests"
- Pipeline Setupper: branch `amos/sprint1-kernel`, готов коммит для
  `amos/bin/amos.js`, `amos/lib/preflight.js`, `amos/tests/preflight.test.js`,
  `tools/harness-gates.js`, `tools/harness-gates.test.js`

## NEXT
1. Раздувание контекста сессий (~/.claude advisory hooks tuning) — отдельная сессия.
2. Дальнейшие AMOS спринты по `.planning/ARCHITECTURE-2026-06-10-amos-agent-mini-os.md`.
