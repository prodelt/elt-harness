# Agent Surface Audit

Generated: 2026-08-05T10:37:45.083Z
Root: C:\Claude playground\Pipiline setupper
Status: pass

## Parity

| Client | Hook commands | Skills | Unsupported configured events | Missing skills vs Claude |
|---|---:|---:|---|---:|
| claude | 29 | 686 | none | 0 |
| codex | 3 | 693 | none | 1 |
| gemini | 3 | 696 | none | 1 |

## Clients

### claude
- settings: present (C:\Users\espad\.claude\settings.json)
- hook commands: 29
- skills: 686 (C:\Users\espad\.claude\skills)
- unsupported events: none

### codex
- settings: present (C:\Users\espad\.codex\hooks.json)
- hook commands: 3
- skills: 693 (C:\Users\espad\.codex\skills)
- unsupported events: Notification, FileChanged

### gemini
- settings: present (C:\Users\espad\.gemini\settings.json)
- hook commands: 3
- skills: 696 (C:\Users\espad\.gemini\skills)
- unsupported events: Notification, FileChanged

## Tooling

- Context7 npx: available (cmd.exe /c where npx.cmd)
- Command shims: 4/4 present
- Browser tooling: pass

## Fallback Contracts

- Codex/Gemini unsupported Notification/FileChanged events are expected; parity requires documented fallback, not fake support.
- Context7: Use cmd /c npx.cmd ctx7 docs <library> <query>; network failures are skip reasons, not silent success.
- Browser: Browser tooling default is agent-browser. Agents must use the agent-browser skill and cmd /c agent-browser for browser QA/testing unless the user explicitly requires another tool.

## Unexplained Gaps

- none
