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

// ---------------------------------------------------------------------------
// Model policy (S5) — orchestrator stays smart, subagents must be cheap.
// ---------------------------------------------------------------------------
const DEFAULT_MODEL_POLICY = { enabled: true, threshold: 3, cheapModels: ['haiku', 'sonnet'] };
const SUBAGENT_TOOLS = ['Task', 'Agent'];

function getModelPolicy(policyPath) {
  const target = policyPath || process.env.AMOS_POLICY_PATH || DEFAULT_POLICY_PATH;
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (parsed && parsed.modelPolicy && typeof parsed.modelPolicy === 'object') {
      const mp = { ...DEFAULT_MODEL_POLICY, ...parsed.modelPolicy };
      if (!Array.isArray(mp.cheapModels) || mp.cheapModels.length === 0) mp.cheapModels = DEFAULT_MODEL_POLICY.cheapModels;
      return mp;
    }
  } catch (e) { /* fail-soft -> defaults */ }
  return { ...DEFAULT_MODEL_POLICY };
}

function isCheapModel(model, cheapModels) {
  if (typeof model !== 'string' || !model) return false;
  const m = model.toLowerCase();
  return (cheapModels || DEFAULT_MODEL_POLICY.cheapModels).some(c => m.includes(String(c).toLowerCase()));
}

// Returns null when the spawn is fine, or { violation: true, model } when the
// subagent would run on an expensive (or inherited-expensive) model.
// Escape hatches: AMOS_MODEL_POLICY=off, modelPolicy.enabled=false, or a cheap
// CLAUDE_CODE_SUBAGENT_MODEL default that covers spawns with no explicit model.
function evaluateSubagentModel(toolName, toolInput, opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  if (env.AMOS_MODEL_POLICY === 'off') return null;
  const mp = opts.modelPolicy || getModelPolicy();
  if (!mp.enabled) return null;
  if (!SUBAGENT_TOOLS.includes(toolName)) return null;

  const model = (toolInput && typeof toolInput.model === 'string') ? toolInput.model : '';
  if (model) return isCheapModel(model, mp.cheapModels) ? null : { violation: true, model };

  const envDefault = env.CLAUDE_CODE_SUBAGENT_MODEL || '';
  return isCheapModel(envDefault, mp.cheapModels) ? null : { violation: true, model: '(inherit)' };
}

module.exports = {
  loadPolicy, evaluateToolPolicy, matchRule, DEFAULT_POLICY_PATH,
  getModelPolicy, isCheapModel, evaluateSubagentModel, DEFAULT_MODEL_POLICY, SUBAGENT_TOOLS
};
