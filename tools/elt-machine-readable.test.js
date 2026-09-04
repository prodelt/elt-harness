'use strict';
// 024 T009 — отказ читается машиной.
//
// Харнес заявлен ядром в том числе для агентов на автоматических серверах. У такого агента
// нет ни человека, который прочитает подсказку, ни возможности посмотреть лог руками: есть
// код выхода и stdout. До этой спеки оба канала молчали о причине.
//
//  * код 4 стоял на 44 отказах из 55 сразу — «задача не найдена», «спека не подписана»,
//    «пруф протух» и «судья мёртв» приезжали одним числом, и ветвиться было не по чему;
//  * `--json` был у 9 команд из 26 и отсутствовал ровно у `commit`, `gate` и `judge run` —
//    тех трёх, вокруг которых крутится автоматика;
//  * `verdict: dead` печатался без причины и без пути к логу, хотя оба поля доезжали до
//    `elt.js` (живой случай: провайдер под root отвечал `--dangerously-skip-permissions
//    cannot be used with root/sudo privileges`, и строка не показывалась никогда).
//
// Переномеровывать 44 места нельзя — драйверы сверяются с `=== 4`. Различителем стал slug.

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];
after(() => { for (const r of roots) { try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } } });

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function run(root, args, env = {}) {
  return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
}
function lastJson(stdout) {
  const line = String(stdout).trim().split('\n').filter(Boolean).pop();
  try { return JSON.parse(line); } catch { return null; }
}
function fixture({ specApproval = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-machine-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL,
    branchPolicy: 'feature', specApproval, judge: { enabled: true, model: 'codex' },
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** fixture\n');
  // spec.md обязателен: без него каталог не считается спекой и гейт подписи не включается.
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'spec.md'), '# fixture\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  git(root, ['checkout', '-qb', 'work']);
  fs.writeFileSync(path.join(root, 'slice.txt'), 'change\n');
  return root;
}

test('024 T009: отказ печатает машинную причину, а не только текст', () => {
  const root = fixture();
  const r = run(root, ['judge', 'run', '--task', 'T404', '--json']);
  assert.notEqual(r.status, 0);
  const env = lastJson(r.stdout);
  assert.ok(env, `ожидалась строка JSON, получено: ${JSON.stringify(r.stdout)}`);
  assert.equal(env.ok, false);
  assert.equal(env.reason, 'task-not-found', JSON.stringify(env));
  assert.equal(env.code, 4);
  assert.match(env.message, /T404/);
});

test('024 T009: разные отказы под одним кодом 4 различимы по slug', () => {
  const root = fixture({ specApproval: true });
  // «спека не подписана» и «задача не найдена» — оба exit 4. Именно эту пару автоматика и
  // не могла развести: одно требует подписи, другое — правки плана.
  const unapproved = run(root, ['slice', 'next', '--json']);
  const notFound = run(root, ['judge', 'run', '--task', 'T404', '--json']);
  assert.equal(unapproved.status, 4, unapproved.stderr);
  assert.equal(notFound.status, 4, notFound.stderr);
  assert.equal(lastJson(unapproved.stdout).reason, 'spec-unapproved');
  assert.equal(lastJson(notFound.stdout).reason, 'task-not-found');
});

test('024 T009: ELT_JSON=1 — тот же конверт без флага (границы процесса)', () => {
  // Флаг долетает не всегда: `harness.json.oracle` и хуки зовут CLI строкой команды, куда
  // argv не дописать. Переменная окружения — тот же приём, что уже есть у ELT_ORACLE_FULL.
  const root = fixture();
  const r = run(root, ['judge', 'run', '--task', 'T404'], { ELT_JSON: '1' });
  assert.equal(lastJson(r.stdout).reason, 'task-not-found');
});

test('024 T009: успех gate тоже читается машиной', () => {
  const root = fixture();
  fs.rmSync(path.join(root, 'slice.txt'));
  const r = run(root, ['gate', '--json']);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const env = lastJson(r.stdout);
  assert.equal(env.ok, true);
  assert.equal(env.reason, 'gate-nothing-to-check');
});

test('024 T009: без --json вывод не изменился ни на байт', () => {
  // Существующие драйверы читают прозу. Конверт обязан быть ДОБАВКОЙ, а не заменой.
  const root = fixture();
  const r = run(root, ['judge', 'run', '--task', 'T404']);
  assert.equal(r.stdout, '', 'без флага на stdout не должно быть ничего');
  assert.match(r.stderr, /^elt: elt judge run: задача T404 не найдена/);
  assert.equal(r.status, 4);
});

test('024 T009: судья-мертвец называет причину и путь к логу', () => {
  // Мост судьи подменяется на такой, что честно рапортует отказ провайдера — ровно ту форму,
  // которую отдаёт judge-invoke.js при `runOk: false`.
  const root = fixture();
  const logPath = path.join(root, '.harness', 'fleet', 'logs', 'fake-provider.log');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, '--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons\n');
  const bridge = path.join(root, 'tools', 'judge-invoke.js');
  fs.mkdirSync(path.dirname(bridge), { recursive: true });
  fs.writeFileSync(bridge, `'use strict';\nprocess.stdout.write(JSON.stringify({\n  runOk: false, verdict: null, reasons: ['судья не отработал: nonzero-exit'],\n  failReason: 'nonzero-exit', judgeLog: ${JSON.stringify(logPath)},\n  judges: [], grounding: null, redProof: null, l0: null,\n}));\n`);

  // Оракул прогоняется первым: без его пруфа `judge run` падает раньше, на записи proof,
  // и проверялся бы не тот путь.
  assert.equal(run(root, ['oracle']).status, 0);
  const r = run(root, ['judge', 'run', '--task', 'T001']);
  assert.equal(r.status, 4, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /судья не отработал — nonzero-exit/, r.stderr);
  assert.match(r.stderr, /лог провайдера/, r.stderr);
  // Главное: строка настоящей причины оказывается на экране, а не только в файле.
  assert.match(r.stderr, /dangerously-skip-permissions/, r.stderr);
});
