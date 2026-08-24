'use strict';
// 020 T008 — spec-bound runtime identity парковки.
//
// Предыстория (живьём): id задачи уникален ТОЛЬКО внутри одного плана. Открытый `T020` есть и
// в спеке 019, и в спеке 020, а `.harness/parked.json` хранил голый `tid`. Значит одна
// припаркованная «T020» навсегда прятала ЧУЖУЮ открытую задачу с тем же номером, и `slice next
// --spec specs/019-...` честно отвечал «план закрыт». Здесь проверяется ровно это: identity =
// (specPath, taskId), а legacy-строка без спеки не смеет выдавать себя за конкретный план.
//
// Файл объявлен в [files:] T008 как `tools/elt-park.test.js`; соседний `elt-parked.test.js`
// остаётся регрессом контракта 009 T004 (формат, attempts, stash, снятие коммитом).

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const ELT = path.join(__dirname, 'elt.js');
const SHELL = process.platform === 'win32' ? 'powershell' : 'bash';
const roots = [];

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function run(root, args) { return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' }); }
function parked(root) {
  const f = path.join(root, '.harness', 'parked.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
}
function writeParked(root, list) {
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'parked.json'), JSON.stringify(list, null, 2) + '\n');
}
function nextId(root, args) {
  const r = run(root, ['slice', 'next', '--json', ...args]);
  return { id: r.status === 0 ? JSON.parse(r.stdout).id : null, status: r.status, stderr: r.stderr };
}

// ДВЕ спеки с пересекающимися id — вся суть задачи. `T005` и `T020` есть в обеих, `T031` —
// только во второй: на нём проверяется, что уникальный legacy-id по-прежнему резолвится.
const SPEC_A = 'specs/019-two-a';
const SPEC_B = 'specs/020-two-b';
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-park-id-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle: 'node -e "process.exit(0)"', shell: SHELL, branchPolicy: 'feature', judge: { enabled: true, model: 'sonnet' },
  }));
  for (const [dir, body] of [
    [SPEC_A, '- [ ] **T005** A пятая\n- [ ] **T020** A двадцатая\n'],
    [SPEC_B, '- [ ] **T005** B пятая\n- [ ] **T020** B двадцатая\n- [ ] **T031** B уникальная\n'],
  ]) {
    fs.mkdirSync(path.join(root, ...dir.split('/')), { recursive: true });
    fs.writeFileSync(path.join(root, ...dir.split('/'), 'tasks.md'), body);
    fs.writeFileSync(path.join(root, ...dir.split('/'), 'spec.md'), `# ${dir}\n`);
  }
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  git(root, ['checkout', '-qb', 'work']);
  return root;
}
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });

test('park: запись несёт specPath той спеки, которую назвали', () => {
  const root = fixture();
  assert.equal(run(root, ['park', '--task', 'T020', '--reason', 'judge-block', '--spec', SPEC_A]).status, 0);
  const list = parked(root);
  assert.equal(list.length, 1);
  assert.equal(list[0].specPath, `${SPEC_A}/tasks.md`, 'без спеки строка неотличима от чужой задачи с тем же номером');
});

test('парковка одной спеки не прячет одноимённую задачу другой', () => {
  const root = fixture();
  run(root, ['park', '--task', 'T005,T020', '--reason', 'red-stop', '--spec', SPEC_B]);
  // Своя спека — задачи скрыты (парковка работает как раньше).
  assert.equal(nextId(root, ['--spec', SPEC_B]).id, 'T031');
  // Чужая — обязана быть видна целиком: это и есть дефект, который закрывает T008.
  assert.equal(nextId(root, ['--spec', SPEC_A]).id, 'T005', 'парковка спеки B не смеет закрывать план A');
  assert.deepEqual(
    JSON.parse(run(root, ['slice', 'next', '--json', '--count', '5', '--spec', SPEC_A]).stdout).map((x) => x.id),
    ['T005', 'T020'],
  );
});

test('legacy-строка без спеки: неоднозначный id никого не глушит и виден в stderr', () => {
  const root = fixture();
  writeParked(root, [{ tid: 'T020', reason: 'red-stop', ts: '2026-01-01T00:00:00.000Z', logPath: null, attempts: 1 }]);
  const a = nextId(root, ['--spec', SPEC_A]);
  assert.equal(a.id, 'T005');
  assert.deepEqual(
    JSON.parse(run(root, ['slice', 'next', '--json', '--count', '5', '--spec', SPEC_A]).stdout).map((x) => x.id),
    ['T005', 'T020'], 'T020 из A остаётся открытым: legacy-строка не доказывает, что павшая задача — эта',
  );
  assert.match(a.stderr, /T020/, 'пропуск обязан быть громким — иначе fail-closed это тихое игнорирование');
  // status показывает ту же неразрешимость, а не пустое поле.
  const st = JSON.parse(run(root, ['status']).stdout);
  assert.equal(st.parked[0].legacy, true);
  assert.deepEqual(st.parked[0].candidates.sort(), [`${SPEC_A}/tasks.md`, `${SPEC_B}/tasks.md`]);
});

test('legacy-строка с уникальным id мигрируется и продолжает прятать свою задачу', () => {
  const root = fixture();
  writeParked(root, [{ tid: 'T031', reason: 'red-stop', ts: '2026-01-01T00:00:00.000Z', logPath: null, attempts: 1 }]);
  assert.equal(nextId(root, ['--spec', SPEC_B]).id, 'T005');
  assert.deepEqual(
    JSON.parse(run(root, ['slice', 'next', '--json', '--count', '5', '--spec', SPEC_B]).stdout).map((x) => x.id),
    ['T005', 'T020'], 'T031 скрыт: спека выводится однозначно, догадки нет',
  );
  const st = JSON.parse(run(root, ['status']).stdout);
  assert.equal(st.parked[0].specPath, `${SPEC_B}/tasks.md`);
  assert.equal(st.parked[0].legacy, undefined);
});

test('park --clear --spec снимает ровно свою запись', () => {
  const root = fixture();
  run(root, ['park', '--task', 'T020', '--reason', 'red-stop', '--spec', SPEC_A]);
  run(root, ['park', '--task', 'T020', '--reason', 'red-stop', '--spec', SPEC_B]);
  assert.equal(parked(root).length, 2, 'два одинаковых id из разных спек — ДВЕ записи, а не одна перезаписанная');
  assert.equal(run(root, ['park', '--clear', '--task', 'T020', '--spec', SPEC_A]).status, 0);
  assert.deepEqual(parked(root).map((e) => e.specPath), [`${SPEC_B}/tasks.md`]);
  assert.equal(nextId(root, ['--spec', SPEC_A]).id, 'T005');
  assert.equal(nextId(root, ['--spec', SPEC_B]).id, 'T005');
});
