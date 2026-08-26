# gemini-3.7-flash-high — a versioned, resume-safe benchmark contour

Replaces the hand-run experiment that used to live in a session scratchpad (T002/T003,
`specs/021-gemini-benchmark-release-readiness`). Both experiments were executed for real:
`writer-plain-vs-elt` (30+30 live `agy` calls, 2026-08-25) and `gate-bare-vs-judgeDiff`
(60 cells, 60 live judge calls, 2026-08-26).

> **Short answer to "does the harness change anything?" — not in the writer, yes in the gate.**
> These are two different places in the pipeline and one number cannot describe both.

## Result — writer-plain-vs-elt (30 pairs, 2026-08-25)

| hand | pass/graded | pass rate [95% CI] | invalid | incomplete |
| --- | --- | --- | --- | --- |
| plain | 30/30 | 100.0% [88.6, 100.0] | 0 | 0 |
| elt | 30/30 | 100.0% [88.6, 100.0] | 0 | 0 |

`claimEligible=true` — both hands terminal on all 30 tasks, 0 transport failures, 0 guard-tamper.

**What this proves:** the same ceiling effect as v5.0.0 (3/3 vs 3/3), now on a statistically
meaningful sample (Wilson 95% CI [88.6%, 100%]) — `gemini-3.7-flash-high` solves
`Aider-AI/polyglot-benchmark` python tasks of this level on the first try in both hands, and by
construction the gate cannot change the pass rate (it does not change the prompt; see
`preregistration.json.writerExperiment.protocol`).

**What it does not prove:** any superiority of ELT in pass rate. The tasks are too easy to
discriminate anything. A negative result is recorded as negative.

## Result — gate-bare-vs-judgeDiff (30 instances × 2 patches, 2026-08-26)

Preregistration: [`preregistration-gate.json`](preregistration-gate.json), frozen **before** the
first row of `gate-results.jsonl`. Machine-generated summary:
[`summary-gate.json`](summary-gate.json).

| arm | correct/cells | accuracy [95% CI] | nature |
| --- | --- | --- | --- |
| bare | 30/60 | 50.0% | analytic — no gate, so everything ships |
| judgeDiff | 51/60 | **85.0% [73.9%, 91.9%]** | measured, 60 live calls |

| judge failure mode | count | what it costs |
| --- | --- | --- |
| fail-open — broken patch shipped | **9/30** | it would have landed in `main` |
| false-block — correct patch rejected | **0/30** | correct work stopped |
| model calls | 60 | latency p50 21.0 s / p90 25.3 s |

`claimEligible=true` — 60/60 cells of the measured arm terminal, 0 transport failures,
0 guard-tamper, 0 `inconclusive`.

**What this proves:** on multi-hunk SWE-bench Verified patches the ELT gate catches 21 broken
patches out of 30 **while rejecting none of the correct ones**. The lower CI bound (73.9%) sits
above the analytic 50% of the gateless arm, so a directional claim is legitimate here — unlike
in the writer arm.

**What it does not prove:** anything about resolve rate. No SWE-bench test was executed in
either arm (see the deviations below). This measures the gate's *discriminating power*.

**Where the gate is blind — by name.** All 9 fail-opens are cases where the truncated patch
stayed coherent and reads like finished work: `astropy-8707`, `astropy-8872`, `seaborn-3187`,
`requests-2931`, `pylint-4661`, `pytest-7236`, `scikit-learn-11310`, `sphinx-9461`,
`sympy-14531`. The judge checks the diff against the problem statement, and when the removed
hunk was a secondary case or a test, the remaining code honestly looks like a solution. This is
exactly the architectural hole recorded as open in the root README: the judge judges against the
task, not against external reality.

`inconclusive` never occurred, so the debatable "inconclusive counts as accept" rule changed
nothing on this data — it is still recorded in the preregistration, because it would change
something on a different sample.

## Deviations from the frozen registration — read before quoting the numbers

`preregistration.json#gateExperiment` is frozen (results already existed in
`writer-results.jsonl`) and describes the gate experiment in a form that is not executable in
this repository. Rather than rewriting a frozen file, a separate **narrowing** registration was
created: `preregistration-gate.json`. Every deviation narrows the claim; none widens it.

1. **The `bare` arm is analytic, not measured.** A real grader needs a per-instance SWE-bench
   environment (docker per repo at `base_commit`, running `FAIL_TO_PASS`) — there is none here.
   "bare" means "no gate", and a pipeline without a gate ships every patch by definition; every
   row is marked `analytic: true`. **Cost: resolve rate disappears from the experiment entirely.**
2. **Single-hunk instances are excluded from the sampling frame.** `stripLastHunk` removes their
   whole file section and the negative degenerates into an EMPTY diff. On the first build of
   this dataset there were **9 of 30** — 30% of the negative arm would have been a free win for
   the judge, decided without reading anything. The filter was introduced before the first
   result. **Cost: the conclusion applies to multi-hunk patches, not to all of them.**
3. **The headline is computed over 2N cells of both halves together.** A gate that rejects
   everything scores 100% on the broken half and 0% on the gold half; only the combined number
   exposes that (`gate-runner.test.js`: "a judge that blocks EVERYTHING does not score above
   bare").
4. **The judge was not adapted to the benchmark.** The earlier note — "judgeDiff is not adapted
   to an external diff, `checkGrounding` reads live git status" — was wrong about the code:
   `judgePrompt()` reads nothing from disk, and `status`/`diff` are parameters. The only change
   in `tools/judge-core.js` is exporting `judgeDiffRetryNoReasons` (the gate calls the judge
   through it, so an external measurement must too). The judge prompt was left untouched,
   including its slice-flavoured wording — what is measured is the gate that actually ships in
   ELT, not an idealised judge rewritten for a benchmark.

The frozen `preregistration.json#gateExperiment` remains in force as **not executed**: what was
done here neither replaces nor closes it.

## The contour

| file | role |
| --- | --- |
| `preregistration.json` | protocol + `runner.sha256` of the writer experiment, frozen before the first result |
| `preregistration-gate.json` | the same for the gate experiment, plus deviations and claim limits |
| `runner.js` | one (task, hand) pair of the writer experiment; append-only JSONL, resume-safe |
| `gate-runner.js` | one (instance, hand) cell of the gate experiment; a separate file so the finished writer run's hash-lock is not broken |
| `build-gate-dataset.js` | deterministic builder: `polyglot-writer` (30 tasks) and `swebench-gate` (30 instances, gold + broken each) |
| `export-swebench.py` | pure format conversion of the SWE-bench Verified HF cache into `instances.jsonl` — no selection, no filtering |
| `summarize.js` / `gate-summarize.js` | machine-generated summaries, Wilson 95% CI, `claimEligible` |
| `runner.test.js` (26) / `gate-runner.test.js` (24) | discriminating regressions; none of them calls a live agent |

Since 021/T003 the tests in this directory are part of the mechanical oracle (`TEST_ROOTS` gained
a third root) — before that they had never run on a single commit.

## Reproduction

```powershell
# 1. datasets (no agent is called)
python export-swebench.py <hf-cache>\swe-bench_verified-test.arrow instances.jsonl
node build-gate-dataset.js --kind swebench-gate --instances instances.jsonl `
  --count 30 --seed elt-021-gate-30-2026-08-26 --out dataset-gate.json
node build-gate-dataset.js --kind polyglot-writer --repo <polyglot-clone> `
  --lang python --ext py --count 30 --seed elt-021-writer-30-2026-08-26 --out dataset-writer.json

# 2. writer experiment (60 agent calls)
node runner.js --dataset dataset-writer.json --hand plain --out writer-results.jsonl --model gemini-3.7-flash-high
node runner.js --dataset dataset-writer.json --hand elt   --out writer-results.jsonl --model gemini-3.7-flash-high
node summarize.js --dataset dataset-writer.json --log writer-results.jsonl --hands plain,elt --out summary-writer.json

# 3. gate experiment (60 judge calls; the bare hands are free)
node gate-runner.js --dataset dataset-gate.json --hand bare-gold        --out gate-results.jsonl
node gate-runner.js --dataset dataset-gate.json --hand bare-broken      --out gate-results.jsonl
node gate-runner.js --dataset dataset-gate.json --hand judgeDiff-gold   --out gate-results.jsonl --model gemini-3.7-flash-high --timeout-ms 480000
node gate-runner.js --dataset dataset-gate.json --hand judgeDiff-broken --out gate-results.jsonl --model gemini-3.7-flash-high --timeout-ms 480000
node gate-summarize.js --dataset dataset-gate.json --log gate-results.jsonl --out summary-gate.json
```

The same source + count + seed must produce a byte-identical `dataset.json` — a checkable
property, not a promise (`runner.test.js`, `gate-runner.test.js`). The gate sample's
`datasetSha256` is `db914ad41dcb…`, frozen in `preregistration-gate.json`.

Interrupting and resuming is safe: both runners skip (id, hand) pairs that already have a
terminal result; `transport-failure` is not terminal and is retried on the next run. Neither run
needed a retry — 0 transport failures across 120 calls.

`results.json` is the canonical output (both summaries inside, plus `claimEligibleOverall`).
`checksums.sha256` holds the sha256 of every evidence file. `dataset-gate.json` is not versioned
(it embeds SWE-bench patches); its hash is recorded in both places.

## Invalidated older data

`../results-v5.0.0.json` and `../preregistration-v5.0.0.json` are marked `invalid-for-claim` in
`preregistration.json.priorRuns` — 3 pairs, below the directional-claim threshold, run before
this hash-locked contour existed. The files are not deleted (an honest record of a directional
pilot), but they cannot enter any headline number.

The draft three-arm (worker/brain, Rust) design from an earlier session was never executed
(blocked on auth/budget) and produces no data in any form.
