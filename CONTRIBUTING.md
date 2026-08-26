# Contributing to ELT

Thanks for taking a look. This project is small and opinionated, so this page is short.

## Before you open a pull request

ELT is built with ELT. Every change goes through the same gate the harness applies to everyone
else, and the fastest way to get a PR merged is to arrive with that already done.

```powershell
node tools/elt-oracle-runner.js --full   # the full suite — must exit 0
node tools/gen-agents-md.js --check      # instruction drift — must exit 0
node bin/doctor.js                       # plugin closure — must exit 0
```

CI runs the same suite on `windows-latest` and `ubuntu-latest`. A red suite is not a review
comment; it is a closed door.

## The two rules that decide most reviews

1. **Fix the shared root cause, not the one call site.** If the same bug can appear a second
   time in a neighbouring file, the patch is not finished.
2. **A non-trivial new branch ships with the smallest regression that proves it.** Not a test
   suite — one test that fails before the change and passes after.

## Instructions live in exactly one file

`CLAUDE.md` is the source. `AGENTS.md` and `.gemini/GEMINI.md` are generated from it by
`node tools/gen-agents-md.js`. Editing a generated copy by hand turns the drift test red — edit
`CLAUDE.md` and regenerate.

## Commits and branches

* One task, one `feature/<slug>` or `fix/<slug>` branch.
* Commit message: `<type>: <description>` — `feat`, `fix`, `docs`, `chore`, `test`, `refactor`.
* PR title under 70 characters; the body has a **Summary** and a **Test plan**.
* Never force-push `main`. Never commit secrets, `.env`, `node_modules`, caches or build
  artifacts.

## Platform notes

The harness runs on Windows and Linux, and the CI matrix enforces both. Two things bite most
often:

* On Windows, `&&` is not a shell operator in PowerShell 5.1 — chain with `;` and `if ($?)`.
* Build paths with `path.join()`, never by concatenating separators.
* A `.ps1` file containing non-ASCII text must be UTF-8 **with BOM** for PowerShell 5.1.

## Reporting a defect in the harness itself

When a verdict and reality disagree, that is data, not an annoyance:

```powershell
node bin/ledger.js record --kind false-positive --rule <rule> --note "<what actually happened>"
```

The registry of numbered defects, with root causes and proof of closure, is in
[`docs/DEFECTS.md`](docs/DEFECTS.md).

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
