'use strict';
// 009 T005 — heal видит ОШИБКУ, а не только собственный лог. Проверяем два контракта:
//   1. `elt oracle` кладёт вывод прогона в .harness/oracle-tail.log (cap, перезапись, игнор);
//   2. драйвер делает до 2 попыток self-heal, вторая с эффортом max — счётчик в run-log.

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
// maxBuffer и здесь: elt oracle переливает вывод прогона в свой stderr, и на болтливом
// оракуле дефолтный 1 МБ убил бы уже сам тест-вызов, а не проверяемый код.
function run(root, args) { return spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
function tail(root) { return fs.readFileSync(path.join(root, '.harness', 'oracle-tail.log'), 'utf8'); }

function fixture(oracle) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-tail-'));
  roots.push(root);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  fs.mkdirSync(path.join(root, '.harness'));
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', oracle, shell: SHELL, branchPolicy: 'feature', judge: { enabled: true, model: 'sonnet' },
  }));
  fs.mkdirSync(path.join(root, 'specs', '001-fixture'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', '001-fixture', 'tasks.md'), '- [ ] **T001** первая\n- [ ] **T002** вторая\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'seed']);
  git(root, ['checkout', '-qb', 'work']);
  return root;
}

test('elt oracle пишет вывод красного прогона в .harness/oracle-tail.log', () => {
  const root = fixture('node -e "console.error(\'ReferenceError: foo is not defined\'); process.exit(1)"');
  const r = run(root, ['oracle']);
  assert.equal(r.status, 1);
  assert.match(tail(root), /ReferenceError: foo is not defined/, 'heal обязан получить ТЕКСТ ошибки, а не пустой файл');
  assert.match(r.stderr, /ReferenceError/, 'захват вывода не должен его проглатывать — консоль по-прежнему всё видит');

  // хвост — состояние прогона, не артефакт репо: commit --task не смеет утащить его в слайс,
  // и дерево обязано остаться чистым (драйвер отличает «impl ничего не сделал» по porcelain)
  assert.equal(spawnSync('git', ['check-ignore', '.harness/oracle-tail.log'], { cwd: root }).status, 0);
  assert.equal(git(root, ['status', '--porcelain']), '');
});

test('хвост перезаписывается каждым прогоном и режется с ГОЛОВЫ (cap ~8K)', () => {
  const root = fixture('node -e "console.log(\'СТАРЫЙ ПРОГОН\')"');
  run(root, ['oracle']);
  assert.match(tail(root), /СТАРЫЙ ПРОГОН/);

  // 20K вывода: обрезка обязана оставить КОНЕЦ — стек и сообщение об ошибке идут последними
  fs.writeFileSync(path.join(root, '.harness', 'harness.json'), JSON.stringify({
    kind: 'code', shell: SHELL, branchPolicy: 'feature', judge: { enabled: true, model: 'sonnet' },
    oracle: 'node -e "console.log(\'x\'.repeat(20000)); console.error(\'ПОСЛЕДНЯЯ СТРОКА ОШИБКИ\')"',
  }));
  run(root, ['oracle']);
  const t = tail(root);
  assert.ok(!t.includes('СТАРЫЙ ПРОГОН'), 'хвост обязан перезаписываться, а не копиться');
  assert.ok(t.length <= 8000, `cap ~8K нарушен: ${t.length}`);
  assert.match(t, /ПОСЛЕДНЯЯ СТРОКА ОШИБКИ/, 'обрезать надо голову — ошибка живёт в конце вывода');
});

test('болтливый оракул не убивается буфером: exit-код верен, хвост = конец вывода', () => {
  // spawnSync с дефолтным maxBuffer (1 МБ) УБИВАЕТ процесс при превышении — красный
  // оракул на большом проекте отдал бы ложный провал и пустой хвост. 4 МБ вывода.
  const root = fixture('node -e "console.log(\'y\'.repeat(4000000)); console.error(\'ФИНАЛЬНАЯ ОШИБКА\'); process.exit(1)"');
  const r = run(root, ['oracle']);
  assert.equal(r.status, 1, 'exit-код оракула обязан пережить объём вывода');
  assert.match(tail(root), /ФИНАЛЬНАЯ ОШИБКА/, 'конец вывода обязан долетать до heal при любом объёме');
});

// 019 T007: сквозная проверка «две попытки self-heal, вторая на max» сняты вместе с
// `PowerShell-драйвер (снят 019/T007)` — счётчик попыток жил в самом драйвере. Механика heal переезжает в T012
// (`specs/019-elt-v5-phases-2-5/writer-prompt-v3.md`, раздел «Эффорт и self-heal»), где и
// получит новый исполняемый тест. Проверки самого хвоста оракула выше — не тронуты.

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});
