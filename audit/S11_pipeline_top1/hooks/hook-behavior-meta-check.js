const fs = require('fs');
const os = require('os');
const path = require('path');

const REQUIRED_PATTERNS = [
  { label: 'task 21 marker', pattern: /S11 task 21 meta hook behavior tests/ },
  { label: 'session-size warn case', pattern: /WARN: session-size-guard 501KB/ },
  { label: 'session-size critical case', pattern: /WARN: session-size-guard 1001KB/ },
  { label: 'git branch protected case', pattern: /BLOCK: git-branch-guard main commit/ },
  { label: 'git branch feature case', pattern: /ALLOW: git-branch-guard feature commit/ },
  { label: 'coverage low case', pattern: /BLOCK: coverage-gate 50 percent/ },
  { label: 'coverage high case', pattern: /ALLOW: coverage-gate 90 percent/ },
];

function defaultTarget() {
  return path.join(os.homedir(), '.claude', 'hooks', 'test-hooks-behavior.js');
}

function evaluateBehaviorSuite(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return {
      path: targetPath,
      success: false,
      missing: ['file missing'],
    };
  }

  const content = fs.readFileSync(targetPath, 'utf8').replace(/^\uFEFF/, '');
  const missing = REQUIRED_PATTERNS
    .filter((requirement) => !requirement.pattern.test(content))
    .map((requirement) => requirement.label);

  return {
    path: targetPath,
    success: missing.length === 0,
    missing,
  };
}

function run(paths) {
  const targets = paths.length > 0 ? paths : [defaultTarget()];
  const results = targets.map((targetPath) => evaluateBehaviorSuite(path.resolve(targetPath)));
  const failed = results.filter((result) => !result.success);
  return {
    success: failed.length === 0,
    checked: results.length,
    failed,
  };
}

function formatText(result) {
  if (result.success) {
    return [`OK: hook behavior meta-tests`, `checked: ${result.checked}`].join('\n');
  }

  const failures = result.failed
    .map((failure) => `${failure.path}: ${failure.missing.join('; ')}`)
    .join('\n');
  return ['FAIL: hook behavior meta-tests', `checked: ${result.checked}`, 'success: false', failures].join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const paths = args.filter((arg) => arg !== '--json');
  const result = run(paths);
  process.stdout.write(`${json ? JSON.stringify(result, null, 2) : formatText(result)}\n`);
  process.exitCode = result.success ? 0 : 1;
}

module.exports = {
  evaluateBehaviorSuite,
  run,
};
