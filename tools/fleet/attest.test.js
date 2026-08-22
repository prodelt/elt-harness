'use strict';
// 009 T009 — worker-attestation: заявка воркера против реального диффа worktree.
// Четыре отказа + честная заявка (юнит, настоящий git-репо), плюс проводка во fleet:
// отклонённый слайс НЕ доходит до судьи, попадает в ledger и перевыдаётся дальше.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const attest = require('./attest');
const fleet = require('./fleet');

let REPO;
const git = (args, cwd = REPO) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const claimOf = (files, tests = []) =>
  `сделал работу\n{"filesChanged":${JSON.stringify(files)},"testsAdded":${JSON.stringify(tests)}}\n`;

before(() => {
  REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-'));
  git(['init', '-q', '-b', 'main']); git(['config', 'user.email', 't@t']); git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(REPO, 'base.txt'), 'base\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'base']);
});
after(() => { try { fs.rmSync(REPO, { recursive: true, force: true }); } catch { /* noop */ } });

test('честная заявка = дифф → ok', () => {
  const r = attest.attest({ stdout: claimOf(['src/a.js', 'src/a.test.js'], ['src/a.test.js']), cwd: REPO, changed: ['src/a.js', 'src/a.test.js'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.claim.filesChanged, ['src/a.js', 'src/a.test.js']);
});

test('нет JSON вовсе → no-attestation', () => {
  const r = attest.attest({ stdout: 'я всё сделал, честно', cwd: REPO, changed: ['src/a.js'] });
  assert.equal(r.code, 'no-attestation');
});

test('заявка есть, дифф пуст → phantom-work', () => {
  const r = attest.attest({ stdout: claimOf(['src/a.js']), cwd: REPO, changed: [] });
  assert.equal(r.code, 'phantom-work');
  assert.deepEqual(r.detail, ['src/a.js']);
});

test('заявленный файл не менялся → hallucinated-file', () => {
  const r = attest.attest({ stdout: claimOf(['src/a.js', 'src/ghost.js']), cwd: REPO, changed: ['src/a.js'] });
  assert.equal(r.code, 'hallucinated-file');
  assert.deepEqual(r.detail, ['src/ghost.js']);
});

test('изменённый файл не заявлен → undeclared-file', () => {
  const r = attest.attest({ stdout: claimOf(['src/a.js']), cwd: REPO, changed: ['src/a.js', 'tools/elt.js'] });
  assert.equal(r.code, 'undeclared-file');
  assert.deepEqual(r.detail, ['tools/elt.js']);
});

// Живой прогон izi-tracker 2026-08-15: 19 отказов из 20 подряд, и каждый раз undeclared-file
// был РОВНО новым тестом из `testsAdded` — слайс с новым тестом был непроходим в принципе.
test('новый тест в testsAdded не считается незаявленным', () => {
  const r = attest.attest({ stdout: claimOf(['src/a.js'], ['src/a.test.js']), cwd: REPO, changed: ['src/a.js', 'src/a.test.js'] });
  assert.ok(r.ok, `честная заявка отвергнута: ${r.code} ${JSON.stringify(r.detail)}`);
});

test('заявленный тест-файл без реального диффа тоже галлюцинация', () => {
  const r = attest.attest({ stdout: claimOf(['src/a.js'], ['src/a.test.js']), cwd: REPO, changed: ['src/a.js'] });
  assert.equal(r.code, 'hallucinated-file');
  assert.deepEqual(r.detail, ['src/a.test.js']);
});

test('changedFiles видит и правки, и новые файлы, и нормализует разделители', () => {
  fs.writeFileSync(path.join(REPO, 'base.txt'), 'changed\n');
  fs.mkdirSync(path.join(REPO, 'src'), { recursive: true });
  fs.writeFileSync(path.join(REPO, 'src', 'new.js'), '1\n');
  const files = attest.changedFiles(REPO);
  assert.deepEqual(files.sort(), ['base.txt', 'src/new.js']);
  // заявка того же воркера с windows-путями сверяется без ложного расхождения
  assert.equal(attest.attest({ stdout: claimOf(['base.txt', 'src\\new.js']), cwd: REPO }).ok, true);
  git(['checkout', '--', 'base.txt']); fs.rmSync(path.join(REPO, 'src'), { recursive: true, force: true });
});

test('путь с кириллицей: честная заявка не режется git-экранированием', () => {
  const name = 'тесты/новый файл.js';
  fs.mkdirSync(path.join(REPO, 'тесты'), { recursive: true });
  fs.writeFileSync(path.join(REPO, name), '1\n');
  try {
    assert.deepEqual(attest.changedFiles(REPO), [name]);
    assert.equal(attest.attest({ stdout: claimOf([name]), cwd: REPO }).ok, true);
  } finally { fs.rmSync(path.join(REPO, 'тесты'), { recursive: true, force: true }); }
});

test('переименование: считается новый путь, старый не всплывает как undeclared', () => {
  fs.writeFileSync(path.join(REPO, 'old.txt'), 'x\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'old']);
  git(['mv', 'old.txt', 'new.txt']);
  try {
    assert.deepEqual(attest.changedFiles(REPO).sort(), ['new.txt']);
  } finally { git(['reset', '-q', '--hard', 'HEAD~1']); }
});

test('рантайм-артефакты харнесса (.harness/oracle-tail.log) не считаются работой воркера', () => {
  fs.mkdirSync(path.join(REPO, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(REPO, '.harness', 'oracle-tail.log'), 'хвост прогона\n');
  try {
    assert.deepEqual(attest.changedFiles(REPO), []);
    assert.equal(attest.attest({ stdout: claimOf([]), cwd: REPO }).ok, true);
  } finally { fs.rmSync(path.join(REPO, '.harness'), { recursive: true, force: true }); }
});

test('заявка читается многострочной и берётся последняя (эхо промпта не мешает)', () => {
  const echoed = 'ПРОМПТ: выдай {"filesChanged":["ОБРАЗЕЦ.js"],"testsAdded":[]}\n' +
    'работа сделана\n{\n  "filesChanged": ["src/a.js"],\n  "testsAdded": []\n}\n';
  const r = attest.attest({ stdout: echoed, cwd: REPO, changed: ['src/a.js'] });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('заявка обязана быть в КОНЦЕ ответа: JSON в середине транскрипта не считается', () => {
  const midway = `план: {"filesChanged":["src/a.js"],"testsAdded":[]}\n` + 'работаю\n'.repeat(30);
  assert.equal(attest.attest({ stdout: midway, cwd: REPO, changed: ['src/a.js'] }).code, 'no-attestation');
});

test('половина контракта (нет testsAdded) → no-attestation', () => {
  const r = attest.attest({ stdout: '{"filesChanged":["src/a.js"]}', cwd: REPO, changed: ['src/a.js'] });
  assert.equal(r.code, 'no-attestation');
});

// --- проводка во fleet: расхождение = слайс не идёт к судье ---

test('fleet: воркер соврал о файлах → attest-fail в ledger, судьи не было, слайс перевыдан', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-fleet-'));
  const g = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'specs', 'tasks.md'), '- [ ] **T1** пишет a [P] [files:a*]\n');
  fs.mkdirSync(path.join(repo, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash',
    branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' },
  }));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);

  // Воркер пишет a.txt, а заявляет ghost.js → hallucinated-file (плюс undeclared a.txt).
  const liar = async (slice, wtPath) => {
    fs.writeFileSync(path.join(wtPath, 'a.txt'), 'from-worker\n');
    return { exit: 0, ok: true, reason: 'ok', stdout: claimOf(['ghost.js']) };
  };
  const s = await fleet.run({ cwd: repo, tasksPath: path.join(repo, 'specs', 'tasks.md'), integration: 'main', workers: 1, worker: liar, maxAttempts: 1 });

  const events = fleet.readEvents(repo);
  const fail = events.find((e) => e.event === 'attest-fail');
  assert.ok(fail, 'нет события attest-fail');
  assert.equal(fail.code, 'hallucinated-file');
  assert.ok(!events.some((e) => e.event === 'gate-pass' || e.event === 'gate-reject'), 'слайс дошёл до судьи');
  assert.deepEqual(s.requeued, ['T1']);
  assert.deepEqual(s.merged, []);

  const ledger = fs.readFileSync(require('../run-log').runtimeRunLog(repo), 'utf8')
    .split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(ledger.some((e) => e.phase === 'attest' && e.verdict === 'hallucinated-file'), 'нет строки attest в ledger');
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* noop */ }
});

test('fleet: слайс после attest-fail перевыдаётся СЛЕДУЮЩЕМУ провайдеру цепочки и доходит до merge', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-reissue-'));
  const g = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'specs', 'tasks.md'), '- [ ] **T1** пишет a [P] [files:a*]\n');
  fs.mkdirSync(path.join(repo, '.harness', 'fleet'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash',
    branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' },
  }));
  // цепочка из двух: соврал claude → слайс обязан уйти к codex, а не к нему же
  fs.writeFileSync(path.join(repo, '.harness', 'fleet', 'fleet.json'), JSON.stringify({ default: ['claude', 'codex'] }));
  fs.writeFileSync(path.join(repo, 'a.txt'), 'base\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);

  const judgeStub = path.join(repo, 'judge-pass.js');
  fs.writeFileSync(judgeStub, "console.log('{\"verdict\":\"pass\",\"reasons\":[\"stub: в границах задачи\"]}');");
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', judgeStub]);

  const seen = [];
  const worker = async (_slice, wtPath, ctx) => {
    seen.push(ctx.provider);
    fs.writeFileSync(path.join(wtPath, 'a.txt'), `from-${ctx.provider}\n`);
    // первый провайдер врёт, второй отчитывается честно
    return { exit: 0, ok: true, stdout: seen.length === 1 ? claimOf(['ghost.js']) : claimOf(['a.txt']) };
  };
  const s = await fleet.run({ cwd: repo, tasksPath: path.join(repo, 'specs', 'tasks.md'), integration: 'main', workers: 1, worker, maxAttempts: 3, maxLoops: 3 });
  delete process.env.FLEET_BIN_CLAUDE;

  assert.deepEqual(seen, ['claude', 'codex'], 'перевыдача ушла не следующему провайдеру цепочки');
  assert.deepEqual(s.merged, ['T1'], 'честная вторая попытка не доехала до merge');
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* noop */ }
});

test('fleet: heal дописал незаявленный файл → повторная сверка ловит, судья не вызван', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-heal-'));
  const g = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'specs', 'tasks.md'), '- [ ] **T1** пишет a [P] [files:a*]\n');
  fs.mkdirSync(path.join(repo, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'), JSON.stringify({
    // оракул красный, пока в flag.txt лежит 'bad'
    kind: 'code',
    oracle: process.platform === 'win32'
      ? "if ((Get-Content flag.txt -Raw).Trim() -eq 'bad') { exit 1 }"
      : "test \"$(cat flag.txt)\" != bad",
    shell: process.platform === 'win32' ? 'powershell' : 'bash',
    branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' },
  }));
  fs.writeFileSync(path.join(repo, 'flag.txt'), 'ok\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);

  // Один стаб на обе роли claude: промпт судьи узнаётся по слову verdict. Heal-ветка
  // чинит красноту И дописывает незаявленный файл — ровно та дыра, что проверяется.
  const stub = path.join(repo, 'claude-stub.js');
  fs.writeFileSync(stub, `
const fs = require('fs'), path = require('path');
let d = ''; process.stdin.on('data', (c) => d += c); process.stdin.on('end', () => {
  if (d.includes('verdict')) {
    fs.appendFileSync(path.join(${JSON.stringify(repo)}, 'judge-calls.log'), 'called\\n');
    console.log('{"verdict":"pass","reasons":["stub"]}');
  } else {
    fs.writeFileSync('flag.txt', 'fixed\\n'); // краснота снята, файл остаётся изменённым
    fs.writeFileSync('heal-extra.txt', 'от heal, никем не заявлен\\n');
    console.log('healed');
  }
});`);
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', stub]);

  const worker = async (_slice, wtPath) => {
    fs.writeFileSync(path.join(wtPath, 'a.txt'), 'impl\n');
    fs.writeFileSync(path.join(wtPath, 'flag.txt'), 'bad\n'); // оракул красный → пойдёт heal
    return { exit: 0, ok: true, stdout: claimOf(['a.txt', 'flag.txt']) };
  };
  const s = await fleet.run({ cwd: repo, tasksPath: path.join(repo, 'specs', 'tasks.md'), integration: 'main', workers: 1, worker, maxAttempts: 1 });
  delete process.env.FLEET_BIN_CLAUDE;

  const events = fleet.readEvents(repo);
  const fail = events.find((e) => e.event === 'attest-fail' && e.afterHeal);
  assert.ok(fail, `нет повторной сверки после heal: ${JSON.stringify(events.map((e) => e.event))}`);
  assert.equal(fail.code, 'undeclared-file');
  assert.deepEqual(fail.detail, ['heal-extra.txt']);
  assert.ok(!fs.existsSync(path.join(repo, 'judge-calls.log')), 'судья вызван на неаттестованном диффе');
  assert.deepEqual(s.merged, []);
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* noop */ }
});

test('fleet: attest-fail в serial-переделе (после merge-конфликта) тоже перевыдаётся, а не хоронит слайс', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-redo-'));
  const g = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  g(['init', '-q', '-b', 'main']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
  fs.mkdirSync(path.join(repo, 'specs'), { recursive: true });
  // оба слайса пишут один файл → второй ловит merge-конфликт → redoSerial
  fs.writeFileSync(path.join(repo, 'specs', 'tasks.md'),
    '- [ ] **T1** пишет shared [P] [files:s1*]\n- [ ] **T2** пишет shared [P] [files:s2*]\n');
  fs.mkdirSync(path.join(repo, '.harness', 'fleet'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node --version', shell: process.platform === 'win32' ? 'powershell' : 'bash',
    branchPolicy: 'feature', push: false, judge: { enabled: true, model: 'sonnet' },
  }));
  fs.writeFileSync(path.join(repo, '.harness', 'fleet', 'fleet.json'), JSON.stringify({ default: ['claude', 'codex'] }));
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'base\n');
  g(['add', '-A']); g(['commit', '-q', '-m', 'base']);

  const judgeStub = path.join(repo, 'judge-pass.js');
  fs.writeFileSync(judgeStub, "console.log('{\"verdict\":\"pass\",\"reasons\":[\"stub\"]}');");
  process.env.FLEET_BIN_CLAUDE = JSON.stringify(['node', judgeStub]);
  process.env.FLEET_BIN_CODEX = JSON.stringify(['node', judgeStub]);

  const calls = [];
  const worker = async (slice, wtPath, ctx) => {
    calls.push(`${slice.id}:${ctx.provider}`);
    fs.writeFileSync(path.join(wtPath, 'shared.txt'), `from-${slice.id}-${calls.length}\n`);
    // врёт РОВНО в serial-переделе T2 (третий вызов), в остальных отчитывается честно
    const lying = slice.id === 'T2' && calls.filter((c) => c.startsWith('T2')).length === 2;
    return { exit: 0, ok: true, stdout: lying ? claimOf(['ghost.js']) : claimOf(['shared.txt']) };
  };
  const s = await fleet.run({ cwd: repo, tasksPath: path.join(repo, 'specs', 'tasks.md'), integration: 'main', workers: 2, worker, maxAttempts: 3, maxLoops: 4 });
  delete process.env.FLEET_BIN_CLAUDE; delete process.env.FLEET_BIN_CODEX;

  assert.ok(calls.includes('T2:codex'), `serial-передел не перевыдал слайс дальше по цепочке: ${calls.join(', ')}`);
  assert.ok(s.merged.includes('T2'), `T2 не доехал до merge: ${JSON.stringify(s)}`);
  assert.ok(!s.failed.includes('T2'), 'слайс похоронен как failed вместо перевыдачи');
  try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* noop */ }
});
