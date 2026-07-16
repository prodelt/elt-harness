# Browser Automation Pilot

## Goal

Close Task 51 by choosing a browser automation layer that does not add permanent global startup overhead.

## Scenario Used For Comparison

Single dry-run/design scenario:
1. open login page;
2. inspect interactive elements;
3. fill credentials placeholders;
4. capture browser state and evidence artifact;
5. produce deterministic route for repeatable automation.

No real credentials, no destructive actions, no global install.

## Phase 2.5 Evidence (2026-04-24)

### Playwright CLI

- Context7 `/microsoft/playwright-cli` confirms command surface for deterministic interaction (`open`, `snapshot`, `fill`, `click`, `tracing-start`, `tracing-stop`).
- Fit: reliable scripted flow with explicit commands and reproducible traces.

### browser-harness

- GitHub `browser-use/browser-harness` describes a self-healing CDP-based harness with optional cloud browsers and API key path.
- Fit: good for unstable UI/research flows, but heavier setup and weaker determinism.

### Chrome DevTools MCP

- `ChromeDevTools/chrome-devtools-mcp` documents MCP server mode with `--autoConnect` and `--browser-url` connection options for running Chrome.
- Fit: strong human-visible debugging and performance tooling, but typically more interactive and less deterministic than strict CLI scripts.

## Comparison Matrix

| Option | Token cost | Setup cost | Reliability | Security posture | Human-visible control | Deterministic repeatability |
|---|---|---|---|---|---|---|
| Playwright CLI | low | low | high | high | medium | high |
| browser-harness | high | medium | medium | medium | high | low |
| chrome-devtools-mcp | medium | medium | medium | medium | high | medium |

## Dry-Run Command Plans

### Playwright CLI

```bash
playwright-cli open https://example.com/login
playwright-cli snapshot
playwright-cli fill e1 "user@example.com"
playwright-cli fill e2 "placeholder-password"
playwright-cli click e3
playwright-cli tracing-start
playwright-cli snapshot
playwright-cli tracing-stop
```

### browser-harness

```bash
python run.py --url https://example.com/login --dry-run
python helpers.py --action snapshot --dry-run
python helpers.py --action fill --target email --value user@example.com --dry-run
python helpers.py --action fill --target password --value placeholder-password --dry-run
python helpers.py --action click --target submit --dry-run
```

### chrome-devtools-mcp

```bash
npx -y chrome-devtools-mcp@latest --browser-url=http://127.0.0.1:9222
# agent-driven MCP dry-run plan:
# open page -> inspect elements -> fill placeholders -> capture trace
```

## Decision

- Default: `playwright-cli`
- Fallback: `chrome-devtools-mcp`
- Optional on-demand: `browser-harness` only for adaptive/self-healing UI tasks

## Scope Policy

- `project-only` + `on-demand` only.
- No global auto-enable for browser stacks.
- Any real run with credentials requires explicit user approval and per-project environment isolation.

## Verdict

Task 51 is closed when one dry-run scenario is scored, default/fallback are selected, and policy explicitly forbids global-by-default browser automation.
