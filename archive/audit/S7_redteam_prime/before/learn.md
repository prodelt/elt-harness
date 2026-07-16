---
name: learn
description: "Extract reusable patterns from current session into instincts. Usage: /learn"
---

# Learn — Extract Session Instincts

Analyze the current session and extract actionable patterns, best practices, mistakes avoided, and reusable techniques.

## Process

1. **Scan session history** — review what was done, what worked, what failed
2. **Identify patterns** — recurring decisions, techniques that solved problems, mistakes caught
3. **Deduplicate** — read existing instinct files in `~/.claude/projects/{project}/memory/instincts-*.md`; skip instincts where trigger+action already present (confidence 0.7+)
4. **Format as instincts** — structured YAML with trigger, action, confidence
5. **Save to file** — write to `~/.claude/projects/{project}/memory/instincts-{YYYY-MM-DD}.md`
6. **Index in MEMORY.md** — append pointer line to `~/.claude/projects/C--/memory/MEMORY.md`:
   `- [Instincts {date}](instincts-{date}.md) — {1-line hook: what patterns were extracted}`
   Use Edit tool, append after last `##` section. Skip if pointer already exists.

## Instinct Format
```yaml
instincts:
  - domain: "{coding|workflow|git|testing|architecture|security}"
    trigger: "when {specific situation}"
    action: "do {specific action}"
    confidence: 0.85  # 0.0-1.0, start at 0.7 for new instincts
    source: "{project-name} session {date}"
    example: "{optional: concrete example from this session}"
```

## What to Extract
- **Patterns that worked:** "Using pgx.Batch for N inserts instead of N queries saved 3x time"
- **Mistakes caught:** "Forgot to run lint before commit — 3 ESLint fix commits needed"
- **Architecture decisions:** "Splitting handlers.go into per-feature files improved readability"
- **Tool usage:** "Research Engineer should search SkillsMP BEFORE sprint, not during"
- **Client preferences:** "Client prefers Ukrainian UI text with tooltips for every metric"

## What NOT to Extract
- Generic coding rules already in core.md
- One-time fixes that won't recur
- Project-specific data (use memory for that)

## Confidence Scoring
- 0.9+ — Proven across multiple sessions/projects
- 0.7-0.9 — Worked well this session, likely generalizable
- 0.5-0.7 — Promising but needs more validation
- <0.5 — Don't save, too uncertain

## After Learning
- Review saved instincts periodically and promote high-confidence ones to rules.md or agent templates
- Cross-pollinate patterns between projects by copying instinct files to global memory
