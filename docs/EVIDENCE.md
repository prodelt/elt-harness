# Evidence

Every number on this page comes with the command that produced it. The numbers are frozen in
[`tools/kpi-release-snapshot.json`](../tools/kpi-release-snapshot.json) (`asOf: 2026-08-26`) and
a regression test — `node tools/kpi-commit-share.test.js` — fails if this page and the snapshot
disagree. That test exists because they had already drifted apart once, silently.

Updating a number means: re-measure with the command below, write the new value into the
snapshot **and** into this page, in one change.

---

## Benchmark — does the harness change anything?

Two experiments on third-party data, Gemini-only (`agy`, `gemini-3.7-flash-high`). Both
preregistrations were frozen **before** the first result row. Full write-up, raw rows and
checksums: [`benchmarks/gemini-3.7-flash-high/`](../benchmarks/gemini-3.7-flash-high/README.md).

| where it was measured | without the harness | with the harness | conclusion |
| --- | --- | --- | --- |
| **writer** — 30 pairs, `Aider-AI/polyglot-benchmark@7e0611e` | 100.0% | 100.0% | **no difference** |
| **gate** — 60 cells, SWE-bench Verified | 50.0% (analytic) | **85.0%** [73.9%, 91.9%] | **there is a difference** |

| gate failure mode | count | what it costs |
| --- | --- | --- |
| **fail-open** — a broken patch shipped | **9/30** | it would have landed in `main` |
| **false-block** — a correct patch rejected | **0/30** | correct work stopped |
| judge latency | p50 21.0 s / p90 25.3 s | 60 calls, 0 transport failures |

The harness does not make the writer smarter — it keeps bad work out of `main`. These are two
different places in the pipeline and one number cannot describe both. The writer arm hit a
ceiling: the model solves those tasks on the first try in both arms.

### The limits of the claim

* **Resolve rate was not measured at all.** The "no gate" arm is analytic, not observed: a
  pipeline without a gate ships every patch *by definition*, and there is no per-instance
  SWE-bench environment here to run the real tests. This measures the gate's **discriminating
  power**, not the share of issues solved.
* **Single-hunk instances were excluded** from the sampling frame: for them the synthetic
  negative degenerates into an empty diff that any judge rejects for free. There were 9 of 30 —
  so 30% of the negative arm would have been a free win for the gate. The conclusion applies to
  multi-hunk patches only.
* **All 9 misses** are cases where the truncated patch stayed coherent and reads like finished
  work: `astropy-8707`, `astropy-8872`, `seaborn-3187`, `requests-2931`, `pylint-4661`,
  `pytest-7236`, `scikit-learn-11310`, `sphinx-9461`, `sympy-14531`. That is the architectural
  hole declared open in [DEFECTS.md](DEFECTS.md): the judge checks the diff against the task,
  not against external reality.
* **`inconclusive` never occurred**, so the debatable "inconclusive counts as accept" rule
  changed nothing on this data — it is still recorded in the preregistration, because it would
  change something on another sample.
* The older 3-pair pilot (`benchmarks/results-v5.0.0.json`) is marked `invalid-for-claim` and
  enters no headline number.

---

## Dogfooding — measured on this repository

### Share of commits that went through the harness

The single number the harness reports about itself. Everything else measures a mechanism that
may well be switched off.

| sample | share, 2026-08-26 |
| --- | --- |
| three projects combined | **54.6% (106/194)** |
| this repository only | **100% (37/37)** |

```powershell
node tools/kpi-commit-share.js --days 14 --as-of 2026-08-26 `
  --cwd "<repo-root>" --cwd "<another-project>" --cwd "<another-project>"
```

`--as-of` is mandatory: without it the command recomputes the window with today's date and stops
reproducing what is printed here. The method matches `.git/elt/run-log.jsonl` against `git log`
**by hash**, not by time — matching by time inflated the share by counting a manual commit made
a minute after a harness run.

> Never mix the combined and single-repo samples: the denominators differ, so "the share
> dropped" would only mean another project entered the sample.

### Blocking verdicts: signal to noise

```powershell
node tools/measure-noise.js
```

| when | ratio |
| --- | --- |
| before phase 2 | **1:7** — seven blocks out of eight were false |
| after phase 2 | **8:1** — 8 true, 1 false out of 20 sampled verdicts |

The caveat without which the number lies: **55% unresolved**. Eleven verdicts out of twenty
could not be classified mechanically and are counted on neither side.

The old noise had a single root behind three defects (D9, D15, D19): there was no single list of
"this belongs to the harness" — every check kept its own, and they drifted apart. There is one
list now: `tools/harness-files.js`.

### Mechanical test suite

```powershell
node tools/elt-oracle-runner.js --full
```

**112/112 files** across three roots — `tools/`, `bin/` and `benchmarks/`. The plugin's own
tests and the benchmark contour's tests must be part of the same gate the harness applies to
everyone else: until 021/T003 the benchmark tests had never run on a single commit. CI runs the
same suite on `windows-latest` and `ubuntu-latest`.

### Size of the harness itself

```powershell
find tools bin \( -name "*.js" -o -name "*.ps1" \) | grep -v node_modules | xargs wc -l | tail -1
```

**42,911 lines** across 188 files, measured on branch `main`.

**The phase-3 goal of ≤ 5,000 lines was not met — and it moved further away, not closer.** The
previous figure of 28,272 was measured in a checkout sitting on a *different* branch: it
described a tree that is not the one being released. The growth is real release work — the D27
fixes, the `benchmarks/` measurement contour and its tests. The largest remaining pieces are
load-bearing (`elt.js` 2,254, `doctor-core.js` 966, `judge-core.js` 886): they cannot be
trimmed, only rewritten, and this release delivered distribution, not a core rewrite.

### Graph-core latency

| metric | target | measured | status |
| --- | --- | --- | --- |
| `ready → local commit` p95 | < 5 s | **16.5 s** (p50 8.1 s, n=15) | **not met** |
| certification p50 / p90 | published separately | 138 s / 183 s (n=31) | — |
| graph-core LOC | ≤ 1,500 | **893** | met |

Measured at `61f6f3c` (regression: `node tools/graph-kpi.test.js`). The p95 sample includes
batches where landing ran together with repair and file moves; swapping the overall percentile
for a convenient sub-sample would be exactly the fudge this measurement exists to prevent.

---

## Review lenses and the confidence cutoff

The lenses run **in parallel** and never see each other's scores: a scorer seen in advance
collapses five independent readings into one.

| lens | what it looks for |
| --- | --- |
| `review-bugs` | obvious bugs in the changed lines themselves |
| `review-claude-md` | violations of the project's own rules |
| `review-code-comments` | comments that have drifted from the code |
| `review-history` | a change that undoes a deliberate past decision |
| `review-prior-comments` | a repeat of something already pointed out |

The scorer (`claude-haiku-4-5-20251001`) assigns 0–100 with a cutoff of **80**. It knows the
usual false positives by name: generated files, harness-owned files, pure formatting, "add a
test" without naming an uncovered branch, renames with no behaviour change.

## Self-repair ledger

The harness fixes itself from data, not from impressions. `.elt/ledger.jsonl` accumulates four
classes of divergence: `weak-signal`, `miss`, `false-positive`, `harness-defect`. Five entries
for one rule raise it for review — **exactly once**; a sixth does not open a second issue, or
the review queue becomes the very noise the ledger exists to remove.

```powershell
node bin/ledger.js record --kind false-positive --rule diff-size --note "threshold ignored a lock file"
node bin/ledger.js summary
```

## Defects

Of 24 numbered defects, 22 are closed. **Blocking open: zero.**

| # | what | status |
| --- | --- | --- |
| D12 | `agent-browser eval --stdin` silently returns `null` | **open, not ours** — [issue #1](https://github.com/prodelt/elt-harness/issues/1) |
| D24 | `tools/elt-checkpoint.test.js` hangs under `node --test` on Linux | **open, non-blocking** — [issue #2](https://github.com/prodelt/elt-harness/issues/2) |

One architectural problem is **not** declared closed: the judge checks the diff against the
spec, not against external reality (a DB schema, another API's semantics). A task that contains
an error passes the gate — and that same mechanism produces the 9 misses out of 30 measured
above. Partial mitigation: the five review lenses, which read the code rather than the task.

Full registry with root causes and proof of closure per number: [DEFECTS.md](DEFECTS.md).
