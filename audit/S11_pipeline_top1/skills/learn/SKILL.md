---
name: learn
description: "Extract repeated session patterns and propose PR-style SKILL.md improvements before applying them. Usage: /learn"
version: 1.1.0
requires: []
changelog:
  - 1.1.0 (2026-04-23): add repeated-pattern detection and approval-gated SKILL.md diff workflow
  - 1.0.0 (2026-04-22): initialize semver metadata
---

# Learn — Skill Improvement Loop

Use this skill at the end of a session to turn repeated patterns into reusable skill improvements.

## Success Criteria

Return `success: true` only when all applicable predicates below are true:
- Requested workflow outcome is produced in the expected file, branch, PR, report, or deployed resource.
- Required verification command(s) complete successfully and the final response includes their exact command names plus pass/fail evidence.
- Any required user approval, dependency gate, or handoff checkpoint is explicitly satisfied.
- Final response reports `success`, `criteria_checked`, `proof`, and `remaining_work`.
- If any predicate cannot be verified, return `success: false` with `remaining_work` and the blocking reason.

## Trigger Threshold

Propose a SKILL.md change only when the same actionable pattern appears at least 3 times in the session or across linked recent handoff notes. If there are fewer than 3 repeats, write memory only and return `success: true` with `remaining_work: "no skill patch proposed"`.

## Workflow

### 1. Extract
- Review session actions, failed attempts, repeated corrections, user preferences, verification gaps, and successful reusable tactics.
- Group observations by target skill. Prefer an explicit skill named by the user; otherwise infer from changed files, commands, and workflow phase.
- Keep only patterns that are specific, repeatable, and actionable.
- Exclude one-off fixes, secrets, private data, and rules already covered by project instructions.

### 2. Propose Diff
- For each pattern with 3+ repeats, produce a PR-style proposal before editing any skill file.
- Target the narrowest relevant `SKILL.md`; do not update unrelated skills.
- The proposal must include:
  - target file path;
  - pattern evidence count;
  - rationale;
  - expected behavior after the change;
  - verification command or manual smoke check;
  - a fenced `diff` block showing the exact proposed patch.

Example proposal:

```diff
diff --git a/skills/example/SKILL.md b/skills/example/SKILL.md
@@
+## Learned Pattern
+- When the same validation bug appears 3+ times, add a boundary test before refactoring.
```

### 3. Ask User
- Ask for explicit approval before applying any proposed SKILL.md patch.
- Accept only clear approval such as "apply", "yes", "approve", or a user-edited replacement diff.
- If approval is missing or ambiguous, do not edit the skill. Save the proposal in memory and return `success: false` with `remaining_work`.

### 4. Apply
- After approval, apply the exact approved patch with the safest available file-edit tool.
- Preserve frontmatter fields: `name`, `description`, `version`, `requires`, and `changelog`.
- Bump patch or minor version when behavior changes and prepend a changelog entry.
- Run the skill-specific verifier when one exists. Otherwise run a smoke check that confirms the new section and approval-gated workflow are present.
- Report `success`, `criteria_checked`, `proof`, and `remaining_work`.

## Memory Output

When a useful pattern is not strong enough for a skill patch, save it as memory:

```yaml
instincts:
  - domain: "{coding|workflow|git|testing|architecture|security}"
    trigger: "when {specific situation repeats}"
    action: "do {specific action}"
    confidence: 0.7
    source: "{project-name} session {date}"
    evidence_count: 2
```

## Hard Rules

- Never apply a SKILL.md diff without explicit user approval.
- Never patch more than one skill from one pattern.
- Never remove existing skill capabilities unless the user explicitly asks.
- Never include secrets, private data, or raw long transcript excerpts in a skill.
- If the target skill is outside the current workspace, request filesystem approval before writing.
