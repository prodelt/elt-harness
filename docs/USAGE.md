# Working under the harness

Installation lives in [INSTALL.md](INSTALL.md). This page is about what happens after it.

## Your first slice

```powershell
/elt
```

`/elt` picks its own mode and does not ask redundant questions:

| situation | what it does |
| --- | --- |
| a large new goal, no plan | creates `specs/NNN-name/spec.md` + `tasks.md`, shows them, waits for an explicit approval |
| open tasks exist in `specs/*/tasks.md` | works through slices from the plan |
| one vertical slice, no plan | a micro-slice with the smallest relevant test |
| "continue", "what's next" | restores context and proposes **one** concrete next step |

A trivial change is not wrapped in ceremony: make it, run the smallest check, show the proof.

## The gate chain

Three commands, **one pass, no writes to the tree in between**:

```powershell
node tools/elt.js oracle --full
node tools/elt.js judge run --task T001 --spec specs/NNN-name
node tools/elt.js commit    --task T001 --spec specs/NNN-name --skip-oracle -m "feat: description"
```

Any write between steps yields `stale-tree`; re-running the oracle inside `commit` yields
`stale-oracle` — which is why `--skip-oracle` is always present in the chain.

A batch of 2–4 closely related tasks from **one** plan: `--task T001,T002,T003` in all three
commands. Never batch across specs, risky architectural changes, or dependent tasks.

> **An edit outside the batch's tasks goes into its own slice.** The judge catches it as scope
> creep and blocks the *entire* batch, not the one line.

## Verdicts

| verdict | what to do |
| --- | --- |
| `pass` | commit |
| `block` | do not commit: fix the cause, or park the task (`elt park --task Txxx --reason ...`) |
| `inconclusive` | commit, with a row in `.harness/review-queue.jsonl`; there is no second round |

A red oracle gets **at most two narrow attempts** at fixing the cause. Never delete or weaken a
test. After that, stop without committing and show the evidence.

## Signing a spec

The signature lives in commit trailers, not in a file: parsing is delegated to git itself
(`%(trailers:key=...)`) — a hand-rolled line-by-line regex made the signature forgeable with
ordinary commit text.

```powershell
node tools/elt.js spec approve --spec specs/NNN-name   # its own narrow commit
node tools/elt.js spec status  --spec specs/NNN-name   # approved | stale | unapproved
```

If the content of `spec.md` or the task text changed, the spec must be signed again. Silent
re-signing is acceptable only after a clean `[ ]` → `[X]` that `elt commit` performed itself.

## What the harness does not judge

`tasks.md`, `.harness/**`, `run-log.jsonl`, auto-checkpoints, lock files and other generated
artefacts are written by the harness itself. There is one list — `tools/harness-files.js`, one
function `isHarnessOwned`. A second list must never be introduced: two lists that drifted apart
are exactly what produced defects D9, D15 and D19, and with them a 1:7 signal-to-noise ratio on
blocking verdicts.

## Review with five lenses

```powershell
/elt-verify
```

The lenses run in parallel and never see each other's scores; the confidence scorer assigns
0–100 with a cutoff of 80. The order is mandatory: a scorer seen by the lenses in advance
collapses five independent readings into one.

## When a verdict disagrees with reality

```powershell
/elt-defects
node bin/ledger.js record --kind false-positive --rule diff-size --note "threshold ignored a lock file"
node bin/ledger.js summary
```

Five entries for one rule raise it for review — exactly once.

## Troubleshooting

| symptom | cause | what to do |
| --- | --- | --- |
| `stale-tree` | something wrote to the tree between chain steps | re-run the chain as one pass |
| `stale-oracle` within a second, with no human edit | the tree is moved by the previous slice's background job and by auto-checkpoints | wait for background work to go quiet **before** starting the chain |
| the judge blocks a whole batch over one line | an edit outside the batch's tasks = scope creep | move it into its own slice |
| `spec status: stale` | the spec or task text changed | run `elt spec approve` again |
| `elt commit` does not tick the plan | `--task Txxx` was omitted | add the flag |
| an old plan is not picked up | without `--spec` the **newest** plan is used | pass `--spec specs/NNN-name` explicitly |
| `agy` claims it loaded the skill | it does not load skills on its own, and says otherwise | require it explicitly in the prompt to read `~/.gemini/skills/elt/SKILL.md` |
| editing `AGENTS.md` turns a test red | instructions live in a single `CLAUDE.md` | edit `CLAUDE.md`, then run `node tools/gen-agents-md.js` |
| a `.ps1` file with non-ASCII text misbehaves | PowerShell 5.1 | save as UTF-8 **with BOM** |
| a deprecated command exits with code 64 | `harness-runner`, `harness-gates`, `/pipeline` were removed | use the `elt` route |

Two diagnostics:

```powershell
node bin/doctor.js     # the plugin closure
node tools/doctor.js   # the project harness
```

## What "done" means

Four things at once, not three:

1. the mechanical oracle exits 0;
2. smoke exits 0, if one is configured;
3. exactly one judge returned `pass` or `inconclusive`;
4. `elt commit` created the commit **and** the run-log row.

A manual `git commit` is not technically forbidden, but it leaves no row in the run-log — and
the share of work that went through the harness is measured from exactly that file.

## Two verification modes — and only one of them is a gate

`.harness/harness.json` carries a `verify` field. The difference between its two values is not
a speed setting; it changes what a commit means.

| `verify` | what happens | what a commit means |
| --- | --- | --- |
| `"sync"` *(default)* | the whole chain runs before the commit; a judge proof is required | **gated** — all four conditions above held before the commit existed |
| `"background"` | L0 and a fast oracle run, then control returns; the full suite, mutation check, smoke and the judge run afterwards on a detached worktree | **speculative** — the commit exists before it is fully checked |

In background mode a red result is written to the review queue; **the commit is not rolled
back**. Automatic revert of work that is already committed was deliberately not built: it is
more dangerous than a red row somebody has to read.

```powershell
node tools/elt.js review              # what the background left behind
node tools/elt.js review close --task T001
```

The queue distinguishes four outcomes, and the distinction matters: `bg-red` (the judge answered
and blocked), `bg-dead` (the judge did not answer at all — a crash, a timeout, unparseable
output), `bg-inconclusive`, and silence longer than `backgroundTimeoutMin`, which is recorded as
its own incident. Before this separation existed, a judge that never answered produced a green
verdict — see D8 in [DEFECTS.md](DEFECTS.md).

**Do not call background mode a release gate.** It is a fast local loop with an explicit
unverified state. If work must not reach `main` unchecked, use `"sync"`, and back it with
protected branches and required CI — the harness disciplines its own CLI path, it does not
physically hold a `git push` back.

## Running it headless — for CI and for unattended agents

The harness is meant to be driven by an agent on a server as much as by a person at a terminal.
An unattended caller has two channels and no third: the **exit code** and **stdout**. Both are
part of the contract.

### Exit codes

| code | meaning |
| --- | --- |
| `0` | done — the command did what it says |
| `1` | the work is wrong: red oracle, L0 block, an unusable environment (missing shell, not a git repo) |
| `3` | nothing to do — plan closed, tree clean. Not an error; a loop should stop, not retry |
| `4` | the gate refuses: unsigned spec, stale or unproven proof, dead judge, unknown task |
| `5` | the local step succeeded but publishing did not — commit exists locally, `git push` failed |

Code `4` covers most refusals on purpose: renumbering them would break drivers that already
branch on `=== 4`. **The discriminator is the reason slug, not the number.**

### `--json`: one line, machine-first

Pass `--json` (or set `ELT_JSON=1` when the flag cannot cross a process boundary — hooks and
`harness.json.oracle` are command *strings*, not argv) and every terminal outcome prints a
single JSON line on stdout. Without the flag the human output is unchanged, byte for byte.

```jsonc
{"ok": false, "code": 4, "reason": "spec-unapproved", "message": "спека не подписана: …"}
{"ok": true,  "code": 0, "reason": "committed", "commit": "a1b2c3d", "branch": "feature/t001", "task": "T001"}
```

Reasons an automated caller is expected to branch on:

| reason | what to do |
| --- | --- |
| `spec-unapproved` | run `elt spec approve --spec <dir>` — the plan is not signed |
| `task-not-found` | the task id is not open in the active plan; re-read `elt slice next` |
| `l0-block` | mechanical block *before* the oracle — fix the cause, a re-run will not help |
| `oracle-proof-stale` | the tree moved since the oracle ran — re-run it |
| `oracle-proof-unproven` | the proof exists but nothing was executed under it (all cache hits) — re-run with `--full` |
| `judge-proof-missing` / `judge-proof-stale` | run `elt judge run --task …` |
| `judge-dead` / `judge-no-json` | the judge did not answer; the provider log path is printed on stderr |
| `shell-missing` / `shell-unknown` | `shell` in `.harness/harness.json` does not exist on this platform |
| `tree-clean` | nothing to commit |
| `push-failed` | the commit exists locally; only publishing failed — do not re-run the slice |

### When the judge dies

A dead judge prints the machine reason, the provider log path, and the log's tail on stderr —
because the cause is almost never in the verdict. The most common one on a server is the
provider refusing to run as root:

```
elt judge run: судья не отработал — nonzero-exit
elt judge run: лог провайдера — .harness/fleet/logs/claude-….log
--- хвост лога ---
--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons
```

Until 024 this line existed only inside a file nothing printed: the terminal showed
`"verdict": "dead", "reasons": ["judge dead"]` and exit 4. See D37 in [DEFECTS.md](DEFECTS.md).

## Configuring `.harness/harness.json`

Every field the harness reads, with its type. Anything outside the type is a **hard error** —
before 024 most of these were not checked at all, and a typo did not get rejected, it changed
how the gate behaves (`redProof: "OFF"` is not `"off"`, so the circuit stayed on; `specApproval:
"no"` is a non-empty string, so the approval gate stayed on). An **unknown** key is a warning
for now; it becomes an error in the next minor version — the counter is `SCHEMA_VERSION` in
`tools/harness-schema.js`.

| field | type | what it does |
| --- | --- | --- |
| `kind` | `code` \| `docs` \| `office` | what this project ships; `code` requires `oracle`, the other two require `artifactVerifier` |
| `oracle` | non-empty string | the mechanical suite; its exit code is the truth |
| `artifactVerifier` | non-empty string | the `docs`/`office` equivalent of `oracle` |
| `smoke` | string | second check, run only after a green oracle |
| `smokeParallel` | boolean | run smoke alongside the oracle rather than after it |
| `shell` | `bash` \| `powershell` | interpreter for `oracle`/`smoke`. **Omit it** — the default follows `process.platform`. A hard value here pins every other machine to yours |
| `verify` | `sync` \| `background` | whether the heavy layers block the commit or run after it |
| `background.layers` | string[] | which of `suite`, `mutate`, `smoke`, `judge` the background runs |
| `background.judgeTimeoutMs` | positive number | how long a background judge may take before it is declared dead |
| `backgroundTimeoutMin` | positive number | silence longer than this is its own incident |
| `branchPolicy` | `feature` \| `none` | `feature` moves the commit onto an auto-named branch |
| `push` | boolean | push after a successful commit |
| `judge.enabled` | boolean | — |
| `judge.model` | non-empty string | required when enabled |
| `judge.provider` | `claude` \| `codex` \| `agy` | — |
| `redProof` | `on` \| `off` | require a proof that the new test was red before the fix |
| `redProofTimeoutMs` | positive number | — |
| `testCmd` | non-empty string | how red-proof runs a single test; needed in non-JS projects, where `package.json` detection does not apply |
| `oracleSelect` | `impact` \| `all` | run only the tests the change can reach, or everything |
| `batch` | positive number | how many tasks one gate may cover |
| `specApproval` | boolean | require a signed spec before a code slice |
| `ctx7Gate` | `warn` \| `block` \| `off` | — |
| `l0.hotPaths` | string[] | globs L0 treats as sensitive |
| `l0.knownPackages` | string[] | imports L0 will not call external |
| `l0.fanInThreshold` | positive number | — |
| `l0.diffSizeThreshold` | positive number | — |

Retired fields are named as retired rather than reported as typos: `judge.verify` (spec 011 —
the runtime ignores it and `project-bootstrap apply` removes it), `fleet` and `workers`
(019/T006). If one is in your config, the harness says so instead of leaving you to debug a
setting nothing reads.

### What runs without an agent CLI at all

`elt gate --ci`, `elt oracle [--full]`, `elt status`, `elt stats`, `elt slice next`,
`elt review`, `elt spec lint|status`, `bin/doctor.js` and `bin/l0.js` need no model. Everything
that produces a verdict — `elt judge run`, and therefore `elt commit` on a code change — needs
a configured provider. CI can enforce *"the mechanical oracle is green"* on its own; it cannot
enforce the judgement layers without one.
