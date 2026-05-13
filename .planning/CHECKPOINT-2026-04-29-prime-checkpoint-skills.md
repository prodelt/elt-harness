## Checkpoint - 2026-04-29 Prime / Checkpoint Skills

### User Question
- Verify whether `/prime` command and `/checkpoint` skill are configured as skills.

### Findings
- `prime` is configured in Codex: `~/.codex/skills/prime/SKILL.md`.
- `prime` is configured in Claude: `~/.claude/skills/prime/SKILL.md`.
- `checkpoint` is configured in Codex: `~/.codex/skills/checkpoint/SKILL.md`.
- `checkpoint` was missing from Claude skills and has been mirrored to `~/.claude/skills/checkpoint/SKILL.md`.

### Hook Behavior
- `~/.claude/hooks/skill-selector-gate.js` has `SKIP_SKILLS = {checkpoint, learn, prime, verify}`.
- This means `prime` and `checkpoint` are explicit meta-skills, not auto-ranked task skills.
- `~/.claude/hooks/stop-auto-checkpoint.js` exists and writes an auto-checkpoint briefing if a session ends without an explicit `/checkpoint`.

### Next Session Entry
1. Start with `/prime` to load project state after compaction.
2. Continue LightRAG work from `.planning/CHECKPOINT-2026-04-29-post-ship-lightrag-next.md`.
3. Run `/checkpoint` explicitly before ending the next session.
