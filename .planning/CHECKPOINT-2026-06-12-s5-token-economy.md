# CHECKPOINT 2026-06-12 — AMOS Sprint 5: Token Economy

## Сделано
- **Roadmap Agent OS v5** утверждён: `.planning/ARCHITECTURE-AGENT-OS-V5.md` (S5-S8; ресёрч mattpocock/skills, agency-agents, CLI-Anything, ECC — главный донор ECC).
- **S5.1** Починены `~/.claude/bin/harness-runner.ps1` и `harness-gates.ps1` (потерян `$Script` в 1-й строке → node получал аргумент как путь модуля).
- **S5.2** `~/.amos`: `lib/cost.js` (парсинг usage из JSONL-транскрипта, tail-cap 10MB, partial-флаг), `cost_ledger` в SQLite, Stop-event пишет итог сессии, команда `amos cost [--days N] [--session id] [--json]`.
- **S5.3** Model-policy gate: спавн Task/Agent без дешёвой модели (haiku/sonnet, конфиг `policy.json:modelPolicy`) → 1-2 нарушения молча в `policy_events`, с 3-го — deny с обучающим reason. Escape: `AMOS_MODEL_POLICY=off` или дешёвый `CLAUDE_CODE_SUBAGENT_MODEL`.
- **S5.4** `~/.claude/settings.json` env: `MAX_THINKING_TOKENS` 20000→10000, `+CLAUDE_CODE_SUBAGENT_MODEL=haiku`. Codex/Gemini: env неприменим, покрытие через общий amos pre-tool hook (подключён ко всем 3, doctor 9/9 PASS).
- **Bonus** BOM-strip stdin в amos.js (PowerShell 5.1 пайпит с UTF-8 BOM → события молча дропались).

## Проверка (пруфы)
- `node --test` в ~/.amos: **161/161 PASS** (вкл. новый tests/cost.test.js).
- `node tests/smoke-cost-e2e.js`: **10/10 PASS** (ledger→cost report; deny на 3-м спавне; haiku молчит; BOM-stdin).
- `test-all-hooks` + `test-hooks-behavior`: **44/44 PASS, 0 FAIL**.
- `tools/doctor.js`: зелёный (future-ts WARN исправлен).
- inline-review (haiku): bugs none, patterns consistent.

## Коммиты
- `~/.amos` 70484c7 feat(s5) · `~/.claude` 80d2238 feat(s5) · этот репо — sync amos/ + docs.

## Известное / next
- `agent-browser doctor --offline --quick` FAIL → `amos doctor browser --repair` (вне скоупа S5).
- ctx7-гейт не видит вызовы ctx7 через PowerShell-тул (только Bash) — кандидат в фикс S6.
- **Next: Sprint 6 — Graph Bootstrap** (`amos graph ensure`, авто-граф в любом проекте через SessionStart).
