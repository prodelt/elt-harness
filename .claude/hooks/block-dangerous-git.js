#!/usr/bin/env node
// PreToolUse(Bash|PowerShell) guardrail: hard-deny destructive git commands.
// v2 (2026-07-08): fixed false positives — patterns now apply ONLY to the args of a real
// `git` invocation per shell segment, with quoted strings stripped first (echo "git reset
// --hard" in docs/commit messages no longer blocks). Exit 2 + stderr = block.

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    cmd = JSON.parse(raw)?.tool_input?.command ?? '';
  } catch {
    process.exit(0); // not parseable -> don't block
  }

  // dangerous git subcommand patterns, tested against args of a git invocation only
  const dangerous = [
    /^push\b/,                      // any push: stays human-confirmed in sessions (driver pushes by flag itself)
    /^reset\s+(.*\s)?--hard/,
    /^clean\s+-\w*f/,
    /^branch\s+(.*\s)?-D\b/,
    /^checkout\s+(--\s+)?\.(\s|$)/,
    /^restore\s+(--\s+)?\.(\s|$)/,
  ];

  // strip quoted strings FIRST (whole command) so text payloads can't match,
  // THEN split compound commands (order matters: quoted payload may contain && or |)
  const stripped = cmd.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  const segments = stripped.split(/&&|\|\||;|\||\r?\n/);
  for (const seg of segments) {
    const clean = seg.trim();
    const m = clean.match(/(?:^|[\s(])git\s+(.+)$/);
    if (!m) continue;
    const args = m[1].replace(/^(-c\s+\S+\s+|-C\s+\S+\s+)+/, ''); // skip git -C <dir> / -c k=v
    for (const p of dangerous) {
      if (p.test(args)) {
        process.stderr.write(
          `BLOCKED: git segment '${seg.trim().slice(0, 120)}' matches dangerous pattern '${p}'. ` +
            `The user has prevented you from running this. Ask the user to run it manually if truly needed.\n`
        );
        process.exit(2);
      }
    }
  }
  process.exit(0);
});
