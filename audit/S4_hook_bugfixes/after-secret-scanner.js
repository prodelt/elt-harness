#!/usr/bin/env node

/**
 * PreToolUse:Bash hook: Scans commands for hardcoded secrets before execution.
 * Detects API keys, tokens, passwords, and other sensitive patterns in Bash commands.
 * Blocks execution and warns the user.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const metrics = require('./lib/metrics');
const logger = require('./lib/logger');

metrics.inc('secret-scanner', 'fired');
let input = '';
const timeout = setTimeout(() => process.exit(0), 5000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input);
    const command = (data.tool_input && data.tool_input.command) || '';

    if (!command) process.exit(0);

    // === CAREFUL MODE: block destructive commands ===
    const carefulFile = path.join(os.tmpdir(), 'claude-careful-mode', 'state.json');
    let carefulActive = false;
    try {
      const s = JSON.parse(fs.readFileSync(carefulFile, 'utf8'));
      if (s.active && Date.now() - (s.ts || 0) < 8 * 60 * 60 * 1000) carefulActive = true;
    } catch (_) {}

    if (carefulActive) {
      const destructivePatterns = [
        { name: 'recursive delete (rm -rf)', pattern: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|-rf|-fr|--recursive)\b/i },
        { name: 'force git reset', pattern: /git\s+reset\s+--hard/i },
        { name: 'force push', pattern: /git\s+push\s+.*?(--force|-f)\b/i },
        { name: 'git clean -f', pattern: /git\s+clean\s+-[a-zA-Z]*f/i },
        { name: 'SQL DROP/TRUNCATE', pattern: /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA|INDEX)\b/i },
        { name: 'force branch delete', pattern: /git\s+branch\s+(-D\b|--delete\s+--force)/i },
      ];
      for (const { name, pattern } of destructivePatterns) {
        if (pattern.test(command)) {
          metrics.inc('secret-scanner', 'careful_blocked');
          logger.warn('secret-scanner', 'CAREFUL BLOCK: ' + name, { cmd: command.slice(0, 120) });
          process.stdout.write(JSON.stringify({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: 'CAREFUL MODE ACTIVE: "' + name + '" is blocked. Run /careful off to deactivate careful mode.'
            }
          }));
          process.exit(0);
        }
      }
    }

    // Secret patterns — high confidence indicators
    const secretPatterns = [
      { name: 'AWS Access Key', pattern: /AKIA[0-9A-Z]{16}/i },
      { name: 'AWS Secret Key', pattern: /aws.{0,10}secret.{0,10}[A-Za-z0-9/+=]{40}/i },
      { name: 'GitHub Token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/i },
      { name: 'GitLab Token', pattern: /glpat-[A-Za-z0-9\-_]{20,}/i },
      { name: 'Slack Token', pattern: /xox[baprs]-[A-Za-z0-9\-]{10,}/i },
      { name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/i },
      { name: 'Generic Secret', pattern: /(?:secret|password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{8,}['"]?/i },
      { name: 'Bearer Token', pattern: /bearer\s+[A-Za-z0-9_\-\.]{20,}/i },
      { name: 'Private Key', pattern: /-----BEGIN\s+(RSA|EC|DSA|OPENSSH)?\s*PRIVATE\s+KEY-----/i },
      { name: 'Supabase Key', pattern: /eyJ[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{50,}/i },
      { name: 'Stripe Key', pattern: /sk_(live|test)_[A-Za-z0-9]{20,}/i },
      { name: 'Sendgrid Key', pattern: /SG\.[A-Za-z0-9_\-]{22,}\.[A-Za-z0-9_\-]{43,}/i },
      { name: 'Twilio SID', pattern: /AC[a-f0-9]{32}/i },
      { name: 'OpenAI Key', pattern: /sk-[A-Za-z0-9]{32,}/i },
      { name: 'Anthropic Key', pattern: /sk-ant-[A-Za-z0-9_\-]{80,}/i },
    ];

    // False positive exclusions
    const falsePositives = [
      /\$\{?\w+\}?/,           // Environment variable references like $VAR or ${VAR}
      /process\.env\./,         // Node.js env access
      /os\.environ/,            // Python env access
      /os\.Getenv/,             // Go env access
      /\.env\b/,                // .env file references
      /echo\s+\$/,              // Echoing env vars
      /export\s+\w+=/,          // Setting env vars (without value check)
      /grep.*secret/i,          // Searching for secrets (security audit)
      /git\s+log/,              // Git log commands
      /cat.*\.env/,             // Reading .env files
      /\b(test|dev|local|mock|fake|dummy|placeholder|example|changeme|sample)\b/i, // Dev/test context
    ];

    // Check for false positives first
    const isFalsePositive = falsePositives.some(fp => fp.test(command));

    const matches = [];
    for (const { name, pattern } of secretPatterns) {
      if (pattern.test(command)) {
        matches.push(name);
      }
    }

    if (matches.length > 0 && !isFalsePositive) {
      metrics.inc('secret-scanner', 'secret_blocked');
      logger.warn('secret-scanner', 'SECRET BLOCK: ' + matches.join(','), { cmd: command.slice(0, 80) });
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'SECRET DETECTED: ' + matches.join(', ') + '. Use environment variables instead. Store in .env and reference via $VAR_NAME.'
        }
      }));
    }
  } catch (e) {
    logger.error('secret-scanner', 'unhandled', e);
  }
  process.exit(0);
});
