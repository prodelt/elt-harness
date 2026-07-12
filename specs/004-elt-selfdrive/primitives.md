# 004-elt-selfdrive — verified native primitives (T014)

> Live probe against the installed Claude Code CLI — see `tools/probe-primitives.js`.
> Snapshot, not a gate: re-run after CLI upgrades (`node tools/probe-primitives.js`).

Version: 2.1.207 (Claude Code)

| primitive | confirmed | source |
|---|---|---|
| --session-id | confirmed | `claude --help` |
| -r/--resume | confirmed | `claude --help` |
| -c/--continue | confirmed | `claude --help` |
| --fork-session | confirmed | `claude --help` |
| --bg/--background | confirmed | `claude --help` |
| --effort | confirmed | `claude --help` |
| --fallback-model | confirmed | `claude --help` |
| claude agents (--json) | confirmed | `claude agents --help` |
| hook: PreToolUse | confirmed | binary string scan |
| hook: PostToolUse | confirmed | binary string scan |
| hook: Notification | confirmed | binary string scan |
| hook: UserPromptSubmit | confirmed | binary string scan |
| hook: SessionStart | confirmed | binary string scan |
| hook: SessionEnd | confirmed | binary string scan |
| hook: Stop | confirmed | binary string scan |
| hook: SubagentStop | confirmed | binary string scan |
| hook: PreCompact | confirmed | binary string scan |
| Notification.notification_type: agent_needs_input | confirmed | binary string scan |
| Notification.notification_type: agent_completed | confirmed | binary string scan |
| env: MAX_THINKING_TOKENS | confirmed | binary string scan |
