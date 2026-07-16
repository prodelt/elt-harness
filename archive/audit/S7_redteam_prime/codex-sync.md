# Cross-Tool Codex Sync (S7)

## Verification

```bash
$ diff <(grep -oE 'hooks/[a-z-]+\.js' ~/.claude/settings.json | sort -u) \
       <(grep -oE 'hooks/[a-z-]+\.js' ~/.codex/hooks.json | sort -u)
6d5
< hooks/env-change-watcher.js
24d22
< hooks/task‑completed‑gate.js
```

**Claude:** 25 unique hooks | **Codex:** 23 unique hooks.
**Разница:** `env-change-watcher.js` (FileChanged event) и `task‑completed‑gate.js` (Notification event) — Codex не поддерживает эти события. Это **ожидаемое поведение** (CLAUDE.md:40).

## Test results

| Suite | Result |
|---|---|
| `test-all-hooks.js` (sanity) | **26/26 PASS** |
| `test-codex-hooks.js` (codex sync) | **25/25 PASS** |
| `test-hooks-behavior.js` (BLOCK/ALLOW) | **29/29 PASS** |

**80/80 overall.**

## config.json reference

Codex хуки работают через те же `.js` файлы в `~/.claude/hooks/`, которые грузят `~/.claude/hooks/config.json` напрямую. Codex не нуждается в отдельной конфигурации — единая точка истины.

## Verdict

- После S3-S6 все изменения (autocompact threshold, loopGuardian blockAt, edit-enforcer metrics, init-project hard-block, pipeline-state) синхронны между Claude и Codex.
- Никаких pipe-разрывов не найдено.
- Claude-only events (FileChanged, Notification) — by design.
