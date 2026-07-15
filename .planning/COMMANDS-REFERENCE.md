# Commands Reference (full)

Полный список команд проекта, вынесенный из `CLAUDE.md`/`AGENTS.md`/`.gemini/GEMINI.md`
2026-06-11 для соблюдения бюджета документации (<150 строк). В основных доках остаётся
только сжатый набор самых частых команд (см. раздел "## Commands").

```bash
# Тесты хуков (три уровня)
node ~/.claude/hooks/test-all-hooks.js          # sanity: exit 0 + valid JSON (35/35)
node ~/.codex/test-codex-hooks.js               # codex sync (45/45)
node ~/.claude/hooks/test-hooks-behavior.js     # BLOCK/ALLOW поведение (37/37)

# Анализ расхода токенов
node ~/.claude/hooks/analyze-session.js <jsonl> # разбор затрат по событиям

# Метрики
node ~/.claude/hooks/hook-stats.js              # статистика вызовов
node ~/.claude/hooks/hook-stats.js --errors     # только ошибки
node ~/.claude/hooks/hook-stats.js --reset      # сброс
node ~/.claude/hooks/weekly-analysis.js         # weekly pipeline-proposals из metrics/errors

# Graphify
cmd /c graphify --help                          # smoke: CLI доступен
cmd /c graphify query "что делает edit-enforcer?"
cmd /c graphify update .                        # обновить граф (в проекте)
node tools/doctor.js                            # health: docs, skills, hooks, Graphify, RAG, git, state
node tools/pipeline-state.test.js               # pipeline v3 acceptance helpers: state/mode/ledger/closeout
node tools/project-docs.js verify --root .      # verify 6 AI-doc core sections
node tools/project-docs.test.js                 # init/sync v2 regression tests
node tools/codemap.js --root .                  # Graphify scope + relevance doctor
node tools/codemap.js --root . --provider codegraph --json # optional CodeGraph provider health
node tools/codemap.js setup --root . --no-relevance # create/update .graphifyignore + scope/stale checks
node tools/codemap-benchmark.js --root . --provider graphify --json # 10-question relevance benchmark
node tools/codemap-measure.js --root . --json   # codemap task-level tool/read measurement plan
node tools/memory-provider.js status --root . --json # project-rag / agentmemory provider health
node tools/memory-provider.js recall --root . --json # 20 recall prompts for memory-provider comparison
node tools/memory-provider.js compare --root . --json # project-rag vs agentmemory promotion report
node tools/agent-surface-audit.js --json       # Claude/Codex/Gemini parity artifact
node tools/agent-surface-audit.js --markdown   # human-readable parity report
node tools/sync-agent-surface.js --dry-run --json          # preview skill sync gaps Claude→Gemini/Codex
node tools/sync-agent-surface.js --apply --target gemini   # copy missing skills to Gemini (--force to overwrite conflicts)
node tools/sync-agent-surface.js --apply --target all      # sync all targets
node tools/agent-skill-supply-chain.js audit --json        # governed skill manifest + client/project rollout audit
node tools/agent-skill-supply-chain.js install-skills --target all --json # dry-run approved skill sync across clients
node tools/agent-skill-supply-chain.js rollout-projects --json # dry-run control-plane pointer rollout across registry
node tools/agent-skill-supply-chain.js archive-missing-projects --json # dry-run archive missing registry paths
node tools/install-agent-skills-wrapper.js --json # dry-run global agent-skills wrapper install
node tools/install-agent-skills-wrapper.js --apply --json # install/update ~/.claude/bin/agent-skills.cmd
agent-skills.cmd audit                         # global wrapper from ~/.claude/bin; works from any project root
cmd /c agent-browser --version                 # global browser automation CLI
cmd /c agent-browser skills get core           # load installed-version browser automation skill
cmd /c agent-browser doctor --offline --quick  # browser automation health check
node tools/git-workflow-audit.js --root .      # git root/branch/dirty/scope audit → .planning/git-workflow-audit-latest.json
node tools/harness-checklist.js --root . --write # harness self-audit (ai-boost CC0 checklist) → .planning/harness-checklist-latest.{json,md}
node tools/harness-checklist.test.js            # harness-checklist unit tests (29/29)
node tools/harness-gates.js gate-plan <runId> --root . --json # inspect gate plan for a run
node tools/harness-gates.js run-gate <runId> --root . --json  # execute current phase gate + write evidence + transition
node tools/harness-gates.js run-gate <runId> --dry-run --json # dry-run gate (no execution/transition)
node tools/harness-gates.js closeout <runId> --root . --json  # verify all phases have gate evidence
node tools/harness-gates.test.js                # harness-gates unit tests (32/32)
harness-runner create <taskId> --root . --json  # global wrapper from ~/.claude/bin; works from any project root
harness-gates gate-plan <runId> --root . --json # global wrapper over central tools/harness-gates.js
harness-gates run-gate <runId> --root . --json  # global wrapper; writes evidence into target --root project
harness-gates closeout <runId> --root . --json  # global wrapper; required before COMPLEX/ARCH success
node tools/hook-diet.js --summary --out .planning/HOOK-DIET-INVENTORY-2026-05-20.json # hook diet inventory/evidence
node tools/token-impact.js measure-command --cmd "node tools/research-router.js design research router --root . --github --architecture --json" --json # command output/token proxy
node tools/project-bootstrap.js --root <project> --json # legacy dry-run bootstrap: docs/codemap strategy and safe actions
node tools/project-bootstrap.js --root <project> --apply --json # legacy apply safe docs + graphifyignore only
node tools/project-bootstrap.js inspect --root <project> --json # read-only: classify code|docs|unknown, docs/harness/codegraph/gate state
node tools/project-bootstrap.js plan --root <project> --json [--codegraph] # read-only target-state decisions (oracle/judge/codegraph/git gate); unknown never gets an invented oracle
node tools/project-bootstrap.js apply --root <project> --json # idempotent: project docs + .planning/STATE.md + managed git gate (code kind only); no .rag/.graphifyignore; harness reported blocked, never invented
node audit/S11_pipeline_top1/skills/pipeline-check.js # verify pipeline v2 runtime skill copies
node audit/S11_pipeline_top1/skills/architect-first-check.js # verify architect-first v2 runtime skill copies
python tools/rag-ingest.py --project pipeline-setupper --queue-stats
doctor.cmd --root .                             # global wrapper from ~/.claude/bin
skill.cmd "architecture refactor" --top 3       # global skill wrapper from ~/.claude/bin
node tools/skill-search.js "architecture refactor" --top 3
node tools/skill-search.js --benchmark --json   # skill-router quality gate
node tools/context7-cli.js library "vercel ai" "agents tool calling"  # resolve library ID
node tools/context7-cli.js docs /microsoft/playwright-mcp "CLI usage" # query library docs
node tools/context7-cli.js skills-search         # manual-only interactive note (no spawn)
node tools/research-router.js "design research router" --root . --github --architecture --json
node tools/github-research.js "claude code hooks" --limit 5
python tools/rag-ingest.py --project pipeline --queue AGENTS.md
python tools/rag-ingest.py --project pipeline --queue-stats
python tools/rag-ingest.py --project pipeline --quarantine-index-backlog
python tools/rag-ingest.py --project pipeline --process-queue --llm ollama

# AMOS (~/.amos, separate git repo, synced copies in amos/)
node "%USERPROFILE%\.amos\bin\amos.js" doctor
node --test "%USERPROFILE%\.amos\tests\amos.test.js"
```
