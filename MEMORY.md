# Session Memory — Pipeline Setupper

## Active Audit
- **S11 Pipeline TOP-1** → `audit/S11_pipeline_top1/`
- Branch: `feature/s11-task-43-init-project-upgrade-mode`
- Score: ~90/100 (Wave 9 fully closed; Wave 10 designed 2026-04-24)
- Archive: `memory/archive/MEMORY-2026-04-24-pre-task55.md`

## Wave 10 — Multi-Project Knowledge Layout (DESIGNED, not implemented)
- Design doc: `audit/S11_pipeline_top1/MULTI_PROJECT_KNOWLEDGE_LAYOUT.md`
- 9 tasks (W10-01..09) added to PLAN.md
- W10-01..06 = manifests (no Python); W10-07..09 = separate session with credentials
- sudoviy-master needs docs trim before ingest (183/159 → ≤150 lines)
- All 4 projects paths:
  - Pipeline-setupper: `C:\Claude playground\Pipiline setupper`
  - Izi-tracker: `D:\Ametrin projects\Izi tracker\izi-tracker`
  - Law_assistant: `D:\Ametrin projects\Law_assistant`
  - sudoviy-master: `D:\Ametrin projects\sudoviy master try 3`

## Wave 9 Status (Tasks 46–55) — ALL CLOSED ✅
| Task | Commit | Summary |
|------|--------|---------|
| 46 | — | Developer Knowledge OS architecture |
| 47 | `bf74e42` | Startup payload audit + config drift findings |
| 48 | `f45c923` | GitHub-first tool discovery workflow |
| 49+50 | `c7c77eb` | LightRAG pilot + CLI capability registry |
| 51+52+53 | `4e65c53` | Browser pilot + Hermes spike + self-improvement loop |
| 54 | `6297127` | Normalize .claude.json + global plugins |
| 55 | (current) | Operating policy + handoff |

## Config State (post-Task 54)
- `.claude.json`: 86 project entries, 0 duplicates (was 88, removed D:/Mammoth erp+mammoth variants)
- Global `enabledPlugins` minimal core: `code-review`, `github`, `commit-commands`, `skill-creator`
- Pipeline-setupper project plugins: `firecrawl`, `chrome-devtools-mcp`, `playwright`
- Izi-tracker project plugins: `supabase`, `playwright`, `typescript-lsp`, `vercel`

## Key Runtime Policy (post-Task 55)
- Doc: `audit/S11_pipeline_top1/runtime/GLOBAL_RUNTIME_POLICY.md`
- Route: Graphify → LightRAG → ctx7 → gh → grep/read → WebSearch
- Daily: SessionStart focus → implement → verify → /learn → /checkpoint
- Plugin rule: global=4 core only; project-specific in per-project settings
- Normalizer: `node audit/S11_pipeline_top1/runtime/claude-json-normalizer.js` (quarterly)

## Installed Infrastructure (global)
- **34 hooks** in `~/.claude/hooks/` — all PASS (last verified Task 53)
- **ctx7-cache** — 24h cache in PreToolUse[Bash]
- **coverage-gate** — blocks commit at <80% line coverage
- **weekly-analysis** — writes `~/.claude/proposals-<ISO-week>.md`
- **graphify-post-commit** — updates graph after each commit
- **stop-auto-checkpoint** — regenerates handoff files on Stop

## Skill Roots Status
- Claude: 24+ skills, SemVer + Success Criteria on all
- Codex: 19+ skills, synced
- Gemini: 21+ skills, synced

## Session Handoff Rule
- End each S11-session: update `audit/S11_pipeline_top1/NEXT_SESSION_PROMPT.md`
- Include: current branch, HEAD commit, closed tasks, next task, first commands
- Auto-handoff: `stop-auto-checkpoint` writes `.planning/AUTO_NEXT_SESSION_PROMPT.md`

## Active Projects
| Project | Priority | Notes |
|---------|----------|-------|
| Law-assistant | HIGH | 34 sessions/week |
| Izi-tracker | HIGH | supabase+vercel+playwright+ts-lsp |
| sudoviy-master | HIGH | 16 sessions/week |
| Pipeline-setupper | MED | this repo, S11 audit complete |

## Gotchas
- git root = `C:\` — always scope with `-- .`
- Hooks: `fs.readFileSync(0, 'utf8')`, not `/dev/stdin`
- Graphify: only `cmd /c graphify update .`
- Windows: no `&&` — use `;` or separate commands
- `.claude.json` duplicate keys: use normalizer, not ConvertFrom-Json
## 2026-04-29 Deep Audit Note
- Fresh audit score: 82/100, not the older documented ~97/100.
- Hook layer is strong: 33/33 Claude sanity, 43/43 Codex sync, 37/37 behavior all pass outside sandbox.
- Main gaps: stale `.rag/index`, dirty workspace/generated artifacts, local `.env` secret hygiene; 2026-04-30 Claude-to-Codex skill parity drift is 0 and Context7 CLI auth was restored via `CONTEXT7_API_KEY`.
- RAG currently contains old `31/31`, `33/33`, `graphify --version` chunks and `graphify query "что делает edit-enforcer?"` returned no match.
- Next best action: rebuild RAG, define skill mirror policy, then clean/exclude `.tmp`, large generated tool caches, and graph artifacts.
## 2026-04-29 RAG Queue
- Implemented LightRAG incremental queue: `tools/rag_queue.py`, tests, and `tools/rag-ingest.py --queue/--queue-stats/--process-queue`.
- Added `~/.claude/hooks/rag-queue-enqueue.js` to Claude/Codex PostToolUse Edit|Write; it only enqueues files and never runs LLM extraction.
- Verified outside sandbox: Claude sanity 35/35, Codex sync 45/45, behavior 37/37.
- Added `--quarantine-index-backlog`; it backed up 21 stale LightRAG status records + 10 full docs, leaving active `processed=12`. Re-run `--process-queue --llm ollama` processed queued `AGENTS.md`; queue is now `indexed=1`, active doc_status `processed=13`, and `pipeline.json` cache was removed. Embeddings still Google 3072-dim until clean local-embedding rebuild.
## 2026-04-29 Skill Parity Note
- `prime` skill exists in both `~/.codex/skills/prime` and `~/.claude/skills/prime`.
- `checkpoint` skill existed in Codex and is now mirrored to `~/.claude/skills/checkpoint/SKILL.md`.
- `skill-selector-gate` intentionally skips meta-skills `{checkpoint, learn, prime, verify}` so they must be invoked explicitly and are not auto-ranked for normal tasks.
## 2026-05-08 Sprint 5 Handoff
- Committed `4511791 feat: automate graphify codemap setup`; next slice is skills simplification for `pipeline` and `architect-first`.
- Continue from `.planning/CHECKPOINT-2026-05-08-sprint5-skills-simplification-start.md`; user approved required writes/escalations.
