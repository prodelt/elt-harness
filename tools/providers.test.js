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

// 009 T010 развернул дефолт: lean снимал с воркера проектную дисциплину (CLAUDE.md/скилы/хуки),
// а не только токен-налог. Профиль остался, включается явно.
test('T010: lean-профиль ВЫКЛЮЧЕН по умолчанию — воркер видит проектный профиль', async () => {
  const claude = await spawnArgs('claude');
  assert.ok(!claude.argv.includes('--safe-mode'));
  const codex = await spawnArgs('codex');
  assert.ok(!codex.argv.includes('--ignore-user-config'));
});

test('T010: FLEET_LEAN=1 — явное включение lean-профиля (claude --safe-mode, codex --ignore-user-config)', async () => {
  process.env.FLEET_LEAN = '1';
  try {
    const claude = await spawnArgs('claude');
    assert.ok(claude.argv.includes('--safe-mode'));
    const codex = await spawnArgs('codex');
    assert.ok(codex.argv.includes('--ignore-user-config'));
  } finally {
    delete process.env.FLEET_LEAN;
  }
});

test('T019: явный lean:true в опциях побеждает даже без env', async () => {
  const { argv } = await spawnArgs('claude', { lean: true });
  assert.ok(argv.includes('--safe-mode'));
});

test('T019: явный lean:false в опциях побеждает даже при FLEET_LEAN=1', async () => {
  process.env.FLEET_LEAN = '1';
  try {
    const { argv } = await spawnArgs('claude', { lean: false });
    assert.ok(!argv.includes('--safe-mode'));
  } finally {
    delete process.env.FLEET_LEAN;
  }
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

// --- Живой прогон 007 (2026-07-22): у agy свой --print-timeout был литералом '5m', наш
// timeoutMs — независимой константой. Воркер дописал [M]-слайс за 2.5 мин, но agy сдался
// по собственному лимиту и вернул «Error: timeout waiting for response» — готовая работа
// выброшена. Лимит должен быть ОДИН: сколько дал caller, столько и agy. ---
test('agy: --print-timeout производен от timeoutMs, а не литерал 5m', async () => {
  const long = await spawnArgs('agy', { timeoutMs: 20 * 60 * 1000 });
  const i = long.argv.indexOf('--print-timeout');
  assert.ok(i >= 0, 'флаг на месте');
  assert.equal(long.argv[i + 1], '20m', 'наш лимит 20 мин → agy получает 20m');
  const short = await spawnArgs('agy', { timeoutMs: 3 * 60 * 1000 });
  assert.equal(short.argv[short.argv.indexOf('--print-timeout') + 1], '3m', 'лимит меняется вместе с timeoutMs');
});

// --- 011 T028 (waggle): промпт agy — файлом, не argv. Живой дефект: диф на DIFF_CAP 60K
// упирался в лимит длины командной строки Windows раньше, чем в сам DIFF_CAP —
// `spawn ENAMETOOLONG`. Проверяем, что argv остаётся коротким НЕЗАВИСИМО от размера промпта
// (класс ошибки снят, а не подловлен порогом) и что файл реально несёт полный текст. ---
test('T028: agy — argv короткий на промпте >200K, файл несёт полный текст', async () => {
  const huge = 'ДИФФ '.repeat(50000); // > 200K символов
  assert.ok(huge.length > 200000, 'фикстура правда огромная');
  const { r, argv } = await spawnArgs('agy', { prompt: huge });
  assert.equal(r.ok, true, 'спавн не падает на огромном промпте');
  const totalArgvLen = argv.join(' ').length;
  assert.ok(totalArgvLen < 2000, `argv обязан быть коротким независимо от промпта (был ${totalArgvLen})`);
  const pIdx = argv.indexOf('-p');
  assert.ok(pIdx >= 0 && !argv[pIdx + 1].includes(huge), '-p несёт ссылку на файл, не сам промпт');
  const m = argv[pIdx + 1].match(/файле (\S+\.txt)/);
  assert.ok(m, '-p называет путь к файлу');
  assert.equal(fs.readFileSync(m[1], 'utf8'), huge, 'файл несёт ПОЛНЫЙ промпт байт в байт');
  assert.ok(m[1].startsWith(path.join(TMP, '.harness', 'fleet', 'prompts')), 'файл лежит там, куда уже смотрит --add-dir cwd');
});

// --- T014 (011): живой дефект найден при приёмке в чужом проекте. `.harness/fleet/` живёт
// внутри дерева, и БЕЗ .gitignore/`.git/info/exclude` в целевом проекте (этот репо его
// гитигнорит, остальные — нет) судья реально ВИДЕЛ prompt-файл agy как «файл диффа»
// (git status его ловит как untracked) и вписывал рантайм-артефакт гейта в grounding. ---
test('T014: agy сам регистрирует .harness/fleet/ в .git/info/exclude — git status его не видит', async () => {
  const { execFileSync } = require('node:child_process');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-prov-gitrepo-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const prev = process.env.FLEET_BIN_AGY;
  process.env.FLEET_BIN_AGY = JSON.stringify(['node', STUBS.argv]);
  try {
    const r = await run({ provider: 'agy', prompt: 'дифф судье', cwd: repo, timeoutMs: 30000 });
    assert.equal(r.ok, true, r.reason);
  } finally {
    if (prev === undefined) delete process.env.FLEET_BIN_AGY; else process.env.FLEET_BIN_AGY = prev;
  }
  const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
  assert.match(exclude, /^\.harness\/fleet\/$/m, '.git/info/exclude несёт строку без ручной правки .gitignore проекта');
  const status = execFileSync('git', ['status', '--porcelain', '-uall'], { cwd: repo, encoding: 'utf8' });
  assert.doesNotMatch(status, /\.harness[\\/]fleet/, 'git status НЕ видит prompt-файл — судья не получит его как «файл диффа»');
});

test('T028: два вызова agy подряд не перетирают файл друг друга (уникальные имена)', async () => {
  const a = await spawnArgs('agy', { prompt: 'первый' });
  const b = await spawnArgs('agy', { prompt: 'второй' });
  const fileOf = (argv) => argv[argv.indexOf('-p') + 1].match(/файле (\S+\.txt)/)[1];
  const fa = fileOf(a.argv); const fb = fileOf(b.argv);
  assert.notEqual(fa, fb);
  assert.equal(fs.readFileSync(fa, 'utf8'), 'первый');
  assert.equal(fs.readFileSync(fb, 'utf8'), 'второй');
});

// --- T007 (004-elt-selfdrive): session-rotation (session-rotation драйвер (снят 019/T007)) ---
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

test('009 T010: судья спавнится read-only, воркер — с правом записи', () => {
  // Живой разбор: судья-codex с workspace-write уходил гонять оракул внутри судейского вызова
  // (лог 567KB, DEAD 5/5). Роль судьи ограничена структурно, а не просьбой в промпте.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-ro-'));
  const argvStub = path.join(dir, 'argv.js');
  fs.writeFileSync(argvStub, 'console.log(JSON.stringify(process.argv.slice(2)));');
  process.env.FLEET_BIN_CODEX = JSON.stringify(['node', argvStub]);
  const judge = run({ provider: 'codex', prompt: 'x', cwd: dir, readOnly: true });
  const worker = run({ provider: 'codex', prompt: 'x', cwd: dir });
  return Promise.all([judge, worker]).then(([j, w]) => {
    delete process.env.FLEET_BIN_CODEX;
    const jargv = JSON.parse(j.stdout.trim().split('\n').pop());
    const wargv = JSON.parse(w.stdout.trim().split('\n').pop());
    assert.ok(jargv.includes('read-only'), 'судья не может писать в дерево: ' + JSON.stringify(jargv));
    assert.ok(!jargv.includes('workspace-write'));
    assert.ok(wargv.includes('workspace-write'), 'воркеру запись по-прежнему нужна');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
