# Agent Surface Audit

Generated: 2026-07-01T12:50:37.177Z
Root: C:\Claude playground\Pipiline setupper
Status: pass

## Parity

| Client | Hook commands | Skills | Unsupported configured events | Missing skills vs Claude |
|---|---:|---:|---|---:|
| claude | 9 | 684 | none | 0 |
| codex | 3 | 140 | none | 12 |
| gemini | 3 | 143 | none | 13 |

## Clients

### claude
- settings: present (C:\Users\espad\.claude\settings.json)
- hook commands: 9
- skills: 684 (C:\Users\espad\.claude\skills)
- unsupported events: none

### codex
- settings: present (C:\Users\espad\.codex\hooks.json)
- hook commands: 3
- skills: 140 (C:\Users\espad\.codex\skills)
- unsupported events: Notification, FileChanged

### gemini
- settings: present (C:\Users\espad\.gemini\settings.json)
- hook commands: 3
- skills: 143 (C:\Users\espad\.gemini\skills)
- unsupported events: Notification, FileChanged

## Tooling

- Context7 npx: available (cmd.exe /c where npx.cmd)
- Command shims: 8/8 present
- Harness CLI: pass (4/4 wrappers, Stop hooks: 0/3)
- Codemap graphify: PASS=4 WARN=0 FAIL=0
- Codemap codegraph: PASS=1 WARN=0 FAIL=0
- Browser tooling: pass

## Fallback Contracts

- Codex/Gemini unsupported Notification/FileChanged events are expected; parity requires documented fallback, not fake support.
- Context7: Use cmd /c npx.cmd ctx7 docs <library> <query>; network failures are skip reasons, not silent success.
- Browser: Browser tooling default is agent-browser. Agents must use the agent-browser skill and cmd /c agent-browser for browser QA/testing unless the user explicitly requires another tool.

## Unexplained Gaps

- none
