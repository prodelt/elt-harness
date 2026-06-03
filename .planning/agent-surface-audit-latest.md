# Agent Surface Audit

Generated: 2026-06-03T21:07:35.308Z
Root: C:\Claude playground\Pipiline setupper
Status: pass

## Parity

| Client | Hook commands | Skills | Unsupported configured events | Missing skills vs Claude |
|---|---:|---:|---|---:|
| claude | 137 | 99 | none | 0 |
| codex | 108 | 106 | none | 0 |
| gemini | 137 | 109 | Notification, FileChanged | 1 |

## Clients

### claude
- settings: present (C:\Users\user\.claude\settings.json)
- hook commands: 137
- skills: 99 (C:\Users\user\.claude\skills)
- unsupported events: none

### codex
- settings: present (C:\Users\user\.codex\hooks.json)
- hook commands: 108
- skills: 106 (C:\Users\user\.codex\skills)
- unsupported events: Notification, FileChanged

### gemini
- settings: present (C:\Users\user\.gemini\settings.json)
- hook commands: 137
- skills: 109 (C:\Users\user\.gemini\skills)
- unsupported events: Notification, FileChanged

## Tooling

- Context7 npx: available (cmd.exe /c where npx.cmd)
- Command shims: 8/8 present
- Harness CLI: pass (4/4 wrappers, Stop hooks: 3/3)
- Codemap graphify: PASS=4 WARN=0 FAIL=0
- Codemap codegraph: PASS=1 WARN=0 FAIL=0
- Browser tooling: pass

## Fallback Contracts

- Codex/Gemini unsupported Notification/FileChanged events are expected; parity requires documented fallback, not fake support.
- Context7: Use cmd /c npx.cmd ctx7 docs <library> <query>; network failures are skip reasons, not silent success.
- Browser: Browser tooling default is agent-browser. Agents must use the agent-browser skill and cmd /c agent-browser for browser QA/testing unless the user explicitly requires another tool.

## Unexplained Gaps

- none
