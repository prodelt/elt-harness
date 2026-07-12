# Checkpoint - 2026-07-06 (round 3 feedback, session handoff)

## Build Status
- Compiles: n/a (static HTML)
- Lint: not configured
- Type check: n/a

## Test Metrics
- No automated tests (presentation deliverable). `node --check` passed on both v1 and v2 rewrites of the inline `<script>` blocks.

## Code Modifications Since Last Checkpoint
- No new file changes since `.planning/CHECKPOINT-2026-07-06-presentation-v2-concrete.md` (same v2b files still on disk). This checkpoint records **round 3 user feedback on v2b** — the fix has NOT been built yet.
- Files still in place: `presentation/index.html` (13 slides, v2b concrete-walkthrough version), `presentation/tests.html` (10-question quiz, v2b)

## Git State
- Branch: `main`
- Uncommitted: `presentation/` untracked, plus pre-existing untouched files (`.planning/elt-system-audit-latest.md` modified, two CHECKPOINT files untracked)
- Last commit: `d9413aa` (unrelated, predates this work)
- Nothing committed this session

## Feedback history (all 3 rounds — READ BEFORE TOUCHING THE FILE AGAIN)

1. **v1** (compared elt-code/elt-loop to internal AMOS + Cursor/Copilot/ChatGPT) — REJECTED: audience doesn't know AMOS, wrong comparison targets.
2. **v2a** (rebuilt around real cited sources — Böckeler/Fowler "harness engineering", Cobus Greyling's loop-engineering repo, ECC — concept-first: Guides/Sensors, computational/inferential, 3 concentric circles, L1→L2→L3 ladder, 8-node canonical anatomy) — REJECTED: "я ничего не понял, как работает елт луп и елт код" — too academic/abstract for department heads.
3. **v2b** (rebuilt around ONE concrete real walkthrough: task T038+T042 "remove service module from catalog", real commit `cf0837a`, plain-language numbered steps 1-6, real terminal transcripts including a real gate-block proof `cargo fmt --check` reject→fix→accept, industry terms introduced only after showing the mechanism, honest gap slide) — **REJECTED AGAIN, THIS SESSION**, verbatim user quote:
   > "в презентации нету схемі работі елт луп и елт код что используе5тсякакие инструменті как устроена харнесс система, так же я не улавливаю главной сути презентации мне все равно непонятно а как тем кто вообще не разбирается для ни єт будет пустой шум"

## Diagnosis of what's still wrong (do this analysis step, don't skip it)

Three distinct complaints in round 3, all real, don't collapse them into one fix:

1. **No visual schema/diagram.** v2b is prose + numbered steps + terminal-text blocks. The user wants an actual **picture**: boxes/arrows showing what elt-code is, what elt-loop is, what tools sit inside the harness (SKILL.md files, the test/oracle command, the git pre-commit hook, the separate judge sub-agent, the STATE.md/tasks.md files) and how they connect. Text steps ≠ a diagram. This needs actual visual architecture art (boxes, arrows, icons or labeled shapes — SVG/CSS diagram, not more paragraphs).

2. **Core message still not landing.** Even after the concrete walkthrough, the user says "я все равно не понимаю" — the presentation may be showing detail without a single, repeatable, one-sentence takeaway a non-technical viewer could recite back. Needs one crystal-clear central idea stated up front AND echoed at the end (something like: "AI пише код, але не йому вирішувати, чи він хороший — рахунок веде комп'ютер" or similar single load-bearing sentence), with everything else clearly subordinate to it.

3. **Terminal transcripts may themselves be noise for a true novice.** v2b's proof slides show real `cargo fmt --check`, `git commit`, `just test` output — readable to anyone with light dev exposure, but the user's new worry is explicitly about people who understand **nothing technical at all** ("кто вообще не разбирается"). Raw terminal text with package-manager commands may read as meaningless code-noise to that audience, even in service of "proof". Likely fix: keep at most one simplified/annotated terminal snippet as supporting evidence, but make the DIAGRAM (point 1) and the plain-language narrative carry the actual explanation — terminal text should be an artifact you point at, not something the viewer has to parse to follow the story.

## What NOT to do next session
- Do not re-run the same "rewrite all slide text" move a third time without first sketching the diagram/schema and the one-sentence core message separately (e.g. in scratchpad) and getting a quick sanity check that those two things alone are clear — text-only iteration has now failed twice.
- Do not add more academic sourcing/citations — that was round 2's mistake, not round 3's complaint. Round 3 is about **visual structure** and **radical simplicity**, not credibility/citations.

## Remaining Work
1. Design an actual visual diagram (architecture schema) of elt-code + elt-loop: what tools/files are involved, how they connect. This is the primary missing piece.
2. Distill the whole deck to one central sentence, stated first and last.
3. Reconsider whether real terminal transcripts belong front-and-center or should be demoted to a single small supporting-evidence element.
4. Rebuild `presentation/index.html` (and re-check `presentation/tests.html` still matches) with the above.
5. Live-fire verify via agent-browser (**use the PowerShell tool directly for `cmd /c agent-browser ...`, not Bash's `cmd //c` wrapper — it hung repeatedly this session**). Use `?r=<random>#N` cache-busting query to force full reload when jumping slides (a `hashchange` listener was added in v2 so plain `#N` navigation without a full reload also now works for same-tab manual testing).
6. Only after user approves: ask whether to commit `presentation/` to git (currently untracked), and separately ask whether to actually implement worktree isolation in the live `elt-loop` skill (a real, deferred, not-yet-decided engineering change — do not do this silently).

## Blockers
- None technical — purely a communication-design problem, needs a diagram-first pass, not more prose.

## Next Steps
1. Sketch the architecture diagram content (nodes + connections) before touching any slide markup.
2. Write the one-sentence core message.
3. Rebuild the deck around those two things; keep the real T038+T042/`cf0837a`/fmt-reject facts (they're good, verified material) but reframe minimal.
4. Re-verify live with agent-browser via PowerShell tool.

## Resume Pointer
- Focus: presentation for elt-code/elt-loop needs a **visual architecture diagram** + **one-sentence core message** — text-only walkthrough (v2b) was rejected a second time for lacking both, and for possibly being too code-heavy for a true non-technical audience.
- Resume: read this checkpoint in full before editing `presentation/index.html` again. Do not start a fourth blind rewrite — design the diagram + core sentence first, then rebuild.
