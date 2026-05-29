# PLAN — Relocate global Claude config out of the whole-drive `C:\.git`

- **Date:** 2026-05-29
- **Status:** ✅ DONE — executed 2026-05-29. `C:\.git` renamed to `C:\_ARCHIVED-ui-ux-gitdir` (C:\ no longer a worktree → "ui-ux everywhere" fixed); `~/.claude` is now its own repo (commit `ff6d02a`, 37 files, branch `master`, no remote). Verified: 35/35 + 44/44 + 46/46 + doctor FAIL=0. Approach used: **B (fresh repo + bundle archive)** — faithful baseline of the 36 previously-tracked files; bundle preserves full history.
- **Owner decision:** «Запланировать перенос конфига» (de-risk now, relocation as a separate sprint).
- **Rollback safety net:** `D:\git-backups\C-root-uiux-git-2026-05-29.bundle` (verified, complete history; restore with `git clone <bundle> <dir>` or `git fetch <bundle> '*:*'`).

## Problem

A repository lives at `C:\.git` whose **working tree is the entire `C:\` drive**:

- Remote `origin` → `https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git` (PUBLIC, third-party, the authenticated user `prodelt` has **READ only** — push is impossible; the leak risk is conditional and now neutralized).
- Tracks ~162 files at drive root: the `ui-ux-pro-max-skill` source (now mostly **deleted** on disk → shows as ` D`), the user's **global Claude config** `Users/user/.claude/hooks/**` + `.claude/skills/**` (37 files), and **personal CV** `Claude playground/CV/**`.
- Branch `feature/cv-key-projects-update` has **no upstream**; it is **16 commits ahead / 39 behind** `origin/main`.
- **16 commits exist only here** — the entire version history of the global config (`/autofix`, auto-metrics, mattpocock skills, skill-registry, pipeline v1.x, CV edits). Irreplaceable except via the bundle backup.
- `doctor.js` is **blind** to this — it inspects only the project repo and reports green.

The pipeline project repo (`C:\Claude playground\Pipiline setupper\.git`) is independent, has no remote, and is isolated — its history does **not** share commits with `C:\.git`.

## De-risk already applied today (reversible)

1. Backup bundle of all `C:\.git` refs → `D:\git-backups\C-root-uiux-git-2026-05-29.bundle` (verified `okay`).
2. `git --git-dir=C:/.git config status.showUntrackedFiles no` → `git status` at `C:\` dropped from full-drive scan to **93 ms / tracked-only**. Revert: `git --git-dir=C:/.git config --unset status.showUntrackedFiles`.
3. `git --git-dir=C:/.git remote rename origin disabled-origin` → no default push target. Revert: `git --git-dir=C:/.git remote rename disabled-origin origin`.
4. Re-ran hook behavior suite → **44/44 PASS** (hooks unaffected).

## Goal / target architecture

- The global config (`~/.claude` hooks + skills, and a decision on CV) lives in its **own dedicated git repo**, rooted at `~/.claude` (or a chosen private remote), with full history preserved.
- `C:\.git` no longer versions the whole drive. Final disposition (keep-disabled vs delete) is a **separate decision requiring explicit approval** (the "decommission" option), gated on the verified backup.
- Personal CV moves to a **private** repo, never the public `ui-ux-pro-max-skill` remote.

## Migration approaches (choose at sprint start)

`git-filter-repo` is **not installed** — account for this.

- **A. `git subtree split` (built-in, no install):** split `Users/user/.claude/` history from `C:\.git` into a new branch, then seed `~/.claude/.git` from it. Preserves per-file history of the 16 commits. Most faithful.
- **B. Fresh repo + bundle archive (simplest):** `git init` at `~/.claude`, commit current state as the initial commit; keep `D:\git-backups\...bundle` as the historical archive. Loses granular live history but is low-risk and fast.
- **C. `git-filter-repo` extraction:** install `git-filter-repo`, extract `Users/user/.claude/**` into a clean repo. Cleanest history rewrite, but adds a tooling dependency.

Recommended: **A** if subtree split is clean; fall back to **B** if history fidelity is not worth the complexity.

## Steps (planned)

1. Re-verify the backup bundle is restorable into a throwaway clone.
2. Decide approach (A/B/C) and CV destination (private repo).
3. Build the new `~/.claude` repo; verify hooks + skills load and all three test suites pass (35/35, 44/44, 46/46).
4. Move CV to its private repo.
5. Decommission `C:\.git` — **separate explicit approval**: with the bundle confirmed, remove `C:\.git`; the whole-drive worktree disappears.
6. Update `CLAUDE.md` / `AGENTS.md` / `.gemini/GEMINI.md` gotcha + `MEMORY.md` to the post-migration reality.

## Risks

- Losing the 16 commits → mitigated by the verified bundle.
- Hooks resolving to `C:\.git` from non-project CWDs → after relocation/decommission this disappears; until then `-- .` scoping stays.
- Accidental publish of CV/config to the public remote → mitigated today (`disabled-origin`, READ-only, no upstream).
- **`git add -A` / `git add .` from any `C:\` subtree (not itself a nested repo) still walks the entire drive and stages everything into `C:\.git`.** `status.showUntrackedFiles=no` is **display-only** and does NOT prevent this — it is the sharpest reason relocation matters. Editor git integrations also surface every `C:\` folder as "ui-ux-pro-max-skill / feature/cv-key-projects-update / N changes". Only relocation/decommission removes this structural hazard.

## Acceptance criteria

- `~/.claude` is its own repo with hooks + skills history (or bundle-archived) and a chosen (private) remote.
- All three test suites green after migration.
- `C:\.git` no longer has the whole drive as a worktree (decommissioned or scoped).
- Docs + memory reflect the new reality; no stale "git root = C:\" claim.

## Follow-up backlog (separate sprint items)

- **doctor blindness:** add a `doctor.js` check that flags a `.git` whose worktree is a drive root (`core.worktree` == `C:/` or repo at filesystem root). The health tool should never report green while a whole-drive repo sits undetected.
