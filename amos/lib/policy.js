const fs = require('fs');
const path = require('path');
const os = require('os');

const AMOS_DIR = process.env.AMOS_HOME || path.join(os.homedir(), '.amos');
const DEFAULT_POLICY_PATH = path.join(AMOS_DIR, 'policy.json');

// Loads policy.json (fail-soft: missing/invalid file -> no rules, allow everything)
function loadPolicy(policyPath) {
  const target = policyPath || process.env.AMOS_POLICY_PATH || DEFAULT_POLICY_PATH;
  try {
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.rules)) return { rules: [] };
    return parsed;
  } catch (e) {
    return { rules: [] };
  }
}

function matchRule(rule, toolName) {
  if (!rule || typeof toolName !== 'string' || !toolName) return false;
  if (rule.match === 'exact') return toolName === rule.pattern;
  return toolName.startsWith(rule.pattern);
}

// Returns the first matching rule for toolName, or null when allowed
function evaluateToolPolicy(toolName, policy) {
  if (!toolName) return null;
  const p = policy || loadPolicy();
  for (const rule of p.rules) {
    if (matchRule(rule, toolName)) return rule;
  }
  return null;
}

module.exports = { loadPolicy, evaluateToolPolicy, matchRule, DEFAULT_POLICY_PATH };
