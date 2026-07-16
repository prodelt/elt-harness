const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cache = require('./lib/ctx7-cache');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx7-cache-test-'));

try {
  const command = 'MSYS_NO_PATHCONV=1 ctx7 docs /vercel/next.js "app router"';
  assert.strictEqual(cache.isCtx7Command(command), true);
  assert.strictEqual(cache.isCtx7Command('npm test'), false);

  const miss = cache.readEntry(command, { root });
  assert.strictEqual(miss.hit, false);

  const written = cache.writeEntry(command, 'docs output', { root });
  assert.ok(fs.existsSync(written.path));

  const hit = cache.readEntry(command, { root });
  assert.strictEqual(hit.hit, true);
  assert.strictEqual(hit.entry.preview, 'docs output');

  const expiredHit = cache.readEntry(command, { root, ttlMs: 1 });
  assert.strictEqual(expiredHit.hit, false);

  cache.appendAccess(root, { event: 'cache hit', command, hash: written.hash });
  const accessLog = path.join(root, 'access.log');
  assert.ok(fs.readFileSync(accessLog, 'utf8').includes('cache hit'));

  process.stdout.write('ctx7-cache.test.js PASS\n');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
