## Checkpoint - 2026-04-29 Post-Ship / LightRAG Next

### Current Goal
- Current hook/RAG/tooling phase is shipped.
- Next session focus: LightRAG incremental/realtime ingest design and implementation.

### Shipped Commit
- `13e0eab feat(tools): add skill and github research helpers`

### Completed This Phase
- Hook friction reduced: workflow-discipline blocks converted to advisory guidance while safety blocks remain.
- Graphify realtime layer added through non-blocking PostToolUse auto-update with debounce.
- Skill search CLI added: `tools/skill-search.js`, `tools/skill.sh`, `tools/skill.cmd`.
- GitHub research CLI added: `tools/github-research.js`, `tools/github-research.sh`, `tools/github-research.cmd`.
- `tools/rag-ingest.py --help` fixed so help does not trigger ingest or mutate indexes.
- Project docs synced: `AGENTS.md`, `CLAUDE.md`, `.gemini/GEMINI.md`.

### Verification Proof
- `node --check tools\skill-search.js` PASS
- `node --check tools\github-research.js` PASS
- `python -m py_compile tools\rag-ingest.py` PASS
- `python tools\rag-ingest.py --help` PASS
- `node tools\skill-search.js "architecture refactor" --top 3` PASS
- Hook suites from phase: 34/34 Claude sanity PASS, 44/44 Codex hooks PASS, 37/37 behavior PASS

### Known Limits
- LightRAG is not realtime yet.
- Gemini ingest returned `503 UNAVAILABLE` during testing, so LightRAG must not run synchronously inside edit hooks.
- Global hook files under `~/.claude` / `~/.codex` are outside this repo and were not included in the project commit.

### Next Session Entry
1. Run `git status --short` and ignore unrelated old untracked artifacts unless they block work.
2. Read `tools/rag-ingest.py`, `.rag/manifest.json`, and `~/.claude/hooks/rag-context-injector.js`.
3. Design an incremental queue-based LightRAG updater: file change event -> queue/manifest delta -> background ingest -> stale-cache invalidation.
4. Keep edit hooks fast and advisory; do not run Gemini/Ollama extraction on the critical path.
