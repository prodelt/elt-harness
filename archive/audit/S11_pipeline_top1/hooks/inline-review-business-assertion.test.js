const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { analyzeAssertions, handleInput } = require('./inline-review-gate');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-review-assertion-'));

function inputFor(filePath, content) {
  return {
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
    cwd: tempRoot,
  };
}

function parseOutput(output) {
  return output ? JSON.parse(output).hookSpecificOutput : null;
}

try {
  const shallow = [
    'test("returns invoice", () => {',
    '  const invoice = calculateInvoice();',
    '  expect(invoice).toBeDefined();',
    '  expect(invoice.total).toBeTruthy();',
    '});',
    '',
  ].join('\n');

  const concrete = [
    'test("applies discount", () => {',
    '  const invoice = calculateInvoice();',
    '  expect(invoice.total).toBe(90);',
    '  expect(invoice.discountAmount).toBe(10);',
    '});',
    '',
  ].join('\n');

  assert.deepStrictEqual(analyzeAssertions(shallow), {
    assertionCount: 2,
    shallowCount: 2,
    onlyShallow: true,
  });
  assert.deepStrictEqual(analyzeAssertions('expect(calculateInvoice()).toBeDefined();'), {
    assertionCount: 1,
    shallowCount: 1,
    onlyShallow: true,
  });
  assert.strictEqual(analyzeAssertions(concrete).onlyShallow, false);

  const warning = parseOutput(handleInput(inputFor('invoice.test.js', shallow), { stateRoot: tempRoot }));
  assert.ok(warning.additionalContext.includes('business assertion'));
  assert.ok(warning.additionalContext.includes('.toBe(<concrete>)'));

  const allowed = handleInput(inputFor('invoice.test.js', concrete), { stateRoot: tempRoot });
  assert.strictEqual(allowed, '');

  const nonTest = handleInput(inputFor('invoice.js', shallow), { stateRoot: tempRoot });
  assert.strictEqual(nonTest, '');

  process.stdout.write('inline-review-business-assertion.test.js PASS\n');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
