# Audit: Global System vs Project-Local Conflicts
Generated: 2026-05-13

## Summary
System maturity after S15-S20: ~7.8/10 (up from 6.2/10).
Critical finding: 28/48 hooks have NO project-context awareness.

---

## Finding 1 — RAG injector hardcodes 4 project paths (CRITICAL)

`rag-context-injector.js` lines 18-20:
```js
'izi-tracker':    'D:/Ametrin projects/Izi tracker/izi-tracker',
'law-assistant':  'D:/Ametrin projects/Law_assistant',
'sudoviy-master': 'D:/Ametrin projects/sudoviy master try 3',
```
Missing from injector: `pipeline-setupper`, `itstep-ai`, `scan-docs`, `preza-12-05`
**Fix**: Replace hardcoded map with `projects-registry.json` lookup (already implemented for
rag-ingest.py in S18 — do same for rag-context-injector.js).
Also add token cap: inject max 1500 tokens (currently uncapped → killed sessions with 1M-context errors).

---

## Finding 2 — 28 hooks not project-aware (HIGH)

Hooks that run identically in ALL projects regardless of stack, domain, or CLAUDE.md:
```
bash-output-advisor, branch-name-validator, config-protection,
context-budget-gate, context7-reminder, context7-tracker,
conventional-commit-validator, edit-enforcer, env-change-watcher,
inline-review-tracker, loop-guardian, memory-discipline,
pipeline-tracker, post-edit-combined, projects-dashboard,
scope-guard, secret-output-scanner, secret-scanner,
session-size-guard, settings-schema-guard, skill-distiller,
skill-ranker, skill-registry-snapshot, skill-selector-gate,
skill-sync-mirror, token-budget, tool-policy-gate,
write-over-edit-guard
```
Most of these are CORRECT to be global (security, budget, loop detection).
But these 4 cause friction in specific projects:
- `skill-selector-gate` — no domain awareness, ranks wrong skills
- `context7-reminder` — fires in projects with no external libs (itstep lesson content)
- `inline-review-tracker` — triggers in doc-only projects (Preza)
- `post-edit-combined` — runs full quality check even in markdown-only edits

---

## Finding 3 — domain-agent-gate generic (MEDIUM)

Detects domain by file extension (.tsx → frontend, .go → go, etc.).
Does NOT know project domain (legal, education, CRM, pipeline).
For Law_assistant: editing .ts files → activates "backend" template with JS/API rules,
not "legal" rules about Ukrainian law structure.
**Fix**: Add `domain` field to `projects-registry.json`:
```json
{ "law-assistant-fc47be0b": { "path": "...", "domain": "legal", "stack": "ts" } }
```
domain-agent-gate reads this → activates domain-appropriate template.

---

## Finding 4 — skill-selector-gate no domain ranking (MEDIUM)

Uses only text similarity on skill descriptions.
"зробити тест" in itstep-ai ranks /tdd above /itstep-lesson-builder.
**Fix**: domain-boosted ranking: if project.domain === 'education' → boost itstep-lesson-builder by 0.15.

---

## Finding 5 — context7-reminder fires in doc/content projects (LOW)

context7-reminder fires after 3 edits warning about library API docs.
In Preza (presentation content) or itstep-ai (lesson markdown) → pure noise.
**Fix**: Skip if edited files are all .md/.html/.txt (no code imports).

---

## Finding 6 — harvest-injector OK, but latest.md path global (LOW)

harvest-injector IS project-aware (checks if harvest mentions cwd). ✓
But reads `~/.claude/session-harvest/latest.md` — single global file.
If two projects used in same day → latest.md contains LAST project's harvest.
**Fix**: Per-project harvest: `session-harvest/<projectKey>/latest.md`

---

## Sprint 6 Plan (from these findings)

### S24-A — RAG injector from registry (P0, ~45min)
File: `~/.claude/hooks/rag-context-injector.js`
- Replace hardcoded project map with `projects-registry.json` lookup
- Add 1500-token cap on injection (truncate to top-3 RAG insights)
- Fallback: if project not in registry → silent skip

### S24-B — domain field in projects-registry (P1, ~30min)
File: `~/.claude/projects-registry.json`
- Add `domain` and `testCmd` fields to each project entry
- domain-agent-gate reads domain → activates correct template
- skill-selector-gate reads domain → domain-boost ranking

### S24-C — context7-reminder file type guard (P2, ~15min)
File: `~/.claude/hooks/context7-reminder.js`
- Skip if ALL edited files match `/\.(md|html|txt|rst|docx)$/`

### S24-D — per-project harvest path (P2, ~20min)
File: `~/.claude/hooks/harvest-injector.js` + session-harvest writer
- Write to `session-harvest/<projectKey>/latest.md`
- Read from same path

### S25 — Red-team quarantine (Sprint 6 original)
Move `skills/red-team/` to `skills/red-team-archive/` behind .gitignore
Windows Defender causes bans: 277 files (.bat:36, .cpp:202, .bin:3, .ps1:15)

### S26 — Context7+ research layer (Sprint 7)
Add GitHub issues/Sourcegraph/Firecrawl as Context7 fallback.

---

## Next Session Entry

Focus: S24-A RAG injector from registry + token cap
Done when: `rag-context-injector.js` reads from projects-registry.json, cap=1500 tokens,
doctor PASS for all 4 projects, no 1M-context errors in first 5 minutes of session.

First commands:
```bash
git branch --show-current
cat C:/Users/user/.claude/projects-registry.json
grep -n "hardcode\|itstep\|izi\|law\|sudoviy" C:/Users/user/.claude/hooks/rag-context-injector.js | head -10
```

Read first: `.planning/AUDIT-2026-05-13-global-system-conflicts.md` (this file)
