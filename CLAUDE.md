# Pipeline Setupper — Command Center

## Overview
Центральный репозиторий для управления глобальной инфраструктурой разработки: хуки, скиллы, настройки Claude Code / Codex CLI / Antigravity. Хранит аудиты, планы апгрейдов и документацию пайплайна.

## Stack
- Node.js 18+ (все хуки на .js)
- Claude Code hooks API (`~/.claude/settings.json`)
- Codex CLI hooks (`~/.codex/hooks.json`)
- Graphify (Python, `C:/Users/espad/AppData/Local/Programs/Python/Python311/Scripts/graphify.exe`)
- Shared memory: `~/.claude/projects/C--/memory/` (junction ↔ `~/.codex/memories/`)

## Commands
```bash
# Тесты хуков (три уровня)
node ~/.claude/hooks/test-all-hooks.js          # sanity: exit 0 + valid JSON (26/26)
node ~/.codex/test-codex-hooks.js               # codex sync (25/25)
node ~/.claude/hooks/test-hooks-behavior.js     # BLOCK/ALLOW поведение (29/29)

# Метрики
node ~/.claude/hooks/hook-stats.js              # статистика вызовов
node ~/.claude/hooks/hook-stats.js --errors     # только ошибки
node ~/.claude/hooks/hook-stats.js --reset      # сброс

# Graphify
cmd /c graphify --version
cmd /c graphify query "что делает edit-enforcer?"
cmd /c graphify update .                        # обновить граф (в проекте)
```

## Architecture
```
~/.claude/
├── hooks/                    ← 27 хуков (все PASS)
│   ├── SessionStart (5):     project-docs-gate, session-focus-gate, autoskills-check,
│   │                         graphify-session-init, memory-discipline
│   ├── UserPromptSubmit (1): context-budget-gate
│   ├── PreToolUse (7):       graphify-read-gate[Read], graphify-preuse[Glob|Grep],
│   │                         config-protection[Edit|Write], domain-agent-gate[Edit|Write],
│   │                         edit-enforcer[Edit|Write], secret-scanner[Bash], quality-gate-runner[Bash]
│   ├── PostToolUse (10):     post-edit-combined, context7-reminder, inline-review-gate [Edit|Write]
│   │                         verification-tracker, loop-guardian [Edit|Write|Bash]
│   │                         secret-output-scanner [Bash]
│   │                         inline-review-tracker [Agent], scope-guard [TaskCreate],
│   │                         context7-tracker [Context7], pipeline-tracker [Skill]
│   ├── Stop (2):             stop-verification, ship-gate
│   ├── Notification (1):     task-completed-gate          ← Claude Code only
│   └── FileChanged (1):      env-change-watcher           ← Claude Code only
├── hooks/lib/                ← config.js, logger.js, metrics.js
├── hooks/config.json         ← все threshold'ы (loopGuardian, editEnforcer, etc.)
├── hooks/hook-stats.js       ← CLI метрик
├── skills/                   ← pipeline, ship, sprint, company, architect-first, cto-playbook,
│                                careful, freeze, prime, fix-issue, learn, checkpoint, sync-docs, etc.
├── settings.json             ← глобальная конфигурация + разрешения
└── projects/C--/memory/      ← shared memory (junction с Codex)

~/.codex/
├── hooks.json                ← 25 хуков (те же .js, без FileChanged/Notification)
├── test-codex-hooks.js       ← динамический тест из hooks.json
└── memories/ → junction → ~/.claude/projects/C--/memory/
```

## Gotchas
- **git root = C:\\** — весь C: в одном git-репо. Хуки должны использовать `-- .` для скопа к CWD
- **`graphify claude install` = ЗАПРЕЩЕНО** — генерирует bash-хуки → exit 1 в PowerShell. Только `cmd /c graphify update .`
- **Graphify в bash**: нельзя напрямую → `cmd /c graphify query "..."` или полный путь к .exe
- **Antigravity** = VSCode-форк, читает `~/.claude/settings.json` напрямую → всегда в синке
- **Codex не поддерживает** FileChanged и Notification — это Claude Code only события
- **loop-guardian**: ловит ОДИНАКОВЫЕ едиты (same old_string), не просто "3 едита одного файла"
- **graphify-read-gate**: пропускает партиальные рида (limit < 150), блокирует только full read >80 строк
- **memory-discipline**: warn >80 строк MEMORY.md, block >100. Запустить /learn для сжатия
- **cwd в хуках**: всегда брать из `input.cwd`, не из `process.cwd()` (process.cwd() = ~/.claude/hooks/)
- **Windows paths**: использовать `path.join()`, не строковую конкатенацию

## Current State (2026-04-16)
- **Score: ~75/100** (все Zero-Waste спринты A0→C4 завершены)
- **27 хуков**, test-all-hooks.js **26/26** | test-codex-hooks.js **25/25** | test-hooks-behavior.js **29/29**
- **Баги сессии**: graphify-read-gate cwd fix, loop-guardian fingerprint fix, memory-discipline NEW
- **Документация**: `HOOK_SYSTEM.md` — полный справочник системы
- **Pending**: OPENAI_API_KEY rotation in D:\Ametrin projects

## Hook Infrastructure
- `config.json` — threshold'ы: `loopGuardian.repeatWarn=3`, `editEnforcer.warnAt=3/blockAt=9`, etc.
- `lib/config.js` — loader для config.json
- `lib/logger.js` — append-only errors.log
- `lib/metrics.js` — metrics.inc(hook, event) → metrics.json

## Claude Code Notes
- PreToolUse BLOCK: `{ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: '...' } }`
- SessionStart/PostToolUse advisory: `{ hookSpecificOutput: { additionalContext: '...' } }`
- Stop BLOCK: `{ decision: 'block', reason: '...' }` → stdout  (формат ДРУГОЙ!)
- Silent exit: `process.exit(0)` без stdout = разрешить без комментариев
- Hard block (SessionStart): `process.exit(2)` + stderr message
