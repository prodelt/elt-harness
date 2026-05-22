# NEXT SESSION PROMPT — Global Claude/Codex System Audit

Continue the global Claude Code + Codex system modernization.

## Read first

1. `.planning/AUDIT-2026-05-08-global-claude-codex-system.md`
2. `.planning/CHECKPOINT-2026-05-08-global-system-audit.md`

## Goal

Make the global system work predictably on this computer in any project, while preserving each project's own rules in `AGENTS.md`, `CLAUDE.md`, and `.gemini/GEMINI.md`.

## Critical findings already established

- Overall system maturity is about `6.2/10`.
- Hooks are relatively strong, but cross-project portability is weak.
- `~/.claude/pipeline-state.json` is global and currently points to another project, which creates cross-project context pollution.
- RAG is hardcoded to four projects in `rag-context-injector.js`, `rag-queue-enqueue.js`, and `tools/rag-ingest.py`.
- Graphify runs, but query quality is unreliable; it returned noisy red-team/audit results for a direct hook query.
- `skill-search.js` works from this repo, but `skill.sh` / `skill.cmd` are not installed as global commands for any project.
- `red-team` vendors a large offensive corpus with `.cpp`, `.bat`, `.ps1`, `.pdb`, build artifacts, and PoC-like files; this likely causes Windows Defender bans.
- `init-project` and `sync-docs` must become section-aware and merge-based, never overwrite project-specific rules.
- There is an invalid git ref: `.git/refs/heads/feature/s11-task-43-init-project-upgrade-mode (1)`.

## User style / operating rules

- User works across multiple projects and expects checkpoint recovery.
- User often gives long multi-requirement messages; extract a checklist and verify it before final.
- Never say done without proof.
- Preserve project-specific rules above global defaults.
- Prefer concrete implementation and verification over abstract plans.
- Start with `Focus: ... Done when: ...`.

## Recommended next work

Start with Sprint 1 and Sprint 2 from the audit:

### Sprint 1 — Global project registry and doctor

Build a global `doctor` / `bootstrap` layer that checks from any project:

- AI docs exist and preserve local rules;
- skill registry is valid;
- invalid `SKILL.md` YAML is detected;
- hooks are reachable;
- Graphify graph exists and passes relevance smoke test;
- RAG manifest/index/queue status;
- git health;
- stale/wrong pipeline state;
- red-team Defender-risk files.

### Sprint 2 — Project capsule / state isolation

Replace the single global `~/.claude/pipeline-state.json` with per-project state:

- deterministic project key;
- TTL;
- future timestamp rejection;
- cwd validation;
- migration fallback from old global file as read-only.

## Do not do without explicit approval

- Do not delete/quarantine red-team files yet.
- Do not remove the invalid git ref yet.
- Do not rewrite global skills in one large edit.
- Do not overwrite project docs.

## Verification expected

Before claiming completion, show exact command proof for:

- doctor pass/warn/fail output;
- project state path isolation;
- docs preservation smoke test;
- skill command works from outside the command-center repo.

