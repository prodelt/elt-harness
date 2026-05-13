#!/usr/bin/env node
'use strict';
// S11 Task 31 — PreToolUse[Bash] enforce Conventional Commits 1.0 format.
const fs = require('fs');

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cmd = (input.tool_input && input.tool_input.command) || '';
if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);
if (/--amend\b/.test(cmd)) process.exit(0);

// extract -m "..." or heredoc subject
let subject = null;
let m = cmd.match(/-m\s+"([^"]+)"/);
if (m) subject = m[1].split('\n')[0];
if (!subject) {
  m = cmd.match(/-m\s+'([^']+)'/);
  if (m) subject = m[1].split('\n')[0];
}
if (!subject) {
  // heredoc: git commit -m "$(cat <<'EOF'\nfeat(x): ...\n...\nEOF\n)"
  m = cmd.match(/<<'?EOF'?\s*\n([^\n]+)/);
  if (m) subject = m[1].trim();
}

if (!subject) process.exit(0); // no -m found (perhaps uses $EDITOR) — pass

const CC = /^(feat|fix|chore|docs|refactor|test|style|perf|build|ci|revert)(\([a-z0-9-]+\))?!?:\s.{5,80}$/;
if (CC.test(subject)) process.exit(0);

const reason =
  `⛔ Commit subject не соответствует Conventional Commits:\n` +
  `  "${subject}"\n` +
  `Требуемый формат: <type>(<scope>): <subject>\n` +
  `Допустимые types: feat, fix, chore, docs, refactor, test, style, perf, build, ci, revert\n` +
  `Примеры:\n` +
  `  feat(harvest): add cross-session briefing skill\n` +
  `  fix(auth): handle token expiry in middleware\n` +
  `  chore(deps): bump eslint to 9.0.0`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason
  }
}));
process.exit(0);
