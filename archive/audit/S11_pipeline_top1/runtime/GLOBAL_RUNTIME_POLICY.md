# Global Runtime Policy — S11 Pipeline TOP-1

> Версия: 1.0 | Дата: 2026-04-24 | Статус: ACTIVE

Этот документ фиксирует повторяемую операционную политику для ежедневной работы
с Claude Code / Codex / Antigravity после завершения Wave 9 (tasks 46–55).

---

## 1. Daily Workflow

```
SessionStart
  └─ read MEMORY.md (≤100 lines)
  └─ confirm focus: "Focus: [goal] Done when: [criteria]"
  └─ check branch: git branch --show-current

Route request
  └─ Graphify first: cmd /c graphify query "<question>"
  └─ RAG (LightRAG) for project docs if Graphify misses
  └─ grep/read only as fallback for small lookups

Implement
  └─ ctx7 before any external library
  └─ /tdd for logic with side-effects
  └─ /architect-first for 3+ file changes
  └─ /sprint for batch of independent tasks

Verify
  └─ tests PASS (show output as proof)
  └─ build/lint PASS
  └─ no secrets in output

SessionEnd
  └─ /learn (extract patterns if MEMORY.md >80 lines)
  └─ /checkpoint (update NEXT_SESSION_PROMPT.md + MEMORY.md)
  └─ commit on feature branch (never main)
```

---

## 2. Plugin Scope Policy

| Tier | Plugins | Scope |
|------|---------|-------|
| **Global core** | code-review, github, commit-commands, skill-creator | `~/.claude/settings.json` |
| **Project** | vercel, supabase, typescript-lsp, playwright, firecrawl, chrome-devtools-mcp, frontend-design | per-project `.claude/settings.json` |
| **On-demand** | browser-harness, hermes-agent, experimental LSPs | enable in session only, never global |

**Rule:** adding a plugin globally requires explicit justification + PR to this doc.

---

## 3. MCP Server Policy

| Server | Transport | Scope |
|--------|-----------|-------|
| `context7` | MCP | on-demand (ctx7 CLI preferred for caching) |
| `skillsmp` | MCP | global (skill discovery) |
| `claude-in-chrome` | MCP | on-demand (browser automation sessions) |
| `law_mcp` / `ukraine-laws` | MCP | project (law_assistant only) |
| `claude_ai_Gmail` / `Google_Calendar` | MCP | explicit user activation only |

---

## 4. Skills Routing Map

| Task type | Skill |
|-----------|-------|
| Any new task | `/pipeline` (auto-classifies) |
| Architecture / 3+ files | `/architect-first` → `/sprint` |
| After implementation | `/inline-review` → `/ship` |
| Batch of 3 independent tasks | group them, one commit |
| Pattern extraction | `/learn` (session end) |
| State save | `/checkpoint` (session end) |
| New project setup | `/init-project` |
| Docs drift | `/sync-docs` |

---

## 5. CLI Capability Routing

Priority order for external data:

1. **Graphify** — project knowledge graph (fastest, cached)
2. **LightRAG** — project docs + summaries (semantic search)
3. **ctx7 CLI** — external library docs (24h cache)
4. **gh CLI** — GitHub discovery, issues, PRs
5. **grep/read** — raw file fallback (last resort for small lookups)
6. **WebSearch/WebFetch** — public web (only when no local answer exists)

---

## 6. GitHub Tool Discovery Protocol

Before adopting any external GitHub tool:

1. `gh search repos <query> --limit 10` → shortlist
2. `gh repo view <owner>/<repo> --json` → README, license, stars
3. Check: adoption (>100 stars), maintenance (<6mo commit), license (MIT/Apache), Windows support
4. Clone to quarantine dir → read-only spike → `skill-quarantine-scan.js`
5. Structured verdict: `adopt-spec | quarantine-readonly-spike | research-only`
6. `autoPromote=false` always — manual promotion only after manifest + rollback plan

---

## 7. Self-improvement Loop

Triggers (automated):
- `SessionStart`: `session-focus-gate` logs focus; `memory-discipline` warns if MEMORY.md >80 lines
- `Stop`: `stop-auto-checkpoint` regenerates `AUTO_NEXT_SESSION_PROMPT.md` + `AUTO_HANDOFF_STATUS.md`
- Weekly: `weekly-analysis.js` → `~/.claude/proposals-<ISO-week>.md`

Triggers (manual):
- `/learn` at session end — extract patterns from MEMORY.md
- `/checkpoint` at session end — sync handoff files

Write scopes:
- MEMORY.md: project learnings only (<100 lines)
- `~/.claude/hooks/`: hook updates (require tests PASS)
- `~/.claude/skills/*/SKILL.md`: skill updates (require checker PASS)
- `.claude.json`: normalizer only (no direct edits)

---

## 8. Secrets and Security Policy

- No secrets in code, hooks, or skills
- `secret-scanner` hook blocks Bash output with key-like patterns
- `.env` files: never ingest into LightRAG or Graphify
- Auth tokens: never log, never commit
- `skill-quarantine-scan.js`: blocks embedded secrets before promotion

---

## 9. Rollout / Rollback Checklist

### Before installing a new hook
- [ ] Unit test exists and passes
- [ ] `test-all-hooks.js` PASS
- [ ] `test-codex-hooks.js` PASS
- [ ] `test-hooks-behavior.js` PASS (or new behavior test added)
- [ ] Apply script exists in `audit/S11_pipeline_top1/hooks/`

### Before promoting a new skill
- [ ] `SKILL.md` has SemVer frontmatter + `## Success Criteria`
- [ ] `skill-quarantine-scan.js` verdict: `allow`
- [ ] Checker + apply script committed to audit dir
- [ ] Synced to Claude/Codex/Gemini roots

### Rollback any hook
```bash
# Remove from settings.json hooks array, then:
node ~/.claude/hooks/test-all-hooks.js
node ~/.codex/test-codex-hooks.js
```

### Rollback .claude.json change
```bash
# Backup was created automatically at:
# C:\Users\espad\.claude.json.<timestamp>.bak
cp C:\Users\espad\.claude.json.TIMESTAMP.bak C:\Users\espad\.claude.json
```

---

## 10. Config Normalization Schedule

Run quarterly or after >10 new project openings:
```bash
node audit/S11_pipeline_top1/runtime/claude-json-normalizer.js
# exit 0 = clean, exit 1 = duplicates found → review then --apply
```

Check startup cost after major plugin changes:
```bash
node audit/S11_pipeline_top1/runtime/startup-payload-audit.js <session.jsonl>
```

---

## Active Projects and Their Plugin Sets

| Project | Plugins (true) |
|---------|----------------|
| Pipeline-setupper | firecrawl, chrome-devtools-mcp, playwright |
| Izi-tracker | supabase, playwright, typescript-lsp, vercel |
| Law-assistant | (default global core only) |
| CV | (default global core only) |
| Other projects | (default global core only) |

To add project plugins: edit `.claude/settings.json` in the project root.
