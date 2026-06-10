# AMOS Project Baseline Measurements

## 1. Document Sizes Baseline
This table tracks the sizes of key documentation files across the two target projects.

| Project | CLAUDE.md Size (Bytes) | AGENTS.md Size (Bytes) | Local MEMORY.md Size (Bytes) | Shared memory_summary.md Size (Bytes) | Shared MEMORY.md Size (Bytes) |
|---|---|---|---|---|---|
| **Pipeline Setupper** (`C:/Claude playground/Pipiline setupper`) | 36,360 | 36,678 | 5,909 | 14,206 | 142,186 |
| **Law Assistant** (`D:/Ametrin projects/Law_assistant`) | 13,884 | 14,046 | 2,940 | *Not Found* | 3,533 |

---

## 2. Hook Performance Baseline (Pipeline Setupper)
Measurements collected on `C:/Claude playground/Pipiline setupper`.

### SessionStart & UserPromptSubmit (Startup Flow)

| Hook Event | Hook Name | Latency (ms) | Stdout Output (Chars) |
|---|---|---|---|
| **SessionStart** | `project-docs-gate` | 168 | 0 |
| **SessionStart** | `session-focus-gate` | 120 | 204 |
| **SessionStart** | `session-branch-advisor` | 412 | 0 |
| **SessionStart** | `autoskills-check` | 167 | 0 |
| **SessionStart** | `graphify-session-init` | 1,000 | 627 |
| **SessionStart** | `memory-discipline` | 118 | 0 |
| **SessionStart** | `harvest-injector` | 116 | 0 |
| **SessionStart** | `projects-dashboard` | 332 | 0 |
| **SessionStart** | `rag-context-injector` | 277 | 0 |
| **SessionStart** | `project-bootstrap-advisor` | 514 | 278 |
| **SessionStart** | `claude-hook` | 156 | 0 |
| *SessionStart Subtotal* | *11 hooks* | *3,380* | *1,109* |
| **UserPromptSubmit** | `context-budget-gate` | 129 | 0 |
| **UserPromptSubmit** | `session-size-guard` | 103 | 0 |
| **UserPromptSubmit** | `claude-hook` | 108 | 0 |
| *UserPromptSubmit Subtotal* | *3 hooks* | *340* | *0* |
| **TOTAL (Startup + 1 Prompt)** | | **3,720** | **1,109 (≈ 277 tokens)** |

### Tool Execution Cycle (Edit & Bash)

| Hook Event | Tool | Hook Name | Latency (ms) | Stdout Output (Chars) |
|---|---|---|---|---|
| **PreToolUse** | Edit | `auto-branch` | 257 | 0 |
| **PreToolUse** | Edit | `settings-schema-guard` | 105 | 0 |
| **PreToolUse** | Edit | `write-over-edit-guard` | 99 | 0 |
| **PreToolUse** | Edit | `config-protection` | 107 | 0 |
| **PreToolUse** | Edit | `domain-agent-gate` | 122 | 0 |
| **PreToolUse** | Edit | `edit-enforcer` | 112 | 727 |
| **PreToolUse** | Edit | `claude-hook` | 107 | 0 |
| **PostToolUse** | Edit | `verification-tracker` | 105 | 0 |
| **PostToolUse** | Edit | `loop-guardian` | 98 | 0 |
| **PostToolUse** | Edit | `post-edit-combined` | 98 | 0 |
| **PostToolUse** | Edit | `context7-reminder` | 121 | 0 |
| **PostToolUse** | Edit | `inline-review-gate` | 152 | 0 |
| **PostToolUse** | Edit | `skill-sync-mirror` | 122 | 0 |
| **PostToolUse** | Edit | `rag-queue-enqueue` | 115 | 0 |
| **PostToolUse** | Edit | `graphify-auto-update` | 154 | 0 |
| **PostToolUse** | Edit | `claude-hook` | 170 | 0 |
| **PreToolUse** | Bash | `git-branch-guard` | 150 | 0 |
| **PreToolUse** | Bash | `conventional-commit-validator` | 121 | 0 |
| **PreToolUse** | Bash | `branch-name-validator` | 144 | 0 |
| **PreToolUse** | Bash | `pre-commit-gate` | 156 | 0 |
| **PreToolUse** | Bash | `secret-scanner` | 144 | 0 |
| **PreToolUse** | Bash | `quality-gate-runner` | 121 | 0 |
| **PreToolUse** | Bash | `context7-tracker` | 122 | 0 |
| **PreToolUse** | Bash | `coverage-gate` | 124 | 0 |
| **PreToolUse** | Bash | `claude-hook` | 154 | 0 |
| **PostToolUse** | Bash | `verification-tracker` | 148 | 0 |
| **PostToolUse** | Bash | `loop-guardian` | 143 | 0 |
| **PostToolUse** | Bash | `secret-output-scanner` | 143 | 0 |
| **PostToolUse** | Bash | `bash-output-advisor` | 154 | 0 |
| **PostToolUse** | Bash | `graphify-post-commit` | 142 | 0 |
| **PostToolUse** | Bash | `context7-tracker` | 135 | 0 |
| **PostToolUse** | Bash | `claude-hook` | 149 | 0 |
| **TOTAL (Edit + Bash Cycle)** | | | **4,271** | **727** |

---

## 3. Hook Performance Baseline (Law Assistant)
Measurements collected on `D:/Ametrin projects/Law_assistant`.

### SessionStart & UserPromptSubmit (Startup Flow)

| Hook Event | Hook Name | Latency (ms) | Stdout Output (Chars) |
|---|---|---|---|
| **SessionStart** | `project-docs-gate` | 642 | 166 |
| **SessionStart** | `session-focus-gate` | 103 | 204 |
| **SessionStart** | `session-branch-advisor` | 376 | 0 |
| **SessionStart** | `autoskills-check` | 120 | 0 |
| **SessionStart** | `graphify-session-init` | 492 | 585 |
| **SessionStart** | `memory-discipline` | 82 | 0 |
| **SessionStart** | `harvest-injector` | 105 | 0 |
| **SessionStart** | `projects-dashboard` | 246 | 0 |
| **SessionStart** | `rag-context-injector` | 114 | 0 |
| **SessionStart** | `project-bootstrap-advisor` | 302 | 278 |
| **SessionStart** | `claude-hook` | 84 | 0 |
| *SessionStart Subtotal* | *11 hooks* | *2,666* | *1,233* |
| **UserPromptSubmit** | `context-budget-gate` | 105 | 0 |
| **UserPromptSubmit** | `session-size-guard` | 112 | 0 |
| **UserPromptSubmit** | `claude-hook` | 93 | 0 |
| *UserPromptSubmit Subtotal* | *3 hooks* | *310* | *0* |
| **TOTAL (Startup + 1 Prompt)** | | **2,976** | **1,233 (≈ 308 tokens)** |

### Tool Execution Cycle (Edit & Bash)

| Hook Event | Tool | Hook Name | Latency (ms) | Stdout Output (Chars) |
|---|---|---|---|---|
| **PreToolUse** | Edit | `auto-branch` | 219 | 0 |
| **PreToolUse** | Edit | `settings-schema-guard` | 87 | 0 |
| **PreToolUse** | Edit | `write-over-edit-guard` | 89 | 0 |
| **PreToolUse** | Edit | `config-protection` | 93 | 0 |
| **PreToolUse** | Edit | `domain-agent-gate` | 93 | 0 |
| **PreToolUse** | Edit | `edit-enforcer` | 86 | 727 |
| **PreToolUse** | Edit | `claude-hook` | 91 | 0 |
| **PostToolUse** | Edit | `verification-tracker` | 92 | 0 |
| **PostToolUse** | Edit | `loop-guardian` | 121 | 0 |
| **PostToolUse** | Edit | `post-edit-combined` | 264 | 172 |
| **PostToolUse** | Edit | `context7-reminder` | 97 | 0 |
| **PostToolUse** | Edit | `inline-review-gate` | 87 | 0 |
| **PostToolUse** | Edit | `skill-sync-mirror` | 84 | 0 |
| **PostToolUse** | Edit | `rag-queue-enqueue` | 112 | 0 |
| **PostToolUse** | Edit | `graphify-auto-update` | 132 | 0 |
| **PostToolUse** | Edit | `claude-hook` | 147 | 0 |
| **PreToolUse** | Bash | `git-branch-guard` | 273 | 0 |
| **PreToolUse** | Bash | `conventional-commit-validator` | 132 | 0 |
| **PreToolUse** | Bash | `branch-name-validator` | 128 | 0 |
| **PreToolUse** | Bash | `pre-commit-gate` | 111 | 0 |
| **PreToolUse** | Bash | `secret-scanner` | 123 | 0 |
| **PreToolUse** | Bash | `quality-gate-runner` | 122 | 0 |
| **PreToolUse** | Bash | `context7-tracker` | 133 | 0 |
| **PreToolUse** | Bash | `coverage-gate` | 110 | 0 |
| **PreToolUse** | Bash | `claude-hook` | 101 | 0 |
| **PostToolUse** | Bash | `verification-tracker` | 113 | 0 |
| **PostToolUse** | Bash | `loop-guardian` | 116 | 0 |
| **PostToolUse** | Bash | `secret-output-scanner` | 94 | 0 |
| **PostToolUse** | Bash | `bash-output-advisor` | 97 | 0 |
| **PostToolUse** | Bash | `graphify-post-commit` | 123 | 0 |
| **PostToolUse** | Bash | `context7-tracker` | 128 | 0 |
| **PostToolUse** | Bash | `claude-hook` | 154 | 0 |
| **TOTAL (Edit + Bash Cycle)** | | | **4,082** | **899** |

---

## 4. AMOS Sprint 1 — Results (2026-06-10)

Виміряно після завершення Sprint 1 на гілці `amos/sprint1-kernel`.

### Kernel Performance

| Команда | Час (cold start) | Stdout (bytes) | Ліміт | Результат |
|---|---|---|---|---|
| `amos event session-start` (Law_assistant) | **133ms** | **185** | <500ms / <2048B | ✅ PASS |
| `amos event session-start` (повторний) | **119ms** | **185** | <500ms / <2048B | ✅ PASS |

### Test Suite

| Метрика | Значення |
|---|---|
| Всього тестів | **45** |
| PASS | **45** |
| FAIL | **0** |
| Час виконання | **~3.7 сек** |

### Acceptance Criteria — Sprint 1 Done ✅

| Критерій | Виконано | Доказ |
|---|---|---|
| `amos event session-start` < 500ms | ✅ | 133ms виміряно |
| stdout ≤ 2KB | ✅ | 185 bytes |
| `amos.cmd status` з будь-якої папки | ✅ | `%USERPROFILE%` шлях |
| ≥40 unit-тестів зелені | ✅ | 45/45 PASS |
| Бита БД → exit 0, пустий stdout | ✅ | тести #36-41 PASS |
| `amos report` показує метрики | ✅ | 8 подій в SQLite |
| `~/.amos` — git-репо з ≥2 комітами | ✅ | 10 комітів |
| Жодних hardcoded шляхів | ✅ | `os.homedir()` скрізь |
| 2KB budget cap в коді | ✅ | `Buffer.byteLength > 2048` |

### Ключові файли

| Файл | Призначення |
|---|---|
| `C:\Users\espad\.amos\bin\amos.js` | CLI ядро (event router, fail-soft, 2KB cap) |
| `C:\Users\espad\.amos\lib\db.js` | SQLite state (node:sqlite, 4 таблиці) |
| `C:\Users\espad\.amos\tests\amos.test.js` | 45 unit-тестів |
| `C:\Users\espad\.claude\bin\amos.cmd` | Глобальна обгортка (`%USERPROFILE%`) |
| `.planning\ARCHITECTURE-2026-06-10-amos-agent-mini-os.md` | Повний план Sprint 0-8 |

### Наступний крок: Sprint 2
Замінити SessionStart хуки Claude/Codex/Gemini на виклики `amos event session-start`.
Цільовий KPI: SessionStart latency v3 (~3380ms) → AMOS (~133ms), -96%.

---

## 5. M4 — Merge & Final Verification (coordinator re-check, 2026-06-10)

Перевірено координатором на гілці `amos/sprint1-kernel` після злиття `amos/sprint0-baseline`,
`amos/sprint1-state`, `amos/sprint1-tests` (стан `~/.amos`, 10 комітів, 2 merge-коміти).

| Команда | Час (cold start) | Stdout (bytes) | Ліміт | Результат |
|---|---|---|---|---|
| `amos event session-start` (Law_assistant) | **~100-130ms** | **185** | <500ms / <2048B | ✅ PASS |
| `amos.cmd status` (запущено з `C:\`) | — | "AMOS CLI Status: OK" | будь-яка папка | ✅ PASS |
| `amos event session-start` (TRIGGER_DB_ERROR=1) | — | **0 bytes**, exit 0 | fail-soft | ✅ PASS |

### Test Suite (post-merge, з db.test.js)

| Метрика | Значення |
|---|---|
| Всього тестів | **52** |
| PASS | **52** |
| FAIL | **0** |
| Suites | `tests/amos.test.js` (45) + `tests/db.test.js` (6) + 1 suite wrapper |

### `amos report` після перевірки (накопичувальний стан SQLite)

| Event | Count | Avg Duration | Total Chars |
|---|---|---|---|
| session-start | 9 | 17ms | 1665 |

Лічильник `session-start` зріс з 6 → 9 після 3 контрольних викликів — підтверджує запис
`output_chars`/`duration_ms` у `events_metrics`.

### Acceptance Criteria — Sprint 0+1 Final Status

| Критерій | Статус | Доказ |
|---|---|---|
| Sprint 0: гілка `system-upgrade/amos-kernel` + тег `v3-legacy` | ✅ DONE | `git branch -a` / `git tag` |
| Sprint 0: `.planning/AMOS-BASELINE.md` з числами по обох проектах | ✅ DONE | розділи 1-3 цього файлу |
| Sprint 1: `amos event session-start` < 500ms, stdout ≤ 2KB | ✅ DONE | 100-130ms, 185 bytes |
| Sprint 1: `amos.cmd status` з будь-якої папки | ✅ DONE | перевірено з `C:\` |
| Sprint 1: ≥40 unit-тестів зелені | ✅ DONE | 52/52 PASS |
| Sprint 1: Бита БД → exit 0, пустий stdout | ✅ DONE | `TRIGGER_DB_ERROR=1` реальний виклик |
| Sprint 1: `amos report` показує метрики (output_chars/duration_ms) | ✅ DONE | 6→9 подій після 3 викликів |
| Sprint 1: `~/.amos` — git-репо з ≥2 комітами | ✅ DONE | 10 комітів, 2 merge |
| M4: Merge & Final Verification (4 гілки → `amos/sprint1-kernel`) | ✅ DONE | цей коміт |

**Sprint 0 + Sprint 1 — ПОВНІСТЮ ЗАКРИТО.** Наступний крок: Sprint 2 (`.planning/PROMPT-SPRINT-2-AMOS.md`) — handoff continuity + інтеграція хуків.
