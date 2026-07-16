const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleInput, readCoverage, shouldCheckCommand } = require('./coverage-gate');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-gate-'));

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function decisionFor(cwd, command = 'git commit -m "test: coverage"') {
  const output = handleInput({
    tool_name: 'Bash',
    tool_input: { command },
    cwd,
  });
  return output ? JSON.parse(output).hookSpecificOutput : null;
}

try {
  assert.strictEqual(shouldCheckCommand('git status'), false);
  assert.strictEqual(shouldCheckCommand('git commit -m "x"'), true);
  assert.strictEqual(shouldCheckCommand('git commit --amend'), false);

  const jsonPass = path.join(tempRoot, 'json-pass');
  writeFile(
    path.join(jsonPass, 'coverage', 'coverage-summary.json'),
    JSON.stringify({ total: { lines: { pct: 82.1 } } })
  );
  assert.deepStrictEqual(readCoverage(jsonPass), { source: 'coverage-summary.json', pct: 82.1 });
  assert.strictEqual(decisionFor(jsonPass), null);

  const jsonFail = path.join(tempRoot, 'json-fail');
  writeFile(
    path.join(jsonFail, 'coverage', 'coverage-summary.json'),
    JSON.stringify({ total: { lines: { pct: 79.9 } } })
  );
  const failDecision = decisionFor(jsonFail);
  assert.strictEqual(failDecision.permissionDecision, 'deny');
  assert.ok(failDecision.permissionDecisionReason.includes('79.9%'));
  assert.ok(failDecision.permissionDecisionReason.includes('80%'));
  assert.strictEqual(
    handleInput({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: jsonFail }, { threshold: 0 }),
    ''
  );

  const jsonBomFail = path.join(tempRoot, 'json-bom-fail');
  writeFile(
    path.join(jsonBomFail, 'coverage', 'coverage-summary.json'),
    `\uFEFF${JSON.stringify({ total: { lines: { pct: 70 } } })}`
  );
  assert.strictEqual(decisionFor(jsonBomFail).permissionDecision, 'deny');

  const lcovPass = path.join(tempRoot, 'lcov-pass');
  writeFile(path.join(lcovPass, 'coverage', 'lcov.info'), ['TN:', 'LF:10', 'LH:8', 'end_of_record', ''].join('\n'));
  assert.deepStrictEqual(readCoverage(lcovPass), { source: 'lcov.info', pct: 80 });
  assert.strictEqual(decisionFor(lcovPass), null);

  const lcovFail = path.join(tempRoot, 'lcov-fail');
  writeFile(path.join(lcovFail, 'coverage', 'lcov.info'), ['TN:', 'LF:10', 'LH:7', 'end_of_record', ''].join('\n'));
  assert.strictEqual(decisionFor(lcovFail).permissionDecision, 'deny');

  const missingCoverage = path.join(tempRoot, 'missing');
  fs.mkdirSync(missingCoverage);
  assert.strictEqual(readCoverage(missingCoverage), null);
  assert.strictEqual(decisionFor(missingCoverage), null);

  process.stdout.write('coverage-gate.test.js PASS\n');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
