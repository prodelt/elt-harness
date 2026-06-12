# Hook Architecture — детальная карта

> Вынесено из CLAUDE.md для экономии контекста (2026-06-11). CLAUDE.md держит только сводку.

## Дерево хуков

```
~/.claude/
├── hooks/                    ← 48 хуков (все PASS; команды в settings.json)
│   ├── SessionStart (9):     project-docs-gate, session-focus-gate, autoskills-check,
│   │                         graphify-session-init, memory-discipline, session-branch-advisor,
│   │                         harvest-injector, projects-dashboard, rag-context-injector
│   ├── UserPromptSubmit (2): context-budget-gate, session-size-guard
│   ├── PreToolUse (11):      graphify-read-gate[Read], graphify-preuse[Glob|Grep],
│   │                         settings-schema-guard[Edit|Write], write-over-edit-guard[Write],
│   │                         config-protection[Edit|Write], domain-agent-gate[Edit|Write],
│   │                         edit-enforcer[Edit|Write], secret-scanner[Bash], quality-gate-runner[Bash],
│   │                         tool-policy-gate[mcp__claude-in-chrome],
│   │                         skill-selector-gate[Skill] (ranker integration)
│   ├── PostToolUse (13):     post-edit-combined, context7-reminder, inline-review-gate [Edit|Write]
│   │                         verification-tracker, loop-guardian [Edit|Write|Bash]
│   │                         secret-output-scanner [Bash], bash-output-advisor [Bash],
│   │                         graphify-post-commit [Bash], graphify-auto-update [Edit|Write],
│   │                         inline-review-tracker [Agent],
│   │                         scope-guard [TaskCreate], context7-tracker [Context7],
│   │                         pipeline-tracker [Skill]
│   ├── Stop (3):             stop-verification, ship-gate, stop-auto-checkpoint
│   ├── Notification (1):     task-completed-gate          ← Claude Code only
│   └── FileChanged (1):      env-change-watcher           ← Claude Code only
├── hooks/skill-distiller.js  ← дистилляция SKILL.md → digests.jsonl (TTL 48h)
├── hooks/skill-ranker.js     ← ранжування скилов по 6 критериям
├── hooks/lib/                ← config.js, logger.js, metrics.js
├── hooks/config.json         ← все threshold'ы (loopGuardian, editEnforcer, etc.)
├── bin/doctor.cmd            ← global doctor wrapper to this repo's tools/doctor.js
├── bin/skill.cmd             ← global skill-search wrapper to tools/skill-search.js
├── bin/agent-skills.cmd      ← global wrapper to central tools/agent-skill-supply-chain.js
├── bin/harness-runner.cmd    ← global wrapper to central tools/harness-runner.js; target via --root
├── bin/harness-gates.cmd     ← global wrapper to central tools/harness-gates.js; target via --root
├── projects-registry.json    ← registered project keys and paths
├── tools/project-docs*.js     ← init-project v2 / sync-docs v2 section-aware docs engine
├── tools/pipeline-state.js    ← canonical pipeline v3 state/ledger helper + acceptance logic
├── tools/codemap*.js          ← Graphify/codemap doctor: setup, scope, stale graph, relevance smoke
├── tools/memory-provider.js   ← project-rag/agentmemory pilot health, recall, comparison, governance
├── tools/agent-surface-audit.js ← Claude/Codex/Gemini hooks/skills/tooling parity audit
├── tools/sync-agent-surface.js  ← skill sync Claude→Gemini/Codex: dry-run + apply; sha256 conflict
├── tools/agent-skill-supply-chain.js ← governed skill manifest audit/install/rollout CLI
├── tools/install-agent-skills-wrapper.js ← installs agent-skills.cmd into ~/.claude/bin
├── config/agent-skill-sources.json ← approved local skills + reviewed GitHub candidate sources
├── tools/harness-checklist.js   ← harness self-audit vs ai-boost/awesome-harness-engineering (CC0)
├── tools/harness-gates.js      ← gate-execution layer over harness-runner.js (P2.2)
├── tools/hook-diet.js          ← hook inventory, classification, failure policy, rollback/evidence
├── tools/token-impact.js       ← JSONL/session and command-output proxy token/file-read impact
├── tools/project-bootstrap.js  ← fail-soft project bootstrap: docs/codemap + bounded-grep strategy
├── tools/research-router.js   ← compact research evidence router with provider skip reasons
├── hooks/hook-stats.js       ← CLI метрик
├── skills/                   ← 47 скілів + mattpocock/skills
├── settings.json             ← глобальная конфигурация + разрешения
└── projects/C--/memory/      ← shared memory: memory_summary.md startup; MEMORY.md/rollouts on demand

~/.codex/
├── hooks.json                ← 44 hook-команды (те же .js, без FileChanged/Notification)
├── test-codex-hooks.js       ← динамический тест из hooks.json
└── memories/ → junction → ~/.claude/projects/C--/memory/
```

## Hook Infrastructure
- `config.json` — threshold'ы: `loopGuardian.repeatWarn=3`, `editEnforcer.warnAt=3/blockAt=9`, etc.
- `lib/config.js` — loader для config.json
- `lib/logger.js` — append-only errors.log
- `lib/metrics.js` — metrics.inc(hook, event) → metrics.json

## Claude Code Notes (форматы вывода хуков)
- PreToolUse BLOCK: `{ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: '...' } }`
- SessionStart/PostToolUse advisory: `{ hookSpecificOutput: { hookEventName: '<Event>', additionalContext: '...' } }`
- Stop BLOCK: `{ decision: 'block', reason: '...' }` → stdout (формат ДРУГОЙ!)
- Silent exit: `process.exit(0)` без stdout = разрешить без комментариев
- Hard block (SessionStart): `process.exit(2)` + stderr message

## Тесты хуков (три уровня)
```bash
node ~/.claude/hooks/test-all-hooks.js          # sanity (35/35)
node ~/.codex/test-codex-hooks.js               # codex sync (45/45)
node ~/.claude/hooks/test-hooks-behavior.js     # BLOCK/ALLOW (37/37)
```
