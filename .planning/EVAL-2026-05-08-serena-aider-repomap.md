# Evaluation 2026-05-08 - Serena and Aider Repo Map

## Goal

Decide whether Graphify should remain the primary codemap layer after Sprint 4, or whether Serena/Aider repo map should replace it.

## Sources Checked

- Aider repo map docs: https://aider.chat/docs/repomap.html
- Serena README/docs entry point: https://github.com/oraios/serena

## Local Tool Availability

- `aider`: not installed.
- `serena`: not installed.
- `python -m pip show aider-chat serena-agent`: packages not installed.

This means the evaluation is a local fit/preflight evaluation, not a live benchmark. Installing either tool requires a separate dependency/network approval.

## Projects Evaluated

| Project | Path | Shape | Codemap Need |
|---|---|---:|---|
| Pipeline Setupper | `C:/Claude playground/Pipiline setupper` | 153 relevant code files after excluding red-team/recon/cache/generated paths | Medium: cross-tool hooks, docs, RAG, registry logic |
| Browser Harness | `C:/Claude playground/browser-harness` | 7 relevant code files after excluding `.venv`, `.git`, caches | Low: compact Python project, direct file reads are enough |

## Findings

### Graphify

- Already installed and operational in this environment.
- After `.graphifyignore` and a fresh rebuild, Pipeline Setupper graph is 810 nodes / 1301 edges / 0 noisy nodes.
- Direct relevance query cites current files such as `tools/project-docs-core.js`, `initOrSyncProjectDocs`, and `registerProject`.
- Weak point: stale semantic/rationale nodes survive normal `graphify update .` if old `graphify-out/graph.json` exists. Fresh rebuild must delete/regenerate the graph.

### Aider Repo Map

- Official docs describe a concise whole-repo map with important classes/functions, signatures, and selected critical lines.
- It ranks relevant portions using a graph over source files and a token budget controlled by `--map-tokens`.
- Good fit for: Aider chat sessions and low-friction overview of medium/large repos.
- Poor fit for this pipeline today: Aider is not installed, and the repo map is not currently exposed as a global Codex/Claude doctor check in this setup.
- Project fit:
  - Pipeline Setupper: useful as a second opinion if Aider is installed, especially for symbol overview.
  - Browser Harness: overkill; 7 source files can be read directly.

### Serena

- Official README positions Serena as an MCP toolkit for semantic retrieval, editing, refactoring, and debugging.
- It works at symbol level, integrates with Codex/Claude through MCP, and uses LSP by default.
- It supports many languages relevant to this workspace, including Python, JavaScript, TypeScript, PowerShell, Markdown, JSON, YAML, and TOML.
- Good fit for: large/multi-language projects where references, renames, and symbol-aware edits matter.
- Poor fit for immediate Sprint 4: Serena is not installed and requires `uv tool install -p 3.13 serena-agent@latest --prerelease=allow` plus client MCP config.
- Project fit:
  - Pipeline Setupper: strongest candidate for future semantic layer because hooks/tools are cross-file and symbol-aware lookup would reduce brittle grep.
  - Browser Harness: useful only if future refactors grow beyond the current small Python surface.

## Decision

Keep Graphify as the primary codemap layer for now.

Add Serena to the future-tools backlog as the best candidate to test next when dependency installation is allowed. Do not adopt Aider repo map as a pipeline dependency until Aider is installed and there is a stable non-chat wrapper that can feed `doctor` or a codemap report.

## Acceptance Result

- Sprint 4 requirement "Evaluate Serena and Aider repo map on 2 real projects" is satisfied as a documented preflight evaluation.
- No dependency was installed.
- No MCP config was changed.
- Graphify remains primary because it is installed, scoped, testable, and now catches bad graphs automatically.
