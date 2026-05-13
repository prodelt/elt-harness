# CLI Capability Registry

## Goal

Close Task 50 by introducing a local, machine-readable registry of approved CLI routes so the agent checks the registry before reading docs or scraping code manually.

## Why OpenCLI-style

The official OpenCLI specification defines a platform-agnostic description for CLI tools that can be used to generate docs, clients, automation, and change detection. For this repo we do not need the full spec runtime; we need a zero-dependency local format that is compatible with the same idea.

Decision:
- adopt `OpenCLI-style`, not the whole OpenCLI runtime;
- store descriptors as JSON-compatible YAML under `runtime/cli-capabilities/*.opencli.yaml`;
- parse them locally without new dependencies.

## Phase 2.5 Evidence

### OpenCLI official spec

Official spec says an OpenCLI Description is a single JSON or YAML document that describes how a CLI tool should be invoked, and it can be used for documentation, client generation, automation, change detection, and autocompletion.

Keep/change decision:
- Keep the format idea.
- Change the implementation to a local subset that is easy to parse in this repo.

### GitHub CLI manual

Official `gh` docs confirm:
- `gh search repos [<query>] [flags]` is the right discovery route;
- `gh repo view owner/repo` is the lightweight metadata/README route.

Keep/change decision:
- Keep `gh` as the default discovery CLI.
- Change the policy so clone happens only after the GitHub-first gate.

### Playwright / Supabase / Vercel / Firecrawl docs

Official docs confirm the current CLI entrypoints needed for project routing:
- Playwright: `npx playwright test`, `npx playwright codegen`
- Supabase: `supabase init`, `supabase db push`, `supabase gen types`
- Vercel: `vercel` supports deploy/log/inspect operations and token auth in CI
- Firecrawl: `firecrawl scrape`, `crawl`, `search ... --scrape`

Keep/change decision:
- Keep these tools as on-demand descriptors.
- Change routing so they are not pulled into every session by default.

## Descriptor Rules

Each descriptor must contain:
- tool name and summary;
- scope (`global`, `project`, or `on-demand`);
- default transport (`cli` or `mcp`);
- `preferCliWhen` and `preferMcpWhen`;
- safe command templates;
- destructive flag per command.

## MCP vs CLI Rule

### Prefer CLI when

- the task is deterministic and command-driven;
- exact shell plan matters more than interactive tooling;
- command output can be piped, saved, or audited;
- the route is already officially documented and stable.

### Prefer MCP when

- the task is docs-first and structured retrieval is cheaper;
- an installed connector already exposes the target system safely;
- interactive agent control is more valuable than a shell plan.

## Approved Descriptors

| Tool | Default transport | Scope | Typical use |
|---|---|---|---|
| `gh` | `cli` | project | repo discovery, metadata review, quarantine planning |
| `context7` | `mcp` | global | official docs lookup; CLI fallback when hook proof requires it |
| `playwright` | `cli` | on-demand | deterministic test/codegen/debug |
| `supabase` | `cli` | on-demand | local project/db/type workflows |
| `vercel` | `cli` | on-demand | deploy/log/inspect/CI |
| `firecrawl` | `cli` | on-demand | scrape/crawl/search research |

## Registry-First Policy

Before manual web/code scraping:
1. check the CLI registry;
2. if a safe CLI route exists, prefer it;
3. if only MCP is preferred, use MCP or the documented fallback;
4. if no descriptor exists, go through GitHub-first discovery before inventing a new route.

## Dry-Run Proof Scenarios

Validated by `cli-capability-registry.js` using `cli-capability-registry.fixture.json`.

1. `github-discovery`
   `gh search repos "lightrag graph rag" --limit 5`
2. `docs-site-crawl`
   `firecrawl crawl https://docs.example.com --limit 50 --max-depth 2 --wait -o docs.json`
3. `deployment-log-check`
   `vercel logs my-app-production`

Additional preference checks:
- `context7` chooses `mcp` for `official API docs`
- `playwright` chooses `mcp` for `interactive browser control in agent session`
- `gh` chooses `cli` for `repository discovery`

## Verdict

Accept the registry.

Task 50 is closed when the descriptors exist, dry-run route selection works, and the policy clearly states when CLI beats MCP and when MCP beats CLI.
