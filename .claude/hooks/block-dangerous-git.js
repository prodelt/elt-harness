#!/usr/bin/env node
// PreToolUse(Bash) guardrail: hard-deny destructive git commands.
// Ported from git-guardrails-claude-code skill (.sh -> .js for Windows reliability).
// Anti-AMOS: ONE deterministic deny on truly destructive ops, no advisory spam.
// Exit 2 + stderr = block the tool call and tell Claude why.

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    cmd = JSON.parse(raw)?.tool_input?.command ?? '';
  } catch {
    process.exit(0); // not parseable -> don't block
  }

  // ponytail: literal substring/regex match on the command string, same as upstream .sh
  const patterns = [
    /git\s+push/,
    /git\s+reset\s+--hard/,
    /git\s+clean\s+-fd/,
    /git\s+clean\s+-f/,
    /git\s+branch\s+-D/,
    /git\s+checkout\s+\./,
    /git\s+restore\s+\./,
    /push\s+--force/,
    /reset\s+--hard/,
  ];

  for (const p of patterns) {
    if (p.test(cmd)) {
      process.stderr.write(
        `BLOCKED: '${cmd}' matches dangerous git pattern '${p}'. ` +
          `The user has prevented you from running this. Ask the user to run it manually if truly needed.\n`
      );
      process.exit(2);
    }
  }
  process.exit(0);
});
