#!/usr/bin/env node

/**
 * PreToolUse hook: Config Protection
 * Matcher: Write|Edit
 *
 * BLOCKS modification of linter/formatter config files.
 * Agents frequently modify these to make checks pass instead of
 * fixing the actual code. This hook steers back to fixing the source.
 *
 * Based on ECC (everything-claude-code) pattern.
 * Silent when no issue — zero context cost.
 */

const fs = require('fs');
const path = require('path');
const metrics = require('./lib/metrics');
const logger = require('./lib/logger');

metrics.inc('config-protection', 'fired');
let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }
const filePath = (input.tool_input && (input.tool_input.file_path || '')) || '';

if (!filePath) {
  process.exit(0);
}

const PROTECTED = new Set([
  // ESLint
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json',
  '.eslintrc.yml', '.eslintrc.yaml',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
  'eslint.config.ts', 'eslint.config.mts',
  // Prettier
  '.prettierrc', '.prettierrc.js', '.prettierrc.cjs',
  '.prettierrc.json', '.prettierrc.yml', '.prettierrc.yaml',
  'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs',
  // Biome
  'biome.json', 'biome.jsonc',
  // Ruff (Python)
  '.ruff.toml', 'ruff.toml',
  // Other linters
  '.shellcheckrc', '.stylelintrc', '.stylelintrc.json',
  '.markdownlint.json', '.markdownlint.yaml', '.markdownlintrc',
  // Go
  '.golangci.yml', '.golangci.yaml',
]);

const basename = path.basename(filePath);

if (PROTECTED.has(basename)) {
  metrics.inc('config-protection', 'blocked');
  logger.warn('config-protection', 'BLOCK edit of ' + basename);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Modifying ' + basename + ' is not allowed. Fix the source code to satisfy linter/formatter rules instead of weakening the config.'
    }
  }));
}
// allow: just exit 0, no output needed
