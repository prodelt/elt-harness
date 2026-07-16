const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleInput } = require('./context7-tracker');

const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx7-tracker-cache-'));
try {
  const command = 'ctx7 docs /vercel/next.js "app router"';
  const firstPre = handleInput({ tool_name: 'Bash', tool_input: { command } }, { cacheRoot });
  assert.strictEqual(firstPre, '');

  const post = handleInput({
      tool_name: 'Bash',
      tool_input: { command },
      tool_response: { stdout: 'network docs response' },
    },
    { cacheRoot }
  );
  assert.strictEqual(post, '');

  const secondPre = handleInput({ tool_name: 'Bash', tool_input: { command } }, { cacheRoot });
  assert.ok(secondPre.includes('CTX7 CACHE HIT'));
  assert.ok(secondPre.includes('permissionDecision'));

  const accessLog = path.join(cacheRoot, 'access.log');
  assert.ok(fs.readFileSync(accessLog, 'utf8').includes('cache hit'));

  process.stdout.write('context7-tracker-cache.test.js PASS\n');
} finally {
  fs.rmSync(cacheRoot, { recursive: true, force: true });
}
