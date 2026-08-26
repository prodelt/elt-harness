# Installing ELT

The `elt@elt` plugin is installed from its own private marketplace. No step below writes files
into `~/.claude/bin`: runtime deployment was removed by spec 019 T015 — the installed plugin
directory **is** the source.

## 1. Claude Code

```powershell
claude plugin marketplace add prodelt/elt-harness
claude plugin install elt@elt
```

The repository is private: access to `prodelt/elt-harness` must already be configured on the
machine (`gh auth status`). For development, a local path is accepted instead of a repo name:

```powershell
claude plugin marketplace add "C:\Claude playground\ELT-v5-one-hour"
claude plugin install elt@elt
```

Verify:

```powershell
claude plugin list
claude plugin details elt@elt
node bin/doctor.js
```

`plugin details` shows exactly what arrived: 6 skills, 6 agents, 2 hooks. The hooks are marked
`harness-only — no model context cost`: they are executed by the Claude Code process and take up
no model context.

<details>
<summary><strong>Expected <code>doctor</code> output in a clean project</strong></summary>

```
elt-doctor — plugin elt 5.0.0
  [PASS] node >= 18 — node 24.14.0
  [PASS] git on PATH — git version 2.51.0.windows.2
  [PASS] plugin.json — elt 5.0.0
  [PASS] marketplace.json agrees with plugin.json — marketplace elt 5.0.0
  [PASS] bin/ entry points — 6
  [PASS] bin/ closure resolves — 6 modules loaded
  [PASS] plugin surface present — 12 files
  [PASS] surface fully declared (both directions) — 12 files cross-checked
  [PASS] /elt: instruction closure — 7 links intact, version 5.0.0
  [PASS] background: terminal state schema — 5 outcomes, priority red > dead > inconclusive holds
  [PASS] plugin hooks — 2 events, 3 commands, every target present
  [PASS] graph: canonical graph compiles — ready — graph 5.0.0, 8 nodes, 12 edges
  [INFO] graph: run journal — no journal yet — no run has started
  [INFO] packs: component registry — no registry — packs not connected
  [INFO] project: .harness/harness.json — no config — clean project; created by /elt
  PASS=12 WARN=0 INFO=3 FAIL=0
```

A missing `.harness/harness.json` is `INFO`, not a failure. After the first `/elt` bootstrap
that line becomes `[PASS] project: .harness/harness.json — oracle: <your command>` and the
count moves to `PASS=13 INFO=2`.

This output is not decorative: `node tools/smoke-elt-deploy.js` reproduces both states
mechanically (a clean directory, then a freshly bootstrapped git repository), and
`tools/smoke-elt-deploy.test.js` fails if either stops holding.

</details>

## 2. What the installation gives you

| surface | contents |
| --- | --- |
| skills | `elt`, `elt-verify`, `elt-defects`, `elt-doctor`, `harness-method`, `project-bootstrap` |
| agents | five `review-*` lenses and `confidence-scorer` |
| hooks | `SessionStart` — project summary; `Stop` — dirty-exit gate |

Hooks are versioned together with the plugin and live in `hooks/hooks.json`; their code is in
`bin/session-start.js` and `bin/session-stop.js`. They contain no absolute paths — commands run
from `${CLAUDE_PLUGIN_ROOT}`, so one manifest works on any machine.

**SessionStart** prints the branch, tree state, `verify` mode, the count of open plan tasks and
the queue of background reds. In a project without `.harness/harness.json` it stays silent: not
an ELT project, nothing to say.

**Stop** refuses to end a session that edited files in an ELT project and left the tree dirty.
An uncommitted edit reaches neither the run-log nor the judge — it drops out of review *and* out
of the "share of work through the harness" measurement. The gate is fail-open by construction:
not an ELT project, a clean tree, no edits this session, or an unreadable transcript — and it
says nothing.

## 3. Codex and Gemini

Claude gets `/elt` from the plugin installation. Codex and Gemini read skills from their own
home directories, so a copy of the very same file is placed there:

```powershell
node tools/host-surface.js --sync-clients --dry-run   # what would change
node tools/host-surface.js --sync-clients             # apply
```

The command rewrites exactly `~/.codex/skills/elt/SKILL.md` and `~/.gemini/skills/elt/SKILL.md`
(and `~/.claude/...` if an old copy is still there) with the contents of the repository's
`skills/elt/SKILL.md`, keeping the previous version alongside as `.bak-<timestamp>`. It deletes
nothing — neither third-party skills nor the retired `~/.claude/bin/elt.js` deployment.

Parity check — `node tools/host-surface.js`. The `client parity` line compares SHA-256, not
mere file presence:

```
  [ok           ] client parity — source 5.0.0 90dcc5e4b4f7
      claude: ok (5.0.0 90dcc5e4b4f7) — C:\Users\espad\.claude\skills\elt\SKILL.md
      codex:  ok (5.0.0 90dcc5e4b4f7) — C:\Users\espad\.codex\skills\elt\SKILL.md
      gemini: ok (5.0.0 90dcc5e4b4f7) — C:\Users\espad\.gemini\skills\elt\SKILL.md
```

Why by hash: a measurement on 2026-08-24 found the source at 5.0.0 and all three copies at
4.0.0 — two clients out of three had been reading a retired route for a month, and a
"the file exists" check could not see that in principle.

## 4. The project

The plugin is installed **before** bootstrap, which is why `node bin/doctor.js` is green in a
clean project. The project config is created by `/elt`.

## 5. Update and rollback

```powershell
claude plugin update elt          # update (restart required)
claude plugin uninstall elt@elt   # remove
```

The version must match in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and
in the frontmatter of `skills/elt/SKILL.md` — a mismatch fails `claude plugin tag` at release
time, and `node bin/doctor.js` shows it beforehand on its own line.

Rolling back to a previous version means reinstalling that version from the marketplace; the
plugin keeps no state of its own outside the project, so removing it leaves `.harness/`,
`.git/elt/run-log.jsonl` and the plans untouched.

## 6. If ELT hooks are already installed globally

On a machine where ELT lived before the plugin, `~/.claude/settings.json` may still call
`~/.claude/hooks/elt-session-brief.js` and `~/.claude/hooks/dirty-exit-gate.js`. After the
plugin is installed its own hooks do the same thing, and the summary is printed twice.

The plugin does not touch them — that is the user profile, and it has no right to delete files
whose origin it does not know. Remove the duplicate by hand: drop the two entries from `hooks`
in `~/.claude/settings.json` (the files themselves can stay; they simply stop being called).

## Troubleshooting

Day-to-day symptoms and their causes are collected in
[USAGE.md → Troubleshooting](USAGE.md#troubleshooting). For installation specifically:

| symptom | cause | what to do |
| --- | --- | --- |
| `marketplace add` fails on a private repo | no GitHub access on this machine | `gh auth status`, then `gh auth login` |
| `doctor` reports a version mismatch | `plugin.json`, `marketplace.json` and the skill frontmatter disagree | align all three, they are one version |
| the session summary prints twice | old global hooks plus the plugin's own | see section 6 |
| Codex/Gemini behave as if the skill were old | copies drifted from the source | `node tools/host-surface.js --sync-clients` |
