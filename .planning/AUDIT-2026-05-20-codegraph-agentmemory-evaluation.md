# CodeGraph / agentmemory Evaluation

Date: 2026-05-20  
Scope: evaluate `colbymchenry/codegraph` and `rohitg00/agentmemory` as replacements or complements for current Graphify/RAG/MEMORY stack.

## Short Answer

Do not replace Graphify with both tools blindly.

Use `codegraph` as the primary candidate to replace Graphify for code structure, symbol search, call graph, impact analysis, and agent code exploration. Use `agentmemory` as a candidate to replace or consolidate the current MEMORY/RAG/session-harvest layer, not the code graph layer.

The best target architecture is:

```text
codegraph      -> code intelligence / impact / affected tests / file structure
agentmemory    -> cross-session memory / decisions / repeated patterns / recall
Context7       -> external library docs
GitHub CLI     -> similar open-source implementations
project docs   -> stable compact source of truth
```

Graphify should stay during a transition period until `codegraph` proves stable under Claude/Codex parallel access on Windows.

## External Evidence

### CodeGraph

Repository: https://github.com/colbymchenry/codegraph

Relevant claims and design:

- Pre-indexed local code knowledge graph for Claude Code, Codex, Cursor, and OpenCode.
- README claims benchmark averages around 92% fewer tool calls and 71% faster exploration.
- Uses tree-sitter AST extraction, local SQLite database, FTS5 search, symbol relationships, call graph, imports, inheritance, and framework route detection.
- Exposes CLI and MCP tools: search, context, callers, callees, impact, node, files, status.
- Supports TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby, C/C++, Swift, Kotlin, Dart, Svelte, Liquid, Pascal/Delphi.
- Installer supports Claude Code and Codex config generation.

Package evidence:

- npm package: `@colbymchenry/codegraph`
- Version observed via npx: `0.7.12`
- Node engines in package metadata: `>=18.0.0 <25.0.0`
- Dependencies include `tree-sitter-wasms`, `web-tree-sitter`, `node-sqlite3-wasm`, optional `better-sqlite3`.

### agentmemory

Repository: https://github.com/rohitg00/agentmemory

Relevant claims and design:

- Persistent memory server for Claude Code, Codex CLI, Cursor, Gemini CLI, OpenCode, and MCP clients.
- README claims 95.2% retrieval R@5 on LongMemEval-S and 92% fewer tokens versus large static context.
- Captures sessions through hooks, compresses observations, indexes BM25 + vector + graph, injects top-K context at SessionStart.
- Default token budget in README config: `TOKEN_BUDGET=2000`.
- Local embeddings are supported with `@xenova/transformers`; no-op LLM provider is default.
- Auto-compress is off by default because PostToolUse LLM compression can spend significant tokens.
- Exposes MCP memory tools: recall, smart search, file history, sessions, profile, relations, audit, governance delete, and more.

Package evidence:

- npm package: `@agentmemory/agentmemory`
- Version in package metadata: `0.9.21`
- Node engines: `>=20.0.0`
- Dependencies include `iii-sdk`, `@anthropic-ai/claude-agent-sdk`, `zod`; optional local embedding dependencies include `@xenova/transformers`.

## Local Pilot Results

Environment:

- Node: `v24.14.0`
- npm/npx via PowerShell is blocked by unsigned `npm.ps1`; `cmd /c npm` and `cmd /c npx` work.
- `codegraph` and `agentmemory` were not installed globally before this test.
- npx default cache path failed with `EPERM` under `D:\npm-cache`; using workspace cache `.tmp\npm-cache` worked for `codegraph`.

### CodeGraph Pilot

Commands:

```text
cmd /c npx --cache ".tmp\npm-cache" -y @colbymchenry/codegraph --version
cmd /c npx --cache ".tmp\npm-cache" -y @colbymchenry/codegraph init -i .
cmd /c npx --cache ".tmp\npm-cache" -y @colbymchenry/codegraph status .
cmd /c npx --cache ".tmp\npm-cache" -y @colbymchenry/codegraph query "project docs" --limit 5 --json
cmd /c npx --cache ".tmp\npm-cache" -y @colbymchenry/codegraph context "what validates project docs" --max-nodes 6
cmd /c npx --cache ".tmp\npm-cache" -y @colbymchenry/codegraph affected tools\project-docs-core.js --json
```

Results:

- Version: `0.7.12`.
- Current project indexed successfully.
- Indexed 665 files in 18.5s.
- Initial report: 3735 nodes, 3070 edges.
- Status report after indexing: 3735 nodes, 6015 edges, DB size 6.58 MB.
- Languages detected: TypeScript 534, JavaScript 126, Python 5.
- Backend: WASM fallback, not native. CodeGraph warns this is 5-10x slower than `better-sqlite3`.
- Query `"project docs"` returned relevant hits: `tools/doctor-core.js`, `tools/project-docs.js`, `tools/project-docs-core.js`, plus old audit copies.
- Context query returned concise code snippets for `DOCS`, `projectKey`, `docsMode`, `normalizePath`, and `registerProject`.
- `affected tools\project-docs-core.js --json` returned no affected tests, so affected-test detection is not yet useful for this repo without import/test conventions.

Important failure:

- Running `codegraph query` and `codegraph context` in parallel hit `database is locked` on the WASM backend.
- This matters because Claude/Codex subagents and hooks can run concurrently. A replacement needs a single-flight wrapper, native backend, or MCP server mode with proper request serialization.

Storage comparison:

- Current `graphify-out/graph.json`: 865,171 bytes.
- Pilot `.codegraph/codegraph.db`: 6,901,760 bytes.
- CodeGraph index is larger, but it stores richer queryable data and code snippets.

### agentmemory Pilot

Commands:

```text
cmd /c npx --cache ".tmp\npm-cache" -y @agentmemory/agentmemory --version
cmd /c npx --cache ".tmp\npm-cache" -y @agentmemory/agentmemory --help
```

Results:

- Direct npx invocation timed out after 60s / 30s in this environment.
- README says it starts a server on port 3111 and viewer on 3113; the timeout is consistent with a long-running server process, not necessarily failure.
- A proper pilot must use explicit server lifecycle checks, port checks, and `mcp` mode instead of expecting the command to exit.

Open concerns:

- Needs `iii-engine` or Docker/prebuilt engine path on Windows.
- Adds a persistent background service and hooks. This may improve memory but can also add startup and PostToolUse overhead if configured badly.
- Auto-compress must remain off initially. Otherwise it can reintroduce token burn through LLM calls after every tool use.

## Comparison With Current Graphify

### Current Graphify Role

Current system uses Graphify for:

- `cmd /c graphify update .`
- `cmd /c graphify query "..."`
- `graphify-out/graph.json`
- `graphify-session-init.js`
- `graphify-read-gate.js`
- `graphify-preuse.js`
- `graphify-auto-update.js`
- `graphify-post-commit.js`
- `tools/codemap-core.js` graph scope and relevance checks
- `doctor` codemap health checks
- architecture docs requiring docs/codemap delta

Current known problems:

- Previous audits found relevance/scoping issues.
- Advice sometimes tells agents to use Graphify even when current project graph does not cover the target files.
- It is a separate CLI flow, not a rich MCP context provider.
- It has weaker direct integration with affected tests, framework routes, and code snippets.

### CodeGraph Advantages

- Better fit for replacing Graphify's actual purpose: code intelligence.
- More agent-native: MCP tools for search/context/callers/callees/impact/files/status.
- Real local pilot returned useful code context without reading files manually.
- Supports Codex and Claude Code explicitly.
- Can reduce exploration reads if the agent follows the rule: use lightweight search/call graph in main session; use heavy context only in explorer subagents.

### CodeGraph Risks

- On this Windows/Codex environment, PowerShell wrappers and npm cache paths are already fragile.
- Native backend was unavailable in npx mode; WASM fallback is slower and showed lock contention under parallel queries.
- The README's large savings assume agents do not re-read files after CodeGraph context. Our current behavior must be enforced through instructions/hooks.
- It indexed audit snapshots and generated files unless config is tightened. We need excludes for `audit/**`, `.planning/**` maybe partially, `.tmp/**`, `graphify-out/**`, `.rag/**`, generated reports, and old copies.

### agentmemory Advantages

- Directly addresses the 200-line MEMORY.md / repeated re-explanation problem.
- Top-K retrieval budget is aligned with our token-reduction goal.
- Cross-agent memory could unify Claude Code and Codex better than current `.claude/projects/C--/memory` + `.codex/memories` junction.
- Has privacy filters, provenance, session history, and memory governance concepts that our current RAG/session-harvest lacks.

### agentmemory Risks

- It is not a code graph replacement.
- It adds another service, another hook suite, and more moving parts.
- README itself warns that LLM-backed auto-compress after every PostToolUse can spend significant tokens.
- Windows setup depends on iii-engine/Docker path and port lifecycle. This needs a controlled pilot.
- If we add it without removing current memory-discipline/RAG/session-harvest hooks, we will duplicate memory injection and increase token burn.

## Decision

CodeGraph: strong candidate to replace Graphify, but only after a pilot hardens Windows execution, native SQLite backend, concurrency, and excludes.

agentmemory: strong candidate to replace the current cross-session memory/RAG/session-harvest layer, but not Graphify. It should be evaluated separately with auto-compress disabled and a strict 1000-2000 token injection budget.

Recommended migration path:

1. Keep Graphify as current production fallback.
2. Add CodeGraph pilot behind a feature flag:
   - `codeMapProvider = graphify | codegraph`
   - `doctor` checks both when enabled.
   - no main-session heavy context calls.
3. Tighten CodeGraph config excludes.
4. Fix Windows/npm wrapper:
   - use `cmd /c npx`, not PowerShell `.ps1`;
   - use a project/cache path that is writable;
   - avoid unbounded progress output.
5. Install native backend or validate MCP server serialization:
   - avoid `database is locked`.
6. Replace graphify hooks gradually:
   - `graphify-read-gate` -> `codemap-provider-gate`
   - `graphify-auto-update` -> `codegraph sync` debounce
   - `tools/codemap-core.js` -> provider interface
7. Pilot agentmemory after CodeGraph:
   - disable auto-compress;
   - disable duplicate RAG injection;
   - bind memory injection to hard token budget;
   - measure retrieval quality and startup overhead.

## Expected Token Impact

Conservative estimate for CodeGraph:

- Exploration-heavy tasks: likely 30-70% fewer file-read/search tool calls if used correctly.
- Small implementation tasks: small benefit, because setup/query overhead can exceed savings.
- Main risk: if `codegraph_context` returns code into the main session and the agent still reads files, token use can increase.

Conservative estimate for agentmemory:

- Cross-session onboarding: likely strong savings if it replaces static MEMORY/RAG injection.
- Active implementation sessions: savings only if auto-compress remains off and injection stays top-K.
- Bad configuration can increase cost because every tool event becomes memory work.

## Recommendation

Proceed with a measured migration, not a full replacement.

The next plan should be a 2-phase architecture:

- Phase 1: CodeGraph provider pilot for code intelligence.
- Phase 2: agentmemory provider pilot for long-term memory.

Success criteria:

- CodeGraph must pass parallel query stress tests without DB locks.
- CodeGraph must produce better relevance than Graphify on 10 fixed project questions.
- CodeGraph must reduce file reads/tool calls in a controlled Claude/Codex task by at least 40%.
- agentmemory must reduce session-start context while preserving recall accuracy.
- Total hook count must go down, not up.
