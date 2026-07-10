'use strict';
// Тесты executor'а на фейк-CLI-стабах. Стабы — node-скрипты (кросс-платформенно и без
// .cmd-shell-escaping); FLEET_BIN_<P> подменяет бинарник на `node <stub>`. Проверяем
// контракт T002: exit-passthrough, empty-stdout=fail, nonzero, timeout, лог, stdin, unknown.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, resolveBin, claudeExe, needsShell } = require('./providers');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-prov-'));
const stub = (name, body) => { const p = path.join(TMP, name); fs.writeFileSync(p, body); return p; };

const STUBS = {
  echo: stub('echo.js', "console.log('line-1');console.log('hello world');process.exit(0);"),
  empty: stub('empty.js', 'process.exit(0);'),
  fail: stub('fail.js', "console.log('boom');process.exit(2);"),
  hang: stub('hang.js', "setTimeout(()=>{},60000);"),
  stdin: stub('stdin.js', "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write('GOT:'+d.trim());process.exit(0);});"),
};

// Прогнать run() с провайдером, чей бинарник подменён на node-стаб.
async function withStub(stubPath, opts = {}) {
  const prev = process.env.FLEET_BIN_CLAUDE;
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stubPath]);
  try {
    return await run({ provider: 'claude', prompt: opts.prompt || 'p', cwd: TMP, timeoutMs: opts.timeoutMs || 30000 });
  } finally {
    if (prev === undefined) delete process.env.FLEET_BIN_CLAUDE; else process.env.FLEET_BIN_CLAUDE = prev;
  }
}

test('exit 0 + вывод → ok, lastMsg = последняя непустая строка', async () => {
  const r = await withStub(STUBS.echo);
  assert.equal(r.ok, true);
  assert.equal(r.exit, 0);
  assert.equal(r.lastMsg, 'hello world');
});

test('пустой stdout при exit 0 = fail (empty-stdout)', async () => {
  const r = await withStub(STUBS.empty);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty-stdout');
  assert.equal(r.exit, 0);
});

test('ненулевой exit → ok:false, exit прокинут', async () => {
  const r = await withStub(STUBS.fail);
  assert.equal(r.ok, false);
  assert.equal(r.exit, 2);
  assert.equal(r.reason, 'nonzero-exit');
});

test('hard-таймаут убивает зависший процесс → reason timeout', async () => {
  const r = await withStub(STUBS.hang, { timeoutMs: 400 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'timeout');
  assert.equal(r.exit, null);
});

test('промпт доходит до провайдера через stdin', async () => {
  const r = await withStub(STUBS.stdin, { prompt: 'HELLO-STDIN' });
  assert.equal(r.ok, true);
  assert.match(r.lastMsg, /GOT:HELLO-STDIN/);
});

test('лог пишется и содержит вывод стаба', async () => {
  const r = await withStub(STUBS.echo);
  assert.ok(fs.existsSync(r.logPath));
  assert.match(fs.readFileSync(r.logPath, 'utf8'), /hello world/);
});

test('баг #10: claude резолвится в .exe → спавн БЕЗ shell (inline JSON schema не рвётся cmd.exe)', () => {
  const prev = process.env.FLEET_BIN_CLAUDE;
  delete process.env.FLEET_BIN_CLAUDE; // без стаб-оверрайда — реальный резолв
  try {
    const bin = resolveBin('claude');
    const exe = claudeExe();
    if (exe) {
      // claude.exe найден на этой машине → resolveBin вернул путь к нему, и needsShell=false
      assert.match(bin[0], /claude\.exe$/i, 'claude резолвится в .exe, а не в .cmd-шим');
      assert.equal(needsShell(bin[0]), false, '.exe спавнится без shell → node квотит JSON-схему сам');
    } else {
      // claude.exe не найден (напр. CI без установленного claude) → fallback на голое имя
      assert.deepEqual(bin, ['claude']);
    }
  } finally {
    if (prev !== undefined) process.env.FLEET_BIN_CLAUDE = prev;
  }
});

test('неизвестный провайдер → reason unknown-provider, без спавна', async () => {
  const r = await run({ provider: 'nope', prompt: 'x', cwd: TMP });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unknown-provider');
  assert.equal(r.logPath, null);
});
