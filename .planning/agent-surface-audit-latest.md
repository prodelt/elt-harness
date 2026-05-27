# Agent Surface Audit

Generated: 2026-05-27T11:22:51.439Z
Root: C:\Claude playground\Pipiline setupper
Status: warn

## Parity

| Client | Hook commands | Skills | Unsupported configured events | Missing skills vs Claude |
|---|---:|---:|---|---:|
| claude | 134 | 98 | none | 0 |
| codex | 105 | 104 | none | 0 |
| gemini | 134 | 25 | Notification, FileChanged | 78 |

## Clients

### claude
- settings: present (C:\Users\espad\.claude\settings.json)
- hook commands: 134
- skills: 98 (C:\Users\espad\.claude\skills)
- unsupported events: none

### codex
- settings: present (C:\Users\espad\.codex\hooks.json)
- hook commands: 105
- skills: 104 (C:\Users\espad\.codex\skills)
- unsupported events: Notification, FileChanged

### gemini
- settings: present (C:\Users\espad\.gemini\settings.json)
- hook commands: 134
- skills: 25 (C:\Users\espad\.gemini\skills)
- unsupported events: Notification, FileChanged

## Tooling

- Context7 npx: available (cmd.exe /c where npx.cmd)
- Command shims: 4/4 present
- Codemap graphify: PASS=4 WARN=0 FAIL=0
- Codemap codegraph: PASS=1 WARN=0 FAIL=0
- Browser tooling: available-as-skill

## Fallback Contracts

- Codex/Gemini unsupported Notification/FileChanged events are expected; parity requires documented fallback, not fake support.
- Context7: Use cmd /c npx.cmd ctx7 docs <library> <query>; network failures are skip reasons, not silent success.
- Browser: Browser tooling is not part of global startup; use explicit browser/gstack skills when needed.

## Unexplained Gaps

- gemini:Notification
- gemini:FileChanged
