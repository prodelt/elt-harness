'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const specPath = path.join(root, 'spec.md');
const manifestPath = path.join(root, 'implementation-packet.lock.json');

function canonicalBytes(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (path.extname(filePath).toLowerCase() === '.png') return bytes;
  return Buffer.from(bytes.toString('utf8').replace(/\r\n?/g, '\n').normalize('NFC'), 'utf8');
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(canonicalBytes(filePath)).digest('hex').toUpperCase();
}

function fail(message) {
  console.error('verify-packet: ' + message);
  process.exit(1);
}

if (!fs.existsSync(specPath)) fail('spec.md is missing');
if (!fs.existsSync(manifestPath)) fail('implementation-packet.lock.json is missing');

const spec = fs.readFileSync(specPath, 'utf8');
const expectedManifest = spec.match(/Implementation-Packet-SHA256:\s*`?([A-Fa-f0-9]{64})`?/);
if (!expectedManifest) fail('spec.md does not bind Implementation-Packet-SHA256');

const actualManifest = sha256(manifestPath);
if (actualManifest !== expectedManifest[1].toUpperCase()) {
  fail('manifest hash mismatch: expected ' + expectedManifest[1] + ', got ' + actualManifest);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.schemaVersion !== 1 || manifest.algorithm !== 'SHA-256-canonical-text-v1' ||
    !Array.isArray(manifest.files)) fail('unsupported manifest schema');

for (const entry of manifest.files) {
  if (!entry || typeof entry.path !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(entry.sha256 || '')) {
    fail('malformed file entry');
  }
  if (path.isAbsolute(entry.path) || entry.path.split(/[\\/]+/).includes('..')) {
    fail('unsafe relative path: ' + entry.path);
  }
  const resolved = path.resolve(root, entry.path);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) fail('path escapes packet: ' + entry.path);
  if (!fs.existsSync(resolved)) fail('missing file: ' + entry.path);
  const actual = sha256(resolved);
  if (actual !== entry.sha256.toUpperCase()) {
    fail('hash mismatch for ' + entry.path + ': expected ' + entry.sha256 + ', got ' + actual);
  }
}

console.log(JSON.stringify({
  status: 'pass',
  manifestSha256: actualManifest,
  files: manifest.files.length,
}, null, 2));
