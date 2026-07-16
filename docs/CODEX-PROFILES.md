# Codex sandbox profiles — safe default vs privileged emergency

Codex CLI runs your shell commands under a sandbox governed by two keys in
`~/.codex/config.toml`:

- `sandbox_mode` — `read-only` | `workspace-write` | `danger-full-access`
- `approval_policy` — `untrusted` | `on-failure` | `on-request` | `never`

Reference: OpenAI Codex sandboxing guidance — https://learn.chatgpt.com/docs/sandboxing
(least-privilege for everyday local automation; a privileged mode is an explicit exception).

## Safe default (use this)

Least-privilege profile for day-to-day work: writes limited to the workspace, and
Codex asks before anything outside it (network, escalation).

```toml
model = "gpt-5.5"
model_reasoning_effort = "medium"
sandbox_mode = "workspace-write"
approval_policy = "on-request"
```

## Privileged emergency profile (scoped exception, not a default)

`danger-full-access` disables the sandbox — full disk and network. Only for a
specific, temporary task where the sandbox genuinely blocks the work. Keep approvals
on, and revert to the safe default afterward.

```toml
sandbox_mode = "danger-full-access"
approval_policy = "on-request"   # NOT "never"
```

## The high-risk combination

`sandbox_mode = "danger-full-access"` **and** `approval_policy = "never"` means Codex
runs any command with no sandbox and no confirmation. It is never a recommended
default. `node tools/doctor.js` surfaces this as a **high-risk fail** (`codex:sandbox`);
`danger-full-access` with approvals still on is a **warn**.

## What the tooling does — and does not do

- `doctor` only **reads** `~/.codex/config.toml` and reports the profile. It never
  edits the file.
- Changing the global Codex config is always a **manual, user-approved step** — the
  control plane will not rewrite it for you.
