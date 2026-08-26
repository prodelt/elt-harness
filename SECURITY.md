# Security Policy

## Supported versions

| version | supported |
| --- | --- |
| 5.x | ✅ |
| < 5.0 | ❌ |

## Reporting a vulnerability

Please report privately through
[GitHub Security Advisories](https://github.com/prodelt/elt-harness/security/advisories/new)
rather than a public issue. Expect an initial response within seven days.

Include the version, the platform, and the smallest reproduction you have. If it is a bypass of
the gate, say which of the three barriers it walks past — the mechanical suite, the judge, or
the commit proof.

## What ELT does on your machine

Being explicit about this, because it decides what counts as a vulnerability:

* **It runs your project's own commands.** The test and smoke commands come from
  `.harness/harness.json` in the repository you point it at. A malicious repository can put an
  arbitrary command there. Treat cloning an untrusted repo and running the harness in it exactly
  as you would treat running its build.
* **It sends diffs to a model provider.** The judge and the review lenses call the CLI you have
  configured (Claude Code, Codex, or `agy`), and the diff of your working tree goes with the
  call. Do not point the harness at a repository whose contents may not leave the machine.
* **The judge is asked to be read-only, and only one transport enforces it.** Codex gets a real
  `--sandbox read-only`. The Claude and `agy` transports pass the read-only intent as part of
  the prompt contract, not as a system-level capability boundary. Treat a judge call as running
  with the permissions of the CLI it invokes.
* **Prompts and provider output are written locally.** They land under `.harness/` and are not
  encrypted or automatically pruned. For a sensitive repository, review that directory's
  retention yourself.
* **It writes to git.** `elt commit` creates commits and updates task checkboxes on the current
  branch. It never pushes unless you pass `--push`.

## What is not a vulnerability

* The judge letting a broken patch through. That is a measured property with a published rate
  (9 of 30 on the benchmark) and a declared architectural cause — see
  [`docs/EVIDENCE.md`](docs/EVIDENCE.md). Report it as a defect, not an advisory.
* A manual `git commit` bypassing the gate. The harness disciplines its own CLI path; it does
  not physically hold work back. Use protected branches and required CI for that.
