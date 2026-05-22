# Checkpoint - 2026-05-13 S24-A/B/C

### Build Status
- Compiles: yes (node --check all modified hooks)
- Lint: not configured
- Type check: not run

### Test Metrics
- Total: 35 | Passed: 35 | Failed: 0 | Skipped: 0
- Coverage: not measured
- New tests: 0 (sanity suite `test-all-hooks.js` covers all hooks)

### Code Modifications Since Last Checkpoint
- Files modified (C: git repo):
  - `~/.claude/hooks/rag-context-injector.js` (+20/-13) — S24-A
  - `~/.claude/hooks/skill-selector-gate.js` (+33/-0) — S24-B
- Files modified (untracked in C: repo):
  - `~/.claude/hooks/domain-agent-gate.js` — S24-B (project-domain injection)
  - `~/.claude/hooks/context7-reminder.js` — S24-C (extended skip list)
  - `~/.claude/projects-registry.json` — S24-B (domain field added)

### Git State
- Branch (project repo): feature/s11-task-43-init-project-upgrade-mode
- Branch (C: global repo): feature/cv-key-projects-update
- Uncommitted changes (project repo): 2 M, many ??
- Last commit: 5c03576 docs: global system conflict audit + S24-S26 sprint plan

### Completed Tasks
- S24-A: `rag-context-injector.js` reads from `projects-registry.json` (not hardcoded), MAX_INJECTION_CHARS=6000 (≈1500 tokens), cap applied at cache read too
- S24-B: `domain` field added to all 5 registry projects; `domain-agent-gate.js` injects project-domain rules once/session (before skipExt — fires for .md too); `skill-selector-gate.js` applies DOMAIN_SKILL_BOOST (education→itstep-lesson-builder +0.15, legal→contract-review +0.15)
- S24-C: `context7-reminder.js` skip list extended with .html/.htm/.rst/.docx/.pptx

### Remaining Work
- S24-D: per-project harvest path (`session-harvest/<projectKey>/latest.md`) — ~20min
- S25: red-team quarantine (skills/red-team → archive, .gitignore)
- S26: Context7+ research layer (GitHub issues/Sourcegraph fallback)

### Blockers
- None

### Next Steps (new session entry)
```
Focus: S24-D per-project harvest path
Done when: harvest-injector.js reads/writes per-project latest.md, session-harvest writer updated, no cross-project contamination

First commands:
cat ~/.claude/hooks/harvest-injector.js
grep -n "latest.md\|session-harvest" ~/.claude/hooks/*.js | head -20
```
