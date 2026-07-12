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
  argv: stub('argv.js', "console.log(JSON.stringify(process.argv.slice(2)));process.exit(0);"),
};

// Прогнать run() со стаб-бинарником для произвольного провайдера, вернуть переданный argv.
async function spawnArgs(provider, opts = {}) {
  const envKey = 'FLEET_BIN_' + provider.toUpperCase();
  const prev = process.env[envKey];
  process.env[envKey] = JSON.stringify(['node', STUBS.argv]);
  try {
    const r = await run({ provider, prompt: opts.prompt || 'p', cwd: TMP, timeoutMs: 30000, ...opts });
    return { r, argv: JSON.parse(r.lastMsg) };
  } finally {
    if (prev === undefined) delete process.env[envKey]; else process.env[envKey] = prev;
  }
}

// Прогнать run() с провайдером, чей бинарник подменён на node-стаб.
async function withStub(stubPath, opts = {}) {
  const prev = process.env.FLEET_BIN_CLAUDE;
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stubPath]);
  try {
    return await run({ provider: 'claude', prompt: opts.prompt || 'p', cwd: TMP, timeoutMs: opts.timeoutMs || 30000, stopFile: opts.stopFile, stopPollMs: opts.stopPollMs });
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

// T027 (дефект 3): STOP-файл убивает child значительно быстрее hard-таймаута — раньше
// in-flight spawn переживал STOP до собственного 5-минутного timeoutMs (проверялся только
// МЕЖДУ батчами fleet.js). Стаб пишет свой pid в файл и спит 60с — если бы kill не сработал,
// тест упёрся бы в timeoutMs=30000 (видно по времени, но здесь и так есть верхний assert).
test('T027: STOP-файл убивает in-flight child ≤неск.секунд (не ждёт timeoutMs), процесс реально мёртв', async () => {
  const pidFile = path.join(TMP, 'stop-pid.txt');
  const stopFile = path.join(TMP, 'STOP');
  try { fs.unlinkSync(stopFile); } catch { /* нет файла */ }
  const hangPid = stub('hang-pid.js', `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setTimeout(()=>{}, 60000);`);

  const runPromise = withStub(hangPid, { timeoutMs: 60000, stopFile, stopPollMs: 150 });
  // дать стабу время стартовать и записать pid, затем «нажать» STOP
  await new Promise((r) => setTimeout(r, 300));
  fs.writeFileSync(stopFile, '');

  const started = Date.now();
  const r = await runPromise;
  const elapsedMs = Date.now() - started;

  assert.equal(r.ok, false);
  assert.equal(r.reason, 'stopped');
  assert.ok(elapsedMs < 10000, `убит за ${elapsedMs}мс, ожидалось <10000мс (не ждёт timeoutMs=60000)`);

  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  const alive = (() => { try { process.kill(pid, 0); return true; } catch { return false; } })();
  assert.equal(alive, false, 'child реально завершён, не просто "потерян" оркестратором');
  fs.unlinkSync(stopFile);
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

// --- T019: явная модель + lean-профиль на каждом spawn ---
test('T019: model не передан → argv несёт --model <router-дефолт> (не molчаливый ambient)', async () => {
  const { argv } = await spawnArgs('claude');
  assert.match(argv.join(' '), /--model sonnet\b/);
});

test('T019: явный model из caller побеждает router-дефолт', async () => {
  const { argv } = await spawnArgs('claude', { model: 'opus' });
  assert.match(argv.join(' '), /--model opus\b/);
});

test('T019: codex тоже получает явный --model (router-дефолт)', async () => {
  const { argv } = await spawnArgs('codex');
  assert.match(argv.join(' '), /--model gpt-5\.6-sol\b/);
});

test('T019: lean-профиль включён по умолчанию — claude получает --safe-mode, codex --ignore-user-config', async () => {
  const claude = await spawnArgs('claude');
  assert.ok(claude.argv.includes('--safe-mode'));
  const codex = await spawnArgs('codex');
  assert.ok(codex.argv.includes('--ignore-user-config'));
});

test('T019: FLEET_LEAN=0 — явный откат lean-профиля', async () => {
  process.env.FLEET_LEAN = '0';
  try {
    const { argv } = await spawnArgs('claude');
    assert.ok(!argv.includes('--safe-mode'));
  } finally {
    delete process.env.FLEET_LEAN;
  }
});

test('T019: явный lean:false в опциях побеждает даже без env', async () => {
  const { argv } = await spawnArgs('claude', { lean: false });
  assert.ok(!argv.includes('--safe-mode'));
});

// --- T003 (004-elt-selfdrive): адаптивный эффорт ---
test('T003: effort → argv несёт --effort <level> (claude); без effort флага нет', async () => {
  const withEffort = await spawnArgs('claude', { effort: 'max' });
  assert.match(withEffort.argv.join(' '), /--effort max\b/, 'effort:max → --effort max в argv');
  const without = await spawnArgs('claude');
  assert.ok(!without.argv.includes('--effort'), 'без effort — флага нет (обратная совместимость)');
});

test('T003: --effort только для claude — codex/agy своего флага не получают', async () => {
  const codex = await spawnArgs('codex', { effort: 'max' });
  assert.ok(!codex.argv.includes('--effort'), 'codex не поддерживает --effort → не прокидываем');
});

// --- T007 (004-elt-selfdrive): session-rotation (elt-drive.ps1) ---
test('T007: sessionId → argv несёт --session-id <id> (claude); без sessionId флага нет', async () => {
  const withId = await spawnArgs('claude', { sessionId: 'abc-123' });
  assert.match(withId.argv.join(' '), /--session-id abc-123\b/);
  const without = await spawnArgs('claude');
  assert.ok(!without.argv.includes('--session-id'), 'без sessionId — флага нет');
});

test('T007: resume+sessionId → argv несёт -r <id> вместо --session-id', async () => {
  const r = await spawnArgs('claude', { sessionId: 'abc-123', resume: true });
  assert.ok(r.argv.includes('-r'), 'resume:true → -r флаг');
  assert.ok(r.argv.includes('abc-123'), 'id идёт значением');
  assert.ok(!r.argv.includes('--session-id'), 'resume вытесняет --session-id');
});

test('T007: sessionId только для claude — codex/agy своего флага не получают', async () => {
  const codex = await spawnArgs('codex', { sessionId: 'abc-123' });
  assert.ok(!codex.argv.includes('--session-id') && !codex.argv.includes('-r'), 'codex не поддерживает session-id/resume');
});

test('неизвестный провайдер → reason unknown-provider, без спавна', async () => {
  const r = await run({ provider: 'nope', prompt: 'x', cwd: TMP });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unknown-provider');
  assert.equal(r.logPath, null);
});
