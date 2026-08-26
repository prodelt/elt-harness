# Benchmarks

One principle: **everything published here was frozen before the run**. The preregistration is
written and saved before the first result; after the first result its fields are immutable.
That is the only thing separating a measurement from a fit.

## Current contour → [`gemini-3.7-flash-high/`](gemini-3.7-flash-high/README.md)

The live, versioned, resume-safe contour (spec 021, T002/T003) covers two experiments at
30 pairs / 60 cells:

| experiment | without the harness | with the harness | conclusion |
| --- | --- | --- | --- |
| writer, 30 pairs (polyglot) | 100.0% | 100.0% | **no difference — the tasks hit a ceiling** |
| gate, 60 cells (SWE-bench Verified) | 50.0% (analytic) | **85.0%** [73.9%, 91.9%] | **there is a difference** |

Read [`gemini-3.7-flash-high/README.md`](gemini-3.7-flash-high/README.md) for the numbers, the
9 fail-opens named one by one, and the limits of the claim — including the fact that **resolve
rate was not measured at all**.

## Archived: v5.0.0 directional pilot — `invalid-for-claim`

The data below (3 pairs) is **`invalid-for-claim`** for any release headline: below the
directional-claim threshold (≥30 pairs) and run before the hash-locked runner existed. The files
are kept, not deleted, as an honestly labelled directional pilot.

| | |
| --- | --- |
| dataset | [`Aider-AI/polyglot-benchmark@7e0611e`](https://github.com/Aider-AI/polyglot-benchmark) — third-party tasks, third-party tests |
| tasks | `bowling` (31 tests), `book-store` (20), `dominoes` (13), Python |
| grader | `py -3 -m pytest <task>_test.py -q`, Python 3.11.6 — **not owned by ELT** |
| agent | `agy` 1.1.19, model `gemini-3.7-flash-high` — **the same in both hands** |
| hands | `plain` (agent without the harness) and `elt` (same agent, gate on top) |
| execution | parallel — no order effect by construction |
| pairs | 3 |

Agent substitution: spec 020 (T005) named Codex. The run used `agy`, a user decision taken
**before the first result** and recorded in the preregistration as an explicit deviation. This
pilot says nothing about Codex.

### Result

| task | plain | elt | grader |
| --- | --- | --- | --- |
| bowling | PASS (96.8 s) | PASS (51.2 s) | 31 passed |
| book-store | PASS (46.3 s) | PASS (61.6 s) | 20 passed |
| dominoes | PASS (42.4 s) | PASS (47.4 s) | 13 passed |
| **total** | **3/3** | **3/3** | 64 tests |

### What it proves, and what it does not

**Proves:** the measurement contour works. The tasks are real, the grader is third-party, both
hands start from identical stub bytes (`stubSha256` in the preregistration), and the result goes
to the same independent checker.

**Does not prove — and this matters more:**

* **There is no ELT superiority in this data.** 3/3 vs 3/3: there was no difference and there
  could not have been — the chosen model solves tasks at this level on the first try, and both
  hands hit the ceiling. The benchmark turned out too easy to compare anything.
* **Timing means nothing here.** 160 s vs 185 s in total is the noise of a single run on a
  stochastic agent. A claim about speed needs dozens of pairs.
* **Certification overhead was not measured.** The ELT gate operates on repository slices that
  have a spec, a plan and an oracle; an isolated polyglot task has none of those. Putting an
  overhead number here would mean inventing it.

By the preregistration's own scale, three pairs give a **directional pilot with no right to
claim superiority**. That is exactly what was recorded.

### Reproduction

```powershell
git clone https://github.com/Aider-AI/polyglot-benchmark
git -C polyglot-benchmark checkout 7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f
# each task's stub and test are verified against stubSha256/testSha256 from the preregistration
py -3 -m pytest bowling_test.py -q   # on the original stub: 31 failed — that is the baseline
```

Raw results — `results-v5.0.0.json`: per run, the answer hash, size, coding time, grader time,
grader exit and its verbatim summary. Tokens and cost are recorded as `missing`: the `agy`
transport does not return them, and an eyeballed estimate in a measurement report is the same
lie, only politer.
