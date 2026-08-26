'use strict';
// 014 T011 (AC11) — `elt brief`: история файла ДО правки. Проверяем ровно то, ради чего он
// существует: пустой ответ на новый файл (не выдумывает), непустой на файл с историей, и что
// укладывается в бюджет 2 c (иначе его никто не будет звать перед каждым слайсом).
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const { brief, format, isRed } = require('./elt-brief');
const ELT = path.join(__dirname, 'elt.js');
const roots = [];
after(() => { for (const r of roots) try { fs.rmSync(r, { recursive: true, force: true }); } catch { /* windows lock */ } });

// Фикстура: git-история, где T001 трогал hot.js, а T002 — cold.js, плюс run-log с красными.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'elt-brief-'));
  roots.push(root);
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: root });
  const commit = (file, msg) => {
    fs.writeFileSync(path.join(root, file), `// ${msg}\n`);
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-qm', msg], { cwd: root });
  };
  commit('hot.js', 'feat: T001 горячий файл');
  commit('cold.js', 'feat: T002 спокойный файл');
  const dir = path.join(root, '.git', 'elt');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run-log.jsonl'), [
    { ts: '2026-08-01T10:00:00.000Z', task: 'T001', status: 'red-stop' },
    { ts: '2026-08-01T11:00:00.000Z', task: 'T001', verdict: 'block', reasons: ['scope creep', 'нет теста'] },
    { ts: '2026-08-01T12:00:00.000Z', task: 'T001', verdict: 'block', reasons: ['scope creep'] },
    { ts: '2026-08-01T13:00:00.000Z', task: 'T001', commit: 'abc', verdict: 'pass' },
    { ts: '2026-08-01T14:00:00.000Z', task: 'T002', commit: 'def', verdict: 'pass' },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.mkdirSync(path.join(root, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(root, '.harness', 'health.jsonl'),
    JSON.stringify({ ts: '2026-08-02T09:00:00.000Z', kind: 'red-repeat', key: 'k1', task: 'T001' }) + '\n');
  return root;
}

test('brief: новый файл — пустой результат, а не выдуманная история', () => {
  const b = brief(fixture(), ['brand-new.js']);
  assert.equal(b.runs, 0);
  assert.deepEqual(b.topReasons, []);
  assert.match(format(b), /истории нет/);
});

test('brief: файл с историей — счётчики, топ причин и дата инцидента', () => {
  const b = brief(fixture(), ['hot.js']);
  assert.deepEqual(b.tasks, ['T001'], 'задача выведена из git-истории файла, а не из имени');
  assert.equal(b.runs, 4);
  assert.equal(b.reds, 3, 'red-stop + два block; pass не красный');
  assert.deepEqual(b.topReasons[0], { reason: 'scope creep', count: 2 }, 'частая причина — первой');
  assert.equal(b.topReasons.length, 3, 'топ-3, не больше');
  assert.equal(b.lastIncident, '2026-08-02T09:00:00.000Z');
});

test('brief: чужая история не приписывается — соседний файл считается отдельно', () => {
  const b = brief(fixture(), ['cold.js']);
  assert.equal(b.reds, 0, 'красные T001 не переползают на файл, которого T001 не трогал');
  assert.equal(b.runs, 1);
});

test('brief: укладывается в бюджет 2 c (иначе его не будут звать перед слайсом)', () => {
  const root = fixture();
  const t = Date.now();
  brief(root, ['hot.js', 'cold.js']);
  assert.ok(Date.now() - t < 2000, `brief занял ${Date.now() - t} мс — бюджет AC11 два раза не переживёт`);
});

test('elt brief: CLI печатает человеку и --json машине; без файлов — явный отказ', () => {
  const root = fixture();
  const run = (args) => spawnSync(process.execPath, [ELT, ...args], { cwd: root, encoding: 'utf8' });
  const human = run(['brief', 'hot.js']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /scope creep/);
  const json = JSON.parse(run(['brief', 'hot.js', '--json']).stdout);
  assert.equal(json.reds, 3);
  assert.equal(run(['brief']).status, 4, 'без аргументов — отказ, а не brief по всему репо');
});

// 021 T006 — регресс, которого не было. Судья на b6cd3b4 (019/T001+T007) заблокировал слайс
// именно за это: `isRed()` расширили с одного терминала фона на все не-зелёные, но ни одна
// проверка на функцию не смотрела — «ни старая, ни новая логика не покрыты регрессом».
// Строка провисела в очереди разбора до релизного гейта.
//
// Что защищается: brief — это то, что человек читает ПЕРЕД правкой файла. Если
// `background-verify-dead` или `-inconclusive` снова станут «зелёными», в сводке пропадёт
// сигнал «здесь не смогли проверить», и человек пойдёт править вслепую, думая, что чисто.
test('isRed: каждый не-зелёный терминал фона считается красным, кроме -pass', () => {
  for (const status of ['background-verify-red', 'background-verify-dead', 'background-verify-inconclusive', 'background-verify-error']) {
    assert.equal(isRed({ status }), true, `${status} обязан читаться как красный: это «здесь не смогли проверить»`);
  }
  // Дискриминирующая половина: узкое сравнение `status === 'background-verify-red'` прошло бы
  // проверку выше только для первого случая, а вот эту строку не переживёт ни одна реализация,
  // которая красит фон целиком.
  assert.equal(isRed({ status: 'background-verify-pass' }), false, 'зелёный терминал фона не может быть красным');
});

test('isRed: прямые вердикты гейта и посторонние статусы различаются', () => {
  for (const e of [{ status: 'red-stop' }, { status: 'l0-block' }, { status: 'judge-block' }, { verdict: 'block' }]) {
    assert.equal(isRed(e), true, `${JSON.stringify(e)} — красный`);
  }
  for (const e of [{ status: 'ok' }, { status: 'green' }, { verdict: 'pass' }, {}]) {
    assert.equal(isRed(e), false, `${JSON.stringify(e)} не красный — иначе сводка станет сплошь красной и её перестанут читать`);
  }
  // Граница префикса: похожее имя из другого семейства цепляться не должно. Проверено
  // фактом, а не предположением — `background-verification-passed` расходится с
  // `background-verify` на 17-м символе, поэтому в красные не попадает.
  assert.equal(isRed({ status: 'background-verification-passed' }), false,
    'чужое имя, лишь похожее на префикс фона, не должно краснить сводку');
});
